// Game service: movement processing and every player action. All mutations run synchronously
// inside one BEGIN IMMEDIATE transaction (see Store.tx), so the database never holds half an action.

import { randomInt } from 'node:crypto';
import {
  BOT_BATCH_VILLAGES,
  NPC_REFRESH_BATCH,
  NPC_REFRESH_BUDGET_MS,
  BOT_MAX_STEPS_PER_RUN,
  GameError,
  claimReward,
  firstStepReward,
  storageCap,
  MAX_BUILD_QUEUE,
  populationCap,
  populationUsage,
  productionPerHour,
  HOLD_MIN_POPULATION,
  UNIT_IDS,
  abandonVillageKeepBuildings,
  applyAutoSettings,
  autoNeedsResearch,
  autoProgress,
  autoSummary,
  autoTrainableUnits,
  buildQueueLimit,
  researchQueueLimit,
  checkAutoSettings,
  defaultAutoMode,
  hasPremiumToolsExtra,
  type AutoOverviewResponse,
  type AutoSettingsRequest,
  type AutoVillageDto,
  applyOwnerChange,
  applyStrike,
  checkFoundTarget,
  checkStrike,
  chestVillageCost,
  CHIEFTAIN_MAX_BATCH,
  chieftainBanked,
  chieftainBatchPrice,
  chieftainDue,
  chieftainTarget,
  chieftainPrice,
  createFoundedVillage,
  foundedVillageName,
  holdDueAt,
  isAttackBlocked,
  isNearSite,
  occupierPopulation,
  chainedChieftains,
  chieftainsNeeded,
  holdDurationMs,
  type StrikeCheck,
  type StrikeOutcome,
  strikeChainWindowMs,
  underVillageLimit,
  updateHold,
  villageRenownCost,
  type HearthInfoDto,
  type HearthState,
  type VillageListResponse,
  type VillageReportData,
  type FirstStepClaimResponse,
  type FirstStepId,
  type FirstStepsDto,
  type ChestDepositResponse,
  type ChestInfo,
  type VillageState,
  MAP_MAX_SPAN,
  botBuildChoice,
  abandonIdleMs,
  botIdleMs,
  botStepMs,
  npcRefreshMs,
  mulberry32,
  RESOURCE_IDS,
  applyAttackerLosses,
  applyBattleToDefender,
  applyBuild,
  applyCancelBuild,
  applyCancelResearch,
  applyCancelTrain,
  type CancelResponse,
  applyFeast,
  checkFeast,
  feastMaxCount,
  feastPrice,
  FEAST_ALL_MAX_VILLAGES,
  type FeastAllRequest,
  type FeastAllResponse,
  type FeastAllResult,
  type FeastOverviewResponse,
  type FeastVillageDto,
  collectDefenderRenown,
  defenderEligibleFrom,
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
  MAX_MARCHES_IN_FLIGHT,
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
  hasBuildingSiegeUnits,
  hasSiegeUnits,
  isBuildingId,
  battleSeed,
  isAttackForbidden,
  isSupportAllowed,
  UNITS,
  normalizeUnits,
  moraleFactor,
  resolveBattle,
  splitLoot,
  vaultProtection,
  watchtowerInfo,
  resolveScouting,
  settleVillage,
  cloneVillage,
  TRAINING_BUILDING_IDS,
  totalUnits,
  travelTimeMs,
  villagePoints,
  LOST_ATTACK_SEEN_SHARE,
  type BattleReportData,
  type BuildingId,
  type FeastResponse,
  type GameStateResponse,
  type MapResponse,
  type MapOverviewCode,
  type MapOverviewResponse,
  MAP_OVERVIEW_CACHE_MS,
  hasWideOverviewExtra,
  type ChainListItemDto,
  type HoldListItemDto,
  type ChainProgressDto,
  type ScoutedResponse,
  type VillageIntelDto,
  type MapVillageDto,
  type Mission,
  type MovementDto,
  type MovementResponse,
  type OwnVillageDto,
  type PlayerDto,
  type RealmResponse,
  type RealmTrainBatchDto,
  type RealmVillageDto,
  type ReportDto,
  type ReportListResponse,
  type Resources,
  type BattleScouting,
  type ScoutReportData,
  type SendResponse,
  type SendShipmentResponse,
  type StationedDto,
  type TribeAlertsResponse,
  type TribeHoldDto,
  type Units,
  type VillageRefDto,
  type WorldSettings,
  seesLeadershipBoards,
  worldRules,
  MULTI_RETENTION_MS,
} from '@clanfire/engine';
import { effectivePremium } from './entitlement.ts';
import { abandonedNoticeOf } from './auth.ts';
import { NPC_VILLAGE_NAME } from './world.ts';
import { loadRelationViewer, relationBetweenPlayers } from './relations.ts';
import { RenownService } from './renown-service.ts';
import { firstStepsDto } from './first-steps-service.ts';
import { SiteService } from './site-service.ts';
import { TribeProjectService } from './tribe-projects-service.ts';
import { sitesFor } from './site-layout.ts';
import { NEW_VILLAGE_NAME, hasUnpaidBuildRenown, type MapRow, type MovementRow, type MovementView, type PlayerRow, type Store, type StationedRow, type StationedView, type VillageRecord, type VillageStub } from './store.ts';
import { addUnits, isScoutArmy, isWithin, only, splitScoutLosses, subtractUnits, sumUnits } from './units.ts';

/** A village name: 1 to 30 letters, digits, spaces and . _ - ' (checked after trimming). */
const VILLAGE_NAME_PATTERN = /^[\p{L}\p{N} ._'-]{1,30}$/u;

const BATCH_SIZE = 100;

/** How much one `processDue` call may do before it hands back (docs/SECURITY_ROADMAP.md section 2.5). */
export interface DueBudget {
  /** Stop after this many resolved movements and hold events. */
  maxCount: number;
  /** Stop once this much real time has gone by (checked after each resolved item, so a call always makes progress). */
  maxMs: number;
}

/** The budget of the 1 s tick and of the request hook: a burst is drained in slices, the API answers in between. */
export const DUE_BUDGET: DueBudget = { maxCount: 250, maxMs: 40 };

/** Counts one budgeted slice. Only resolved items count, so rows that keep failing can never make a slice report "more to do". */
class DueSlice {
  private done = 0;
  private readonly startedAt = performance.now();
  constructor(private readonly budget: DueBudget) {}
  resolved(): void {
    this.done++;
  }
  spent(): boolean {
    return this.done >= this.budget.maxCount || (this.done > 0 && performance.now() - this.startedAt >= this.budget.maxMs);
  }
}

/** Let the event loop serve waiting requests and sockets between two slices (setImmediate on the server, a timer elsewhere). */
const yieldToIo = (): Promise<void> =>
  new Promise((done) => (typeof setImmediate === 'function' ? setImmediate(done) : setTimeout(done, 0)));
const REPORT_LIST_LIMIT = 50;
const ALERT_LIST_LIMIT = 200;
/** Most villages one command-post search returns. */
const SEARCH_LIMIT = 10;

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
    ...(m.kind === 'shipment' && m.toTribeStore ? { toTribeStore: true as const } : {}),
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

/** 6 -> "6th". */
function ordinal(n: number): string {
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 ? 0 : n % 10]}`;
}

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

/** The same-connection check refused a send between two accounts; the wrapper logs the attempt for staff after the transaction rolled back. */
class HouseholdRefusal extends GameError {
  constructor(
    readonly senderId: number,
    readonly ownerId: number,
    message: string,
  ) {
    super('invalid_target', message);
  }
}

export class GameService {
  /** Secret battle salt, read from the database on first battle. */
  private salt: number[] | null = null;

  private readonly renown: RenownService;

  /**
   * May a Strike put out the hearth of a PLAYER village? Undefined = the world's rule (`conquest.playersCanBeConquered`); public so
   * tests can force it on or off.
   */
  strikePlayers: boolean | undefined = undefined;

  /** The effective answer: a test override, else this world's rule. */
  private playersConquerable(): boolean {
    return this.strikePlayers ?? worldRules(this.settings).conquest.playersCanBeConquered;
  }

  /** Earliest arrival of any return created since it was last reset (hold events report what they spawned through it). */
  private spawnMin: number | null = null;

  /** Map sites (Fire Shrines): sending, holding and the Renown bonus (site-service.ts). */
  readonly sites: SiteService;

  /** Tribe Store, projects and their effects on travel, defence and alerts (tribe-projects-service.ts). */
  readonly projects: TribeProjectService;

  private readonly clock: () => number;

  constructor(
    private readonly store: Store,
    readonly settings: WorldSettings,
    private readonly log: GameLogger = { error: () => {} },
    now: () => number = Date.now,
  ) {
    this.clock = now;
    this.renown = new RenownService(store, settings);
    this.projects = new TribeProjectService(store, settings);
    this.sites = new SiteService(store, settings, now, this.projects);
    this.migrateChieftainFullPrice(); // once per world database (meta flag): open claims are folded into the Chieftain reservations
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
    // Budgeted like the tick: with a backlog this pass is skipped (the tick drains it; the next pass looks again).
    this.processDue(now, DUE_BUDGET);
    if (this.dueBacklog) return 0;
    this.cleanMultiData(now);
    // The world has ended: it is frozen. Movements in flight still resolve (above), but nobody builds or loses a village any more.
    if (this.store.isWorldEnded()) return 0;
    this.abandonIdleVillages(now);
    this.refreshAbandonedVillages(now);
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

  /** Privacy: IPs, device hashes, activity slots and the pair log are deleted, and audit-log addresses blanked, after MULTI_RETENTION_MS. Checked at most hourly (also in a frozen world). */
  private multiCleanedAt = 0;
  private cleanMultiData(now: number): void {
    if (now - this.multiCleanedAt < 3_600_000) return;
    this.multiCleanedAt = now;
    this.store.multi.cleanup(now - MULTI_RETENTION_MS);
  }

  /**
   * Keep the stored state (and so the map points) of abandoned villages fresh. They grow on their own (engine settleVillage, world rule
   * npc.selfBuild), so the oldest-refreshed ones, those last settled more than npcRefreshMs ago, are settled to `now` and saved, oldest first,
   * at most `batch` villages and `budgetMs` of real time per pass. Same result as the lazy settle (settling in steps equals one settle), so
   * a raid still settles at arrival as before. Call it only after every due movement is resolved (the caretaker does; the preview after its own
   * processDue). Skipped when nothing can grow (rule off) and in a world that has ended.
   * Returns the number of villages refreshed.
   */
  refreshAbandonedVillages(now: number, batch = NPC_REFRESH_BATCH, budgetMs = NPC_REFRESH_BUDGET_MS): number {
    const s = this.settings;
    if (!worldRules(s).npc.selfBuild || this.store.isWorldEnded()) return 0;
    const started = performance.now();
    let done = 0;
    for (const { id } of this.store.npcRefreshOrder(now - npcRefreshMs(s), batch)) {
      if (done > 0 && performance.now() - started >= budgetMs) break;
      try {
        this.store.tx(() => {
          const v = this.store.getVillage(id);
          if (!v || v.ownerId !== null) return;
          const next = settleVillage(v.state, now, s);
          this.store.saveVillage(id, next, villagePoints(next));
          this.store.setNpcRefreshAt(id, now);
        });
        done++;
      } catch (err) {
        this.log.error({ err, villageId: id }, 'abandoned village refresh failed');
      }
    }
    return done;
  }

  /**
   * Villages of owners away for ABANDON_IDLE_DAYS become abandoned villages that KEEP ALL THEIR BUILDINGS (engine
   * `abandonVillageKeepBuildings`: a valuable target that keeps the troops standing at home, which defend until beaten; nothing
   * is added or trained). Queues and the contingents of the village are cleared (troops of the owner on their way home join, others away are disbanded); support of others standing in it
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

  /**
   * Account deletion (docs/GAME_DESIGN.md 17, "Account deletion"): every village of the player turns abandoned NOW, exactly as after
   * ABANDON_IDLE_DAYS (abandonVillage: buildings stay, queues and the player's own armies and contingents are gone, others' support goes home).
   * Beforehand any hold the player runs on someone else's village ends (the claim fails, the occupiers walk home), so the village can never fall
   * to a deleted account. The player's troops standing at map sites are disbanded like stationed support of an abandoned owner. Runs in the
   * caller's transaction; returns the number of villages given up. Movements due by `now` must already be resolved (the request hook / caretaker does).
   */
  abandonAllVillagesOf(playerId: number, now: number): number {
    return this.store.tx(() => {
      for (const id of this.store.villageIdsClaimedBy(playerId)) {
        const v = this.store.getVillage(id);
        const h = v?.state.hearth;
        if (v && h && h.claimBy === playerId) this.endClaim(v, h, 'no_room', now);
      }
      let n = 0;
      for (const { id } of this.store.villagesOfPlayer(playerId)) {
        const v = this.store.getVillage(id); // fresh: an earlier village may have sent hosted support home
        if (!v || v.ownerId !== playerId) continue;
        this.abandonVillage(v, now);
        n++;
      }
      this.store.deleteSiteGarrisonsOf(playerId);
      return n;
    });
  }

  private abandonVillage(v: VillageRecord, now: number): void {
    const s = this.settings;
    const ownerId = v.ownerId;
    if (ownerId === null) return;
    // The owner's armies and contingents are gone; everybody else's troops standing here go home.
    // Troops on their way HOME join the village (their march is deleted); troops out on other missions are disbanded, as before.
    const returning = emptyUnits();
    for (const m of this.store.movementsFrom(v.id)) {
      if (m.kind === 'return') for (const u of UNIT_IDS) returning[u] += m.units[u] ?? 0;
      this.store.deleteMovement(m.id);
    }
    for (const c of this.store.stationedHomedAt(v.id)) this.store.deleteStationed(c.id);
    this.sendHostedHome(v, now);
    const claim = v.state.hearth;
    this.store.addAbandonedVillage(ownerId, v.id, v.name, v.x, v.y, now);
    const next = abandonVillageKeepBuildings(v.state, now, s, randomInt(0, 0xffffffff), returning);
    this.store.releaseVillage(v.id, NPC_VILLAGE_NAME); // before the save: villages without an owner pay no Renown
    this.store.saveVillage(v.id, next, villagePoints(next));
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
    if (v.state.hearth) {
      this.store.setBotNextAt(v.id, now + stepMs); // a cold village cannot build; look again later
      return 0;
    }
    const owner = this.store.getPlayer(v.ownerId);
    const vr = owner ? this.withEntitlement(owner, v) : v; // the tools ended: auto mode stops before this village is settled
    let state = settleVillage(vr.state, now, s);
    if (state.auto?.on) {
      // Auto mode runs this village; the caretaker's own random builds would only fight it. Keep the settled state (and the map points) current.
      this.store.saveVillage(v.id, state, villagePoints(state));
      this.store.setBotNextAt(v.id, now + stepMs);
      return 0;
    }
    let queued = 0;
    for (let i = 0; i < BOT_MAX_STEPS_PER_RUN; i++) {
      const choice = botBuildChoice(state, now, s, mulberry32(hashSeed(v.id, Math.floor(now / stepMs), i)));
      if (!choice) break;
      state = applyBuild(state, choice, now, s);
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
   *
   * With a `budget` the call stops after that much work and sets `dueBacklog`; the next call (the tick, a request, `catchUp`)
   * carries on from the oldest row, so the order `arrive_at, id` and every outcome are the same as in one long call. Without a
   * budget it drains everything (startup catch-up, tests, the preview, sandbox tools).
   */
  processDue(now: number, budget?: DueBudget): number {
    const handled = this.resolveDue(now, budget ? new DueSlice(budget) : null);
    // Upkeep that reads the world "as of now" waits until the arrivals are fully up to date.
    if (this.dueBacklog) return handled;
    // Sites: troops of players who left the tribe or were banned go home, a site nobody holds any more turns neutral. A frozen world keeps its sites.
    if (!this.store.isWorldEnded()) {
      try {
        this.sites.reconcileIfDue(now);
        this.sites.settleHolders(now);
      } catch (err) {
        this.log.error({ err }, 'site upkeep failed');
      }
    }
    // After the arrivals: the domination win condition is settled lazily from stored timestamps (domination-service.ts).
    // A failure here must never break the request or the tick that happened to trigger it.
    if (this.afterProcess) {
      try {
        this.afterProcess(now);
      } catch (err) {
        this.log.error({ err }, 'domination evaluation failed');
      }
    }
    return handled;
  }

  /** Called at the end of every processDue (set by the DominationService). */
  afterProcess: ((now: number) => void) | null = null;

  /** True when the last `processDue` stopped on its budget: arrivals that are already due are still waiting. */
  dueBacklog = false;

  private catchingUp: Promise<void> | null = null;

  /**
   * Drain a backlog in budgeted slices, letting the event loop run between them. One shared loop however many callers wait
   * (a hundred waiting requests must not each run their own slice back to back). Resolves when nothing due is left.
   */
  catchUp(budget: DueBudget = DUE_BUDGET): Promise<void> {
    this.catchingUp ??= (async () => {
      try {
        while (this.dueBacklog) {
          await yieldToIo();
          this.processDue(this.clock(), budget);
        }
      } catch (err) {
        this.log.error({ err }, 'catch-up failed');
      } finally {
        this.catchingUp = null;
      }
    })();
    return this.catchingUp;
  }

  private resolveDue(now: number, slice: DueSlice | null): number {
    let handled = 0;
    const failed = new Set<number>();
    const failedHolds = new Set<number>();
    this.dueBacklog = false;
    // Out of budget: stop between two items. Everything still due stays in the database, in order, for the next call.
    const stop = (): number => {
      this.dueBacklog = true;
      return handled;
    };
    for (;;) {
      const raw = this.store.dueMovements(now, BATCH_SIZE);
      const batch = raw.filter((m) => !failed.has(m.id));
      let restart = false;
      for (const m of batch) {
        if (slice?.spent()) return stop();
        // A hold clock that ends at or before this arrival comes first: movements and hold events run in one time order.
        const hold = this.runDueHolds(m.arriveAt, failedHolds, slice);
        handled += hold.handled;
        if (hold.stopped) return stop();
        if (hold.spawn !== null && hold.spawn <= now) {
          restart = true;
          break;
        }
        let spawnedArrival: number | null = null;
        try {
          spawnedArrival = this.store.tx(() => this.resolveMovement(m.id));
          handled++;
          slice?.resolved();
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
      if (slice?.spent()) return stop(); // the next call finds out whether anything is left
      const hold = this.runDueHolds(now, failedHolds, slice);
      handled += hold.handled;
      if (hold.stopped) return stop();
      if (hold.spawn !== null && hold.spawn <= now) continue;
      break;
    }
    return handled;
  }

  /**
   * Hold clocks and fail timers that are due by `limitAt`, earliest first, each in its own transaction. Returns how many ran and
   * the earliest arrival of anything they sent walking (the caller re-reads the movement queue when that is already due);
   * `stopped` when the slice ran out of budget with hold events possibly left.
   */
  private runDueHolds(limitAt: number, failed: Set<number>, slice: DueSlice | null): { handled: number; spawn: number | null; stopped: boolean } {
    let handled = 0;
    let spawn: number | null = null;
    for (;;) {
      const due = this.store.dueHolds(limitAt, BATCH_SIZE).filter((d) => !failed.has(d.id));
      if (due.length === 0) break;
      for (const d of due) {
        if (slice?.spent()) return { handled, spawn, stopped: true };
        this.takeSpawn();
        try {
          this.store.tx(() => this.refreshHold(d.id, d.dueAt));
          handled++;
          slice?.resolved();
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
    return { handled, spawn, stopped: false };
  }

  /** Handle one movement. Returns the arrival time of a movement it created, if any. */
  private resolveMovement(id: number): number | null {
    const m = this.store.getMovement(id);
    if (!m) return null;
    this.takeSpawn(); // forget returns noted by earlier (possibly rolled back) work
    switch (m.kind) {
      case 'attack':
        // A tile target (not a village) is a map site (see send).
        return m.targetX != null ? this.sites.resolveAttack(m) : this.resolveAttack(m);
      case 'scout':
        return this.resolveScout(m);
      case 'support':
        return m.targetX != null ? this.sites.resolveSupport(m) : this.resolveSupport(m);
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
    let origin = this.store.getVillage(m.originVillageId);
    let target = this.store.getVillage(m.targetVillageId);
    if (!origin || !target) {
      this.store.deleteMovement(m.id);
      return null;
    }
    const at = m.arriveAt;
    // The owner, a tribe-mate or an ally attacking a cold village: a fight against the occupiers only.
    if (origin.ownerId !== null && target.state.hearth && this.isRelief(origin.ownerId, target, at)) return this.resolveRelief(m, origin, target);
    // Relations may have changed while the troops marched: an alliance, NAP or shared tribe calls the attack off.
    if (origin.ownerId !== null && target.ownerId !== null) {
      const rel = relationBetweenPlayers(this.store.tribes, origin.ownerId, target.ownerId, at);
      if (isAttackForbidden(rel.relation)) return this.callOffAttack(m, origin, target);
    }
    // Your own claim is not a target (the occupiers there are yours); a founded or restarted village is protected for a while.
    if (origin.ownerId !== null && target.state.hearth?.claimBy === origin.ownerId) return this.callOffAttack(m, origin, target);
    if (isAttackBlocked(target.state, at)) return this.callOffAttack(m, origin, target);
    // Pathfinders in the army scout first (the same duel as a scouting march) and then stay out of the battle: the rest fights.
    // An army of Pathfinders only is just a scouting march.
    const scoutsSent = m.units.pathfinder;
    if (scoutsSent > 0 && totalUnits(m.units) === scoutsSent) return this.resolveScout(m);
    let scoutSurvivors = emptyUnits();
    let fighters = m.units;
    // One report per attack: the duel's result goes into the battle reports as their `scouting` part (no separate scout report).
    let scouting: { data: ScoutReportData; spotted: boolean } | null = null;
    if (scoutsSent > 0) {
      const duel = this.runScouting(m, origin, target, at, true);
      scoutSurvivors = duel.survivors;
      scouting = { data: duel.data, spotted: duel.spotted };
      fighters = { ...m.units, pathfinder: 0 };
      origin = this.store.getVillage(m.originVillageId) ?? origin; // both villages were saved by the duel
      target = this.store.getVillage(m.targetVillageId) ?? target;
    }
    const originState = settleVillage(origin.state, at, s);
    const targetState = settleVillage(target.state, at, s);
    // Support stationed at the target defends with the village's own troops.
    const contingents = this.store.stationedAt(target.id);
    // An attack with Chieftains is a Strike attempt, not a raid: it carries no loot.
    const strikeTry = fighters.chieftain > 0 && origin.ownerId !== null;
    // The store village: a won raid may also take up to a fifth of each Tribe Store resource (the Vault shelters only the stock).
    const storeRaid = strikeTry ? null : this.projects.raidPool(target, at);

    // Morale: only a fight against a village OWNED BY ANOTHER PLAYER; points are read here, at the fight (server side, no client input).
    const morale =
      origin.ownerId !== null && target.ownerId !== null && origin.ownerId !== target.ownerId
        ? moraleFactor(this.store.playerPoints(origin.ownerId), this.store.playerPoints(target.ownerId), worldRules(s).features.morale)
        : 1;
    const result = resolveBattle({
      attackerUnits: fighters,
      defender: targetState,
      ...(morale < 1 ? { moraleFactor: morale } : {}),
      support: contingents.map((c) => c.units),
      // Attacker and support use the ranks stamped when they left home; the defender's are its village's current ones.
      attackerRanks: m.ranks ?? undefined,
      defenderRanks: targetState.ranks,
      supportRanks: contingents.map((c) => c.ranks ?? undefined),
      seed: battleSeed((this.salt ??= this.store.battleSalt()), m.id, at),
      noLoot: strikeTry,
      siegeTarget: m.siegeTarget ?? null,
      ...(storeRaid ? { extraLootable: storeRaid.pool } : {}),
    }, s);
    // Split the loot between the village stock and the store (the carriers take the whole of it home).
    let lootFromStore: Resources | null = null;
    let villageLoot = result.loot;
    if (storeRaid && result.attackerWon) {
      const hidden = vaultProtection(targetState);
      const villagePool = emptyResources();
      for (const r of RESOURCE_IDS) villagePool[r] = Math.max(0, Math.floor(targetState.resources[r]) - hidden);
      const split = splitLoot(result.loot, villagePool, storeRaid.pool);
      villageLoot = split.fromVillage;
      if (RESOURCE_IDS.some((r) => split.fromStore[r] > 0)) {
        lootFromStore = split.fromStore;
        this.projects.applyRaid(storeRaid.tribeId, split.fromStore, origin.ownerName ?? 'someone', at);
      }
    }
    const supportLosses = contingents.map((_, i) => normalizeUnits(result.supportLosses[i]));
    const newTarget = applyBattleToDefender(targetState, { ...result, loot: villageLoot });
    const newOrigin = applyAttackerLosses(originState, result.attackerLosses);
    this.store.saveVillage(target.id, newTarget, villagePoints(newTarget));
    this.store.saveVillage(origin.id, newOrigin, villagePoints(newOrigin));
    // After the attacker's own village is saved: a support owner's home may be that very village.
    this.applyContingentLosses(contingents, supportLosses, at);

    // First steps: a WON raid on an abandoned village is the "raid" step (a lost one does not count; recorded here, at the event).
    if (result.attackerWon && !strikeTry && target.ownerId === null && origin.ownerId !== null) this.store.firstSteps.markDone(origin.ownerId, 'raid', at);
    this.countBattleStats(origin, target, contingents, result, supportLosses);
    // Staff tooling: a fight between two players goes into the pair log (loot, losses, how many defenders stood there).
    if (origin.ownerId !== null && target.ownerId !== null && origin.ownerId !== target.ownerId) {
      this.store.multi.logEvent({
        at,
        kind: 'attack',
        a: origin.ownerId,
        b: target.ownerId,
        amount: RESOURCE_IDS.reduce((n, r) => n + result.loot[r], 0),
        lostA: totalUnits(result.attackerLosses),
        lostB: totalUnits(result.defenderLosses) + supportLosses.reduce((n, l) => n + totalUnits(l), 0),
        defenders: totalUnits(result.defenderUnits) + contingents.reduce((n, c) => n + totalUnits(c.units), 0),
      });
    }
    // Combat Renown (bonus source, section 18.2): states are the settled, pre-battle ones; who earns is decided in the service.
    const outcomes = this.renown.awardBattle({
      at,
      result,
      origin,
      target,
      originState,
      targetState,
      attackerRanks: m.ranks ?? undefined,
      contingents,
    });
    // Per report owner: Renown earned (or why none), and the value of enemy troops their side destroyed (the fighter rankings' number).
    // `hideDestroyed`: a wiped-out attacker sees nothing of the defence, so the defender's losses stay hidden from them too.
    const gained = (playerId: number | null, hideDestroyed = false): Pick<BattleReportData, 'renownGained' | 'defeatedPeople' | 'renownNote'> => {
      const o = playerId === null ? undefined : outcomes.get(playerId);
      if (!o) return {};
      const destroyed = Math.floor(o.destroyed + 1e-9);
      return {
        ...(o.renown > 0 ? { renownGained: o.renown } : {}),
        ...(destroyed > 0 && !hideDestroyed ? { defeatedPeople: destroyed } : {}),
        ...(o.renown < 1 && o.note ? { renownNote: o.note } : {}),
      };
    };

    const survived = totalUnits(result.attackerSurvivors) > 0;
    // Strike decision, made before the reports are written so the attacker's report can say what the Chieftains did. It only reads:
    // the strike itself, the chain entry and the hold follow below.
    let check: StrikeCheck | null = null;
    let household = false;
    let strikeInfo: StrikeOutcome | undefined;
    if (strikeTry && origin.ownerId !== null) {
      if (survived) {
        // Same connection as the owner: no Strike and nothing is banked (the battle itself stands).
        household = target.ownerId !== null && this.store.shareAnIp(origin.ownerId, target.ownerId);
        // Chieftain chain: Chieftains of this attacker's earlier attacks on this village that are still inside the window and
        // still on their way home count with the survivors. Entries are written in arrival order (movements resolve by
        // arrival time, then id), so this sum depends only on stored times and ids.
        const entries = household ? [] : this.store.strikeChainOf(target.id, origin.ownerId);
        const banked = chainedChieftains(entries, at, s);
        check = checkStrike(
          result,
          result.attackerSurvivors,
          {
            abandoned: target.ownerId === null,
            points: villagePoints(targetState),
            now: at,
            lockUntil: targetState.lockUntil,
            // The village's own protection and the owner's beginner / restart protection both stop a Strike.
            protectedUntil: Math.max(targetState.protectedUntil ?? 0, target.ownerId !== null ? target.ownerProtectedUntil : 0),
          },
          { playersEnabled: this.playersConquerable() },
          banked,
          s,
        );
        const need = check.need;
        if (household) strikeInfo = { result: 'refused', need, reason: 'household' };
        else if (check.ok) strikeInfo = { result: 'struck', need, holdMs: holdDurationMs(target.ownerId === null, s) };
        else if (check.reason === 'too_few_chieftains' && check.chieftains >= 1) {
          const counted = entries.filter((e) => e.at <= at && at - e.at <= strikeChainWindowMs(s)).map((e) => e.at);
          strikeInfo = { result: 'banked', need, have: check.chieftains + check.banked, endsAt: Math.min(at, ...counted) + strikeChainWindowMs(s) };
        } else if (check.reason === 'too_few_chieftains') strikeInfo = { result: 'fell', need };
        else strikeInfo = { result: 'refused', need, reason: check.reason };
      } else {
        strikeInfo = { result: 'fell', need: chieftainsNeeded(target.ownerId === null, villagePoints(targetState)) };
      }
    }
    const full: BattleReportData = {
      outcome: 'battle',
      attacker: refOf(origin),
      defender: refOf(target),
      attackerWon: result.attackerWon,
      luck: result.luck,
      attackPower: result.attackPower,
      defensePower: result.defensePower,
      attackerUnits: fighters,
      attackerLosses: result.attackerLosses,
      defenderUnits: result.defenderUnits,
      defenderLosses: result.defenderLosses,
      supportUnits: contingents.length > 0 ? sumUnits(contingents.map((c) => c.units)) : null,
      supportLosses: contingents.length > 0 ? sumUnits(supportLosses) : null,
      // The Wall as it counted in the battle (after the Firecarts' during hit); the Wall siege line below runs from before to after.
      wallLevel: result.wallDuring,
      ...(morale < 1 ? { morale } : {}),
      loot: result.loot,
      ...(lootFromStore ? { lootFromTribeStore: lootFromStore } : {}),
      ...(hasSiegeUnits(fighters) ? { siege: result.siege ?? [] } : {}),
    };
    // The Pathfinders' part, as each side may see it: the sender sees the intel and (on success) the defending scouts; the defender
    // hears of it only when somebody there spotted them.
    const scoutingFor = (side: 'attack' | 'defense'): { scouting: BattleScouting } | Record<string, never> => {
      if (!scouting) return {};
      const d = scouting.data;
      if (side === 'attack') return { scouting: { sent: d.scoutsSent, lost: d.scoutsLost, success: d.success, defenderScouts: d.defenderScouts, defenderScoutsLost: d.defenderScoutsLost, intel: d.intel } };
      if (!scouting.spotted) return {};
      return { scouting: { sent: d.scoutsSent, lost: d.scoutsLost, success: d.success, defenderScouts: d.defenderScouts, defenderScoutsLost: d.defenderScoutsLost, intel: null } };
    };
    if (origin.ownerId !== null) {
      // An army wiped out sees nothing of the defence, except the Wall hit of a close loss (it shot during the battle).
      const wallHits = (result.siege ?? []).filter((h) => h.building === 'wall');
      // A close lost fight (attack power at least LOST_ATTACK_SEEN_SHARE of the defence) still shows what held the village; decided here, on the
      // server, as the report is written. The Wall level and the buildings stay hidden either way.
      const seen = survived || result.attackPower >= LOST_ATTACK_SEEN_SHARE * result.defensePower;
      const battle: BattleReportData = survived
        ? full
        : seen
          ? { ...full, wallLevel: null, seenInLoss: true, ...(hasSiegeUnits(fighters) ? { siege: wallHits } : {}) }
          : {
            ...full,
            defenderUnits: null,
            defenderLosses: null,
            supportUnits: null,
            supportLosses: null,
            wallLevel: null,
            ...(hasSiegeUnits(fighters) ? { siege: wallHits } : {}),
          };
      this.store.insertReport({
        playerId: origin.ownerId,
        side: 'attack',
        won: result.attackerWon,
        title: `Raid on ${target.name} ${coords(target)}`,
        createdAt: at,
        type: 'battle',
        battle: { ...battle, ...(strikeInfo ? { strike: strikeInfo } : {}), ...gained(origin.ownerId, !seen), ...scoutingFor('attack') },
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
        battle: { ...full, ...gained(target.ownerId), ...scoutingFor('defense') },
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
    let bankChieftains = 0;
    if (check && origin.ownerId !== null && !household) {
      if (check.ok) {
        this.strike(origin, target, newTarget, targetState.hearth, result.attackerSurvivors, m, at);
        this.store.clearStrikeChain(target.id, origin.ownerId); // the chain is used up
        struck = true;
      } else if (check.reason === 'too_few_chieftains' && check.chieftains >= 1) {
        bankChieftains = check.chieftains; // only the Chieftain count was missing: write a chain entry below
      }
    }
    // Any other battle at a cold village changes who stands there: the hold clock follows.
    if (!struck && target.state.hearth) this.refreshHold(target.id, at);

    let spawned: number | null = null;
    // Surviving Pathfinders walk home with the army's survivors, or alone when the rest of the army fell (or struck and stayed).
    const walkers = struck || !survived ? scoutSurvivors : addUnits(result.attackerSurvivors, scoutSurvivors);
    if (totalUnits(walkers) > 0) {
      const back = m.returnSecs != null ? m.returnSecs * 1000 : travelTimeMs({ x: target.x, y: target.y }, { x: origin.x, y: origin.y }, walkers, s, this.sites.waymarksForPlayer(origin.ownerId));
      spawned = at + back;
      const returnId = this.store.insertMovement({
        kind: 'return',
        originVillageId: origin.id,
        targetVillageId: target.id,
        units: walkers,
        loot: survived && !struck ? result.loot : null,
        departAt: at,
        arriveAt: spawned,
      });
      // Chieftain chain entry. It counts only while THIS return movement exists: once the survivors are home the movement row is
      // deleted, those Chieftains are fresh Chieftains that can be sent again, and they must never be counted twice.
      if (bankChieftains > 0 && origin.ownerId !== null) {
        this.store.addStrikeChain(target.id, origin.ownerId, bankChieftains, at, returnId, at - strikeChainWindowMs(s));
      }
    }
    this.store.deleteMovement(m.id);
    const sent = this.takeSpawn(); // returns the hold update sent walking (occupiers going home)
    return spawned === null ? sent : sent === null ? spawned : Math.min(spawned, sent);
  }

  /**
   * Does `senderId` stand on the owner's side of a cold village (hearth out)? True for the owner (from another village), a
   * tribe-mate or an ally of the owner, as long as the sender is not tied to the claimant by tribe, alliance or pact.
   */
  private isRelief(senderId: number, target: VillageRecord, t: number): boolean {
    const h = target.state.hearth;
    if (!h || target.ownerId === null || h.claimBy === senderId) return false;
    if (isAttackForbidden(relationBetweenPlayers(this.store.tribes, senderId, h.claimBy, t).relation)) return false;
    if (target.ownerId === senderId) return true;
    return isSupportAllowed(relationBetweenPlayers(this.store.tribes, senderId, target.ownerId, t).relation);
  }

  /**
   * A relief attack arrives at a cold village (docs/GAME_DESIGN.md 18.2, "How the owner fights back"). The defenders are the
   * claimant's occupiers only: the village's own troops take no part, its Wall does not shelter an occupier, nothing is looted,
   * no Chieftain strikes and no siege lowers a building. Losses follow the normal rules. The hold clock then follows the occupiers
   * that are left: all dead = the hearth relights at once, under the minimum = the clock stops. No combat Renown is paid.
   */
  private resolveRelief(m: MovementRow, origin: VillageRecord, target: VillageRecord): number | null {
    const s = this.settings;
    const at = m.arriveAt;
    const h = target.state.hearth as HearthState;
    const occupiers = this.store.stationedAt(target.id).filter((c) => c.ownerPlayerId === h.claimBy);
    const originState = settleVillage(origin.state, at, s);
    const { ranks: _ranks, ...rest } = settleVillage(target.state, at, s);
    const bare: VillageState = { ...rest, troops: emptyUnits(), buildings: { ...rest.buildings, wall: 0 } };
    const result = resolveBattle({
      attackerUnits: m.units,
      defender: bare,
      support: occupiers.map((c) => c.units),
      attackerRanks: m.ranks ?? undefined,
      supportRanks: occupiers.map((c) => c.ranks ?? undefined),
      seed: battleSeed((this.salt ??= this.store.battleSalt()), m.id, at),
      noLoot: true,
      siegeTarget: null,
    }, s);
    const supportLosses = occupiers.map((_, i) => normalizeUnits(result.supportLosses[i]));
    const newOrigin = applyAttackerLosses(originState, result.attackerLosses);
    this.store.saveVillage(origin.id, newOrigin, villagePoints(newOrigin));
    this.applyContingentLosses(occupiers, supportLosses, at);

    const killed = supportLosses.reduce((n, l) => n + totalUnits(l), 0);
    const lost = totalUnits(result.attackerLosses);
    this.store.addStats(origin.ownerId, { troopsKilled: killed, troopsLost: lost, attacksWon: result.attackerWon ? 1 : 0, attacksLost: result.attackerWon ? 0 : 1 });
    this.store.addStats(h.claimBy, { troopsKilled: lost, troopsLost: killed, defencesWon: result.attackerWon ? 0 : 1, defencesLost: result.attackerWon ? 1 : 0 });

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
      supportUnits: sumUnits(occupiers.map((c) => c.units)),
      supportLosses: sumUnits(supportLosses),
      wallLevel: null,
      loot: emptyResources(),
    };
    const blind: BattleReportData = { ...full, defenderUnits: null, defenderLosses: null, supportUnits: null, supportLosses: null };
    if (origin.ownerId !== null) {
      this.store.insertReport({
        playerId: origin.ownerId,
        side: 'attack',
        won: result.attackerWon,
        title: `Relief attack at ${target.name} ${coords(target)}`,
        createdAt: at,
        type: 'battle',
        battle: survived ? full : blind,
      });
    }
    if (target.ownerId !== null && target.ownerId !== origin.ownerId) {
      this.store.insertReport({
        playerId: target.ownerId,
        side: 'defense',
        won: result.attackerWon,
        title: `Relief attack at ${target.name} ${coords(target)} from ${origin.ownerName ?? 'a friend'}`,
        createdAt: at,
        type: 'battle',
        battle: full,
      });
    }
    this.store.insertReport({
      playerId: h.claimBy,
      side: 'support',
      won: !result.attackerWon,
      title: `Your troops at ${target.name} ${coords(target)} were attacked`,
      createdAt: at,
      type: 'battle',
      battle: full,
    });

    // The occupiers changed: the hold clock follows (all dead = relit at once).
    this.refreshHold(target.id, at);
    let spawned: number | null = null;
    if (survived) {
      const back = m.returnSecs != null ? m.returnSecs * 1000 : travelTimeMs({ x: target.x, y: target.y }, { x: origin.x, y: origin.y }, result.attackerSurvivors, s, this.sites.waymarksForPlayer(origin.ownerId));
      spawned = at + back;
      this.store.insertMovement({
        kind: 'return',
        originVillageId: origin.id,
        targetVillageId: target.id,
        units: result.attackerSurvivors,
        loot: emptyResources(),
        departAt: at,
        arriveAt: spawned,
      });
    }
    this.store.deleteMovement(m.id);
    const sent = this.takeSpawn();
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
      this.store.multi.logEvent({ at, kind: 'strike', a: claimant, b: target.ownerId });
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
    this.store.emitHearth(target.ownerId, claimant); // live hint: hearth out (owner, claimant, owner's tribe alert list)
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
    this.store.emitHearth(v.ownerId, h.claimBy); // the clock may have started, paused or resumed
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
    this.store.emitHearth(v.ownerId, h.claimBy); // live hint: hold broken or ended
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
   * occupiers stay as support from their home villages (no own troops), one Chieftain is used up, the others walk home; the old owner's troops, queues
   * and contingents are gone and everyone else's troops standing here go home. `at` is the exact end of the clock.
   */
  private completeTake(v: VillageRecord, h: HearthState, at: number): void {
    const s = this.settings;
    const claimant = this.store.getPlayer(h.claimBy);
    const owned = claimant ? this.store.villagesOfPlayer(claimant.id).length : 0;
    if (!claimant || claimant.deletedAt !== null || !underVillageLimit(owned)) return this.endClaim(v, h, 'no_room', at);
    const oldOwnerId = v.ownerId;
    const rows = this.store.stationedAt(v.id);
    const occ = rows.filter((c) => c.ownerPlayerId === claimant.id);

    // The old owner's side of the village: what it held and what was away from it is disbanded (the engine rule).
    let lostUnits: Units | null = null;
    if (oldOwnerId !== null) {
      const old = settleVillage(v.state, at, s);
      lostUnits = addUnits(old.troops, old.away);
      for (const mv of this.store.movementsFrom(v.id)) this.store.deleteMovement(mv.id);
      for (const c of this.store.stationedHomedAt(v.id)) this.store.deleteStationed(c.id);
    }

    // Occupiers stay as SUPPORT from the village that sent them (owner 2026-11-18): the stationed rows, home village and ranks stay as
    // they are, and the units keep counting in their home village (away). Edge case (decided): a contingent whose home village is gone or
    // no longer the claimant's cannot be support; it moves in as the village's own troops up to the population cap (the old rule).
    const occTotal = sumUnits(occ.map((c) => c.units));
    const stayRows = occ.filter((c) => {
      const home = this.store.getVillage(c.homeVillageId);
      return home && home.id !== v.id && home.ownerId === claimant.id;
    });
    const fallbackRows = occ.filter((c) => !stayRows.includes(c));
    const moveIn = sumUnits(fallbackRows.map((c) => c.units));
    moveIn.chieftain = 0;
    const change = applyOwnerChange(v.state, { occupiers: occTotal, moveIn, now: at, settings: s });
    const name = v.name; // a taken village keeps its name until the new owner renames it (owner 2026-11-18)
    this.store.setVillageOwner(v.id, claimant.id, name);
    this.store.saveVillage(v.id, change.state, villagePoints(change.state));

    // One Chieftain is used up (taken off his home village's away count); the other Chieftains walk home, everyone else stays.
    const here: VillageRecord = { ...v, ownerId: claimant.id, ownerName: claimant.username, name };
    let usedLeft = change.chieftainUsed;
    const overflowLeft = { ...change.overflow };
    const overflowTotal = emptyUnits();
    const stays = emptyUnits();
    for (const c of occ) {
      const home = this.store.getVillage(c.homeVillageId);
      const used = Math.min(usedLeft, c.units.chieftain);
      usedLeft -= used;
      const walk = emptyUnits(); // goes home on a return movement
      walk.chieftain = c.units.chieftain - used;
      const gone = emptyUnits(); // used up, or moved in as own troops
      gone.chieftain = used;
      const keep = { ...c.units, chieftain: 0 };
      if (stayRows.includes(c)) {
        if (totalUnits(keep) > 0) this.store.setStationedUnits(c.id, keep);
        else this.store.deleteStationed(c.id);
        for (const u of UNIT_IDS) stays[u] += keep[u];
      } else {
        this.store.deleteStationed(c.id);
        for (const u of UNIT_IDS) {
          if (u === 'chieftain') continue;
          const take = Math.min(keep[u], overflowLeft[u]); // did not fit: goes home
          walk[u] += take;
          overflowLeft[u] -= take;
          gone[u] += keep[u] - take;
        }
      }
      if (!home || home.id === v.id) continue;
      if (totalUnits(gone) > 0) {
        const next = applyAttackerLosses(settleVillage(home.state, at, s), gone);
        this.store.saveVillage(home.id, next, villagePoints(next));
      }
      if (totalUnits(walk) > 0) {
        this.insertReturn(home, here, walk, at);
        for (const u of UNIT_IDS) overflowTotal[u] += walk[u];
      }
    }
    if (change.chieftainUsed > 0) this.spendVillagePrice(claimant.id, owned); // owned = villages before this one
    // Everyone else's troops standing here go home.
    this.sendHostedHome(v, at, (c) => c.ownerPlayerId !== claimant.id);

    const ref = refOf(here);
    this.store.insertReport({
      playerId: claimant.id,
      side: 'attack',
      won: true,
      title: `Village taken: ${name} ${coords(v)}`,
      createdAt: at,
      type: 'village',
      village: { kind: 'taken', village: ref, ...(totalUnits(stays) > 0 ? { stays } : {}), ...(totalUnits(overflowTotal) > 0 ? { overflow: overflowTotal } : {}) },
    });
    if (oldOwnerId !== null) {
      this.store.multi.logEvent({ at, kind: 'conquest', a: claimant.id, b: oldOwnerId });
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
    this.store.emitHearth(oldOwnerId, claimant.id); // live hint: village taken (the old owner's tribe list loses the hold)
  }

  /** Does the player have no village? Then a fresh start village is created at the next request (AuthService.ensureStartingVillage). */
  playerHasVillage(playerId: number): boolean {
    return this.store.hasVillage(playerId);
  }

  // ---- Chieftain Renown ledger (BANKED model, owner 2026-11-20) ----------------------------------------------
  // players.renown_reserved is the POOL of Renown paid for Chieftains (chest_reserved the same for War Chest gold); it is part of
  // renown_spent. H = Chieftains held (queued + home + away + standing + walking home). target(owned, H) = the slot prices of the H
  // Chieftains; banked = max(0, pool - target). Training pays only what the banked part does not cover. A Chieftain dying, being lost
  // or cancelled never changes the pool (it becomes banked as H drops). Gaining a village spends one village price from the pool.

  /** The pool's banked part (Renown, gold) for a player with `owned` villages and `held` Chieftains. */
  private bankedFor(p: PlayerRow, owned: number, held: number): { renown: number; gold: number } {
    const target = chieftainTarget(owned, held, this.settings);
    return { renown: chieftainBanked(p.renownReserved, target.renown), gold: chieftainBanked(p.chestReserved, target.gold) };
  }

  /** Chieftains the player has: queued + at home + away (standing or walking), over all their villages, settled to `at`. */
  private outstandingChieftains(playerId: number, at: number): number {
    return this.store.villagesOfPlayer(playerId).reduce((n, v) => n + chieftainsIn(settleVillage(v.state, at, this.settings)), 0);
  }

  /** The prices of the next CHIEFTAIN_MAX_BATCH Chieftains in order (each the full price of one village), for GET /api/state. */
  private nextChieftainPrices(owned: number, held: number): Array<{ renown: number; gold: number }> {
    return Array.from({ length: CHIEFTAIN_MAX_BATCH }, (_, i) => chieftainPrice(owned, held + i, this.settings));
  }

  /** The player's War Chest as shown to them (gold floored like Renown; the price of the next Chieftains). `held` = Chieftains the player has. */
  private chestInfo(p: PlayerRow, villages: number, held?: number): ChestInfo {
    const owned = Math.max(1, villages);
    const h = held ?? this.outstandingChieftains(p.id, this.clock());
    const prices = this.nextChieftainPrices(owned, h);
    const banked = this.bankedFor(p, owned, h);
    return {
      gold: Math.floor(p.chestGold + 1e-9),
      reserved: Math.floor(p.chestReserved + 1e-9),
      banked: Math.floor(banked.gold + 1e-9),
      chieftainPrice: Math.ceil(chieftainDue(prices[0]?.gold ?? 0, banked.gold) - 1e-9),
      chieftainPrices: prices.map((x) => x.gold),
      villagePrice: chestVillageCost(owned, this.settings),
      held: 0,
    };
  }

  /**
   * Once per world database (meta flag), when this version first runs on a world (owner 2026-11-20, "deposits count; the rest is waived
   * once"): every open claim (the rest of a village price reserved by a sent Strike / Found order under the 2026-11-18 rule) is folded into
   * the player's Chieftain pool: its Renown and War Chest gold were already taken out of the balance and the chest, so they now count as
   * reserved (renown_reserved += claim Renown, chest_reserved += claim gold) and the claim row is deleted. Chieftains already trained keep
   * what they paid. Nothing more is charged. Logged per player. Fresh worlds only set the flag.
   */
  migrateChieftainFullPrice(): Array<{ playerId: number; username: string; renown: number; gold: number }> {
    if (this.store.getMeta('chieftain_full_price_applied')) return [];
    const out: Array<{ playerId: number; username: string; renown: number; gold: number }> = [];
    this.store.tx(() => {
      for (const id of this.store.allClaimPlayerIds()) {
        const p = this.store.getPlayer(id);
        if (!p) continue;
        const held = this.store.claimsHeld(id);
        this.store.foldClaimsIntoReserve(id);
        out.push({ playerId: id, username: p.username, renown: Math.floor(held.renown + 1e-9), gold: Math.floor(held.gold + 1e-9) });
      }
      this.store.setMeta('chieftain_full_price_applied', '1');
    });
    for (const r of out) console.info(`[game] chieftain full price (v36): ${r.username}: claims of ${r.renown} Renown and ${r.gold} War Chest gold folded into the Chieftain pool`);
    return out;
  }

  /**
   * A village was gained (taken or founded) by `owned` -> owned + 1 villages: one village price leaves the pool for good (it stays in
   * renown_spent). min(pool, the price of the village after `owned`), for Renown and for War Chest gold separately.
   */
  private spendVillagePrice(playerId: number, owned: number): void {
    const p = this.store.getPlayer(playerId);
    if (!p) return;
    const o = Math.max(1, owned);
    this.store.releaseRenown(playerId, Math.min(p.renownReserved, villageRenownCost(o, this.settings)), 0);
    this.store.releaseChest(playerId, Math.min(p.chestReserved, chestVillageCost(o, this.settings)), 0);
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
    const { survivors } = this.runScouting(m, origin, target, at, false);
    let spawned: number | null = null;
    if (totalUnits(survivors) > 0) {
      spawned = at + (m.returnSecs != null ? m.returnSecs * 1000 : travelTimeMs({ x: target.x, y: target.y }, { x: origin.x, y: origin.y }, survivors, this.settings, this.sites.waymarksForPlayer(origin.ownerId)));
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
   * The scouting duel of the Pathfinders in movement `m` against the village `target`: losses on both sides are saved, stats
   * counted. Used by a Pathfinder-only march and, first of all, by an attack that carries Pathfinders. A scouting march gets its own
   * reports here (the sender's, and the target's if somebody there spotted them); with `merged` (an attack) nothing is written: the
   * caller puts `data` into the battle reports (`scouting`), so there is one report per attack. Returns the surviving Pathfinders
   * (units), the report data and whether the target's side spotted them; the caller sends the survivors home. Re-read the villages
   * afterwards: both were saved here.
   */
  private runScouting(m: MovementRow, origin: VillageRecord, target: VillageRecord, at: number, merged: boolean): { survivors: Units; data: ScoutReportData; spotted: boolean } {
    const s = this.settings;
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
    const survivors = only('pathfinder', scoutsSent - result.scoutLosses);

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
    const spotted = target.ownerId !== null && defenderScouts > 0;
    if (merged) return { survivors, data, spotted };
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
    if (spotted) {
      this.store.insertReport({
        playerId: target.ownerId as number,
        side: 'defense',
        won: !result.success,
        title: `Enemy scouts from ${origin.name} ${coords(origin)}`,
        createdAt: at,
        type: 'scout',
        scout: { ...data, defenderScouts, intel: null },
      });
    }

    return { survivors, data, spotted };
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
    // A turned-back shipment (no units) travels at carrier speed. Roads shorten the way home between two members of one tribe
    // (support coming home, a shipment turning back): the same factor as on the way out.
    const way = cargo
      ? shipmentTravelMs({ x: from.x, y: from.y }, { x: home.x, y: home.y }, this.settings, this.sites.waymarksForPlayer(home.ownerId))
      : travelTimeMs({ x: from.x, y: from.y }, { x: home.x, y: home.y }, units, this.settings, this.sites.waymarksForPlayer(home.ownerId));
    const arriveAt = t + this.projects.roadsMs(way, home.ownerId, from.ownerId, t);
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
    const arriveAt = t + travelTimeMs(tile, { x: home.x, y: home.y }, units, this.settings, this.sites.waymarksForPlayer(home.ownerId));
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
    if (m.units.chieftain > 0) this.spendVillagePrice(owner.id, owned); // owned = villages before this one
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
   * village `away` count, settling that village first.
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
    this.sites.settleMember(player.id, t); // daily site Renown earned so far is credited, so the total shown is current
    let pending = 0;
    let chieftains = 0;
    const fresh0 = this.store.getPlayer(player.id) ?? player;
    const eligibleFrom = defenderEligibleFrom(fresh0.protectedUntil, fresh0.createdAt, this.settings);
    const earns = !this.store.isSandboxUser(player.username);
    const settledStates: VillageState[] = [];
    const villages = this.store.villagesOfPlayer(player.id).map((v0) => {
      const v = this.withEntitlement(fresh0, v0);
      const settled = settleVillage(v.state, t, this.settings);
      settledStates.push(settled);
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
    const ownedN = Math.max(1, villages.length);
    const prices = this.nextChieftainPrices(ownedN, chieftains);
    const banked = this.bankedFor(fresh, ownedN, chieftains);
    return {
      serverTime: t,
      settings: this.settings,
      player: dto,
      villages,
      chest: this.chestInfo(fresh, villages.length, chieftains),
      renown: {
        // The pending defender trickle shows too; the site Renown was settled into the total above.
        ...makeRenownInfo(fresh.renownTotal + pending, fresh.renownSpent, villages.length, this.settings),
        reserved: Math.floor(fresh.renownReserved + 1e-9),
        banked: Math.floor(banked.renown + 1e-9),
        chieftainPrice: Math.ceil(chieftainDue(prices[0]?.renown ?? 0, banked.renown) - 1e-9),
        chieftainPrices: prices.map((x) => x.renown),
        chieftainsHeld: chieftains,
        held: 0,
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
      // Newly done starter tasks are stored here (sticky); a read of this card is the only place they are detected.
      firstSteps: this.store.tx(() => firstStepsDto(this.store, player.id, settledStates, t)),
      chains: this.chainList(player.id, t),
      holds: this.holdList(player.id, t),
    };
  }

  /** Villages the player holds now (their claim on a cold village): the hold clock for the Banner Hall page. */
  private holdList(playerId: number, t: number): HoldListItemDto[] {
    const out: HoldListItemDto[] = [];
    const seen = new Set<number>();
    for (const st of this.store.stationedAbroad(playerId)) {
      if (seen.has(st.host.villageId)) continue;
      seen.add(st.host.villageId);
      const v = this.store.getVillage(st.host.villageId);
      const h = v?.state.hearth;
      if (!v || !h || h.claimBy !== playerId) continue;
      const d = hearthDto(h, t, this.settings, '');
      out.push({ villageId: v.id, name: v.name, x: v.x, y: v.y, running: d.running, holdMsLeft: d.holdMsLeft });
    }
    return out.sort((a, b) => a.holdMsLeft - b.holdMsLeft);
  }

  /** The player's own Chieftain chains (villages with banked Chieftains inside the window), soonest to run out first. */
  private chainList(playerId: number, t: number): ChainListItemDto[] {
    const windowMs = strikeChainWindowMs(this.settings);
    const byVillage = new Map<number, Array<{ chieftains: number; at: number }>>();
    for (const e of this.store.strikeChainsOfPlayer(playerId)) {
      if (t - e.at < 0 || t - e.at > windowMs) continue;
      const list = byVillage.get(e.villageId);
      if (list) list.push(e);
      else byVillage.set(e.villageId, [e]);
    }
    const out: ChainListItemDto[] = [];
    for (const [villageId, entries] of byVillage) {
      const v = this.store.getVillage(villageId);
      if (!v) continue;
      const have = chainedChieftains(entries, t, this.settings);
      if (have < 1) continue;
      out.push({
        villageId,
        name: v.name,
        x: v.x,
        y: v.y,
        have,
        need: chieftainsNeeded(v.ownerId === null, villagePoints(v.state)),
        endsAt: Math.min(...entries.map((e) => e.at)) + windowMs,
      });
    }
    return out.sort((a, b) => a.endsAt - b.endsAt);
  }

  /** Take a done step's reward into one of the player's villages (capped at its storage). One transaction; a second claim changes nothing. */
  claimFirstStep(player: PlayerRow, stepId: FirstStepId, villageId: number, t: number): FirstStepClaimResponse {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const reward = firstStepReward(stepId);
      if (!reward) throw new GameError('invalid_input', 'Unknown step.');
      const all = this.store.villagesOfPlayer(player.id).map((x) => settleVillage(x.state, t, this.settings));
      const state = firstStepsDto(this.store, player.id, all, t);
      const step = state.steps.find((x) => x.id === stepId);
      if (!step?.done) throw new GameError('step_not_done', 'You have not finished that step yet.');
      if (step.claimed || !this.store.firstSteps.claim(player.id, stepId, t)) throw new GameError('step_claimed', 'You already took that reward.');
      const settled = settleVillage(v.state, t, this.settings);
      const { resources, added } = claimReward(storageCap(settled), settled.resources, reward);
      const next: VillageState = { ...settled, resources };
      this.store.saveVillage(v.id, next, villagePoints(next));
      return { firstSteps: firstStepsDto(this.store, player.id, all, t), village: this.ownDto(v, next, t), added };
    });
  }

  /** Fold the first steps card away or bring it back. */
  setFirstStepsHidden(player: PlayerRow, hidden: boolean, t: number): FirstStepsDto {
    return this.store.tx(() => {
      this.store.firstSteps.setHidden(player.id, hidden);
      const all = this.store.villagesOfPlayer(player.id).map((x) => settleVillage(x.state, t, this.settings));
      return firstStepsDto(this.store, player.id, all, t);
    });
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
    return { villages: this.mapDtos(player, this.store.mapVillages(x, x + w - 1, y, y + h - 1), t) };
  }

  /** Base rows for the whole-world overview, kept for MAP_OVERVIEW_CACHE_MS (per world: one process = one world). */
  private overviewCache: { at: number; rows: Array<{ x: number; y: number; ownerId: number | null; tribeId: number | null }> } | null = null;

  /** GET /api/map/overview: premium only (checked here, 403 otherwise). Light `[x, y, code]` rows with the relation computed for this viewer. */
  mapOverview(player: PlayerRow, t: number): MapOverviewResponse {
    if (!hasWideOverviewExtra(this.premiumBits(player))) throw new GameError('forbidden', 'The wide overview is part of Premium, and this account does not have it.');
    if (!this.overviewCache || t - this.overviewCache.at >= MAP_OVERVIEW_CACHE_MS || t < this.overviewCache.at) {
      this.overviewCache = { at: t, rows: this.store.overviewRows() };
    }
    const viewer = loadRelationViewer(this.store.tribes, player.id, t);
    const CODE: Record<string, MapOverviewCode> = { self: 1, tribe: 2, ally: 3, nap: 4, enemy: 5 };
    return {
      serverTime: t,
      villages: this.overviewCache.rows.map((r): [number, number, MapOverviewCode] => [
        r.x,
        r.y,
        r.ownerId === null ? 0 : (CODE[viewer.relationTo(r.ownerId, r.tribeId)] ?? 6),
      ]),
    };
  }

  /**
   * Village search for the command post (GET /api/search/villages): the same per-viewer rows as the map, nothing more.
   * `from` (optional) must be one of the caller's own villages; results are then nearest first.
   */
  searchVillages(player: PlayerRow, q: unknown, by: unknown, fromId: number | null, t: number): MapResponse {
    if (by !== 'village' && by !== 'player') throw new GameError('invalid_input', 'by must be "village" or "player".');
    if (typeof q !== 'string') throw new GameError('invalid_input', 'q must be text.');
    const text = q.trim();
    if (text.length < 2 || text.length > 24 || /[\u0000-\u001f\u007f]/.test(text)) {
      throw new GameError('invalid_input', 'q must be 2 to 24 characters.');
    }
    let from: { x: number; y: number } | null = null;
    if (fromId !== null) {
      const v = this.store.getVillage(fromId);
      if (!v || v.ownerId !== player.id) throw new GameError('not_found', 'Village not found.');
      from = { x: v.x, y: v.y };
    }
    return { villages: this.mapDtos(player, this.store.searchVillages(by, text, from, SEARCH_LIMIT), t) };
  }

  /** The per-viewer map rows shared by the map and the search: public data only (no troops, stock or queues). */
  private mapDtos(player: PlayerRow, rows: MapRow[], t: number): MapVillageDto[] {
    // The viewer's tribe and relations are read once; the owner's tribe comes with each map row.
    const viewer = loadRelationViewer(this.store.tribes, player.id, t);
    // The viewer's OWN Chieftain chains (their Chieftains still walking home), per village; nobody else's.
    const chainEntries = new Map<number, Array<{ chieftains: number; at: number }>>();
    for (const e of this.store.strikeChainsOfPlayer(player.id)) {
      const list = chainEntries.get(e.villageId);
      if (list) list.push(e);
      else chainEntries.set(e.villageId, [e]);
    }
    const windowMs = strikeChainWindowMs(this.settings);
    const chainOf = (villageId: number, abandoned: boolean, points: number): { chain?: ChainProgressDto } => {
      const entries = chainEntries.get(villageId);
      if (!entries) return {};
      const counted = entries.filter((e) => t - e.at >= 0 && t - e.at <= windowMs);
      const have = chainedChieftains(counted, t, this.settings);
      if (have < 1) return {};
      return { chain: { have, need: chieftainsNeeded(abandoned, points), endsAt: Math.min(...counted.map((e) => e.at)) + windowMs } };
    };
    const storeMarks = this.projects.storeMarkers(rows);
    const ownerPoints = this.store.playersPoints(rows.flatMap((r) => (r.ownerId === null ? [] : [r.ownerId])));
    return rows.map((r): MapVillageDto => {
      const points = r.points;
      return {
        id: r.id,
        name: r.name,
        x: r.x,
        y: r.y,
        kind: r.ownerId === null ? 'abandoned' : r.ownerId === player.id ? 'own' : 'player',
        ownerName: r.ownerName,
        ownerPoints: r.ownerId === null ? null : (ownerPoints.get(r.ownerId) ?? 0),
        // Abandoned villages: the stored points, refreshed at most hourly by the caretaker (refreshAbandonedVillages) and whenever one is raided.
        points,
        // A cold village (hearth out) is never shown as safe.
        protected: r.ownerId !== null && !r.coldState && (r.ownerProtectedUntil > t || r.protectedUntil > t),
        tribeTag: r.ownerId === null ? null : r.ownerTribeTag,
        tribeId: r.ownerId === null ? null : r.ownerTribeId,
        ownerChieftain: r.ownerId === null ? null : r.ownerChieftain,
        relation: r.ownerId === null ? null : viewer.relationTo(r.ownerId, r.ownerTribeId),
        ...(r.coldState?.hearth ? { hearth: hearthDto(r.coldState.hearth, t, this.settings, this.store.getPlayer(r.coldState.hearth.claimBy)?.username ?? '?') } : {}),
        ...chainOf(r.id, r.ownerId === null, points),
        ...(r.ownerId === null && r.defended ? { defended: true as const } : {}),
        ...(storeMarks.has(r.id) ? { tribeStore: true as const } : {}),
      };
    });
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
      villages: this.store.villagesOfPlayer(player.id).map((v0) => {
        const v = this.withEntitlement(this.store.getPlayer(player.id) ?? player, v0);
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

  /**
   * The realm overview (GET /api/realm): all of the player's own villages, each settled to `t` in memory only (nothing is saved, like
   * the village list). A constant number of queries however many villages there are: the villages, one grouped query each for incoming
   * attacks and for marches, and one for the notes; the hearth claimant's name is read only for a village whose hearth is out.
   */
  realm(player: PlayerRow, t: number): RealmResponse {
    const villages = this.store.villagesOfPlayer(player.id);
    const incoming = this.store.incomingAttackStats(player.id);
    const outgoing = this.store.outgoingMarchStats(player.id);
    const notes = this.store.notes.forVillages(player.id, villages.map((v) => v.id));
    const claimNames = new Map<number, string>();
    return {
      serverTime: t,
      villages: villages.map((v): RealmVillageDto => {
        const settled = settleVillage(v.state, t, this.settings);
        const h = settled.hearth;
        let claimBy: string | null = null;
        if (h) {
          claimBy = claimNames.get(h.claimBy) ?? null;
          if (claimBy === null) {
            claimBy = this.store.getPlayer(h.claimBy)?.username ?? '?';
            claimNames.set(h.claimBy, claimBy);
          }
        }
        const training: RealmTrainBatchDto[] = [];
        for (const building of TRAINING_BUILDING_IDS) {
          for (const job of settled.trainQueues[building] ?? []) {
            if (job.done >= job.count) continue;
            training.push({ building, unit: job.unit, left: job.count - job.done, finishAt: job.startAt + job.count * job.perUnitMs });
          }
        }
        training.sort((a, b) => a.finishAt - b.finishAt);
        const nonZero = (u: Units): Partial<Units> => {
          const out: Partial<Units> = {};
          for (const id of UNIT_IDS) if (u[id] > 0) out[id] = u[id];
          return out;
        };
        const inc = incoming.get(v.id);
        const out = outgoing.get(v.id);
        return {
          id: v.id,
          name: v.name,
          x: v.x,
          y: v.y,
          points: villagePoints(settled),
          hearth: h ? 'out' : 'lit',
          claimBy,
          holdEndsAt: h && h.runningSince !== null ? holdDueAt(h, this.settings) : null,
          protectedUntil: settled.protectedUntil !== undefined && settled.protectedUntil > t ? settled.protectedUntil : null,
          resources: floorResources(settled.resources),
          income: productionPerHour(settled, this.settings),
          storageCap: storageCap(settled),
          population: { used: populationUsage(settled).total, cap: populationCap(settled) },
          build: { queue: settled.buildQueue.map((j) => ({ building: j.building, targetLevel: j.targetLevel, finishAt: j.finishAt })), slots: MAX_BUILD_QUEUE },
          training,
          troops: nonZero(settled.troops),
          away: nonZero(settled.away),
          incoming: { attacks: inc?.count ?? 0, nextAt: inc?.nextAt ?? null },
          outgoing: { marches: out?.count ?? 0, nextAt: out?.nextAt ?? null },
          note: notes.get(v.id) ?? null,
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
    const dto: OwnVillageDto = { id: v.id, name: v.name, x: v.x, y: v.y, state };
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
        ...(r.digest ? { digest: r.digest } : {}),
      })),
    };
  }

  /** The caller's own latest scout report on a village with building levels (Firecart picker); nothing else. Unknown village: 404. */
  scoutedBuildings(player: PlayerRow, villageId: number): ScoutedResponse {
    if (!this.store.getVillage(villageId)) throw new GameError('not_found', 'Village not found.');
    const r = this.store.latestScoutBuildings(player.id, villageId);
    return r ? { buildings: r.buildings, scoutedAt: r.createdAt } : { buildings: null, scoutedAt: null };
  }

  /** The caller's own newest usable report on a village (scout or attack) for the troops hint; nulls when none. Unknown village: 404. */
  villageIntel(player: PlayerRow, villageId: number): VillageIntelDto {
    if (!this.store.getVillage(villageId)) throw new GameError('not_found', 'Village not found.');
    return this.store.latestIntel(player.id, villageId);
  }

  /** Incoming attacks on villages of the player's tribe members, soonest first. Members only. */
  tribeAlerts(player: PlayerRow, t: number): TribeAlertsResponse {
    const tribe = this.store.tribes.playerTribe(player.id);
    if (!tribe) throw new GameError('not_in_tribe', 'You are not in a tribe.');
    const watchtowerLevel = this.projects.level(tribe.id, 'watchtower', t);
    return {
      watchtowerLevel,
      alerts: this.store.tribeAlerts(tribe.id, ALERT_LIST_LIMIT).map((a) => ({
        movementId: a.movementId,
        target: stubRef(a.target),
        attacker: stubRef(a.attacker),
        attackerTribeTag: a.attackerTribeTag,
        departAt: a.departAt,
        arriveAt: a.arriveAt,
        // Watchtower: a rough size, then the slowest unit, then about-how-many. Chieftains are never counted or named.
        ...watchtowerInfo(a.units, watchtowerLevel),
      })),
      holds: this.store.tribeColdVillages(tribe.id, ALERT_LIST_LIMIT).flatMap((v): TribeHoldDto[] => {
        const h = v.state.hearth;
        if (!h) return [];
        // Same clock everybody sees on the map; the occupiers' numbers only for the owner of the village.
        const pop = v.ownerId === player.id ? occupierPopulation(sumUnits(this.store.stationedAt(v.id).filter((c) => c.ownerPlayerId === h.claimBy).map((c) => c.units))) : undefined;
        return [{ village: refOf(v), hearth: hearthDto(h, t, this.settings, this.store.getPlayer(h.claimBy)?.username ?? '?', pop) }];
      }),
    };
  }

  /** The player's own report (marked read). Other players' reports look like missing ones. */
  getReport(player: PlayerRow, id: number): ReportDto {
    return this.store.tx(() => {
      const r = this.store.getReport(player.id, id);
      if (!r) throw new GameError('not_found', 'Report not found.');
      if (!r.read) this.store.markReportRead(player.id, id);
      if (r.type === 'battle') {
        this.store.firstSteps.markDone(player.id, 'report', this.clock());
        this.store.onFtue?.(player.id, 'first_report');
      }
      return {
        id: r.id,
        createdAt: r.createdAt,
        title: r.title,
        side: r.side,
        type: r.type,
        won: r.won,
        read: true,
        outcome: r.outcome,
        ...(r.digest ? { digest: r.digest } : {}),
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
      const limit = buildQueueLimit(worldRules(this.settings), this.premiumTools(this.store.getPlayer(player.id) ?? player));
      const next = applyBuild(v.state, building, t, this.settings, limit);
      this.store.saveVillage(v.id, next, villagePoints(next));
      this.store.addStats(player.id, { buildingLevelsBuilt: 1 });
      this.store.onFtue?.(player.id, 'first_build');
      return this.ownDto(v, next, t);
    });
  }

  /**
   * Queue troops. A Chieftain batch also pays its price in the same transaction (docs/GAME_DESIGN.md 18.2, owner 2026-11-20: what is paid
   * stays paid). Each Chieftain has a full slot price (the price of one village, in order: chieftainBatchPrice(owned, held, count)); what the
   * pool already holds above the held Chieftains' prices is banked and covers part of it, so due = max(0, full - banked) for Renown and gold
   * separately. The due Renown is taken from the balance (renown_spent) and held in renown_reserved, the due gold moves from chest_gold into
   * chest_reserved. A short balance or chest refuses the whole order (409 not_enough_resources, plain message) before anything is paid.
   * Sending the Chieftain later costs nothing more.
   */
  train(player: PlayerRow, villageId: number, unit: string, count: number, t: number): OwnVillageDto {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const next = applyTrain(v.state, unit, count, t, this.settings); // validates first (Banner Hall, queue, batch size)
      let due: { renown: number; gold: number } | null = null;
      if (unit === 'chieftain') {
        this.sites.settleMember(player.id, t); // site Renown earned so far counts toward the price
        const owned = Math.max(1, this.store.villagesOfPlayer(player.id).length);
        const held = this.outstandingChieftains(player.id, t); // before this batch joins the queue
        const full = chieftainBatchPrice(owned, held, count, this.settings);
        const fresh = this.store.getPlayer(player.id) ?? player;
        const banked = this.bankedFor(fresh, owned, held);
        due = { renown: chieftainDue(full.renown, banked.renown), gold: chieftainDue(full.gold, banked.gold) };
        const what = count > 1 ? `${count} Chieftains cost` : 'A Chieftain costs';
        const nth = count > 1 ? '' : ` (your ${ordinal(owned + held + 1)} village)`;
        const bankedText = banked.renown >= 1 || banked.gold >= 1
          ? ` ${[
            banked.renown >= 1 ? `${Math.floor(banked.renown).toLocaleString('en-US')} Renown` : '',
            banked.gold >= 1 ? `${Math.floor(banked.gold).toLocaleString('en-US')} War Chest gold` : '',
          ].filter(Boolean).join(' and ')} is banked from earlier Chieftains.`
          : '';
        const head = `${what} ${Math.round(full.renown).toLocaleString('en-US')} Renown + ${Math.round(full.gold).toLocaleString('en-US')} War Chest gold${nth}.${bankedText}`;
        const shortRenown = Math.ceil(due.renown - (fresh.renownTotal - fresh.renownSpent) - 1e-9);
        if (shortRenown > 0) throw new GameError('not_enough_resources', `${head} You need ${shortRenown.toLocaleString('en-US')} more Renown.`);
        const shortGold = Math.ceil(due.gold - fresh.chestGold - 1e-9);
        if (shortGold > 0) throw new GameError('not_enough_resources', `${head} You need ${shortGold.toLocaleString('en-US')} more War Chest gold.`);
      }
      this.store.saveVillage(v.id, next, villagePoints(next)); // also pays Renown that finished building levels earned
      if (due) {
        this.store.reserveRenown(player.id, due.renown);
        this.store.reserveChest(player.id, due.gold);
      }
      this.store.addStats(player.id, { troopsTrained: count });
      this.store.onFtue?.(player.id, 'first_train');
      return this.ownDto(v, next, t);
    });
  }

  /**
   * Pay `gold` from this village into the player's War Chest (one way; docs/GAME_DESIGN.md 18.2). The village is settled first, the
   * gold leaves its stock and joins players.chest_gold in one transaction. A cold village (hearth out) cannot pay.
   */
  depositChest(player: PlayerRow, villageId: number, gold: number, t: number): ChestDepositResponse {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const state = settleVillage(v.state, t, this.settings);
      if (state.hearth) throw new GameError('requirements_not_met', 'The hearth is out: a cold village cannot pay into the War Chest.');
      if (state.resources.gold + 1e-9 < gold) {
        throw new GameError('not_enough_resources', `Not enough gold: ${gold} needed, ${Math.floor(state.resources.gold)} in the village.`);
      }
      const next: VillageState = { ...state, resources: { ...state.resources, gold: Math.max(0, state.resources.gold - gold) } };
      this.store.saveVillage(v.id, next, villagePoints(next));
      this.store.depositChest(player.id, gold);
      const fresh = this.store.getPlayer(player.id) ?? player;
      const villages = this.store.villagesOfPlayer(player.id);
      return { village: this.ownDto(v, next, t), chest: this.chestInfo(fresh, villages.length) };
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

  /**
   * Cancel one training batch; CANCEL_REFUND_PERCENT of the untrained rest comes back. A cancelled Chieftain batch keeps its Renown and
   * War Chest gold in the pool: it is banked for the next Chieftain (owner 2026-11-20), so nothing is refunded or lost.
   */
  cancelTrain(player: PlayerRow, villageId: number, building: string, index: number, t: number): CancelResponse {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const { state, refund } = applyCancelTrain(v.state, building, index, t, this.settings);
      this.store.saveVillage(v.id, state, villagePoints(state));
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
      const next = applyResearch(v.state, unit, t, this.settings, researchQueueLimit(worldRules(this.settings), this.premiumTools(this.store.getPlayer(player.id) ?? player)));
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
   * Hold `count` Feasts in the player's village (section 18.2): the engine checks Banner Hall and stock (no daily
   * limit), the cost leaves the village and the Renown is added to the player's total, all in one transaction.
   * A sandbox account may feast too (test mode has no other way to see the Feast work).
   */
  feast(player: PlayerRow, villageId: number, count: number, t: number): FeastResponse {
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      const { state, renown } = applyFeast(v.state, count, t, this.settings);
      this.store.saveVillage(v.id, state, villagePoints(state));
      const gained = this.store.addRenown(player.id, renown);
      const fresh = this.store.getPlayer(player.id) ?? player;
      const owned = this.store.villagesOfPlayer(player.id).length;
      return { village: this.ownDto(v, state, t), renown: makeRenownInfo(fresh.renownTotal, fresh.renownSpent, owned, this.settings), gained };
    });
  }

  /** Every owned village on the "Feast in all villages" list, settled to `t`, with Feast price and how many it can pay for. */
  private feastOverviewOf(player: PlayerRow, t: number): FeastOverviewResponse {
    const fresh = this.store.getPlayer(player.id) ?? player;
    const owned = this.store.villagesOfPlayer(player.id);
    const villages: FeastVillageDto[] = owned.map((v0) => {
      const v = this.withEntitlement(fresh, v0); // auto mode only settles for an entitled owner (same as GET /api/auto)
      const state = settleVillage(v.state, t, this.settings);
      return { id: v.id, name: v.name, x: v.x, y: v.y, bannerhall: state.buildings.bannerhall, price: feastPrice(state.buildings.bannerhall), resources: state.resources, max: feastMaxCount(state, t, this.settings) };
    });
    return {
      serverTime: t,
      feature: worldRules(this.settings).features.premium,
      entitled: this.premiumTools(fresh),
      renown: makeRenownInfo(fresh.renownTotal, fresh.renownSpent, owned.length, this.settings),
      villages,
    };
  }

  /** GET /api/feasts: the caller's villages with Feast price and maximum. Anyone may read it; without the tools it is shown greyed. */
  feastOverview(player: PlayerRow, t: number): FeastOverviewResponse {
    return this.feastOverviewOf(player, t);
  }

  /**
   * POST /api/feasts: hold Feasts in several villages at once (premium tools). All ids are checked as owned first (nothing held otherwise);
   * a village that cannot Feast now (no Banner Hall, stock too low) is skipped with its reason. One transaction, Renown added once.
   */
  feastAll(player: PlayerRow, body: FeastAllRequest, t: number): FeastAllResponse {
    return this.store.tx(() => {
      const fresh = this.store.getPlayer(player.id) ?? player;
      if (!this.premiumTools(fresh)) throw new GameError('forbidden', 'Feasting in all villages is part of the premium tools, and this account does not have them.');
      const wanted = body.villages;
      if (!Array.isArray(wanted) || wanted.length < 1 || wanted.length > FEAST_ALL_MAX_VILLAGES) throw new GameError('invalid_input', 'Pick between 1 and ' + FEAST_ALL_MAX_VILLAGES + ' villages.');
      if (new Set(wanted.map((w) => w.id)).size !== wanted.length) throw new GameError('invalid_input', 'Each village may be listed once.');
      const records = wanted.map((w) => this.ownedVillage(fresh, w.id));
      const results: FeastAllResult[] = [];
      let total = 0;
      wanted.forEach((w, i) => {
        const v = records[i]!;
        const check = checkFeast(v.state, w.count, t, this.settings);
        if (!check.ok) {
          results.push({ id: v.id, held: 0, gained: 0, skipped: { reason: check.reason, message: check.message } });
          return;
        }
        const { state, renown } = applyFeast(v.state, w.count, t, this.settings);
        this.store.saveVillage(v.id, state, villagePoints(state));
        total += renown;
        results.push({ id: v.id, held: w.count, gained: renown });
      });
      const gained = total > 0 ? this.store.addRenown(player.id, total) : 0;
      return { gained, results, overview: this.feastOverviewOf(player, t) };
    });
  }

  /**
   * Send troops on a mission (attack, support, ...). An attack with Pathfinders only is stored and resolved as a scouting march. Order of checks: the target exists and is not yours, the
   * relation and beginner protection allow the mission, the army suits the mission, the troops are at home.
   */
  send(player: PlayerRow, villageId: number, x: number, y: number, units: Partial<Units>, mission: Mission, t: number, timing: { travelSeconds?: number; returnSeconds?: number } = {}, targetBuilding?: unknown): SendResponse {
    try {
      return this.sendInner(player, villageId, x, y, units, mission, t, timing, targetBuilding);
    } catch (err) {
      // Staff tooling: a refused try between two accounts on one connection is worth knowing (written after the rollback).
      if (err instanceof HouseholdRefusal) this.store.multi.logEvent({ at: t, kind: mission === 'support' ? 'support_blocked' : 'attack_blocked', a: err.senderId, b: err.ownerId });
      throw err;
    }
  }

  private sendInner(player: PlayerRow, villageId: number, x: number, y: number, units: Partial<Units>, mission: Mission, t: number, timing: { travelSeconds?: number; returnSeconds?: number } = {}, targetBuilding?: unknown): SendResponse {
    const s = this.settings;
    // The Firecart pick (the Wall included) is checked for form only, NEVER against the target's buildings: any difference in the answer would
    // tell the sender what the village holds (docs/SECURITY_ROADMAP.md section 2).
    let siegeTarget: BuildingId | null = null;
    if (targetBuilding !== undefined && targetBuilding !== null) {
      if (!isBuildingId(targetBuilding)) throw new GameError('invalid_input', 'That is not a building.');
      if (mission !== 'attack' || !hasBuildingSiegeUnits(units)) throw new GameError('invalid_input', 'Only an attack with Firecarts can aim at a building.');
      siegeTarget = targetBuilding;
    }
    const custom = timing.travelSeconds !== undefined || timing.returnSeconds !== undefined;
    if (custom && !this.store.isSandboxUser(player.username)) throw new GameError('forbidden', 'Test mode is not available for this account.');
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      this.checkMarchRoom(player.id);
      const army = normalizeUnits(units);
      // A found mission walks to a free tile; every other mission needs a village on the target tile.
      let target: VillageRecord | null = null;
      let relief = false;
      if (mission === 'found') {
        const tile = checkFoundTarget({ x, y }, s, (px, py) => this.store.villageExistsAt(px, py));
        if (!tile.ok) throw new GameError(tile.reason, tile.message);
        // No village near a map site (docs/GAME_DESIGN.md 18.4b).
        if (isNearSite(x, y, sitesFor(s))) throw new GameError('invalid_target', 'That tile is too close to a Fire Shrine for a village.');
        if (!underVillageLimit(this.store.villagesOfPlayer(player.id).length)) {
          throw new GameError('invalid_target', 'You own as many villages as the world allows.');
        }
      } else if (!this.store.getVillageAt(x, y)) {
        // No village there: a map site (attack / support, like a found mission it walks to a tile), or nothing.
        const site = this.sites.at(x, y);
        if (!site) throw new GameError('invalid_target', 'There is no village at those coordinates.');
        if ((mission === 'attack' || mission === 'scout') && isScoutArmy(army)) throw new GameError('invalid_target', 'Pathfinders alone can only scout villages.');
        this.sites.checkSend(player, site, mission, army, t);
      } else {
        target = this.store.getVillageAt(x, y) as VillageRecord;
        // An attack of Pathfinders only is a scouting march (owner, 2026-11-06). An old client may still say 'scout'.
        if (mission === 'attack' && isScoutArmy(army)) mission = 'scout';
        const own = target.ownerId === player.id;
        // A cold village (hearth out) may be attacked by its owner, tribe-mates and allies: the attack fights the occupiers only.
        relief = mission === 'attack' && target.id !== v.id && this.isRelief(player.id, target, t);
        if (target.id === v.id || (own && mission !== 'support' && !relief)) {
          const what = mission === 'support' ? 'send support to' : mission === 'scout' ? 'scout' : mission === 'occupy' ? 'occupy' : 'attack';
          throw new GameError('invalid_target', `You cannot ${what} your own village.`);
        }
        if (target.ownerId !== null && !own) this.refuseHousehold(player.id, target.ownerId);
        if (mission === 'support') {
          if (!own) this.requireSupportable(player.id, target, t);
        } else if (mission === 'occupy') {
          // Occupiers only go to the cold village of your own claim.
          if (target.state.hearth?.claimBy !== player.id) throw new GameError('invalid_target', 'You hold no claim on that village.');
        } else if (relief) {
          if (army.chieftain > 0) throw new GameError('invalid_target', 'Chieftains cannot help win a village back: send fighters.');
          if (hasSiegeUnits(army)) throw new GameError('invalid_target', 'Siege units cannot be used to win a village back.');
        } else {
          if (target.ownerId !== null) this.refuseProtectedByTribe(player.id, target.ownerId, t, mission);
          if (target.ownerId !== null && target.ownerProtectedUntil > t) {
            throw new GameError('target_protected', `${target.ownerName ?? 'This player'} is under beginner protection.`);
          }
          if (isAttackBlocked(target.state, t)) throw new GameError('target_protected', 'That village is protected for a while.');
          if (mission === 'attack' && target.state.hearth?.claimBy === player.id) {
            throw new GameError('invalid_target', 'That is the village you are holding: send occupiers, not an attack.');
          }
          if (army.chieftain > 0 && target.ownerId !== null) {
            if (!this.playersConquerable()) throw new GameError('invalid_target', 'Chieftains can only strike abandoned villages for now.');
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
      let travel = timing.travelSeconds !== undefined ? timing.travelSeconds * 1000 : travelTimeMs({ x: v.x, y: v.y }, { x: dest.x, y: dest.y }, check.units, s, this.sites.waymarksForPlayer(player.id));
      // Roads: support between villages of members of one tribe is faster (never attacks, scouts or marches to sites).
      if (mission === 'support' && target && timing.travelSeconds === undefined) travel = this.projects.roadsMs(travel, player.id, target.ownerId, t);

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
      if (mission === 'attack') this.store.onFtue?.(player.id, 'first_raid');
      // Staff tooling: support from one player to another (the pair log, kept 30 days).
      if (mission === 'support' && target && target.ownerId !== null && target.ownerId !== player.id) {
        this.store.multi.logEvent({ at: t, kind: 'support', a: player.id, b: target.ownerId, amount: totalUnits(check.units) });
      }
      // Raiding abandoned villages keeps beginner protection; attacking or scouting a player ends it. Support, found and occupy never do.
      if ((mission === 'attack' || mission === 'scout') && target && target.ownerId !== null && !relief) this.store.setProtectedUntil(player.id, 0);

      const view = this.store.getMovementView(movementId);
      if (!view) throw new Error('movement vanished after insert');
      return { village: this.ownDto(v, next, t), movement: movementDto(view, player.id, t) };
    });
  }

  /** Refuse a NEW march when the player already has MAX_MARCHES_IN_FLIGHT on the road. Never used for recalls, cancels or returns. */
  private checkMarchRoom(playerId: number): void {
    if (this.store.marchesInFlight(playerId, MAX_MARCHES_IN_FLIGHT) >= MAX_MARCHES_IN_FLIGHT) {
      throw new GameError('march_limit', `You already have ${MAX_MARCHES_IN_FLIGHT} marches on the way. Wait for some to arrive.`);
    }
  }

  /**
   * Send resources to any player village (own, tribe-mate, ally, neutral or enemy). The cargo leaves the village at once
   * (after catch-up) and is credited on arrival. Section 13 of GAME_DESIGN.
   */
  sendShipment(player: PlayerRow, villageId: number, x: number, y: number, cargo: unknown, t: number, toTribeStore = false): SendShipmentResponse {
    try {
      return this.sendShipmentInner(player, villageId, x, y, cargo, t, toTribeStore);
    } catch (err) {
      if (err instanceof HouseholdRefusal) this.store.multi.logEvent({ at: t, kind: 'ship_blocked', a: err.senderId, b: err.ownerId });
      throw err;
    }
  }

  private sendShipmentInner(player: PlayerRow, villageId: number, x: number, y: number, cargo: unknown, t: number, toTribeStore = false): SendShipmentResponse {
    const s = this.settings;
    return this.store.tx(() => {
      const v = this.ownedVillage(player, villageId);
      this.checkMarchRoom(player.id);
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
      // To the Tribe Store: the member, daily-cap, account-age and store-cap checks run here, inside the send transaction.
      const storeTribe = toTribeStore ? this.projects.checkFunding(player, target, check.resources, check.total, t) : null;
      const next = applyShipmentSend(settled, check.resources, t, s);
      // Roads: shipments between villages of members of one tribe are faster (the Tribe Store funding included).
      const travel = this.projects.roadsMs(
        shipmentTravelMs({ x: v.x, y: v.y }, { x: target.x, y: target.y }, s, this.sites.waymarksForPlayer(player.id)),
        player.id,
        target.ownerId,
        t,
      );
      const movementId = this.store.insertMovement({
        kind: 'shipment',
        originVillageId: v.id,
        targetVillageId: target.id,
        units: emptyUnits(),
        loot: check.resources,
        departAt: t,
        arriveAt: t + travel,
        ...(toTribeStore ? { toTribeStore: true } : {}),
      });
      if (storeTribe !== null) this.projects.recordSend(movementId, storeTribe, player.id, check.total, t);
      // Staff tooling: resources from one player to another (not the Tribe Store, which is a tribe feature).
      if (!toTribeStore && target.ownerId !== null && target.ownerId !== player.id) {
        this.store.multi.logEvent({ at: t, kind: 'ship', a: player.id, b: target.ownerId, amount: check.total });
      }
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
    if (m.toTribeStore) return this.resolveStoreShipment(m, origin, target, cargo);
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
   * A shipment to the Tribe Store arrives (GAME_DESIGN 18.5): into the store when the target is still the store village of the
   * sender's tribe, else the whole cargo turns back. Any excess over the store cap (only possible after a project refund filled it)
   * turns back home with the carriers. The village stock of the store village is never touched.
   */
  private resolveStoreShipment(m: MovementRow, origin: VillageRecord, target: VillageRecord, cargo: Resources): number | null {
    const at = m.arriveAt;
    const sender = origin.ownerId === null ? null : this.store.getPlayer(origin.ownerId);
    const outcome = sender ? this.projects.arrive(sender.id, sender.username, target, cargo, at) : ({ kind: 'turned_back' } as const);
    this.projects.forgetSend(m.id);
    this.store.deleteMovement(m.id);
    if (outcome.kind === 'turned_back') return this.insertReturn(origin, target, emptyUnits(), at, cargo).arriveAt;
    const lost = emptyResources();
    let back: number | null = null;
    if (RESOURCE_IDS.some((r) => outcome.excess[r] > 0)) back = this.insertReturn(origin, target, emptyUnits(), at, outcome.excess).arriveAt;
    this.store.insertReport({
      playerId: origin.ownerId as number,
      side: 'shipment',
      won: true,
      title: `Shipment delivered into the Tribe Store at ${target.name} ${coords(target)}`,
      createdAt: at,
      type: 'shipment',
      shipment: { role: 'sent', from: refOf(origin), to: refOf(target), resources: cargo, stored: outcome.credited, lost },
    });
    return back;
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
        // A march to a tile (a map site) walks back from that tile, not from the placeholder village.
        ...(m.targetX != null && m.targetY != null ? { targetX: m.targetX, targetY: m.targetY } : {}),
      });
      this.store.deleteMovement(m.id);
      if (m.kind === 'shipment') this.projects.forgetSend(m.id); // a cancelled funding shipment no longer counts towards the daily cap
      this.store.cancelNotifications(m.id); // the target's "incoming" notification goes with the order
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

  /** The owner of troops standing at a map site brings all or some of one village's troops home (POST /api/sites/:id/recall). */
  recallSite(player: PlayerRow, siteId: number, villageId: number, units: Partial<Units> | undefined, t: number): MovementResponse {
    return this.store.tx(() => ({ movement: movementDto(this.sites.recall(player, siteId, villageId, units, t), player.id, t) }));
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
    return { id: p.id, username: p.username, protectedUntil: p.protectedUntil, tribe: this.store.tribes.playerTribe(p.id), chieftain: p.chieftain, householdShared: p.householdShared, abandonedNotice: abandonedNoticeOf(p, this.settings, this.store), sandbox: this.store.isSandboxUser(p.username), staffRole: p.staffRole, buildQueueLimit: buildQueueLimit(worldRules(this.settings), this.premiumTools(p)), researchQueueLimit: researchQueueLimit(worldRules(this.settings), this.premiumTools(p)), ...(this.premiumTools(p) ? { premiumTools: true as const } : {}), ...(hasWideOverviewExtra(this.premiumBits(p)) ? { wideOverview: true as const } : {}), ...(p.premiumUntil > 0 ? { premiumUntil: p.premiumUntil } : {}) };
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
        for (let i = 0; i < 3; i++) need += villageRenownCost(owned + i, this.settings);
        const p = this.store.getPlayer(player.id) ?? player;
        const short = need - (p.renownTotal - p.renownSpent);
        if (short > 0) this.store.addRenown(player.id, short); // a top-up
        // The same for War Chest gold (Chieftains reserve it): enough for the next 3 Chieftains, topped up only when short.
        let chestNeed = 0;
        for (let i = 0; i < 3; i++) chestNeed += chestVillageCost(owned + i, this.settings);
        if (chestNeed > p.chestGold) this.store.depositChest(player.id, chestNeed - p.chestGold);
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

  /**
   * Sandbox: finish everything queued in every village of mine right now (buildings, training incl. Chieftains, research).
   * Every queued item's time is pulled back so it ends at `t`; the engine's own settle then completes it.
   */
  sandboxFinish(player: PlayerRow, t: number): GameStateResponse {
    if (!this.store.isSandboxUser(player.username)) throw new GameError('forbidden', 'Test mode is not available for this account.');
    this.store.tx(() => {
      for (const v of this.store.villagesOfPlayer(player.id)) {
        const st = cloneVillage(v.state);
        st.lastUpdate = Math.min(st.lastUpdate, t - 1); // settle returns early when nothing has passed since the last update
        for (const j of st.buildQueue) {
          j.startAt = Math.min(j.startAt, t);
          j.finishAt = t;
        }
        for (const j of st.researchQueue ?? []) {
          j.startAt = Math.min(j.startAt, t);
          j.finishAt = t;
        }
        for (const b of TRAINING_BUILDING_IDS) {
          for (const j of st.trainQueues[b]) j.startAt = Math.min(j.startAt, t - j.count * j.perUnitMs);
        }
        const next = settleVillage(st, t, this.settings);
        this.store.saveVillage(v.id, next, villagePoints(next));
      }
    });
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
      throw new HouseholdRefusal(senderId, ownerId, `You share a connection with that player, so you cannot send ${what} to their villages.${tail}`);
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
    return this.withEntitlement(player, v);
  }

  // ---- premium tools: 5 build slots and auto mode (docs/GAME_DESIGN.md "Auto mode and 5 build slots") ---------------------

  /** The world has the premium tools switched on AND this account has them (EXTRA_PREMIUM_TOOLS). */
  private premiumTools(p: Pick<PlayerRow, 'premium' | 'premiumUntil'>): boolean {
    return worldRules(this.settings).features.premium && hasPremiumToolsExtra(this.premiumBits(p));
  }

  /** Paid-extra bits in force right now: operator bits plus Premium bought with Flames while it lasts (entitlement.ts). */
  premiumBits(p: Pick<PlayerRow, 'premium' | 'premiumUntil'>): number {
    return effectivePremium(p, this.clock());
  }

  /**
   * Auto mode only runs for an entitled owner: when the bit or the world switch is gone, auto mode is switched off (settings kept) in the
   * stored state before anything settles it. Called wherever the owner's villages are read.
   */
  private withEntitlement(player: Pick<PlayerRow, 'premium' | 'premiumUntil'>, v: VillageRecord): VillageRecord {
    const auto = v.state.auto;
    if (!auto?.on || this.premiumTools(player)) return v;
    this.store.switchAutoOffVillage(v.id, v.state);
    return { ...v, state: { ...v.state, auto: { ...auto, on: false } } };
  }

  private autoDto(v: VillageRecord, t: number): AutoVillageDto {
    const settled = settleVillage(v.state, t, this.settings);
    const a = settled.auto ?? defaultAutoMode();
    const summary = autoSummary(settled, this.settings);
    let queuedTroops = 0;
    for (const q of Object.values(settled.trainQueues)) for (const j of q) if (j.auto) queuedTroops++;
    return {
      id: v.id,
      name: v.name,
      x: v.x,
      y: v.y,
      on: a.on,
      troopGoals: { ...a.troopGoals },
      buildingGoals: { ...a.buildingGoals },
      ...autoProgress(settled),
      trainable: autoTrainableUnits(settled, this.settings),
      needsResearch: autoNeedsResearch(settled),
      status: summary.status,
      next: a.on ? summary.next : null,
      queuedBuilds: settled.buildQueue.filter((j) => j.auto).length,
      queuedTroops,
    };
  }

  /** GET /api/auto: every village's auto mode settings and what it does next. Anyone may read it; without the tools it shows everything off. */
  autoOverview(player: PlayerRow, t: number): AutoOverviewResponse {
    const fresh = this.store.getPlayer(player.id) ?? player;
    return {
      serverTime: t,
      feature: worldRules(this.settings).features.premium,
      entitled: this.premiumTools(fresh),
      villages: this.store.villagesOfPlayer(player.id).map((v) => this.autoDto(this.withEntitlement(fresh, v), t)),
    };
  }

  /** POST /api/villages/:id/auto: save the settings of one village (needs the premium tools). The village is settled first with the old settings. */
  setAutoMode(player: PlayerRow, villageId: number, body: AutoSettingsRequest, t: number): AutoVillageDto {
    return this.store.tx(() => {
      const fresh = this.store.getPlayer(player.id) ?? player;
      if (!this.premiumTools(fresh)) throw new GameError('forbidden', 'Auto mode is part of the premium tools, and this account does not have them.');
      const v = this.ownedVillage(fresh, villageId);
      const state = settleVillage(v.state, t, this.settings);
      const check = checkAutoSettings(body, state.auto ?? defaultAutoMode());
      if (!check.ok) throw new GameError(check.reason, check.message);
      const next = { ...state, auto: applyAutoSettings(state.auto, check) };
      this.store.saveVillage(v.id, next, villagePoints(next));
      return this.autoDto({ ...v, state: next }, t);
    });
  }
}
