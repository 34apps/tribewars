// Game service: movement processing and every player action. All mutations run synchronously
// inside one BEGIN IMMEDIATE transaction (see Store.tx), so the database never holds half an action.

import { randomInt } from 'node:crypto';
import {
  BOT_BATCH_VILLAGES,
  BOT_MAX_STEPS_PER_RUN,
  GameError,
  HEARTH_PLAYERS_ENABLED,
  HOLD_MIN_POPULATION,
  UNIT_IDS,
  abandonVillageKeepBuildings,
  applyOwnerChange,
  applyStrike,
  checkFoundTarget,
  checkStrike,
  chieftainRefund,
  createFoundedVillage,
  foundedVillageName,
  holdDueAt,
  isAttackBlocked,
  occupierPopulation,
  underVillageLimit,
  updateHold,
  villageRenownCost,
  villageRenownPrice,
  type HearthInfoDto,
  type HearthState,
  type VillageListResponse,
  type VillageReportData,
  type VillageState,
  MAP_MAX_SPAN,
  MAX_BUILD_QUEUE,
  botBuildChoice,
  abandonIdleMs,
  botIdleMs,
  botStepMs,
  mulberry32,
  RESOURCE_IDS,
  applyAttackerLosses,
  applyBattleToDefender,
  applyBuild,
  applyCancelBuild,
  applyCancelResearch,
  applyCancelTrain,
  type CancelResponse,
  MAX_RESEARCH_QUEUE,
  applyFeast,
  collectDefenderRenown,
  defenderEligibleFrom,
  feastAllowance,
  makeRenownInfo,
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
  hasChosenSiege,
  hasSiegeUnits,
  isBuildingId,
  battleSeed,
  repeatRaidLootFactor,
  repeatRaidWindowMs,
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
  type BuildingId,
  type FeastResponse,
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
import { abandonedNoticeOf } from './auth.ts';
import { NPC_VILLAGE_NAME } from './world.ts';
import { loadRelationViewer, relationBetweenPlayers } from './relations.ts';
import { RenownService } from './renown-service.ts';
import { NEW_VILLAGE_NAME, hasUnpaidBuildRenown, type MovementRow, type MovementView, type PlayerRow, type Store, type StationedRow, type StationedView, type VillageRecord, type VillageStub } from './store.ts';
import { addUnits, isWithin, only, splitScoutLosses, subtractUnits, sumUnits } from './units.ts';

/** A village name: 1 to 30 letters, digits, spaces and . _ - ' (checked after trimming). */
const VILLAGE_NAME_PATTERN = /^[\p{L}\p{N} ._'-]{1,30}$/u;

const BATCH_SIZE = 100;
const REPORT_LIST_LIMIT = 50;
const ALERT_LIST_LIMIT = 200;

export interface GameLogger {
  error(obj: unknown, msg?: string): void;
}

function refOf(v: { id: number; name: string; x: number; y: number; ownerName: string | null }): VillageRefDto {
  return { villageId: v.id, name: v.name, x: v.x, y: v.y, ownerName: v.ownerName };
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

/** Chieftains a (settled) village holds for its owner's ledger: queued in the Banner Hall, at home and away. */
function chieftainsIn(st: VillageState): number {
  const queued = st.trainQueues.bannerhall.reduce((n, j) => n + (j.unit === 'chieftain' ? j.count - j.done : 0), 0);
  return st.troops.chieftain + st.away.chieftain + queued;
}

/** Public numbers of a hearth that is out, computed at `t`; the claimant's name comes from `claimName`. */
function hearthDto(h: HearthState, t: number, s: WorldSettings, claimName: string, occupierPop?: number): HearthInfoDto {
  const running = h.runningSince !== null;
  return {
    claimBy: claimName,
    claimById: h.claimBy,
    outAt: h.outAt,
    running,
    endsAt: running ? holdDueAt(h, s) : null,
    holdMsLeft: running ? Math.max(0, h.runningSince! + h.holdMs - t) : h.holdMs,
    failsAt: running ? null : holdDueAt(h, s),
    minPopulation: HOLD_MIN_POPULATION,
    ...(occupierPop !== undefined ? { occupierPopulation: occupierPop } : {}),
  };
}

export class GameService {
  /** Secret battle salt, read from the database on first battle. */
  private salt: number[] | null = null;

  private readonly renown: RenownService;

  /**
   * May a Strike put out the hearth of a PLAYER village? Off in step 2 (HEARTH_PLAYERS_ENABLED); public so tests can switch
   * it on to exercise the player path (taking, restart) that step 4 will open.
   */
  strikePlayers: boolean = HEARTH_PLAYERS_ENABLED;

  /** Earliest arrival of any return created since it was last reset (hold events report what they spawned through it). */
  private spawnMin: number | null = null;

  constructor(
    private readonly store: Store,
    readonly settings: WorldSettings,
    private readonly log: GameLogger = { error: () => {} },
  ) {
    this.renown = new RenownService(store, settings);
  }

  // ---- caretaker bot (docs/GAME_DESIGN.md section 17) ----------------------------------------------

  /**
   * One pass of the caretaker: for villages of idle (and not banned) owners that are due, settle to `now` and queue
   * up to BOT_MAX_STEPS_PER_RUN random affordable builds through the normal build rules. It never trains, researches
   * or sends anything. Each village runs in its own transaction; at most BOT_BATCH_VILLAGES per pass. Returns the
   * number of builds queued.
   */
  runCaretaker(now: number): number {
    const s = this.settings;
    // Every movement due by `now` must be resolved before any village is settled to `now`: settling past an
    // arrival would make the later battle see the village in the wrong (future) state.
    this.processDue(now);
    this.abandonIdleVillages(now);
    const due = this.store.botDueVillages(now, now - botIdleMs(s), BOT_BATCH_VILLAGES);
    let queued = 0;
    for (const v of due) {
      try {
        queued += this.store.tx(() => this.caretakeVillage(v.id, now));
      } catch (err) {
        this.log.error({ err, villageId: v.id }, 'caretaker failed');
      }
    }
    return queued;
  }

  /**
   * Villages of owners away for ABANDON_IDLE_DAYS become abandoned villages that KEEP ALL THEIR BUILDINGS (engine
   * `abandonVillageKeepBuildings`: a valuable target, garrison for its Town Hall level). Queues, the owner's old troops and the
   * contingents of the village are cleared (troops of the owner that were away are disbanded); support of others standing in it
   * goes home. Owners still under beginner protection and sandbox accounts are skipped. The Chieftains of the village leave the
   * Renown ledger like dead ones.
   */
  private abandonIdleVillages(now: number): void {
    for (const v of this.store.abandonDueVillages(now - abandonIdleMs(this.settings), now, BOT_BATCH_VILLAGES)) {
      try {
        this.store.tx(() => this.abandonVillage(v, now));
      } catch (err) {
        this.log.error({ err, villageId: v.id }, 'abandon failed');
      }
    }
  }

  private abandonVillage(v: VillageRecord, now: number): void {
    const s = this.settings;
    const ownerId = v.ownerId;
    if (ownerId === null) return;
    const shares = this.sharesBefore([ownerId], now);
    const lostChieftains = chieftainsIn(settleVillage(v.state, now, s));
    // The owner's armies and contingents are gone; everybody else's troops standing here go home.
    for (const m of this.store.movementsFrom(v.id)) this.store.deleteMovement(m.id);
    for (const c of this.store.stationedHomedAt(v.id)) this.store.deleteStationed(c.id);
    this.sendHostedHome(v, now);
    const claim = v.state.hearth;
    const next = abandonVillageKeepBuildings(v.state, now, s, randomInt(0, 0xffffffff));
    this.store.releaseVillage(v.id, NPC_VILLAGE_NAME); // before the save: villages without an owner pay no Renown
    this.store.saveVillage(v.id, next, villagePoints(next));
    this.loseChieftains(ownerId, lostChieftains, shares);
    this.store.addAbandonedNotice(ownerId, 1); // shown once on their return
    if (claim) this.reportClaimFailed(claim.claimBy, v, 'relit', now, undefined);
  }

  /** Send every contingent standing in `host` home (their owners' villages) and delete it. Returns the units that went. */
  private sendHostedHome(host: VillageRecord, at: number, only?: (c: StationedRow) => boolean): void {
    for (const c of this.store.stationedAt(host.id)) {
      if (only && !only(c)) continue;
      this.store.deleteStationed(c.id);
      const home = this.store.getVillage(c.homeVillageId);
      if (home && home.id !== host.id && home.ownerId === c.ownerPlayerId) this.insertReturn(home, host, c.units, at);
    }
  }

  private caretakeVillage(villageId: number, now: number): number {
    const s = this.settings;
    const v = this.store.getVillage(villageId);
    if (!v || v.ownerId === null) return 0;
    const stepMs = botStepMs(s);
    let state = settleVillage(v.state, now, s);
    let queued = 0;
    for (let i = 0; i < BOT_MAX_STEPS_PER_RUN; i++) {
      const choice = botBuildChoice(state, now, s, mulberry32(hashSeed(v.id, Math.floor(now / stepMs), i)), MAX_BUILD_QUEUE);
      if (!choice) break;
      state = applyBuild(state, choice, now, s, MAX_BUILD_QUEUE);
      queued++;
    }
    if (queued > 0) this.store.saveVillage(v.id, state, villagePoints(state));
    this.store.setBotNextAt(v.id, now + stepMs);
    return queued;
  }

  // ---- time-ordered movement processing ---------------------------------------------------------

  /**
   * Resolve every movement that has arrived by `now`, oldest first, each in its own transaction.
   * Returns how many were handled.
   */
  processDue(now: number): number {
    let handled = 0;
    const failed = new Set<number>();
    const failedHolds = new Set<number>();
    for (;;) {
      const raw = this.store.dueMovements(now, BATCH_SIZE);
      const batch = raw.filter((m) => !failed.has(m.id));
      let restart = false;
      for (const m of batch) {
        // A hold clock that ends at or before this arrival comes first: movements and hold events run in one time order.
        const hold = this.runDueHolds(m.arriveAt, failedHolds);
        handled += hold.handled;
        if (hold.spawn !== null && hold.spawn <= now) {
          restart = true;
          break;
        }
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
          restart = true;
          break;
        }
      }
      if (restart) continue;
      if (batch.length > 0 && raw.length >= BATCH_SIZE) continue; // more movements may be due; hold events wait behind them
      const hold = this.runDueHolds(now, failedHolds);
      handled += hold.handled;
      if (hold.spawn !== null && hold.spawn <= now) continue;
      break;
    }
    return handled;
  }

  /**
   * Hold clocks and fail timers that are due by `limitAt`, earliest first, each in its own transaction. Returns how many ran and
   * the earliest arrival of anything they sent walking (the caller re-reads the movement queue when that is already due).
   */
  private runDueHolds(limitAt: number, failed: Set<number>): { handled: number; spawn: number | null } {
    let handled = 0;
    let spawn: number | null = null;
    for (;;) {
      const due = this.store.dueHolds(limitAt, BATCH_SIZE).filter((d) => !failed.has(d.id));
      if (due.length === 0) break;
      for (const d of due) {
        this.takeSpawn();
        try {
          this.store.tx(() => this.refreshHold(d.id, d.dueAt));
          handled++;
        } catch (err) {
          failed.add(d.id);
          this.log.error({ err, villageId: d.id }, 'hold processing failed');
          continue;
        }
        const made = this.takeSpawn();
        if (made !== null) spawn = spawn === null ? made : Math.min(spawn, made);
        const after = this.store.getVillage(d.id);
        if (after && after.holdDueAt !== null && after.holdDueAt <= d.dueAt) failed.add(d.id); // no progress: never loop on it
      }
    }
    return { handled, spawn };
  }

  /** Handle one movement. Returns the arrival time of a movement it created, if any. */
  private resolveMovement(id: number): number | null {
    const m = this.store.getMovement(id);
    if (!m) return null;
    this.takeSpawn(); // forget returns noted by earlier (possibly rolled back) work
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
      case 'found':
        return this.resolveFound(m);
      case 'occupy':
        return this.resolveOccupy(m);
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
    // Your own claim is not a target (the occupiers there are yours); a founded or restarted village is protected for a while.
    if (origin.ownerId !== null && target.state.hearth?.claimBy === origin.ownerId) return this.callOffAttack(m, origin, target);
    if (isAttackBlocked(target.state, at)) return this.callOffAttack(m, origin, target);
    const originState = settleVillage(origin.state, at, s);
    const targetState = settleVillage(target.state, at, s);
    // Support stationed at the target defends with the village's own troops.
    const contingents = this.store.stationedAt(target.id);
    // An attack with Chieftains is a Strike attempt, not a raid: it carries no loot.
    const strikeTry = m.units.chieftain > 0 && origin.ownerId !== null;

    // Repeat raids on an abandoned village by the same player carry less each time (docs/GAME_DESIGN.md section 5).
    const raidWindow = repeatRaidWindowMs(s);
    const lootFactor = strikeTry
      ? 0
      : target.ownerId === null && origin.ownerId !== null
        ? repeatRaidLootFactor(this.store.countNpcRaids(origin.ownerId, target.id, at - raidWindow, at))
        : 1;

    const result = resolveBattle({
      attackerUnits: m.units,
      defender: targetState,
      support: contingents.map((c) => c.units),
      // Attacker and support use the ranks stamped when they left home; the defender's are its village's current ones.
      attackerRanks: m.ranks ?? undefined,
      defenderRanks: targetState.ranks,
      supportRanks: contingents.map((c) => c.ranks ?? undefined),
      seed: battleSeed((this.salt ??= this.store.battleSalt()), m.id, at),
      lootFactor,
      siegeTarget: m.siegeTarget ?? null,
    });
    if (result.attackerWon && target.ownerId === null && origin.ownerId !== null && !strikeTry) {
      this.store.recordNpcRaid(origin.ownerId, target.id, at, at - raidWindow);
    }
    // Chieftain ledger: each owner's average reservation is read BEFORE any village is changed (the dead still count).
    const supportLosses = contingents.map((_, i) => normalizeUnits(result.supportLosses[i]));
    const chiefLosses: Array<[number | null, number]> = [
      [origin.ownerId, result.attackerLosses.chieftain],
      [target.ownerId, result.defenderLosses.chieftain],
      ...contingents.map((c, i): [number, number] => [c.ownerPlayerId, supportLosses[i]?.chieftain ?? 0]),
    ];
    const shares = chiefLosses.some(([, n]) => n > 0) ? this.sharesBefore(chiefLosses.map(([id]) => id), at) : null;
    const newTarget = applyBattleToDefender(targetState, result);
    const newOrigin = applyAttackerLosses(originState, result.attackerLosses);
    this.store.saveVillage(target.id, newTarget, villagePoints(newTarget));
    this.store.saveVillage(origin.id, newOrigin, villagePoints(newOrigin));
    // After the attacker's own village is saved: a support owner's home may be that very village.
    this.applyContingentLosses(contingents, supportLosses, at);
    if (shares) for (const [id, n] of chiefLosses) if (id !== null) this.loseChieftains(id, n, shares);

    this.countBattleStats(origin, target, contingents, result, supportLosses);
    // Combat Renown (bonus source, section 18.2): states are the settled, pre-battle ones; who earns is decided in the service.
    const renownGained = this.renown.awardBattle({
      at,
      result,
      origin,
      target,
      originState,
      targetState,
      attackerRanks: m.ranks ?? undefined,
      contingents,
    });
    const gained = (playerId: number | null): { renownGained?: number } => {
      const n = playerId === null ? 0 : (renownGained.get(playerId) ?? 0);
      return n > 0 ? { renownGained: n } : {};
    };

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
      ...(lootFactor < 1 ? { lootShare: Math.round(lootFactor * 100) } : {}),
      ...(hasSiegeUnits(m.units) ? { siege: result.siege ?? [] } : {}),
    };
    if (origin.ownerId !== null) {
      // An army wiped out sees nothing of the defence (nor of any siege).
      const { siege: _siege, ...withoutSiege } = full;
      const battle: BattleReportData = survived
        ? full
        : { ...withoutSiege, defenderUnits: null, defenderLosses: null, supportUnits: null, supportLosses: null, wallLevel: null };
      this.store.insertReport({
        playerId: origin.ownerId,
        side: 'attack',
        won: result.attackerWon,
        title: `Raid on ${target.name} ${coords(target)}`,
        createdAt: at,
        type: 'battle',
        battle: { ...battle, ...gained(origin.ownerId) },
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
        battle: { ...full, ...gained(target.ownerId) },
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
        battle: { ...full, ...gained(ownerId) },
      });
    }

    // Strike: a won battle with enough surviving Chieftains puts the hearth out; the survivors stay as the first occupiers.
    let struck = false;
    if (strikeTry && survived && origin.ownerId !== null) {
      const check = checkStrike(
        result,
        result.attackerSurvivors,
        {
          abandoned: target.ownerId === null,
          points: villagePoints(targetState),
          now: at,
          lockUntil: targetState.lockUntil,
          protectedUntil: targetState.protectedUntil,
        },
        { playersEnabled: this.strikePlayers },
      );
      // Same connection as the owner: no Strike (the battle itself stands).
      const household = target.ownerId !== null && this.store.shareAnIp(origin.ownerId, target.ownerId);
      if (check.ok && !household) {
        this.strike(origin, target, newTarget, targetState.hearth, result.attackerSurvivors, m, at);
        struck = true;
      }
    }
    // Any other battle at a cold village changes who stands there: the hold clock follows.
    if (!struck && target.state.hearth) this.refreshHold(target.id, at);

    let spawned: number | null = null;
    if (survived && !struck) {
      const back = m.returnSecs != null ? m.returnSecs * 1000 : travelTimeMs({ x: target.x, y: target.y }, { x: origin.x, y: origin.y }, result.attackerSurvivors, s);
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
    const sent = this.takeSpawn(); // returns the hold update sent walking (occupiers going home)
    return spawned === null ? sent : sent === null ? spawned : Math.min(spawned, sent);
  }

  // ---- Strike and Hold (docs/GAME_DESIGN.md 18.2) -------------------------------------------------------------

  /**
   * The hearth goes out: the surviving army stays at the village as occupiers (a stationed contingent owned by the attacker), the
   * hold clock starts through the engine, and its due time is stored so processDue runs it in time order. A claim of somebody
   * else that was already running is replaced. `afterBattle` is the target's state with the battle's losses and loot applied.
   */
  private strike(
    origin: VillageRecord,
    target: VillageRecord,
    afterBattle: VillageState,
    previous: HearthState | undefined,
    survivors: Units,
    m: MovementRow,
    at: number,
  ): void {
    const s = this.settings;
    const claimant = origin.ownerId as number;
    this.store.addStationed(claimant, origin.id, target.id, survivors, at, m.ranks ?? null);
    const occupiers = sumUnits(this.store.stationedAt(target.id).filter((c) => c.ownerPlayerId === claimant).map((c) => c.units));
    const cold = applyStrike(afterBattle, { claimBy: claimant, now: at, settings: s, occupiers });
    this.store.saveVillage(target.id, cold, villagePoints(cold));
    if (cold.hearth) this.store.setHoldDue(target.id, holdDueAt(cold.hearth, s));
    const holdEndsAt = cold.hearth?.runningSince != null ? cold.hearth.runningSince + cold.hearth.holdMs : null;
    const ref = refOf(target);
    this.store.insertReport({
      playerId: claimant,
      side: 'attack',
      won: true,
      title: `Hearth out at ${target.name} ${coords(target)}`,
      createdAt: at,
      type: 'village',
      village: { kind: 'struck', village: ref, holdEndsAt },
    });
    if (target.ownerId !== null) {
      this.store.insertReport({
        playerId: target.ownerId,
        side: 'defense',
        won: false,
        title: `Hearth out at ${target.name} ${coords(target)}`,
        createdAt: at,
        type: 'village',
        village: { kind: 'hearth_out', village: ref, claimBy: origin.ownerName ?? undefined, holdEndsAt },
      });
    }
    if (previous && previous.claimBy !== claimant) this.reportClaimFailed(previous.claimBy, target, 'replaced', at, undefined);
  }

  /**
   * Bring the hold clock of a cold village to `at` with the occupiers it has now (the claimant's contingents standing there), and
   * act on the outcome: keep running or paused, village taken, claim failed or hearth relit. Call it at every event that changes
   * the occupiers (arrival, battle, recall) and when the stored due time passes. Never touches lit villages.
   */
  private refreshHold(villageId: number, at: number): void {
    const v = this.store.getVillage(villageId);
    if (!v) return;
    const h = v.state.hearth;
    if (!h) {
      if (v.holdDueAt !== null) this.store.setHoldDue(v.id, null);
      return;
    }
    const occupiers = sumUnits(this.store.stationedAt(v.id).filter((c) => c.ownerPlayerId === h.claimBy).map((c) => c.units));
    const up = updateHold(h, occupierPopulation(occupiers), at, this.settings);
    if (up.outcome === 'taken') return this.completeTake(v, h, up.at);
    if (up.outcome === 'failed') return this.endClaim(v, h, 'time', up.at);
    if (up.outcome === 'relit' || !up.hearth) return this.endClaim(v, h, 'relit', up.at);
    const state = { ...v.state, hearth: up.hearth };
    this.store.saveVillage(v.id, state, v.points);
    this.store.setHoldDue(v.id, holdDueAt(up.hearth, this.settings));
  }

  /** The claim ended without taking the village: the hearth burns again and the claimant's occupiers walk home. */
  private endClaim(v: VillageRecord, h: HearthState, reason: 'time' | 'relit' | 'no_room', at: number): void {
    const settled = settleVillage(v.state, at, this.settings); // the village was frozen; production resumes from `at`
    delete settled.hearth;
    this.store.saveVillage(v.id, settled, villagePoints(settled));
    this.store.setHoldDue(v.id, null);
    const sent = sumUnits(this.store.stationedAt(v.id).filter((c) => c.ownerPlayerId === h.claimBy).map((c) => c.units));
    this.sendHostedHome(v, at, (c) => c.ownerPlayerId === h.claimBy);
    this.reportClaimFailed(h.claimBy, v, reason, at, sent);
    if (v.ownerId !== null) {
      this.store.insertReport({
        playerId: v.ownerId,
        side: 'defense',
        won: true,
        title: `Hearth relit at ${v.name} ${coords(v)}`,
        createdAt: at,
        type: 'village',
        village: { kind: 'relit', village: refOf(v) },
      });
    }
  }

  private reportClaimFailed(claimant: number, v: VillageRecord, reason: NonNullable<VillageReportData['reason']>, at: number, units: Units | undefined): void {
    this.store.insertReport({
      playerId: claimant,
      side: 'attack',
      won: false,
      title: `Claim on ${v.name} ${coords(v)} ended`,
      createdAt: at,
      type: 'village',
      village: { kind: 'claim_failed', village: refOf(v), reason, ...(units && totalUnits(units) > 0 ? { units } : {}) },
    });
  }

  /**
   * The hold clock ran out: the village changes owner in ONE transaction (the caller's). All buildings stay; the claimant's
   * occupiers move in up to the population cap (the rest walks home), one Chieftain is used up; the old owner's troops, queues
   * and contingents are gone and everyone else's troops standing here go home. `at` is the exact end of the clock.
   */
  private completeTake(v: VillageRecord, h: HearthState, at: number): void {
    const s = this.settings;
    const claimant = this.store.getPlayer(h.claimBy);
    const owned = claimant ? this.store.villagesOfPlayer(claimant.id).length : 0;
    if (!claimant || !underVillageLimit(owned)) return this.endClaim(v, h, 'no_room', at);

    const oldOwnerId = v.ownerId;
    const shares = this.sharesBefore([claimant.id, oldOwnerId], at);
    const rows = this.store.stationedAt(v.id);
    const occ = rows.filter((c) => c.ownerPlayerId === claimant.id);

    // The old owner's side of the village: what it held and what was away from it is disbanded (the engine rule).
    let lostUnits: Units | null = null;
    if (oldOwnerId !== null) {
      const old = settleVillage(v.state, at, s);
      lostUnits = addUnits(old.troops, old.away);
      this.loseChieftains(oldOwnerId, chieftainsIn(old), shares);
      for (const mv of this.store.movementsFrom(v.id)) this.store.deleteMovement(mv.id);
      for (const c of this.store.stationedHomedAt(v.id)) this.store.deleteStationed(c.id);
    }

    const change = applyOwnerChange(v.state, { newOwnerOccupiers: sumUnits(occ.map((c) => c.units)), now: at, settings: s });
    const name = foundedVillageName(claimant.username, owned + 1);
    this.store.setVillageOwner(v.id, claimant.id, name);
    this.store.saveVillage(v.id, change.state, villagePoints(change.state));

    // Occupiers: each contingent's home loses the units that moved in (the new village feeds them now) and the Chieftain used up;
    // what did not fit walks home.
    const overflowLeft = { ...change.overflow };
    const overflowTotal = emptyUnits();
    const here: VillageRecord = { ...v, ownerId: claimant.id, ownerName: claimant.username, name };
    for (const c of occ) {
      this.store.deleteStationed(c.id);
      const home = this.store.getVillage(c.homeVillageId);
      if (!home || home.id === v.id) continue;
      const back = emptyUnits();
      const gone = emptyUnits(); // moved in, or the Chieftain used up
      for (const u of UNIT_IDS) {
        const take = Math.min(c.units[u], overflowLeft[u]);
        back[u] = take;
        overflowLeft[u] -= take;
        gone[u] = c.units[u] - take;
      }
      const next = applyAttackerLosses(settleVillage(home.state, at, s), gone);
      this.store.saveVillage(home.id, next, villagePoints(next));
      if (totalUnits(back) > 0) {
        this.insertReturn(home, here, back, at);
        for (const u of UNIT_IDS) overflowTotal[u] += back[u];
      }
    }
    this.consumeChieftains(claimant.id, change.chieftainUsed, shares);
    // Everyone else's troops standing here go home.
    this.sendHostedHome(v, at);

    const ref = refOf(here);
    this.store.insertReport({
      playerId: claimant.id,
      side: 'attack',
      won: true,
      title: `Village taken: ${name} ${coords(v)}`,
      createdAt: at,
      type: 'village',
      village: { kind: 'taken', village: ref, ...(totalUnits(overflowTotal) > 0 ? { overflow: overflowTotal } : {}) },
    });
    if (oldOwnerId !== null) {
      this.store.insertReport({
        playerId: oldOwnerId,
        side: 'defense',
        won: false,
        title: `Village lost: ${v.name} ${coords(v)}`,
        createdAt: at,
        type: 'village',
        village: { kind: 'lost', village: refOf(v), claimBy: claimant.username, ...(lostUnits && totalUnits(lostUnits) > 0 ? { units: lostUnits } : {}) },
      });
      this.store.emit({ kind: 'player', playerId: oldOwnerId, topics: ['game'] });
    }
    this.store.emit({ kind: 'player', playerId: claimant.id, topics: ['game'] });
  }

  /** Does the player have no village? Then a fresh start village is created at the next request (AuthService.ensureStartingVillage). */
  playerHasVillage(playerId: number): boolean {
    return this.store.hasVillage(playerId);
  }

  // ---- Chieftain Renown ledger ----------------------------------------------------------------------------
  // players.renown_reserved is the part of renown_spent held by Chieftains. A Chieftain's share is the AVERAGE: reserved divided by
  // the player's Chieftains (queued + at home + away + standing as occupiers, in every village), read before the event changes
  // anything. Dying: the share leaves the reservation and CHIEFTAIN_RENOWN_REFUND_SHARE of it comes back (spent goes down). Used up
  // founding or taking, or cancelled before he was trained: the share leaves the reservation (cancel: all of it comes back).

  /** Each player's average Chieftain share now (ids that are null or repeated are fine). */
  private sharesBefore(playerIds: readonly (number | null)[], at: number): Map<number, number> {
    const out = new Map<number, number>();
    for (const id of playerIds) {
      if (id === null || out.has(id)) continue;
      const p = this.store.getPlayer(id);
      const count = this.outstandingChieftains(id, at);
      out.set(id, p && count > 0 ? p.renownReserved / count : 0);
    }
    return out;
  }

  /** Chieftains the player has: queued + at home + away (standing or walking), over all their villages, settled to `at`. */
  private outstandingChieftains(playerId: number, at: number): number {
    return this.store.villagesOfPlayer(playerId).reduce((n, v) => n + chieftainsIn(settleVillage(v.state, at, this.settings)), 0);
  }

  /** `n` Chieftains died or were lost: their shares leave the reservation and part of it comes back. */
  private loseChieftains(playerId: number, n: number, shares: ReadonlyMap<number, number>): void {
    if (n <= 0) return;
    const share = shares.get(playerId) ?? 0;
    this.store.releaseRenown(playerId, n * share, n * chieftainRefund(share));
  }

  /** `n` Chieftains were used up (founded or took a village): the Renown stays spent, the reservation ends. */
  private consumeChieftains(playerId: number, n: number, shares: ReadonlyMap<number, number>): void {
    if (n <= 0) return;
    this.store.releaseRenown(playerId, n * (shares.get(playerId) ?? 0), 0);
  }

  /**
   * Lifetime statistics of one resolved battle (docs/GAME_DESIGN.md section 16), counted in the battle's own transaction.
   * Kills are the opponent's losses; a support owner gets a head-count share of the attacker's losses. Abandoned villages
   * (no owner) are never credited.
   */
  private countBattleStats(
    origin: VillageRecord,
    target: VillageRecord,
    contingents: readonly StationedRow[],
    result: ReturnType<typeof resolveBattle>,
    supportLosses: readonly Units[],
  ): void {
    const attackerLost = totalUnits(result.attackerLosses);
    const defenderLost = totalUnits(result.defenderLosses);
    const supportLostTotal = supportLosses.reduce((n, l) => n + totalUnits(l), 0);
    this.store.addStats(origin.ownerId, {
      lootWood: Math.floor(result.loot.wood),
      lootFood: Math.floor(result.loot.food),
      lootIron: Math.floor(result.loot.iron),
      lootGold: Math.floor(result.loot.gold),
      troopsKilled: defenderLost + supportLostTotal,
      troopsLost: attackerLost,
      attacksWon: result.attackerWon ? 1 : 0,
      attacksLost: result.attackerWon ? 0 : 1,
      abandonedRaided: result.attackerWon && target.ownerId === null ? 1 : 0,
    });
    this.store.addStats(target.ownerId, {
      troopsKilled: attackerLost,
      troopsLost: defenderLost,
      defencesWon: result.attackerWon ? 0 : 1,
      defencesLost: result.attackerWon ? 1 : 0,
    });
    const defenders = totalUnits(result.defenderUnits) + contingents.reduce((n, c) => n + totalUnits(c.units), 0);
    const byOwner = new Map<number, { lost: number; present: number }>();
    contingents.forEach((c, i) => {
      const e = byOwner.get(c.ownerPlayerId) ?? { lost: 0, present: 0 };
      e.lost += totalUnits(supportLosses[i] ?? emptyUnits());
      e.present += totalUnits(c.units);
      byOwner.set(c.ownerPlayerId, e);
    });
    for (const [ownerId, e] of byOwner) {
      this.store.addStats(ownerId, { troopsLost: e.lost, troopsKilled: defenders > 0 ? Math.round((attackerLost * e.present) / defenders) : 0 });
    }
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
    let ownScoutsLost = 0;
    if (result.defenderScoutLosses > 0) {
      const split = splitScoutLosses(ownScouts, supportScouts, result.defenderScoutLosses);
      ownScoutsLost = split.own;
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

    this.store.addStats(origin.ownerId, {
      scoutsSent: 1,
      scoutsSucceeded: result.success ? 1 : 0,
      troopsLost: result.scoutLosses,
      troopsKilled: result.defenderScoutLosses,
    });
    this.store.addStats(target.ownerId, { troopsKilled: result.scoutLosses, troopsLost: ownScoutsLost });

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
      spawned = at + (m.returnSecs != null ? m.returnSecs * 1000 : travelTimeMs({ x: target.x, y: target.y }, { x: origin.x, y: origin.y }, survivors, s));
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
    // Your own other villages may always host your troops (several-village play); otherwise tribe-mates and allies only.
    const allowed =
      host.ownerId !== null &&
      (host.ownerId === origin.ownerId || isSupportAllowed(relationBetweenPlayers(this.store.tribes, origin.ownerId, host.ownerId, at).relation));
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
    this.store.addStats(origin.ownerId, { supportSent: 1 });
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
    this.spawnMin = this.spawnMin === null ? arriveAt : Math.min(this.spawnMin, arriveAt);
    return { id, arriveAt };
  }

  /** A failed found mission walks home from the free tile it was sent to (the tile shows as the return's start). */
  private insertReturnFromTile(home: VillageRecord, tile: { x: number; y: number }, units: Units, t: number): number {
    const arriveAt = t + travelTimeMs(tile, { x: home.x, y: home.y }, units, this.settings);
    this.store.insertMovement({
      kind: 'return',
      originVillageId: home.id,
      targetVillageId: home.id,
      units,
      loot: emptyResources(),
      departAt: t,
      arriveAt,
      targetX: tile.x,
      targetY: tile.y,
    });
    return arriveAt;
  }

  // ---- found and occupy arrivals -------------------------------------------------------------------------------

  /**
   * The Chieftain reaches the free tile. Everything is re-checked: the tile must still be free build land and the player under
   * the village limit, else he walks home (and the sender is told). On success the new village is created with the escort as its
   * garrison, the Chieftain is used up (Renown reservation released; the price was paid when he was trained).
   */
  private resolveFound(m: MovementRow): number | null {
    const s = this.settings;
    const origin = this.store.getVillage(m.originVillageId);
    if (!origin || origin.ownerId === null || m.targetX == null || m.targetY == null) {
      this.store.deleteMovement(m.id);
      return null;
    }
    const at = m.arriveAt;
    const tile = { x: m.targetX, y: m.targetY };
    const owner = this.store.getPlayer(origin.ownerId);
    if (!owner) {
      this.store.deleteMovement(m.id);
      return null;
    }
    const owned = this.store.villagesOfPlayer(owner.id).length;
    const tileRef = { id: 0, name: NEW_VILLAGE_NAME, x: tile.x, y: tile.y, ownerName: null };
    const refuse = (reason: 'tile_taken' | 'village_limit'): number => {
      this.store.insertReport({
        playerId: owner.id,
        side: 'attack',
        won: false,
        title: `Founding at ${coords(tile)} failed`,
        createdAt: at,
        type: 'village',
        village: { kind: 'found_failed', village: refOf(tileRef), reason },
      });
      const back = this.insertReturnFromTile(origin, tile, m.units, at);
      this.store.deleteMovement(m.id);
      return back;
    };
    if (!underVillageLimit(owned)) return refuse('village_limit');
    if (!checkFoundTarget(tile, s, (x, y) => this.store.villageExistsAt(x, y)).ok) return refuse('tile_taken');

    const shares = this.sharesBefore([owner.id], at);
    const { state, overflow } = createFoundedVillage(at, s, m.units);
    const name = foundedVillageName(owner.username, owned + 1);
    const id = this.store.insertVillage(owner.id, name, tile.x, tile.y, villagePoints(state), state);
    // The escort that moved in and the Chieftain leave the home village's `away`; what did not fit walks home.
    const gone = subtractUnits(m.units, overflow);
    const home = applyAttackerLosses(settleVillage(origin.state, at, s), gone);
    this.store.saveVillage(origin.id, home, villagePoints(home));
    const created: VillageRecord = { id, ownerId: owner.id, ownerName: owner.username, ownerProtectedUntil: owner.protectedUntil, name, x: tile.x, y: tile.y, points: villagePoints(state), state, holdDueAt: null };
    let spawned: number | null = null;
    if (totalUnits(overflow) > 0) spawned = this.insertReturn(origin, created, overflow, at).arriveAt;
    this.consumeChieftains(owner.id, m.units.chieftain, shares);
    this.store.insertReport({
      playerId: owner.id,
      side: 'attack',
      won: true,
      title: `Village founded: ${name} ${coords(tile)}`,
      createdAt: at,
      type: 'village',
      village: { kind: 'founded', village: refOf(created), ...(totalUnits(overflow) > 0 ? { overflow } : {}) },
    });
    this.store.deleteMovement(m.id);
    return spawned;
  }

  /**
   * Occupiers reach the cold village of their owner's claim: they stand there (a stationed contingent) and the hold clock follows.
   * If the claim is gone (relit, failed, taken by somebody else or already theirs) they turn round and the sender is told.
   */
  private resolveOccupy(m: MovementRow): number | null {
    const origin = this.store.getVillage(m.originVillageId);
    const target = this.store.getVillage(m.targetVillageId);
    if (!origin || !target || origin.ownerId === null) {
      this.store.deleteMovement(m.id);
      return null;
    }
    const at = m.arriveAt;
    const h = target.state.hearth;
    if (!h || h.claimBy !== origin.ownerId || target.ownerId === origin.ownerId) {
      this.reportClaimFailed(origin.ownerId, target, 'no_claim', at, m.units);
      return this.turnBack(m, origin, target);
    }
    this.store.addStationed(origin.ownerId, origin.id, target.id, m.units, at, m.ranks ?? null);
    this.store.deleteMovement(m.id);
    this.takeSpawn();
    this.refreshHold(target.id, at);
    return this.takeSpawn();
  }

  /** The earliest return created since the last call (null when none), and forget it. */
  private takeSpawn(): number | null {
    const v = this.spawnMin;
    this.spawnMin = null;
    return v;
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
    // Defender Renown (source 4) that is earned but not saved yet: a read never writes it (the next save pays exactly this),
    // it only shows it, so the number on screen is current.
    let pending = 0;
    let chieftains = 0;
    const fresh0 = this.store.getPlayer(player.id) ?? player;
    const eligibleFrom = defenderEligibleFrom(fresh0.protectedUntil, fresh0.createdAt, this.settings);
    const earns = !this.store.isSandboxUser(player.username);
    const villages = this.store.villagesOfPlayer(player.id).map((v) => {
      const settled = settleVillage(v.state, t, this.settings);
      chieftains += chieftainsIn(settled);
      // Builds finish lazily; keep the map's cached points current once the owner looks.
      const points = villagePoints(settled);
      // Levels that finished since the last save pay their Renown now (saveVillage), so the number shown is current.
      if (hasUnpaidBuildRenown(settled)) this.store.saveVillage(v.id, settled, points);
      else {
        if (points !== v.points) this.store.setPoints(v.id, points);
        if (earns) pending += collectDefenderRenown(settled, eligibleFrom, this.settings).renown;
      }
      return this.ownDto(v, settled, t);
    });
    const fresh = this.store.getPlayer(player.id) ?? player;
    const dto = this.playerDto(fresh);
    return {
      serverTime: t,
      settings: this.settings,
      player: dto,
      villages,
      renown: {
        ...makeRenownInfo(fresh.renownTotal + pending, fresh.renownSpent, villages.length),
        reserved: Math.floor(fresh.renownReserved + 1e-9),
        chieftainPrice: villageRenownPrice(Math.max(1, villages.length), chieftains),
        chieftains,
      },
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
      // A cold village (hearth out) is never shown as safe.
      protected: r.ownerId !== null && !r.coldState && (r.ownerProtectedUntil > t || r.protectedUntil > t),
      tribeTag: r.ownerId === null ? null : r.ownerTribeTag,
      tribeId: r.ownerId === null ? null : r.ownerTribeId,
      ownerChieftain: r.ownerId === null ? null : r.ownerChieftain,
      relation: r.ownerId === null ? null : viewer.relationTo(r.ownerId, r.ownerTribeId),
      ...(r.coldState?.hearth ? { hearth: hearthDto(r.coldState.hearth, t, this.settings, this.store.getPlayer(r.coldState.hearth.claimBy)?.username ?? '?') } : {}),
    }));
    return { villages };
  }

  /** The player's own villages, light (GET /api/villages): hearth status, stock, incoming attacks. */
  villageList(player: PlayerRow, t: number): VillageListResponse {
    const incoming = new Map<number, number>(); // village id -> soonest arrival of an attack on it
    for (const m of this.store.movementViewsForPlayer(player.id)) {
      if (m.kind !== 'attack' || m.origin.ownerId === player.id) continue;
      const soonest = incoming.get(m.targetVillageId);
      if (soonest === undefined || m.arriveAt < soonest) incoming.set(m.targetVillageId, m.arriveAt);
    }
    return {
      serverTime: t,
      villages: this.store.villagesOfPlayer(player.id).map((v) => {
        const settled = settleVillage(v.state, t, this.settings);
        const h = settled.hearth;
        const protectedUntil = settled.protectedUntil !== undefined && settled.protectedUntil > t ? settled.protectedUntil : null;
        return {
          id: v.id,
          name: v.name,
          x: v.x,
          y: v.y,
          points: villagePoints(settled),
          hearth: h ? 'out' : 'lit',
          holdEndsAt: h && h.runningSince !== null ? holdDueAt(h, this.settings) : null,
          resources: floorResources(settled.resources),
          incomingAttack: incoming.has(v.id),
          nextAttackAt: incoming.get(v.id) ?? null,
          protectedUntil,
        };
      }),
    };
  }

  /** Rename one of the player's villages. A village that is not theirs looks missing (404). */
  rename(player: PlayerRow, villageId: number, name: unknown, t: number): OwnVillageDto {
    if (typeof name !== 'string') throw new GameError('invalid_input', 'The name must be text.');
    const clean = name.trim().replace(/[^\S ]+/gu, '\u0000').replace(/ +/g, ' '); // tabs and line breaks are not allowed: they stay as NUL and fail the pattern
    if (!VILLAGE_NAME_PATTERN.test(clean)) {
      throw new GameError('invalid_input', 'A village name has 1 to 30 characters: letters, digits, spaces and . _ - \'.');
    }
    return this.store.tx(() => {
      const v = this.store.getVillage(villageId);
      if (!v || v.ownerId !== player.id) throw new GameError('not_found', 'Village not found.');
      this.store.setVillageName(v.id, clean);
      return this.ownDto({ ...v, name: clean }, settleVillage(v.state, t, this.settings), t);
    });
  }

  private ownDto(v: VillageRecord, state: VillageState, t: number): OwnVillageDto {
    const dto: OwnVillageDto = { id: v.id, name: v.name, x: v.x, y: v.y, state, feastAllowance: feastAllowance(state, t, this.settings) };
    const h = state.hearth;
    if (h) {
      const pop = occupierPopulation(sumUnits(this.store.stationedAt(v.id).filter((c) => c.ownerPlayerId === h.claimBy).map((c) => c.units)));
      dto.hearth = hearthDto(h, t, this.settings, this.store.getPlayer(h.claimBy)?.username ?? '?', pop);
    }
    return dto;
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
        village: r.village,
      };
    });
  }

  // ---- village actions ---------------------------------------------------------------------------

  build(player: PlayerRow, villageId: number, building: string, t: number): OwnVillageDto {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const next = applyBuild(v.state, building, t, this.settings, MAX_BUILD_QUEUE);
      this.store.saveVillage(v.id, next, villagePoints(next));
      this.store.addStats(player.id, { buildingLevelsBuilt: 1 });
      return this.ownDto(v, next, t);
    });
  }

  /**
   * Queue troops. A Chieftain batch also reserves Renown in the same transaction (docs/GAME_DESIGN.md 18.2): each Chieftain costs
   * villageRenownPrice(villages owned, the player's other Chieftains in all villages), the sum is taken from the balance
   * (renown_spent) and held in renown_reserved. A short balance refuses the whole order (409 not_enough_resources) and nothing is paid.
   */
  train(player: PlayerRow, villageId: number, unit: string, count: number, t: number): OwnVillageDto {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const others = unit === 'chieftain' ? this.outstandingChieftains(player.id, t) : 0;
      const next = applyTrain(v.state, unit, count, t, this.settings);
      this.store.saveVillage(v.id, next, villagePoints(next)); // also pays Renown that finished building levels earned
      if (unit === 'chieftain') {
        const owned = this.store.villagesOfPlayer(player.id).length;
        let price = 0;
        for (let i = 0; i < count; i++) price += villageRenownPrice(owned, others + i);
        const fresh = this.store.getPlayer(player.id) ?? player;
        const balance = fresh.renownTotal - fresh.renownSpent;
        if (balance + 1e-9 < price) {
          throw new GameError('not_enough_resources', `Not enough Renown: ${price} needed, ${Math.max(0, Math.floor(balance))} available.`);
        }
        this.store.reserveRenown(player.id, price);
      }
      this.store.addStats(player.id, { troopsTrained: count });
      return this.ownDto(v, next, t);
    });
  }

  /** Cancel the newest construction job; CANCEL_REFUND_PERCENT of the cost comes back. */
  cancelBuild(player: PlayerRow, villageId: number, index: number, t: number): CancelResponse {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const { state, refund } = applyCancelBuild(v.state, index, t, this.settings);
      this.store.saveVillage(v.id, state, villagePoints(state));
      return { village: this.ownDto(v, state, t), refund };
    });
  }

  /** Cancel one training batch; CANCEL_REFUND_PERCENT of the untrained rest comes back. */
  cancelTrain(player: PlayerRow, villageId: number, building: string, index: number, t: number): CancelResponse {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      // A cancelled Chieftain batch gives its Renown back in full: the untrained Chieftains' average reservation.
      const job = (building === 'bannerhall' ? settleVillage(v.state, t, this.settings).trainQueues.bannerhall : [])[index as number];
      const left = job && job.unit === 'chieftain' ? job.count - job.done : 0;
      const share = left > 0 ? (this.sharesBefore([player.id], t).get(player.id) ?? 0) : 0;
      const { state, refund } = applyCancelTrain(v.state, building, index, t, this.settings);
      this.store.saveVillage(v.id, state, villagePoints(state));
      if (left > 0) {
        const back = Math.min(left * share, (this.store.getPlayer(player.id) ?? player).renownReserved);
        this.store.releaseRenown(player.id, back, back);
        return { village: this.ownDto(v, state, t), refund, renownRefund: Math.floor(back + 1e-9) };
      }
      return { village: this.ownDto(v, state, t), refund };
    });
  }

  /** Cancel the running research; CANCEL_REFUND_PERCENT of its cost comes back. */
  cancelResearch(player: PlayerRow, villageId: number, index: number, t: number): CancelResponse {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const { state, refund } = applyCancelResearch(v.state, index, t, this.settings);
      this.store.saveVillage(v.id, state, villagePoints(state));
      return { village: this.ownDto(v, state, t), refund };
    });
  }

  // Drillyard actions: owner-only (ownedVillage), server clock `t`, one transaction, engine re-checks everything.
  research(player: PlayerRow, villageId: number, unit: string, t: number): OwnVillageDto {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const next = applyResearch(v.state, unit, t, this.settings, MAX_RESEARCH_QUEUE);
      this.store.saveVillage(v.id, next, villagePoints(next));
      return this.ownDto(v, next, t);
    });
  }

  rank(player: PlayerRow, villageId: number, unit: string, track: string, t: number): OwnVillageDto {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const next = applyRank(v.state, unit, track, t, this.settings);
      this.store.saveVillage(v.id, next, villagePoints(next));
      return this.ownDto(v, next, t);
    });
  }

  respec(player: PlayerRow, villageId: number, unit: string, track: string, t: number): OwnVillageDto {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const next = applyRespec(v.state, unit, track, t, this.settings);
      this.store.saveVillage(v.id, next, villagePoints(next));
      return this.ownDto(v, next, t);
    });
  }

  /**
   * Hold `count` Feasts in the player's village (section 18.2): the engine checks Banner Hall, stock and the daily
   * limit, the cost leaves the village and the Renown is added to the player's total, all in one transaction.
   * A sandbox account may feast too (test mode has no other way to see the Feast work).
   */
  feast(player: PlayerRow, villageId: number, count: number, t: number): FeastResponse {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const { state, renown } = applyFeast(v.state, count, t, this.settings);
      this.store.saveVillage(v.id, state, villagePoints(state));
      this.store.addRenown(player.id, renown);
      const fresh = this.store.getPlayer(player.id) ?? player;
      const owned = this.store.villagesOfPlayer(player.id).length;
      return { village: this.ownDto(v, state, t), renown: makeRenownInfo(fresh.renownTotal, fresh.renownSpent, owned), gained: renown };
    });
  }

  /**
   * Send troops on a mission (attack, scout or support). Order of checks: the target exists and is not yours, the
   * relation and beginner protection allow the mission, the army suits the mission, the troops are at home.
   */
  send(player: PlayerRow, villageId: number, x: number, y: number, units: Partial<Units>, mission: Mission, t: number, timing: { travelSeconds?: number; returnSeconds?: number } = {}, targetBuilding?: unknown): SendResponse {
    const s = this.settings;
    // The Boulder Sling pick is checked for form only, NEVER against the target's buildings: any difference in the answer would
    // tell the sender what the village holds (docs/SECURITY_ROADMAP.md section 2).
    let siegeTarget: BuildingId | null = null;
    if (targetBuilding !== undefined && targetBuilding !== null) {
      if (!isBuildingId(targetBuilding)) throw new GameError('invalid_input', 'That is not a building.');
      if (mission !== 'attack' || !hasChosenSiege(units)) throw new GameError('invalid_input', 'Only an attack with Boulder Slings can aim at a building.');
      siegeTarget = targetBuilding;
    }
    const custom = timing.travelSeconds !== undefined || timing.returnSeconds !== undefined;
    if (custom && !this.store.isSandboxUser(player.username)) throw new GameError('forbidden', 'Test mode is not available for this account.');
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const army = normalizeUnits(units);
      // A found mission walks to a free tile; every other mission needs a village on the target tile.
      let target: VillageRecord | null = null;
      if (mission === 'found') {
        const tile = checkFoundTarget({ x, y }, s, (px, py) => this.store.villageExistsAt(px, py));
        if (!tile.ok) throw new GameError(tile.reason, tile.message);
        if (!underVillageLimit(this.store.villagesOfPlayer(player.id).length)) {
          throw new GameError('invalid_target', 'You own as many villages as the world allows.');
        }
      } else {
        target = this.store.getVillageAt(x, y);
        if (!target) throw new GameError('invalid_target', 'There is no village at those coordinates.');
        const own = target.ownerId === player.id;
        if (target.id === v.id || (own && mission !== 'support')) {
          const what = mission === 'support' ? 'send support to' : mission === 'scout' ? 'scout' : mission === 'occupy' ? 'occupy' : 'attack';
          throw new GameError('invalid_target', `You cannot ${what} your own village.`);
        }
        if (target.ownerId !== null && !own) this.refuseHousehold(player.id, target.ownerId);
        if (mission === 'support') {
          if (!own) this.requireSupportable(player.id, target, t);
        } else if (mission === 'occupy') {
          // Occupiers only go to the cold village of your own claim.
          if (target.state.hearth?.claimBy !== player.id) throw new GameError('invalid_target', 'You hold no claim on that village.');
        } else {
          if (target.ownerId !== null) this.refuseProtectedByTribe(player.id, target.ownerId, t, mission);
          if (target.ownerId !== null && target.ownerProtectedUntil > t) {
            throw new GameError('target_protected', `${target.ownerName ?? 'This player'} is under beginner protection.`);
          }
          if (isAttackBlocked(target.state, t)) throw new GameError('target_protected', 'That village is protected for a while.');
          if (mission === 'attack' && target.state.hearth?.claimBy === player.id) {
            throw new GameError('invalid_target', 'That is the village you are holding: send occupiers, not an attack.');
          }
          if (army.chieftain > 0 && target.ownerId !== null && !this.strikePlayers) {
            throw new GameError('invalid_target', 'Chieftains can only strike abandoned villages for now.');
          }
        }
      }

      const fits = checkMission(mission, army);
      if (!fits.ok) throw new GameError(fits.reason, fits.message);
      const settled = settleVillage(v.state, t, s);
      const check = checkSend(settled, army);
      if (!check.ok) throw new GameError(check.reason, check.message);
      const next = applySend(settled, check.units, t, s);
      const dest = target ?? { x, y };
      const travel = timing.travelSeconds !== undefined ? timing.travelSeconds * 1000 : travelTimeMs({ x: v.x, y: v.y }, { x: dest.x, y: dest.y }, check.units, s);

      const movementId = this.store.insertMovement({
        returnSecs: timing.returnSeconds ?? null,
        kind: mission,
        originVillageId: v.id,
        targetVillageId: target?.id ?? v.id, // a found mission has no village yet: its own home stands in, the tile is in targetX/Y
        units: check.units,
        loot: null,
        departAt: t,
        arriveAt: t + travel,
        ranks: next.ranks ?? null, // stamped now: a later respec can't change a march in flight
        ...(target ? {} : { targetX: x, targetY: y }),
        ...(siegeTarget ? { siegeTarget } : {}),
      });
      this.store.saveVillage(v.id, next, villagePoints(next));
      // Raiding abandoned villages keeps beginner protection; attacking or scouting a player ends it. Support, found and occupy never do.
      if ((mission === 'attack' || mission === 'scout') && target && target.ownerId !== null) this.store.setProtectedUntil(player.id, 0);

      const view = this.store.getMovementView(movementId);
      if (!view) throw new Error('movement vanished after insert');
      return { village: this.ownDto(v, next, t), movement: movementDto(view, player.id, t) };
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
      // Back door between accounts on one connection: feed an abandoned village, let the partner raid it.
      if (target.ownerId === null && this.store.sharesIpWithAnyone(player.id)) {
        throw new GameError('invalid_target', 'You share a connection with another player, so you cannot send resources to abandoned villages.');
      }
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
      this.store.addStats(player.id, {
        shipmentsSent: 1,
        resourcesShipped: RESOURCE_IDS.reduce((n, r) => n + Math.floor(check.resources[r]), 0),
      });
      const view = this.store.getMovementView(movementId);
      if (!view) throw new Error('movement vanished after insert');
      return { village: this.ownDto(v, next, t), movement: movementDto(view, player.id, t) };
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
      // The claimant's occupiers are not guests: the owner of a cold village has to beat them in battle.
      if (this.store.getVillage(row.hostVillageId)?.state.hearth?.claimBy === row.ownerPlayerId && row.ownerPlayerId !== player.id) {
        throw new GameError('invalid_target', 'Those troops are holding your village. Defeat them in battle.');
      }
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
    // Occupiers leaving a cold village change its hold clock.
    if (host.state.hearth) this.refreshHold(host.id, t);
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
    return { id: p.id, username: p.username, protectedUntil: p.protectedUntil, tribe: this.store.tribes.playerTribe(p.id), chieftain: p.chieftain, householdShared: p.householdShared, abandonedNotice: abandonedNoticeOf(p, this.settings), sandbox: this.store.isSandboxUser(p.username), staffRole: p.staffRole };
  }

  /**
   * Sandbox (test mode): only accounts in SANDBOX_USERS. `max` fills every village of the player; `reset` makes each a
   * fresh starting village again. Returns the new state. Section "Sandbox" of GAME_DESIGN.
   */
  sandbox(player: PlayerRow, action: 'max' | 'reset', t: number): GameStateResponse {
    if (!this.store.isSandboxUser(player.username)) throw new GameError('forbidden', 'Test mode is not available for this account.');
    this.store.tx(() => {
      const owned = this.store.villagesOfPlayer(player.id).length;
      if (action === 'max') {
        // Renown balance for the next 3 villages (founding or Chieftains), topped up only when short.
        let need = 0;
        for (let i = 0; i < 3; i++) need += villageRenownCost(owned + i);
        const p = this.store.getPlayer(player.id) ?? player;
        const short = need - (p.renownTotal - p.renownSpent);
        if (short > 0) this.store.addRenown(player.id, short);
      }
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

  /** Sandbox time warp: all my movements (and attacks/support heading for me) arrive in `seconds` from now. */
  sandboxWarp(player: PlayerRow, seconds: number, t: number): GameStateResponse {
    if (!this.store.isSandboxUser(player.username)) throw new GameError('forbidden', 'Test mode is not available for this account.');
    // The same `seconds` also applies to the way home of everything still on its way out (and to returns already walking).
    this.store.tx(() => this.store.warpMovementsOfPlayer(player.id, t + Math.round(seconds) * 1000, Math.round(seconds)));
    this.processDue(t);
    return this.getState(player, t);
  }

  /** Sandbox: remove my own troops that are at home in every village of mine (away troops and stationed contingents stay). */
  sandboxClearArmy(player: PlayerRow, t: number): GameStateResponse {
    if (!this.store.isSandboxUser(player.username)) throw new GameError('forbidden', 'Test mode is not available for this account.');
    this.store.tx(() => {
      for (const v of this.store.villagesOfPlayer(player.id)) {
        const next = { ...settleVillage(v.state, t, this.settings), troops: emptyUnits() };
        this.store.saveVillage(v.id, next, villagePoints(next));
      }
    });
    return this.getState(player, t);
  }

  /** Sandbox: remove all troops from every abandoned village (their garrison slowly refills through growth steps). */
  sandboxClearAbandoned(player: PlayerRow, t: number): GameStateResponse {
    if (!this.store.isSandboxUser(player.username)) throw new GameError('forbidden', 'Test mode is not available for this account.');
    this.store.tx(() => {
      for (const id of this.store.abandonedVillageIds()) {
        const v = this.store.getVillage(id);
        if (!v) continue;
        const next = { ...settleVillage(v.state, t, this.settings), troops: emptyUnits() };
        this.store.saveVillage(id, next, villagePoints(next));
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
