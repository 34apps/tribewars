// Tribe projects (docs/GAME_DESIGN.md 18.5): the Tribe Store, the store village, projects and the funding ledger.
// Every mutation runs in one Store.tx and re-checks membership and rights inside it. Rule numbers are in the engine.

import {
  CANCEL_REFUND_PERCENT,
  GameError,
  PROJECT_DAILY_CAP_PER_MEMBER,
  PROJECT_MIN_ACCOUNT_DAYS,
  RESOURCE_IDS,
  STORE_VILLAGE_CHANGE_COOLDOWN_DAYS,
  TRIBE_EVENTS_KEEP,
  TRIBE_LEDGER_LIST_LIMIT,
  TRIBE_PROJECT_IDS,
  TRIBE_PROJECT_MAX_LEVEL,
  TRIBE_STORE_CAP,
  applyRoads,
  canTribe,
  emptyResources,
  projectBuildMs,
  projectCost,
  projectEffect,
  storeLootable,
  wardMultiplier,
  type Resources,
  type TribeProjectId,
  type TribeProjectOptionDto,
  type TribeProjectsResponse,
  type VillageRefDto,
  type WorldSettings,
} from '@clanfire/engine';
import type { PlayerRow, Store, VillageRecord } from './store.ts';
import type { ProjectRunRow, TribeStoreRow } from './tribe-projects-store.ts';
import type { MembershipRow } from './tribe-store.ts';

const MS_PER_DAY = 86_400_000;

const refOf = (v: VillageRecord): VillageRefDto => ({ villageId: v.id, name: v.name, x: v.x, y: v.y, ownerName: v.ownerName });

const projectName: Record<TribeProjectId, string> = { roads: 'Roads', watchtower: 'Watchtower', wards: 'Wards' };

const isProject = (p: unknown): p is TribeProjectId => typeof p === 'string' && (TRIBE_PROJECT_IDS as readonly string[]).includes(p);

export type ArrivalOutcome = { kind: 'credited'; credited: Resources; excess: Resources } | { kind: 'turned_back' };

export class TribeProjectService {
  constructor(
    private readonly store: Store,
    private readonly settings: WorldSettings,
  ) {}

  private get ps() {
    return this.store.projects;
  }

  // ---- lazy state -----------------------------------------------------------------------------------

  /** Finish the tribe's project when its time is up (every read of levels or the store goes through here). Returns the fresh row. */
  private settle(tribeId: number, t: number): TribeStoreRow {
    const row = this.ps.ensure(tribeId);
    const run = this.ps.getRun(tribeId);
    if (run && run.endsAt <= t) {
      this.ps.setLevel(tribeId, run.project, run.level);
      this.ps.deleteRun(tribeId);
      this.event(tribeId, run.endsAt, `${projectName[run.project]} level ${run.level} is finished.`);
      return this.ps.ensure(tribeId);
    }
    return row;
  }

  /** The store village if it is still a village of a current member, else null (and the stale pointer is cleared). */
  private home(row: TribeStoreRow): VillageRecord | null {
    if (row.villageId === null) return null;
    const v = this.store.getVillage(row.villageId);
    if (v !== null && v.ownerId !== null && this.store.tribes.membership(v.ownerId)?.tribeId === row.tribeId) return v;
    this.ps.clearVillage(row.tribeId);
    return null;
  }

  /** Finished level of one project for a tribe (0 when none; no row is made for a tribe that never used projects). */
  level(tribeId: number | null | undefined, project: TribeProjectId, t: number): number {
    if (!tribeId || !this.ps.peek(tribeId)) return 0;
    return this.store.tx(() => this.settle(tribeId, t).levels[project]);
  }

  levels(tribeId: number, t: number): Record<TribeProjectId, number> {
    if (!this.ps.peek(tribeId)) return { roads: 0, watchtower: 0, wards: 0 };
    return this.store.tx(() => ({ ...this.settle(tribeId, t).levels }));
  }

  /** Roads level between two villages: both owners must be members of the same tribe (the same player counts). 0 otherwise. */
  roadsLevelBetween(ownerA: number | null, ownerB: number | null, t: number): number {
    if (ownerA === null || ownerB === null) return 0;
    const a = this.store.tribes.membership(ownerA);
    if (!a) return 0;
    if (ownerA !== ownerB && this.store.tribes.membership(ownerB)?.tribeId !== a.tribeId) return 0;
    return this.level(a.tribeId, 'roads', t);
  }

  /** Travel time (ms) after Roads, for support, shipments and their returns between two members of one tribe. */
  roadsMs(ms: number, ownerA: number | null, ownerB: number | null, t: number): number {
    return applyRoads(ms, this.roadsLevelBetween(ownerA, ownerB, t));
  }

  /** Defence factor of the defending side at a site held by `tribeId` (1 when none). */
  wardFactor(tribeId: number | null, t: number): number {
    return tribeId === null ? 1 : wardMultiplier(this.level(tribeId, 'wards', t));
  }

  /** Map marker: which of these village rows hold their owner tribe's store (a valid home only). */
  storeMarkers(rows: ReadonlyArray<{ id: number; ownerId: number | null; ownerTribeId: number | null }>): Set<number> {
    const stores = this.ps.storeVillageTribes();
    const out = new Set<number>();
    if (stores.size === 0) return out;
    for (const r of rows) if (r.ownerId !== null && r.ownerTribeId !== null && stores.get(r.id) === r.ownerTribeId) out.add(r.id);
    return out;
  }

  // ---- reads -------------------------------------------------------------------------------------------

  view(player: PlayerRow, t: number): TribeProjectsResponse {
    return this.store.tx(() => this.viewOf(this.requireMember(player), player, t));
  }

  /** The caller's own tribe: finished levels and the store village, for TribeDto (own view only). */
  ownTribeInfo(tribeId: number, t: number): { levels: Record<TribeProjectId, number>; storeVillage: VillageRefDto | null } {
    return this.store.tx(() => {
      const row = this.settle(tribeId, t);
      const home = this.home(row);
      return { levels: { ...row.levels }, storeVillage: home ? refOf(home) : null };
    });
  }

  private viewOf(m: MembershipRow, player: PlayerRow, t: number): TribeProjectsResponse {
    const row = this.settle(m.tribeId, t);
    const home = this.home(row);
    const run = this.ps.getRun(m.tribeId);
    const canManage = canTribe(m.role, 'projects', m.grants);
    const projects: TribeProjectOptionDto[] = TRIBE_PROJECT_IDS.map((project) => {
      const level = row.levels[project];
      const more = level < TRIBE_PROJECT_MAX_LEVEL;
      return {
        project,
        level,
        maxLevel: TRIBE_PROJECT_MAX_LEVEL,
        nextCost: more ? projectCost(level + 1) : null,
        nextBuildMs: more ? projectBuildMs(level + 1, this.settings) : null,
        effectNow: projectEffect(project, level),
        effectNext: more ? projectEffect(project, level + 1) : null,
      };
    });
    const cooldownEnd = home && row.villageSetAt > 0 ? row.villageSetAt + STORE_VILLAGE_CHANGE_COOLDOWN_DAYS * MS_PER_DAY : null;
    const ageEnd = player.createdAt + PROJECT_MIN_ACCOUNT_DAYS * MS_PER_DAY;
    let memberVillages: VillageRefDto[] = [];
    if (canManage) {
      memberVillages = this.store.tribes
        .members(m.tribeId)
        .flatMap((x) => this.store.villagesOfPlayer(x.playerId).map((v) => ({ owner: x.username, ref: refOf(v) })))
        .sort((a, b) => a.owner.localeCompare(b.owner) || a.ref.name.localeCompare(b.ref.name) || a.ref.villageId - b.ref.villageId)
        .map((x) => x.ref);
    }
    return {
      store: row.resources,
      storeCap: TRIBE_STORE_CAP,
      storeVillage: home ? refOf(home) : null,
      storeVillageChangeableAt: cooldownEnd !== null && cooldownEnd > t ? cooldownEnd : null,
      running: run ? { project: run.project, level: run.level, startedAt: run.startedAt, endsAt: run.endsAt, cost: run.cost } : null,
      projects,
      ledger: this.ps.ledger(m.tribeId, TRIBE_LEDGER_LIST_LIMIT).map((l) => ({ player: { id: l.playerId, name: l.name }, resources: l.resources, at: l.at })),
      totals: this.ps.totals(m.tribeId, t).map((x) => ({ player: { id: x.playerId, name: x.name }, total: x.total, last24h: x.last24h })),
      canManage,
      myDailyLeft: Math.max(0, PROJECT_DAILY_CAP_PER_MEMBER - this.ps.sentSince(player.id, t)),
      myGiveFrom: ageEnd > t ? ageEnd : null,
      memberVillages,
    };
  }

  // ---- writes ------------------------------------------------------------------------------------------

  setStoreVillage(player: PlayerRow, villageId: number, t: number): TribeProjectsResponse {
    return this.store.tx(() => {
      const m = this.requireMember(player, 'projects');
      const row = this.settle(m.tribeId, t);
      const village = this.store.getVillage(villageId);
      if (!village || village.ownerId === null || this.store.tribes.membership(village.ownerId)?.tribeId !== m.tribeId) {
        throw new GameError('invalid_target', 'The store village must be a village of a member of your tribe.');
      }
      const home = this.home(row);
      if (home && home.id === village.id) throw new GameError('invalid_target', 'That village already holds the Tribe Store.');
      if (home && row.villageSetAt > 0) {
        const ready = row.villageSetAt + STORE_VILLAGE_CHANGE_COOLDOWN_DAYS * MS_PER_DAY;
        if (ready > t) throw new GameError('requirements_not_met', `The store village can only be changed once every ${STORE_VILLAGE_CHANGE_COOLDOWN_DAYS} days.`);
      }
      this.ps.setVillage(m.tribeId, village.id, t);
      this.event(m.tribeId, t, `${player.username} made ${village.name} (${village.x}|${village.y}) the store village.`);
      return this.viewOf(m, player, t);
    });
  }

  start(player: PlayerRow, project: unknown, t: number): TribeProjectsResponse {
    return this.store.tx(() => {
      const m = this.requireMember(player, 'projects');
      if (!isProject(project)) throw new GameError('invalid_input', 'Unknown project.');
      const row = this.settle(m.tribeId, t);
      if (this.ps.getRun(m.tribeId)) throw new GameError('queue_full', 'Your tribe is already building a project. Wait for it to finish or cancel it.');
      const level = row.levels[project] + 1;
      if (level > TRIBE_PROJECT_MAX_LEVEL) throw new GameError('max_level', `${projectName[project]} is at its highest level.`);
      const cost = projectCost(level);
      const next = emptyResources();
      for (const r of RESOURCE_IDS) {
        if (row.resources[r] < cost[r]) throw new GameError('not_enough_resources', 'The Tribe Store does not hold enough.');
        next[r] = row.resources[r] - cost[r];
      }
      this.ps.setResources(m.tribeId, next);
      const run: ProjectRunRow = { tribeId: m.tribeId, project, level, startedAt: t, endsAt: t + projectBuildMs(level, this.settings), cost };
      this.ps.insertRun(run);
      this.event(m.tribeId, t, `${player.username} started ${projectName[project]} level ${level}.`);
      return this.viewOf(m, player, t);
    });
  }

  cancel(player: PlayerRow, t: number): TribeProjectsResponse {
    return this.store.tx(() => {
      const m = this.requireMember(player, 'projects');
      const row = this.settle(m.tribeId, t);
      const run = this.ps.getRun(m.tribeId);
      if (!run) throw new GameError('not_found', 'No project is being built.');
      const back = emptyResources();
      for (const r of RESOURCE_IDS) back[r] = Math.min(TRIBE_STORE_CAP, row.resources[r] + Math.floor((run.cost[r] * CANCEL_REFUND_PERCENT) / 100));
      this.ps.setResources(m.tribeId, back);
      this.ps.deleteRun(m.tribeId);
      this.event(m.tribeId, t, `${player.username} cancelled ${projectName[run.project]} level ${run.level}.`);
      return this.viewOf(m, player, t);
    });
  }

  // ---- funding shipments ---------------------------------------------------------------------------

  /**
   * Checks for a shipment to the Tribe Store, run inside the send transaction after the normal shipment rules. `target` must be the
   * current store village. Returns the tribe id.
   */
  checkFunding(player: PlayerRow, target: VillageRecord, cargo: Resources, total: number, t: number): number {
    const m = this.requireMember(player);
    const row = this.settle(m.tribeId, t);
    const home = this.home(row);
    if (!home || home.id !== target.id) throw new GameError('invalid_target', "That village does not hold your tribe's store.");
    if (t - player.createdAt < PROJECT_MIN_ACCOUNT_DAYS * MS_PER_DAY) {
      throw new GameError('forbidden', `Your account must be ${PROJECT_MIN_ACCOUNT_DAYS} days old before you can give to the Tribe Store.`);
    }
    const left = PROJECT_DAILY_CAP_PER_MEMBER - this.ps.sentSince(player.id, t);
    if (total > left) {
      throw new GameError('requirements_not_met', `You can give at most ${PROJECT_DAILY_CAP_PER_MEMBER} a day to the Tribe Store (${Math.max(0, left)} left in the last 24 hours).`);
    }
    const onRoad = this.ps.onTheRoad(m.tribeId);
    for (const r of RESOURCE_IDS) {
      if (row.resources[r] + onRoad[r] + cargo[r] > TRIBE_STORE_CAP) {
        throw new GameError('exceeds_storage', 'The Tribe Store cannot hold that much of one resource.');
      }
    }
    return m.tribeId;
  }

  /** Remember a funding shipment for the daily cap. */
  recordSend(movementId: number, tribeId: number, playerId: number, total: number, t: number): void {
    this.ps.insertSend(movementId, tribeId, playerId, t, total);
  }

  /** The funding shipment is gone (cancelled or turned back): it no longer counts towards the cap. */
  forgetSend(movementId: number): void {
    this.ps.deleteSend(movementId);
  }

  /**
   * A funding shipment arrives. If the target is still the store village of the sender's (current) tribe, the cargo goes into
   * the store (clamped to the cap; any excess is handed back for the caller to turn home) and the ledger gets a row.
   * Otherwise everything turns back.
   */
  arrive(senderId: number, senderName: string, target: VillageRecord, cargo: Resources, at: number): ArrivalOutcome {
    const m = this.store.tribes.membership(senderId);
    if (!m) return { kind: 'turned_back' };
    const row = this.settle(m.tribeId, at);
    const home = this.home(row);
    if (!home || home.id !== target.id) return { kind: 'turned_back' };
    const credited = emptyResources();
    const excess = emptyResources();
    const next = emptyResources();
    for (const r of RESOURCE_IDS) {
      const c = Math.floor(cargo[r]);
      credited[r] = Math.max(0, Math.min(c, TRIBE_STORE_CAP - row.resources[r]));
      excess[r] = c - credited[r];
      next[r] = row.resources[r] + credited[r];
    }
    this.ps.setResources(m.tribeId, next);
    if (RESOURCE_IDS.some((r) => credited[r] > 0)) this.ps.insertLedger(m.tribeId, senderId, senderName, credited, at);
    return { kind: 'credited', credited, excess };
  }

  // ---- raids ---------------------------------------------------------------------------------------------

  /** If `target` holds its owner tribe's store: the tribe id and what a won attack may take (a fifth of each resource). Else null. */
  raidPool(target: VillageRecord, at: number): { tribeId: number; pool: Resources } | null {
    if (target.ownerId === null) return null;
    const row = this.ps.storeAtVillage(target.id);
    if (!row) return null;
    const m = this.store.tribes.membership(target.ownerId);
    if (!m || m.tribeId !== row.tribeId) return null;
    return { tribeId: row.tribeId, pool: storeLootable(this.settle(row.tribeId, at).resources) };
  }

  /** Take `loot` out of the store (never below zero) and log it. */
  applyRaid(tribeId: number, loot: Resources, raiderName: string, at: number): void {
    const row = this.ps.ensure(tribeId);
    const next = emptyResources();
    for (const r of RESOURCE_IDS) next[r] = Math.max(0, row.resources[r] - Math.max(0, Math.floor(loot[r])));
    this.ps.setResources(tribeId, next);
    this.event(tribeId, at, `The Tribe Store was raided by ${raiderName}.`);
  }

  // ---- helpers ---------------------------------------------------------------------------------------------

  private requireMember(player: PlayerRow, action?: 'projects'): MembershipRow {
    const m = this.store.tribes.membership(player.id);
    if (!m) throw new GameError('not_in_tribe', 'You are not in a tribe.');
    if (action && !canTribe(m.role, action, m.grants)) throw new GameError('forbidden', "You don't have the right to manage the tribe projects.");
    return m;
  }

  private event(tribeId: number, t: number, text: string): void {
    this.store.tribes.insertEvent(tribeId, t, text, TRIBE_EVENTS_KEEP);
  }
}
