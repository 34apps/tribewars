// Game service: movement processing and every player action. All mutations run synchronously
// inside one BEGIN IMMEDIATE transaction (see Store.tx), so the database never holds half an action.

import {
  GameError,
  MAP_MAX_SPAN,
  RESOURCE_IDS,
  applyAttackerLosses,
  applyBattleToDefender,
  applyBuild,
  buildQueueLimit,
  applyReturn,
  applySend,
  applyShipmentArrival,
  applyShipmentSend,
  canCancel,
  createPlayerVillage,
  maxOutVillage,
  cancelDeadline,
  cancelReturnMs,
  checkShipment,
  shipmentTravelMs,
  SHIPMENT_MAX_IN_TRANSIT,
  SCOUT_UNIT,
  buildScoutIntel,
  keenMultiplier,
  rankOf,
  scoutStrength,
  applyTrain,
  applyResearch,
  applyRank,
  applyRespec,
  checkMission,
  checkSend,
  emptyResources,
  emptyUnits,
  hashSeed,
  isAttackForbidden,
  isSupportAllowed,
  normalizeUnits,
  resolveBattle,
  resolveScouting,
  settleVillage,
  totalUnits,
  travelTimeMs,
  villagePoints,
  type BattleReportData,
  type GameStateResponse,
  type MapResponse,
  type MapVillageDto,
  type Mission,
  type MovementDto,
  type MovementResponse,
  type OwnVillageDto,
  type PlayerDto,
  type ReportDto,
  type ReportListResponse,
  type Resources,
  type ScoutReportData,
  type SendResponse,
  type SendShipmentResponse,
  type StationedDto,
  type TribeAlertsResponse,
  type Units,
  type VillageRefDto,
  type WorldSettings,
  seesLeadershipBoards,
} from '@clanfire/engine';
import { loadRelationViewer, relationBetweenPlayers } from './relations.ts';
import type { MovementRow, MovementView, PlayerRow, Store, StationedRow, StationedView, VillageRecord, VillageStub } from './store.ts';
import { addUnits, isWithin, only, splitScoutLosses, subtractUnits, sumUnits } from './units.ts';

const BATCH_SIZE = 100;
const REPORT_LIST_LIMIT = 50;
const ALERT_LIST_LIMIT = 200;

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
 * Database rows keep the army's home village as `origin` for every kind. The DTO shows the physical
 * direction instead: a return travels from the village the troops were in (row target) back home (row origin).
 * Incoming attacks hide their units; incoming support shows them. `asSender` is for the host owner who just
 * sent stationed troops back: the return leaves their village, so it is theirs to see as outgoing.
 */
function movementDto(m: MovementView, viewerId: number, now: number, asSender = false): MovementDto {
  const outgoing = asSender || m.origin.ownerId === viewerId;
  const [from, to] = m.kind === 'return' ? [m.target, m.origin] : [m.origin, m.target];
  return {
    id: m.id,
    kind: m.kind,
    direction: outgoing ? 'outgoing' : 'incoming',
    origin: stubRef(from),
    target: stubRef(to),
    departAt: m.departAt,
    arriveAt: m.arriveAt,
    units: outgoing || m.kind === 'support' ? m.units : null,
    loot: outgoing && m.kind === 'return' ? (m.loot ?? emptyResources()) : null,
    resources: m.kind === 'shipment' ? (m.loot ?? emptyResources()) : null,
    cancellableUntil: outgoing && !asSender && canCancel(m, now) ? cancelDeadline(m.departAt) : null,
  };
}

function stationedDto(v: StationedView): StationedDto {
  return { id: v.id, home: stubRef(v.home), host: stubRef(v.host), units: v.units, arrivedAt: v.arrivedAt };
}

const floorResources = (r: Resources): Resources => {
  const out = emptyResources();
  for (const id of RESOURCE_IDS) out[id] = Math.floor(r[id]);
  return out;
};

const coords = (v: { x: number; y: number }): string => `(${v.x}|${v.y})`;

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
    switch (m.kind) {
      case 'attack':
        return this.resolveAttack(m);
      case 'scout':
        return this.resolveScout(m);
      case 'support':
        return this.resolveSupport(m);
      case 'shipment':
        return this.resolveShipment(m);
      case 'return':
        return this.resolveReturn(m);
    }
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
    // Support stationed at the target defends with the village's own troops.
    const contingents = this.store.stationedAt(target.id);

    const result = resolveBattle({
      attackerUnits: m.units,
      defender: targetState,
      support: contingents.map((c) => c.units),
      // Attacker and support use the ranks stamped when they left home; the defender's are its village's current ones.
      attackerRanks: m.ranks ?? undefined,
      defenderRanks: targetState.ranks,
      supportRanks: contingents.map((c) => c.ranks ?? undefined),
      seed: hashSeed(m.id, at),
    });
    const newTarget = applyBattleToDefender(targetState, result);
    const newOrigin = applyAttackerLosses(originState, result.attackerLosses);
    this.store.saveVillage(target.id, newTarget, villagePoints(newTarget));
    this.store.saveVillage(origin.id, newOrigin, villagePoints(newOrigin));
    // After the attacker's own village is saved: a support owner's home may be that very village.
    const supportLosses = contingents.map((_, i) => normalizeUnits(result.supportLosses[i]));
    this.applyContingentLosses(contingents, supportLosses, at);

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
      supportUnits: contingents.length > 0 ? sumUnits(contingents.map((c) => c.units)) : null,
      supportLosses: contingents.length > 0 ? sumUnits(supportLosses) : null,
      wallLevel: targetState.buildings.wall,
      loot: result.loot,
    };
    if (origin.ownerId !== null) {
      // An army wiped out sees nothing of the defence.
      const battle: BattleReportData = survived
        ? full
        : { ...full, defenderUnits: null, defenderLosses: null, supportUnits: null, supportLosses: null, wallLevel: null };
      this.store.insertReport({
        playerId: origin.ownerId,
        side: 'attack',
        won: result.attackerWon,
        title: `Raid on ${target.name} ${coords(target)}`,
        createdAt: at,
        type: 'battle',
        battle,
      });
    }
    if (target.ownerId !== null) {
      this.store.insertReport({
        playerId: target.ownerId,
        side: 'defense',
        won: !result.attackerWon,
        title: `Attack from ${origin.name} ${coords(origin)}`,
        createdAt: at,
        type: 'battle',
        battle: full,
      });
    }
    // Everyone who had troops standing there gets the full picture (one report per owner).
    for (const ownerId of new Set(contingents.map((c) => c.ownerPlayerId))) {
      this.store.insertReport({
        playerId: ownerId,
        side: 'support',
        won: !result.attackerWon,
        title: `Your troops at ${target.name} ${coords(target)} were attacked`,
        createdAt: at,
        type: 'battle',
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
        title: `Attack on ${target.name} ${coords(target)} called off`,
        createdAt: at,
        type: 'battle',
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
          supportUnits: null,
          supportLosses: null,
          wallLevel: null,
          loot: emptyResources(),
        },
      });
    }
    return this.turnBack(m, origin, target);
  }

  /**
   * Scouts reach the village. Defending Pathfinders are the village's own at home plus those of every stationed
   * support contingent. See GAME_DESIGN.md section 12.
   */
  private resolveScout(m: MovementRow): number | null {
    const s = this.settings;
    const origin = this.store.getVillage(m.originVillageId);
    const target = this.store.getVillage(m.targetVillageId);
    if (!origin || !target) {
      this.store.deleteMovement(m.id);
      return null;
    }
    const at = m.arriveAt;
    // Same targets as an attack. If the target became a tribe-mate, ally or NAP partner while they marched, the
    // scouts quietly turn back: nobody is told, there is no report.
    if (origin.ownerId !== null && target.ownerId !== null) {
      const rel = relationBetweenPlayers(this.store.tribes, origin.ownerId, target.ownerId, at);
      if (isAttackForbidden(rel.relation)) return this.turnBack(m, origin, target);
    }
    const originState = settleVillage(origin.state, at, s);
    const targetState = settleVillage(target.state, at, s);
    const contingents = this.store.stationedAt(target.id);
    const ownScouts = targetState.troops.pathfinder;
    const supportScouts = contingents.map((c) => c.units.pathfinder);
    const defenderScouts = ownScouts + supportScouts.reduce((a, b) => a + b, 0);
    const scoutsSent = m.units.pathfinder;

    // Keen ranks tilt the duel: the sender's stamped ranks against each defending Pathfinder's own village ranks.
    const result = resolveScouting({
      scouts: scoutsSent,
      defenderScouts,
      scoutMultiplier: keenMultiplier(m.ranks ?? undefined),
      defenderStrength: scoutStrength([
        { count: ownScouts, ranks: targetState.ranks },
        ...contingents.map((c) => ({ count: c.units.pathfinder, ranks: c.ranks ?? undefined })),
      ]),
    });

    // The sender's losses come off their `away` count; the survivors go home.
    const lost = only('pathfinder', result.scoutLosses);
    const newOrigin = applyAttackerLosses(originState, lost);
    this.store.saveVillage(origin.id, newOrigin, villagePoints(newOrigin));
    const survivors = subtractUnits(m.units, lost);

    // Defenders lose their own Pathfinders first; the rest is split between contingents by size.
    if (result.defenderScoutLosses > 0) {
      const split = splitScoutLosses(ownScouts, supportScouts, result.defenderScoutLosses);
      if (split.own > 0) {
        const hurt = { ...targetState, troops: { ...targetState.troops, pathfinder: ownScouts - split.own } };
        this.store.saveVillage(target.id, hurt, villagePoints(hurt));
      }
      this.applyContingentLosses(
        contingents,
        split.support.map((n) => only('pathfinder', n)),
        at,
      );
    }

    const data: ScoutReportData = {
      scout: refOf(origin),
      target: refOf(target),
      success: result.success,
      scoutsSent,
      scoutsLost: result.scoutLosses,
      defenderScouts: result.success ? defenderScouts : null,
      defenderScoutsLost: result.defenderScoutLosses,
      intel: result.success
        ? buildScoutIntel({
            keen: rankOf(m.ranks ?? undefined, SCOUT_UNIT, 'keen'),
            resources: floorResources(targetState.resources),
            buildings: targetState.buildings,
            troops: addUnits(targetState.troops, sumUnits(contingents.map((c) => c.units))),
            ranks: targetState.ranks,
          })
        : null,
    };
    if (origin.ownerId !== null) {
      this.store.insertReport({
        playerId: origin.ownerId,
        side: 'attack',
        won: result.success,
        title: `Scouting ${target.name} ${coords(target)}`,
        createdAt: at,
        type: 'scout',
        scout: data,
      });
    }
    // The target hears of it only if somebody was there to spot the scouts (their own or stationed Pathfinders).
    if (target.ownerId !== null && defenderScouts > 0) {
      this.store.insertReport({
        playerId: target.ownerId,
        side: 'defense',
        won: !result.success,
        title: `Enemy scouts from ${origin.name} ${coords(origin)}`,
        createdAt: at,
        type: 'scout',
        scout: { ...data, defenderScouts, intel: null },
      });
    }

    let spawned: number | null = null;
    if (totalUnits(survivors) > 0) {
      spawned = at + travelTimeMs({ x: target.x, y: target.y }, { x: origin.x, y: origin.y }, survivors, s);
      this.store.insertMovement({
        kind: 'return',
        originVillageId: origin.id,
        targetVillageId: target.id,
        units: survivors,
        loot: null,
        departAt: at,
        arriveAt: spawned,
      });
    }
    this.store.deleteMovement(m.id);
    return spawned;
  }

  /**
   * Support arrives. If the host is still a tribe-mate or ally the troops are stationed (merged into the pair's
   * contingent, still counted in their owner's `away`); otherwise they turn back and the sender is told.
   */
  private resolveSupport(m: MovementRow): number | null {
    const origin = this.store.getVillage(m.originVillageId);
    const host = this.store.getVillage(m.targetVillageId);
    if (!origin || !host || origin.ownerId === null) {
      this.store.deleteMovement(m.id);
      return null;
    }
    const at = m.arriveAt;
    const allowed =
      host.ownerId !== null && isSupportAllowed(relationBetweenPlayers(this.store.tribes, origin.ownerId, host.ownerId, at).relation);
    if (!allowed) {
      this.store.insertReport({
        playerId: origin.ownerId,
        side: 'support',
        won: false,
        title: `Support for ${host.name} ${coords(host)} turned back`,
        createdAt: at,
        type: 'support',
        support: { reason: 'relation_changed', home: refOf(origin), host: refOf(host), units: m.units },
      });
      return this.turnBack(m, origin, host);
    }
    this.store.addStationed(origin.ownerId, origin.id, host.id, m.units, at, m.ranks ?? null);
    this.store.deleteMovement(m.id);
    return null;
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

  /** The movement's troops turn round where they stand: an empty-handed return from `dest` home, and the order is done. */
  private turnBack(m: MovementRow, origin: VillageRecord, dest: VillageRecord): number {
    const back = this.insertReturn(origin, dest, m.units, m.arriveAt);
    this.store.deleteMovement(m.id);
    return back.arriveAt;
  }

  /** A return movement `from` (where the troops stand) to their home, leaving at `t`. */
  private insertReturn(
    home: VillageRecord,
    from: VillageRecord,
    units: Units,
    t: number,
    cargo?: Resources,
  ): { id: number; arriveAt: number } {
    // A turned-back shipment (no units) travels at carrier speed.
    const arriveAt = cargo
      ? t + shipmentTravelMs({ x: from.x, y: from.y }, { x: home.x, y: home.y }, this.settings)
      : t + travelTimeMs({ x: from.x, y: from.y }, { x: home.x, y: home.y }, units, this.settings);
    const id = this.store.insertMovement({
      kind: 'return',
      originVillageId: home.id,
      targetVillageId: from.id,
      units,
      loot: cargo ?? emptyResources(),
      departAt: t,
      arriveAt,
    });
    return { id, arriveAt };
  }

  /**
   * Stationed troops died: take the dead off each contingent (an empty one is deleted) and off their owner's home
   * village `away` count, settling that village first so the lower food upkeep only starts now.
   */
  private applyContingentLosses(contingents: readonly StationedRow[], losses: readonly Units[], t: number): void {
    contingents.forEach((c, i) => {
      const loss = losses[i];
      if (!loss || totalUnits(loss) === 0) return;
      const left = subtractUnits(c.units, loss);
      if (totalUnits(left) === 0) this.store.deleteStationed(c.id);
      else this.store.setStationedUnits(c.id, left);
      const home = this.store.getVillage(c.homeVillageId);
      if (!home) return;
      const next = applyAttackerLosses(settleVillage(home.state, t, this.settings), loss);
      this.store.saveVillage(home.id, next, villagePoints(next));
    });
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
      movements: this.store.movementViewsForPlayer(player.id).map((m) => movementDto(m, player.id, t)),
      unreadReports: this.store.unreadReportCount(player.id),
      unreadMail: this.store.mail.unreadCount(player.id),
      forumUnread: this.forumUnread(player.id),
      // Invitations only matter to tribeless players: they cannot accept while in a tribe.
      tribeInvites: dto.tribe === null ? this.store.tribes.countInvitesForPlayer(player.id, t) : 0,
      // Incoming attacks on any member's village (scouts and support don't count).
      tribeAlerts: dto.tribe === null ? 0 : this.store.countTribeAlerts(dto.tribe.id),
      stationed: {
        here: this.store.stationedHere(player.id).map(stationedDto),
        abroad: this.store.stationedAbroad(player.id).map(stationedDto),
      },
    };
  }

  /** Villages in the rectangle [x, x+w) x [y, y+h). */
  /** Forum threads with new posts for the player (0 when tribeless). */
  private forumUnread(playerId: number): number {
    const m = this.store.tribes.membership(playerId);
    return m ? this.store.forum.unreadCount(playerId, m.tribeId, seesLeadershipBoards(m.role, m.grants)) : 0;
  }

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
      // Abandoned villages grow lazily and their stored points only refresh when raided: settle in memory (no write on GET).
      points: r.npcState ? villagePoints(settleVillage(r.npcState, t, this.settings)) : r.points,
      protected: r.ownerId !== null && r.ownerProtectedUntil > t,
      tribeTag: r.ownerId === null ? null : r.ownerTribeTag,
      tribeId: r.ownerId === null ? null : r.ownerTribeId,
      ownerChieftain: r.ownerId === null ? null : r.ownerChieftain,
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
        type: r.type,
        won: r.won,
        read: r.read,
        outcome: r.outcome,
      })),
    };
  }

  /** Incoming attacks on villages of the player's tribe members, soonest first. Members only. */
  tribeAlerts(player: PlayerRow): TribeAlertsResponse {
    const tribe = this.store.tribes.playerTribe(player.id);
    if (!tribe) throw new GameError('not_in_tribe', 'You are not in a tribe.');
    return {
      alerts: this.store.tribeAlerts(tribe.id, ALERT_LIST_LIMIT).map((a) => ({
        movementId: a.movementId,
        target: stubRef(a.target),
        attacker: stubRef(a.attacker),
        attackerTribeTag: a.attackerTribeTag,
        departAt: a.departAt,
        arriveAt: a.arriveAt,
      })),
    };
  }

  /** The player's own report (marked read). Other players' reports look like missing ones. */
  getReport(player: PlayerRow, id: number): ReportDto {
    return this.store.tx(() => {
      const r = this.store.getReport(player.id, id);
      if (!r) throw new GameError('not_found', 'Report not found.');
      if (!r.read) this.store.markReportRead(player.id, id);
      return {
        id: r.id,
        createdAt: r.createdAt,
        title: r.title,
        side: r.side,
        type: r.type,
        won: r.won,
        read: true,
        outcome: r.outcome,
        battle: r.battle,
        scout: r.scout,
        support: r.support,
        shipment: r.shipment,
      };
    });
  }

  // ---- village actions ---------------------------------------------------------------------------

  build(player: PlayerRow, villageId: number, building: string, t: number): OwnVillageDto {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const next = applyBuild(v.state, building, t, this.settings, buildQueueLimit(player.premium));
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

  // Drillyard actions: owner-only (ownedVillage), server clock `t`, one transaction, engine re-checks everything.
  research(player: PlayerRow, villageId: number, unit: string, t: number): OwnVillageDto {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const next = applyResearch(v.state, unit, t, this.settings);
      this.store.saveVillage(v.id, next, villagePoints(next));
      return ownDto(v, next);
    });
  }

  rank(player: PlayerRow, villageId: number, unit: string, track: string, t: number): OwnVillageDto {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const next = applyRank(v.state, unit, track, t, this.settings);
      this.store.saveVillage(v.id, next, villagePoints(next));
      return ownDto(v, next);
    });
  }

  respec(player: PlayerRow, villageId: number, unit: string, track: string, t: number): OwnVillageDto {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const next = applyRespec(v.state, unit, track, t, this.settings);
      this.store.saveVillage(v.id, next, villagePoints(next));
      return ownDto(v, next);
    });
  }

  /**
   * Send troops on a mission (attack, scout or support). Order of checks: the target exists and is not yours, the
   * relation and beginner protection allow the mission, the army suits the mission, the troops are at home.
   */
  send(player: PlayerRow, villageId: number, x: number, y: number, units: Partial<Units>, mission: Mission, t: number): SendResponse {
    const s = this.settings;
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const target = this.store.getVillageAt(x, y);
      if (!target) throw new GameError('invalid_target', 'There is no village at those coordinates.');
      if (target.id === v.id || target.ownerId === player.id) {
        const what = mission === 'support' ? 'send support to' : mission === 'scout' ? 'scout' : 'attack';
        throw new GameError('invalid_target', `You cannot ${what} your own village.`);
      }
      if (target.ownerId !== null) this.refuseHousehold(player.id, target.ownerId);
      if (mission === 'support') {
        this.requireSupportable(player.id, target, t);
      } else {
        if (target.ownerId !== null) this.refuseProtectedByTribe(player.id, target.ownerId, t, mission);
        if (target.ownerId !== null && target.ownerProtectedUntil > t) {
          throw new GameError('target_protected', `${target.ownerName ?? 'This player'} is under beginner protection.`);
        }
      }

      const army = normalizeUnits(units);
      const fits = checkMission(mission, army);
      if (!fits.ok) throw new GameError(fits.reason, fits.message);
      const settled = settleVillage(v.state, t, s);
      const check = checkSend(settled, army);
      if (!check.ok) throw new GameError(check.reason, check.message);
      const next = applySend(settled, check.units, t, s);
      const travel = travelTimeMs({ x: v.x, y: v.y }, { x: target.x, y: target.y }, check.units, s);

      const movementId = this.store.insertMovement({
        kind: mission,
        originVillageId: v.id,
        targetVillageId: target.id,
        units: check.units,
        loot: null,
        departAt: t,
        arriveAt: t + travel,
        ranks: next.ranks ?? null, // stamped now: a later respec can't change a march in flight
      });
      this.store.saveVillage(v.id, next, villagePoints(next));
      // Raiding abandoned villages keeps beginner protection; attacking or scouting a player ends it. Support never does.
      if (mission !== 'support' && target.ownerId !== null) this.store.setProtectedUntil(player.id, 0);

      const view = this.store.getMovementView(movementId);
      if (!view) throw new Error('movement vanished after insert');
      return { village: ownDto(v, next), movement: movementDto(view, player.id, t) };
    });
  }

  /**
   * Send resources to any player village (own, tribe-mate, ally, neutral or enemy). The cargo leaves the village at once
   * (after catch-up) and is credited on arrival. Section 13 of GAME_DESIGN.
   */
  sendShipment(player: PlayerRow, villageId: number, x: number, y: number, cargo: unknown, t: number): SendShipmentResponse {
    const s = this.settings;
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const target = this.store.getVillageAt(x, y);
      if (!target) throw new GameError('invalid_target', 'There is no village at those coordinates.');
      if (target.id === v.id) throw new GameError('invalid_target', 'You cannot send resources to the same village.');
      // Abandoned villages (no owner) may receive too (owner, 2026-11-03); the household check only applies to players.
      if (target.ownerId !== null && target.ownerId !== player.id) this.refuseHousehold(player.id, target.ownerId, 'resources');
      if (this.store.shipmentsInTransit(v.id) >= SHIPMENT_MAX_IN_TRANSIT) {
        throw new GameError('queue_full', `This village already has ${SHIPMENT_MAX_IN_TRANSIT} shipments on the road. Wait for one to arrive.`);
      }
      const settled = settleVillage(v.state, t, s);
      const check = checkShipment(settled, cargo);
      if (!check.ok) throw new GameError(check.reason, check.message);
      const next = applyShipmentSend(settled, check.resources, t, s);
      const travel = shipmentTravelMs({ x: v.x, y: v.y }, { x: target.x, y: target.y }, s);
      const movementId = this.store.insertMovement({
        kind: 'shipment',
        originVillageId: v.id,
        targetVillageId: target.id,
        units: emptyUnits(),
        loot: check.resources,
        departAt: t,
        arriveAt: t + travel,
      });
      this.store.saveVillage(v.id, next, villagePoints(next));
      const view = this.store.getMovementView(movementId);
      if (!view) throw new Error('movement vanished after insert');
      return { village: ownDto(v, next), movement: movementDto(view, player.id, t) };
    });
  }

  /**
   * A shipment arrives. If the receiver is still allowed (own village, tribe-mate or ally) the cargo is added to the
   * stock, capped at the storehouse (the overflow is lost); otherwise it turns round and goes home.
   */
  private resolveShipment(m: MovementRow): number | null {
    const origin = this.store.getVillage(m.originVillageId);
    const target = this.store.getVillage(m.targetVillageId);
    const cargo = m.loot ?? emptyResources();
    if (!origin || !target) {
      this.store.deleteMovement(m.id);
      return null;
    }
    const at = m.arriveAt;
    const allowed = origin.ownerId !== null; // an abandoned target still takes the cargo
    if (!allowed) {
      const back = this.insertReturn(origin, target, emptyUnits(), at, cargo);
      this.store.deleteMovement(m.id);
      return back.arriveAt;
    }
    const before = settleVillage(target.state, at, this.settings);
    const next = applyShipmentArrival(target.state, cargo, at, this.settings);
    this.store.saveVillage(target.id, next, villagePoints(next));
    const stored = emptyResources();
    const lost = emptyResources();
    for (const r of RESOURCE_IDS) {
      stored[r] = Math.max(0, Math.min(cargo[r], Math.floor(next.resources[r] - before.resources[r] + 1e-6)));
      lost[r] = cargo[r] - stored[r];
    }
    const base = { from: refOf(origin), to: refOf(target), resources: cargo, stored, lost };
    this.store.insertReport({
      playerId: origin.ownerId!,
      side: 'shipment',
      won: true,
      title: `Shipment delivered to ${target.name} ${coords(target)}`,
      createdAt: at,
      type: 'shipment',
      shipment: { role: 'sent', ...base },
    });
    if (target.ownerId !== null && target.ownerId !== origin.ownerId) {
      this.store.insertReport({
        playerId: target.ownerId,
        side: 'shipment',
        won: true,
        title: `Shipment received from ${origin.name} ${coords(origin)}`,
        createdAt: at,
        type: 'shipment',
        shipment: { role: 'received', ...base },
      });
    }
    this.store.deleteMovement(m.id);
    return null;
  }

  /**
   * The sender calls an outgoing attack, scout, support or shipment back within CANCEL_WINDOW_MS of departure.
   * The troops (or cargo) return in exactly the time already travelled; nothing is looted. Others' movements look missing.
   */
  cancel(player: PlayerRow, movementId: number, t: number): MovementResponse {
    return this.store.tx(() => {
      const m = this.store.getMovement(movementId);
      const origin = m ? this.store.getVillage(m.originVillageId) : null;
      if (!m || !origin || origin.ownerId !== player.id) throw new GameError('not_found', 'Movement not found.');
      if (m.kind === 'return') throw new GameError('invalid_target', 'Returning troops cannot be cancelled.');
      if (t >= m.arriveAt) throw new GameError('too_late', 'It has already arrived.');
      if (!canCancel(m, t)) throw new GameError('too_late', 'It can only be cancelled in the first two minutes after leaving.');
      const dest = this.store.getVillage(m.targetVillageId);
      if (!dest) throw new GameError('not_found', 'Movement not found.');
      const id = this.store.insertMovement({
        kind: 'return',
        originVillageId: origin.id,
        targetVillageId: dest.id,
        units: m.units,
        loot: m.kind === 'shipment' ? (m.loot ?? emptyResources()) : emptyResources(),
        departAt: t,
        arriveAt: t + cancelReturnMs(m.departAt, t),
      });
      this.store.deleteMovement(m.id);
      const view = this.store.getMovementView(id);
      if (!view) throw new Error('movement vanished after insert');
      return { movement: movementDto(view, player.id, t) };
    });
  }

  /** The owner of stationed troops brings all or some of them home. */
  recall(player: PlayerRow, stationedId: number, units: Partial<Units> | undefined, t: number): MovementResponse {
    return this.store.tx(() => {
      const row = this.stationedFor(player, stationedId, 'owner');
      const want = units === undefined ? row.units : normalizeUnits(units);
      if (totalUnits(want) === 0) throw new GameError('no_troops', 'Select at least one unit.');
      if (!isWithin(want, row.units)) throw new GameError('not_enough_troops', 'You do not have that many troops stationed there.');
      return { movement: movementDto(this.dispatchHome(row, want, t), player.id, t) };
    });
  }

  /** The owner of the host village sends a contingent (all of it) back where it came from. */
  sendBack(player: PlayerRow, stationedId: number, t: number): MovementResponse {
    return this.store.tx(() => {
      const row = this.stationedFor(player, stationedId, 'host');
      if (totalUnits(row.units) === 0) throw new GameError('no_troops', 'There are no troops in that contingent.');
      return { movement: movementDto(this.dispatchHome(row, row.units, t), player.id, t, true) };
    });
  }

  // ---- helpers -----------------------------------------------------------------------------------

  /**
   * Take `units` out of the contingent (deleting it when empty) and start them walking from the host back home.
   * They stay in the owner's `away` count until the return arrives.
   */
  private dispatchHome(row: StationedRow, units: Units, t: number): MovementView {
    const home = this.store.getVillage(row.homeVillageId);
    const host = this.store.getVillage(row.hostVillageId);
    if (!home || !host) throw new GameError('not_found', 'Those troops are no longer stationed there.');
    const left = subtractUnits(row.units, units);
    if (totalUnits(left) === 0) this.store.deleteStationed(row.id);
    else this.store.setStationedUnits(row.id, left);
    const view = this.store.getMovementView(this.insertReturn(home, host, units, t).id);
    if (!view) throw new Error('movement vanished after insert');
    return view;
  }

  /**
   * A contingent as `role` sees it. Strangers get 404 (they cannot tell whether it exists); the other party to the
   * stationing gets 403 for an action that is not theirs.
   */
  private stationedFor(player: PlayerRow, id: number, role: 'owner' | 'host'): StationedRow {
    const row = this.store.getStationed(id);
    if (!row) throw new GameError('not_found', 'Stationed troops not found.');
    const isOwner = row.ownerPlayerId === player.id;
    const isHost = this.store.getVillage(row.hostVillageId)?.ownerId === player.id;
    if (!isOwner && !isHost) throw new GameError('not_found', 'Stationed troops not found.');
    if (role === 'owner' && !isOwner) throw new GameError('forbidden', 'Only the owner of the troops can recall them.');
    if (role === 'host' && !isHost) throw new GameError('forbidden', 'Only the owner of the village can send support troops back.');
    return row;
  }

  /** Support only goes to a village of a tribe-mate or an ally (never to abandoned villages, NAP partners, neutrals or enemies). */
  private requireSupportable(senderId: number, target: VillageRecord, t: number): void {
    const allowed =
      target.ownerId !== null && isSupportAllowed(relationBetweenPlayers(this.store.tribes, senderId, target.ownerId, t).relation);
    if (!allowed) throw new GameError('invalid_target', 'You can only send support to members of your own tribe and to allies.');
  }

  private playerDto(p: PlayerRow): PlayerDto {
    return { id: p.id, username: p.username, protectedUntil: p.protectedUntil, tribe: this.store.tribes.playerTribe(p.id), chieftain: p.chieftain, premium: p.premium, householdShared: p.householdShared, sandbox: this.store.isSandboxUser(p.username) };
  }

  /**
   * Sandbox (test mode): only accounts in SANDBOX_USERS. `max` fills every village of the player; `reset` makes each a
   * fresh starting village again. Returns the new state. Section "Sandbox" of GAME_DESIGN.
   */
  sandbox(player: PlayerRow, action: 'max' | 'reset', t: number): GameStateResponse {
    if (!this.store.isSandboxUser(player.username)) throw new GameError('forbidden', 'Test mode is not available for this account.');
    this.store.tx(() => {
      for (const v of this.store.villagesOfPlayer(player.id)) {
        if (action === 'max') {
          const next = maxOutVillage(settleVillage(v.state, t, this.settings), t);
          this.store.saveVillage(v.id, next, villagePoints(next));
        } else {
          this.store.clearVillageActivity(v.id);
          const fresh = createPlayerVillage(t);
          this.store.saveVillage(v.id, fresh, villagePoints(fresh));
        }
      }
    });
    return this.getState(player, t);
  }

  /** Accounts that share a connection may not attack, scout or support each other's villages (abandoned ones stay fair game). */
  private refuseHousehold(senderId: number, ownerId: number, what = 'troops'): void {
    if (this.store.shareAnIp(senderId, ownerId)) {
      const tail = what === 'troops' ? ' Abandoned villages are still fine.' : '';
      throw new GameError('invalid_target', `You share a connection with that player, so you cannot send ${what} to their villages.${tail}`);
    }
  }

  /** Tribe-mates, allies and NAP partners (also while a cancelled pact serves its notice) cannot be attacked or scouted. */
  private refuseProtectedByTribe(attackerId: number, ownerId: number, t: number, mission: Mission): void {
    const rel = relationBetweenPlayers(this.store.tribes, attackerId, ownerId, t);
    if (!isAttackForbidden(rel.relation)) return;
    const verb = mission === 'scout' ? 'scout' : 'attack';
    if (rel.relation === 'tribe') throw new GameError('invalid_target', `You can't ${verb} members of your own tribe.`);
    const pact = rel.relation === 'ally' ? 'an alliance' : 'a non-aggression pact';
    const ending = rel.endsAt === null ? '' : ' (it is being cancelled but still protects them during the notice period)';
    throw new GameError('target_protected', `You can't ${verb} [${rel.tag ?? '?'}]: your tribe has ${pact} with them${ending}.`);
  }

  private ownedVillage(player: PlayerRow, villageId: number): VillageRecord {
    const v = this.store.getVillage(villageId);
    if (!v) throw new GameError('not_found', 'Village not found.');
    if (v.ownerId !== player.id) throw new GameError('forbidden', 'That is not your village.');
    return v;
  }
}
