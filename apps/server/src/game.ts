// Game service: movement processing and every player action. All mutations run synchronously
// inside one BEGIN IMMEDIATE transaction (see Store.tx), so the database never holds half an action.

import {
  GameError,
  MAP_MAX_SPAN,
  applyAttackerLosses,
  applyBattleToDefender,
  applyBuild,
  applyReturn,
  applySend,
  applyTrain,
  checkSend,
  emptyResources,
  emptyUnits,
  hashSeed,
  isAttackForbidden,
  resolveBattle,
  settleVillage,
  totalUnits,
  travelTimeMs,
  villagePoints,
  type BattleReportData,
  type GameStateResponse,
  type MapResponse,
  type MapVillageDto,
  type MovementDto,
  type OwnVillageDto,
  type PlayerDto,
  type ReportDto,
  type ReportListResponse,
  type SendResponse,
  type Units,
  type VillageRefDto,
  type WorldSettings,
} from '@tribewars/engine';
import { loadRelationViewer, relationBetweenPlayers } from './relations.ts';
import type { MovementRow, MovementView, PlayerRow, Store, VillageRecord, VillageStub } from './store.ts';

const BATCH_SIZE = 100;
const REPORT_LIST_LIMIT = 50;

export interface GameLogger {
  error(obj: unknown, msg?: string): void;
}

function refOf(v: { id: number; name: string; x: number; y: number; ownerName: string | null }): VillageRefDto {
  return { villageId: v.id, name: v.name, x: v.x, y: v.y, ownerName: v.ownerName };
}

function ownDto(v: VillageRecord, state: OwnVillageDto['state']): OwnVillageDto {
  return { id: v.id, name: v.name, x: v.x, y: v.y, state };
}

function stubRef(s: VillageStub): VillageRefDto {
  return { villageId: s.villageId, name: s.name, x: s.x, y: s.y, ownerName: s.ownerName };
}

/**
 * Database rows keep the army's home village as `origin` for both kinds. The DTO shows the physical
 * direction instead: a return travels from the raided village (origin) back home (target).
 */
function movementDto(m: MovementView, viewerId: number): MovementDto {
  const outgoing = m.origin.ownerId === viewerId;
  const [from, to] = m.kind === 'return' ? [m.target, m.origin] : [m.origin, m.target];
  return {
    id: m.id,
    kind: m.kind,
    direction: outgoing ? 'outgoing' : 'incoming',
    origin: stubRef(from),
    target: stubRef(to),
    departAt: m.departAt,
    arriveAt: m.arriveAt,
    units: outgoing ? m.units : null,
    loot: outgoing && m.kind === 'return' ? (m.loot ?? emptyResources()) : null,
  };
}

export class GameService {
  constructor(
    private readonly store: Store,
    readonly settings: WorldSettings,
    private readonly log: GameLogger = { error: () => {} },
  ) {}

  // ---- time-ordered movement processing ---------------------------------------------------------

  /**
   * Resolve every movement that has arrived by `now`, oldest first, each in its own transaction.
   * Returns how many were handled.
   */
  processDue(now: number): number {
    let handled = 0;
    const failed = new Set<number>();
    for (;;) {
      const raw = this.store.dueMovements(now, BATCH_SIZE);
      const batch = raw.filter((m) => !failed.has(m.id));
      if (batch.length === 0) break;
      let refetch = false;
      for (const m of batch) {
        let spawnedArrival: number | null = null;
        try {
          spawnedArrival = this.store.tx(() => this.resolveMovement(m.id));
          handled++;
        } catch (err) {
          // Skip this movement for now so one bad row cannot block the whole queue.
          failed.add(m.id);
          this.log.error({ err, movementId: m.id }, 'movement processing failed');
        }
        // A return that is already due must run before later movements of this batch (time order).
        if (spawnedArrival !== null && spawnedArrival <= now) {
          refetch = true;
          break;
        }
      }
      if (!refetch && raw.length < BATCH_SIZE) break;
    }
    return handled;
  }

  /** Handle one movement. Returns the arrival time of a movement it created, if any. */
  private resolveMovement(id: number): number | null {
    const m = this.store.getMovement(id);
    if (!m) return null;
    return m.kind === 'attack' ? this.resolveAttack(m) : this.resolveReturn(m);
  }

  private resolveAttack(m: MovementRow): number | null {
    const s = this.settings;
    const origin = this.store.getVillage(m.originVillageId);
    const target = this.store.getVillage(m.targetVillageId);
    if (!origin || !target) {
      this.store.deleteMovement(m.id);
      return null;
    }
    const at = m.arriveAt;
    // Relations may have changed while the troops marched: an alliance, NAP or shared tribe calls the attack off.
    if (origin.ownerId !== null && target.ownerId !== null) {
      const rel = relationBetweenPlayers(this.store.tribes, origin.ownerId, target.ownerId, at);
      if (isAttackForbidden(rel.relation)) return this.callOffAttack(m, origin, target);
    }
    const originState = settleVillage(origin.state, at, s);
    const targetState = settleVillage(target.state, at, s);

    const result = resolveBattle({ attackerUnits: m.units, defender: targetState, seed: hashSeed(m.id, at) });
    const newTarget = applyBattleToDefender(targetState, result);
    const newOrigin = applyAttackerLosses(originState, result.attackerLosses);
    this.store.saveVillage(target.id, newTarget, villagePoints(newTarget));
    this.store.saveVillage(origin.id, newOrigin, villagePoints(newOrigin));

    const survived = totalUnits(result.attackerSurvivors) > 0;
    const full: BattleReportData = {
      outcome: 'battle',
      attacker: refOf(origin),
      defender: refOf(target),
      attackerWon: result.attackerWon,
      luck: result.luck,
      attackPower: result.attackPower,
      defensePower: result.defensePower,
      attackerUnits: m.units,
      attackerLosses: result.attackerLosses,
      defenderUnits: result.defenderUnits,
      defenderLosses: result.defenderLosses,
      wallLevel: targetState.buildings.wall,
      loot: result.loot,
    };
    if (origin.ownerId !== null) {
      // An army wiped out sees nothing of the defence.
      const battle: BattleReportData = survived ? full : { ...full, defenderUnits: null, defenderLosses: null, wallLevel: null };
      this.store.insertReport({
        playerId: origin.ownerId,
        side: 'attack',
        won: result.attackerWon,
        title: `Raid on ${target.name} (${target.x}|${target.y})`,
        createdAt: at,
        battle,
      });
    }
    if (target.ownerId !== null) {
      this.store.insertReport({
        playerId: target.ownerId,
        side: 'defense',
        won: !result.attackerWon,
        title: `Attack from ${origin.name} (${origin.x}|${origin.y})`,
        createdAt: at,
        battle: full,
      });
    }

    let spawned: number | null = null;
    if (survived) {
      const back = travelTimeMs({ x: target.x, y: target.y }, { x: origin.x, y: origin.y }, result.attackerSurvivors, s);
      spawned = at + back;
      this.store.insertMovement({
        kind: 'return',
        originVillageId: origin.id,
        targetVillageId: target.id,
        units: result.attackerSurvivors,
        loot: result.loot,
        departAt: at,
        arriveAt: spawned,
      });
    }
    this.store.deleteMovement(m.id);
    return spawned;
  }

  /**
   * The target turned out to be protected on arrival (same tribe, ally or NAP partner): no battle, the troops
   * turn back at once with nothing, and the attacker gets a "called off" report. Returns the return's arrival time.
   */
  private callOffAttack(m: MovementRow, origin: VillageRecord, target: VillageRecord): number | null {
    const at = m.arriveAt;
    if (origin.ownerId !== null) {
      this.store.insertReport({
        playerId: origin.ownerId,
        side: 'attack',
        won: false,
        title: `Attack on ${target.name} (${target.x}|${target.y}) called off`,
        createdAt: at,
        battle: {
          outcome: 'called_off',
          attacker: refOf(origin),
          defender: refOf(target),
          attackerWon: false,
          luck: 0,
          attackPower: 0,
          defensePower: 0,
          attackerUnits: m.units,
          attackerLosses: emptyUnits(),
          defenderUnits: null,
          defenderLosses: null,
          wallLevel: null,
          loot: emptyResources(),
        },
      });
    }
    const back = travelTimeMs({ x: target.x, y: target.y }, { x: origin.x, y: origin.y }, m.units, this.settings);
    const arriveAt = at + back;
    this.store.insertMovement({
      kind: 'return',
      originVillageId: origin.id,
      targetVillageId: target.id,
      units: m.units,
      loot: emptyResources(),
      departAt: at,
      arriveAt,
    });
    this.store.deleteMovement(m.id);
    return arriveAt;
  }

  private resolveReturn(m: MovementRow): null {
    const origin = this.store.getVillage(m.originVillageId);
    if (origin) {
      const next = applyReturn(origin.state, m.units, m.loot ?? emptyResources(), m.arriveAt, this.settings);
      this.store.saveVillage(origin.id, next, villagePoints(next));
    }
    this.store.deleteMovement(m.id);
    return null;
  }

  // ---- reads -------------------------------------------------------------------------------------

  getState(player: PlayerRow, t: number): GameStateResponse {
    const fresh = this.store.getPlayer(player.id) ?? player;
    const dto = this.playerDto(fresh);
    return {
      serverTime: t,
      settings: this.settings,
      player: dto,
      villages: this.store.villagesOfPlayer(player.id).map((v) => {
        const settled = settleVillage(v.state, t, this.settings);
        // Builds finish lazily; keep the map's cached points current once the owner looks.
        const points = villagePoints(settled);
        if (points !== v.points) this.store.setPoints(v.id, points);
        return ownDto(v, settled);
      }),
      movements: this.store.movementViewsForPlayer(player.id).map((m) => movementDto(m, player.id)),
      unreadReports: this.store.unreadReportCount(player.id),
      // Invitations only matter to tribeless players: they cannot accept while in a tribe.
      tribeInvites: dto.tribe === null ? this.store.tribes.countInvitesForPlayer(player.id, t) : 0,
    };
  }

  /** Villages in the rectangle [x, x+w) x [y, y+h). */
  map(player: PlayerRow, x: number, y: number, w: number, h: number, t: number): MapResponse {
    if (![x, y, w, h].every(Number.isInteger)) throw new GameError('invalid_input', 'x, y, w and h must be whole numbers.');
    if (w < 1 || h < 1 || w > MAP_MAX_SPAN || h > MAP_MAX_SPAN) {
      throw new GameError('invalid_input', `w and h must be from 1 to ${MAP_MAX_SPAN}.`);
    }
    // The viewer's tribe and relations are read once; the owner's tribe comes with each map row.
    const viewer = loadRelationViewer(this.store.tribes, player.id, t);
    const villages: MapVillageDto[] = this.store.mapVillages(x, x + w - 1, y, y + h - 1).map((r) => ({
      id: r.id,
      name: r.name,
      x: r.x,
      y: r.y,
      kind: r.ownerId === null ? 'abandoned' : r.ownerId === player.id ? 'own' : 'player',
      ownerName: r.ownerName,
      points: r.points,
      protected: r.ownerId !== null && r.ownerProtectedUntil > t,
      tribeTag: r.ownerId === null ? null : r.ownerTribeTag,
      tribeId: r.ownerId === null ? null : r.ownerTribeId,
      relation: r.ownerId === null ? null : viewer.relationTo(r.ownerId, r.ownerTribeId),
    }));
    return { villages };
  }

  listReports(player: PlayerRow): ReportListResponse {
    return {
      reports: this.store.listReports(player.id, REPORT_LIST_LIMIT).map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        title: r.title,
        side: r.side,
        won: r.won,
        read: r.read,
        outcome: r.outcome,
      })),
    };
  }

  /** The player's own report (marked read). Other players' reports look like missing ones. */
  getReport(player: PlayerRow, id: number): ReportDto {
    return this.store.tx(() => {
      const r = this.store.getReport(player.id, id);
      if (!r) throw new GameError('not_found', 'Report not found.');
      if (!r.read) this.store.markReportRead(player.id, id);
      return { id: r.id, createdAt: r.createdAt, title: r.title, side: r.side, won: r.won, read: true, outcome: r.outcome, battle: r.battle };
    });
  }

  // ---- village actions ---------------------------------------------------------------------------

  build(player: PlayerRow, villageId: number, building: string, t: number): OwnVillageDto {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const next = applyBuild(v.state, building, t, this.settings);
      this.store.saveVillage(v.id, next, villagePoints(next));
      return ownDto(v, next);
    });
  }

  train(player: PlayerRow, villageId: number, unit: string, count: number, t: number): OwnVillageDto {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const next = applyTrain(v.state, unit, count, t, this.settings);
      this.store.saveVillage(v.id, next, villagePoints(next));
      return ownDto(v, next);
    });
  }

  send(player: PlayerRow, villageId: number, x: number, y: number, units: Partial<Units>, t: number): SendResponse {
    const s = this.settings;
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const target = this.store.getVillageAt(x, y);
      if (!target) throw new GameError('invalid_target', 'There is no village at those coordinates.');
      if (target.id === v.id || target.ownerId === player.id) throw new GameError('invalid_target', 'You cannot attack your own village.');
      if (target.ownerId !== null) this.refuseProtectedByTribe(player.id, target.ownerId, t);
      if (target.ownerId !== null && target.ownerProtectedUntil > t) {
        throw new GameError('target_protected', `${target.ownerName ?? 'This player'} is under beginner protection.`);
      }

      const settled = settleVillage(v.state, t, s);
      const check = checkSend(settled, units);
      if (!check.ok) throw new GameError(check.reason, check.message);
      const next = applySend(settled, check.units, t, s);
      const travel = travelTimeMs({ x: v.x, y: v.y }, { x: target.x, y: target.y }, check.units, s);

      const movementId = this.store.insertMovement({
        kind: 'attack',
        originVillageId: v.id,
        targetVillageId: target.id,
        units: check.units,
        loot: null,
        departAt: t,
        arriveAt: t + travel,
      });
      this.store.saveVillage(v.id, next, villagePoints(next));
      // Raiding abandoned villages keeps beginner protection; attacking a player ends it.
      if (target.ownerId !== null) this.store.setProtectedUntil(player.id, 0);

      const view = this.store.getMovementView(movementId);
      if (!view) throw new Error('movement vanished after insert');
      return { village: ownDto(v, next), movement: movementDto(view, player.id) };
    });
  }

  // ---- helpers -----------------------------------------------------------------------------------

  private playerDto(p: PlayerRow): PlayerDto {
    return { id: p.id, username: p.username, protectedUntil: p.protectedUntil, tribe: this.store.tribes.playerTribe(p.id) };
  }

  /** Tribe-mates, allies and NAP partners (also while a cancelled pact serves its notice) cannot be attacked. */
  private refuseProtectedByTribe(attackerId: number, ownerId: number, t: number): void {
    const rel = relationBetweenPlayers(this.store.tribes, attackerId, ownerId, t);
    if (!isAttackForbidden(rel.relation)) return;
    if (rel.relation === 'tribe') throw new GameError('invalid_target', "You can't attack members of your own tribe.");
    const pact = rel.relation === 'ally' ? 'an alliance' : 'a non-aggression pact';
    const ending = rel.endsAt === null ? '' : ' (it is being cancelled but still protects them during the notice period)';
    throw new GameError('target_protected', `You can't attack [${rel.tag ?? '?'}]: your tribe has ${pact} with them${ending}.`);
  }

  private ownedVillage(player: PlayerRow, villageId: number): VillageRecord {
    const v = this.store.getVillage(villageId);
    if (!v) throw new GameError('not_found', 'Village not found.');
    if (v.ownerId !== player.id) throw new GameError('forbidden', 'That is not your village.');
    return v;
  }
}
