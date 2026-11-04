// All SQL lives here: prepared statements with bound parameters only.

import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_CHIEFTAIN,
  STAT_KEYS,
  emptyStats,
  normalizeUnits,
  normalizeVillage,
  isStaffRole,
  type BattleReportData,
  type Mission,
  type PlayerStatsDto,
  type Resources,
  type ScoutReportData,
  type ShipmentReportData,
  type StaffRole,
  type SupportReportData,
  type Units,
  type VillageRanks,
  type VillageState,
  type WorldSettings,
} from '@clanfire/engine';
import { statColumn } from './db.ts';
import { SqlBase, type Raw } from './sql.ts';
import { ForumStore } from './forum-store.ts';
import type { LiveEvent } from './live-events.ts';
import { MailStore } from './mail-store.ts';
import { ReportStore } from './report-store.ts';
import { StaffStore, type NewAudit } from './staff-store.ts';
import { SupportStore } from './support-store.ts';
import { TribeStore } from './tribe-store.ts';
import { addUnits } from './units.ts';

/** Newest reports kept per player; older ones are deleted when a new one arrives. */
export const REPORTS_KEEP = 200;

export interface PlayerRow {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: number;
  protectedUntil: number;
  /** Chieftain portrait id (CHIEFTAINS in the engine). */
  chieftain: string;
  /** Premium subscription active (longer build queue). Set by billing, never by the client. */
  premium: boolean;
  /** The player reported that others play from the same household (self-declared, shown in the admin report). */
  householdShared: boolean;
  /** When the account was banned (ms), or null. Banned accounts cannot sign in; their sessions are dead. */
  bannedAt: number | null;
  banReason: string | null;
  /** Last authenticated request (ms); written at most every ACTIVITY_WRITE_INTERVAL_MS. Drives the caretaker bot. */
  lastActive: number;
  /** Villages abandoned for idleness that the player has not been told about yet (0 = none). */
  abandonedNotice: number;
  /** Staff role, set only through the server CLI. */
  staffRole: StaffRole | null;
  /** Muted (no mail, chat or forum writing) until this time (ms), or null. Check with `isMuted`. */
  mutedUntil: number | null;
  muteReason: string | null;
  /** Lobby account this player belongs to, or null (worlds without a lobby, or not yet linked). */
  accountId: number | null;
}

export interface SharedIpGroup {
  ip: string;
  players: Array<{ id: number; username: string; bannedAt: number | null; householdShared: boolean }>;
}

export interface VillageRecord {
  id: number;
  ownerId: number | null;
  ownerName: string | null;
  /** The owner's beginner protection end (0 for abandoned villages). */
  ownerProtectedUntil: number;
  name: string;
  x: number;
  y: number;
  points: number;
  state: VillageState;
}

export type MovementKind = Mission | 'return' | 'shipment';

/** A movement row as stored. For both kinds `originVillageId` is the army's home village. */
export interface MovementRow {
  id: number;
  kind: MovementKind;
  originVillageId: number;
  targetVillageId: number;
  units: Units;
  loot: Resources | null;
  departAt: number;
  arriveAt: number;
  /** The home village's unit ranks when the army left (attack, scout, support). Null = none, e.g. returns and old rows. */
  ranks?: VillageRanks | null;
  /** Test mode: fixed seconds for the return trip, set when sending. Null = normal travel time. */
  returnSecs?: number | null;
}

export interface VillageStub {
  villageId: number;
  name: string;
  x: number;
  y: number;
  ownerId: number | null;
  ownerName: string | null;
}

export interface MovementView extends MovementRow {
  origin: VillageStub;
  target: VillageStub;
}

/** Support troops standing in a host village. `units` also stay in the owner's home village `away` count. */
export interface StationedRow {
  id: number;
  ownerPlayerId: number;
  homeVillageId: number;
  hostVillageId: number;
  units: Units;
  arrivedAt: number;
  /** Home-village ranks stamped on the latest arrival; the contingent defends with them. */
  ranks?: VillageRanks | null;
}

export interface StationedView extends StationedRow {
  home: VillageStub;
  host: VillageStub;
}

/** An incoming attack on a member's village, with what the tribe alert list shows. */
export interface AlertRow {
  movementId: number;
  departAt: number;
  arriveAt: number;
  attacker: VillageStub;
  attackerTribeTag: string | null;
  target: VillageStub;
}

export interface MapRow {
  id: number;
  ownerId: number | null;
  ownerName: string | null;
  ownerProtectedUntil: number;
  name: string;
  x: number;
  y: number;
  points: number;
  /** The owner's tribe, if any (joined in the same query so the map needs no per-village lookups). */
  ownerTribeId: number | null;
  ownerTribeTag: string | null;
  ownerChieftain: string | null;
  /** The stored village state, only for abandoned villages (they grow lazily; the map settles them to now). */
  npcState: VillageState | null;
}

export type ReportSide = 'attack' | 'defense' | 'support' | 'shipment';
export type ReportType = 'battle' | 'scout' | 'support' | 'shipment';

export interface ReportRow {
  id: number;
  playerId: number;
  side: ReportSide;
  type: ReportType;
  won: boolean;
  title: string;
  createdAt: number;
  read: boolean;
  /** Battles: the battle's own outcome. A support turned back counts as called off; scouting reports as 'battle'. */
  outcome: 'battle' | 'called_off';
}

/** The body of a report: exactly one of the three, matching `type`. */
export type ReportBody =
  | { type: 'battle'; battle: BattleReportData }
  | { type: 'scout'; scout: ScoutReportData }
  | { type: 'support'; support: SupportReportData }
  | { type: 'shipment'; shipment: ShipmentReportData };

export type NewReport = ReportBody & {
  playerId: number;
  side: ReportSide;
  won: boolean;
  title: string;
  createdAt: number;
};

/** A report as read back, shaped like ReportDto's body fields. */
export type FullReport = ReportRow & {
  battle: BattleReportData | null;
  scout: ScoutReportData | null;
  support: SupportReportData | null;
  shipment: ShipmentReportData | null;
};

const MOVEMENT_VIEW_SQL = `
SELECT m.id, m.kind, m.origin_village_id, m.target_village_id, m.units_json, m.loot_json, m.depart_at, m.arrive_at, m.ranks_json, m.return_secs,
       o.name AS o_name, o.x AS o_x, o.y AS o_y, o.owner_id AS o_owner_id, op.username AS o_owner_name,
       t.name AS t_name, t.x AS t_x, t.y AS t_y, t.owner_id AS t_owner_id, tp.username AS t_owner_name
FROM movements m
JOIN villages o ON o.id = m.origin_village_id
JOIN villages t ON t.id = m.target_village_id
LEFT JOIN players op ON op.id = o.owner_id
LEFT JOIN players tp ON tp.id = t.owner_id`;

const STATIONED_VIEW_SQL = `
SELECT s.id, s.owner_player_id, s.home_village_id, s.host_village_id, s.units_json, s.arrived_at, s.ranks_json,
       h.name AS h_name, h.x AS h_x, h.y AS h_y, h.owner_id AS h_owner_id, hp.username AS h_owner_name,
       t.name AS t_name, t.x AS t_x, t.y AS t_y, t.owner_id AS t_owner_id, tp.username AS t_owner_name
FROM stationed s
JOIN villages h ON h.id = s.home_village_id
JOIN villages t ON t.id = s.host_village_id
LEFT JOIN players hp ON hp.id = h.owner_id
LEFT JOIN players tp ON tp.id = t.owner_id`;

/** Attacks (not scouts, not support) heading for a village owned by a member of tribe ?. Index-friendly: target village ids come from a subquery. */
const TRIBE_ATTACKS_WHERE = `
m.kind = 'attack'
AND m.target_village_id IN (
  SELECT v.id FROM villages v JOIN tribe_members tm ON tm.player_id = v.owner_id WHERE tm.tribe_id = ?
)`;

const VILLAGE_SQL = `
SELECT v.id, v.owner_id, v.name, v.x, v.y, v.points, v.state_json,
       p.username AS owner_name, COALESCE(p.protected_until, 0) AS owner_protected_until
FROM villages v LEFT JOIN players p ON p.id = v.owner_id`;

function toVillage(r: Raw): VillageRecord {
  return {
    id: r.id as number,
    ownerId: (r.owner_id as number | null) ?? null,
    ownerName: (r.owner_name as string | null) ?? null,
    ownerProtectedUntil: r.owner_protected_until as number,
    name: r.name as string,
    x: r.x as number,
    y: r.y as number,
    points: r.points as number,
    // Villages saved before a unit existed lack its key: normalise on every load.
    state: normalizeVillage(JSON.parse(r.state_json as string) as VillageState),
  };
}

/** Stamped ranks as saved; bad or missing JSON means no ranks (the engine ignores malformed entries). */
function parseRanks(raw: unknown): VillageRanks | null {
  if (typeof raw !== 'string') return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as VillageRanks) : null;
  } catch {
    return null;
  }
}

const stampRanks = (ranks: VillageRanks | null | undefined): string | null => (ranks ? JSON.stringify(ranks) : null);

function toMovement(r: Raw): MovementRow {
  return {
    id: r.id as number,
    kind: r.kind as MovementKind,
    originVillageId: r.origin_village_id as number,
    targetVillageId: r.target_village_id as number,
    units: normalizeUnits(JSON.parse(r.units_json as string) as Partial<Units>),
    loot: r.loot_json ? (JSON.parse(r.loot_json as string) as Resources) : null,
    departAt: r.depart_at as number,
    arriveAt: r.arrive_at as number,
    ranks: parseRanks(r.ranks_json),
    returnSecs: (r.return_secs as number | null) ?? null,
  };
}

function toMovementView(r: Raw): MovementView {
  return {
    ...toMovement(r),
    origin: {
      villageId: r.origin_village_id as number,
      name: r.o_name as string,
      x: r.o_x as number,
      y: r.o_y as number,
      ownerId: (r.o_owner_id as number | null) ?? null,
      ownerName: (r.o_owner_name as string | null) ?? null,
    },
    target: {
      villageId: r.target_village_id as number,
      name: r.t_name as string,
      x: r.t_x as number,
      y: r.t_y as number,
      ownerId: (r.t_owner_id as number | null) ?? null,
      ownerName: (r.t_owner_name as string | null) ?? null,
    },
  };
}

function toPlayer(r: Raw): PlayerRow {
  return {
    id: r.id as number,
    username: r.username as string,
    passwordHash: r.password_hash as string,
    createdAt: r.created_at as number,
    protectedUntil: r.protected_until as number,
    chieftain: r.chieftain as string,
    premium: (r.premium as number) === 1,
    householdShared: (r.household_shared as number) === 1,
    bannedAt: (r.banned_at as number | null) ?? null,
    banReason: (r.ban_reason as string | null) ?? null,
    lastActive: (r.last_active as number | null) ?? (r.created_at as number),
    abandonedNotice: (r.abandoned_notice as number | null) ?? 0,
    staffRole: isStaffRole(r.staff_role) ? r.staff_role : null,
    mutedUntil: (r.muted_until as number | null) ?? null,
    muteReason: (r.mute_reason as string | null) ?? null,
    accountId: (r.account_id as number | null) ?? null,
  };
}

function reportTypeOf(raw: unknown): ReportType {
  return raw === 'scout' || raw === 'support' || raw === 'shipment' ? raw : 'battle'; // reports saved before scouting have no type
}

function toReport(r: Raw): ReportRow {
  const type = reportTypeOf(r.type);
  return {
    id: r.id as number,
    playerId: r.player_id as number,
    side: r.side as ReportSide,
    type,
    won: r.won === 1,
    title: r.title as string,
    createdAt: r.created_at as number,
    read: r.read === 1,
    outcome: type === 'support' || (type === 'battle' && r.outcome === 'called_off') ? 'called_off' : 'battle',
  };
}

const optionalUnits = (u: Partial<Units> | null | undefined): Units | null => (u ? normalizeUnits(u) : null);

/** Parse stored report JSON; every unit map goes through normalizeUnits so reports saved before a unit existed still read. */
function parseReportBody(json: string): ReportBody {
  const { type: rawType, ...data } = JSON.parse(json) as Record<string, unknown>;
  const type = reportTypeOf(rawType);
  if (type === 'scout') {
    const d = data as unknown as ScoutReportData;
    return { type, scout: { ...d, intel: d.intel ? { ...d.intel, troops: d.intel.troops ? normalizeUnits(d.intel.troops) : null } : null } };
  }
  if (type === 'shipment') return { type, shipment: data as unknown as ShipmentReportData };
  if (type === 'support') {
    const d = data as unknown as SupportReportData;
    return { type, support: { ...d, units: normalizeUnits(d.units) } };
  }
  const d = data as unknown as Partial<BattleReportData> & BattleReportData;
  return {
    type,
    battle: {
      ...d,
      outcome: d.outcome ?? 'battle', // reports saved before tribes existed were all battles
      attackerUnits: normalizeUnits(d.attackerUnits),
      attackerLosses: normalizeUnits(d.attackerLosses),
      defenderUnits: optionalUnits(d.defenderUnits),
      defenderLosses: optionalUnits(d.defenderLosses),
      supportUnits: optionalUnits(d.supportUnits), // absent before support existed
      supportLosses: optionalUnits(d.supportLosses),
    },
  };
}

function reportJson(r: ReportBody): string {
  if (r.type === 'scout') return JSON.stringify({ type: 'scout', ...r.scout });
  if (r.type === 'shipment') return JSON.stringify({ type: 'shipment', ...r.shipment });
  if (r.type === 'support') return JSON.stringify({ type: 'support', ...r.support });
  return JSON.stringify({ type: 'battle', ...r.battle });
}

function stubFrom(r: Raw, prefix: string, id: number): VillageStub {
  return {
    villageId: id,
    name: r[`${prefix}_name`] as string,
    x: r[`${prefix}_x`] as number,
    y: r[`${prefix}_y`] as number,
    ownerId: (r[`${prefix}_owner_id`] as number | null) ?? null,
    ownerName: (r[`${prefix}_owner_name`] as string | null) ?? null,
  };
}

function toStationed(r: Raw): StationedRow {
  return {
    id: r.id as number,
    ownerPlayerId: r.owner_player_id as number,
    homeVillageId: r.home_village_id as number,
    hostVillageId: r.host_village_id as number,
    units: normalizeUnits(JSON.parse(r.units_json as string) as Partial<Units>),
    arrivedAt: r.arrived_at as number,
    ranks: parseRanks(r.ranks_json),
  };
}

export class Store extends SqlBase {
  private depth = 0;
  /** Tribe tables. Shares this connection, so it takes part in `tx`. */
  readonly tribes: TribeStore;
  /** Mail table. Shares this connection, so it takes part in `tx`. */
  readonly mail: MailStore;
  readonly forum: ForumStore;
  /** Staff tooling tables (audit log, roles, mutes), tickets with templates, and player reports. Share this connection. */
  readonly staff: StaffStore;
  readonly support: SupportStore;
  readonly msgReports: ReportStore;

  /** Lowercase usernames allowed to use sandbox (test) mode: SANDBOX_USERS. Set once at start-up. */
  sandboxUsers: ReadonlySet<string> = new Set();

  constructor(db: DatabaseSync) {
    super(db);
    this.tribes = new TribeStore(db);
    this.mail = new MailStore(db);
    this.forum = new ForumStore(db);
    this.staff = new StaffStore(db);
    this.support = new SupportStore(db);
    this.msgReports = new ReportStore(db);
    this.emit = (event) => this.queueLive(event);
    for (const s of [this.tribes, this.mail, this.forum, this.staff, this.support, this.msgReports]) s.emit = this.emit;
  }

  /** Append a row to the audit log (never put secrets in `detail`). */
  audit(entry: NewAudit): void {
    this.staff.audit(entry);
  }

  isSandboxUser(username: string): boolean {
    return this.sandboxUsers.has(username.toLowerCase());
  }

  /** Sandbox reset: drop every movement sent from this village and the support it has standing elsewhere. */
  clearVillageActivity(villageId: number): void {
    this.run('DELETE FROM movements WHERE origin_village_id = ?', villageId);
    this.run('DELETE FROM stationed WHERE home_village_id = ?', villageId);
  }

  /**
   * Sandbox time warp: every movement sent from, returning to or heading for this player's villages that is due later
   * than `arriveAt` is pulled forward to arrive then (departure moved back if needed so the span stays positive).
   */
  warpMovementsOfPlayer(playerId: number, arriveAt: number): void {
    this.run(
      `UPDATE movements SET depart_at = MIN(depart_at, ? - 1000), arrive_at = MIN(arrive_at, ?)
       WHERE arrive_at > ? AND (origin_village_id IN (SELECT id FROM villages WHERE owner_id = ?)
          OR target_village_id IN (SELECT id FROM villages WHERE owner_id = ?))`,
      arriveAt,
      arriveAt,
      arriveAt,
      playerId,
      playerId,
    );
  }

  /** Run `fn` inside BEGIN IMMEDIATE ... COMMIT; roll back and rethrow on error. Re-entrant. */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    let result: T;
    try {
      result = fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.pendingLive = []; // rolled back: nothing happened, so nothing is announced
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // The transaction may already be gone; the original error matters more.
      }
      throw err;
    } finally {
      this.depth = 0;
    }
    this.flushLive(); // only after COMMIT, never inside the transaction
    return result;
  }

  /** Receives live-update events after the commit that caused them (set by the live hub). Must not throw. */
  onLive: ((events: readonly LiveEvent[]) => void) | null = null;
  private pendingLive: LiveEvent[] = [];

  /** Inside a transaction: hold the event until COMMIT. Outside one the write is already committed: deliver now. */
  private queueLive(event: LiveEvent): void {
    this.pendingLive.push(event);
    if (this.depth === 0) this.flushLive();
  }

  private flushLive(): void {
    if (this.pendingLive.length === 0) return;
    const events = this.pendingLive;
    this.pendingLive = [];
    try {
      this.onLive?.(events);
    } catch {
      // A broken listener must never break a game action that already committed.
    }
  }

  /** Owner ids of two villages (null = abandoned/unknown), for movement hints. */
  private ownersOf(a: number, b: number): [number | null, number | null] {
    const owner = (id: number): number | null => {
      const r = this.get('SELECT owner_id FROM villages WHERE id = ?', id);
      return r ? ((r.owner_id as number | null) ?? null) : null;
    };
    return [owner(a), owner(b)];
  }

  /**
   * Hints for a movement that was created or has finished: both sides' game state changes. An incoming attack or
   * support also tells the target; an attack also changes the target tribe's alert list. Scouts stay silent for the
   * target (they must not learn that one is coming).
   */
  private emitMovement(kind: MovementRow['kind'], originVillageId: number, targetVillageId: number, created: boolean): void {
    const [from, to] = this.ownersOf(originVillageId, targetVillageId);
    if (from !== null) this.emit({ kind: 'player', playerId: from, topics: ['game'] });
    // Scouts and returning troops stay silent for the village they came from / went to; a shipment shows up on arrival.
    const visibleToTarget = kind === 'attack' || kind === 'support' || (kind === 'shipment' && !created);
    if (to !== null && to !== from && visibleToTarget) this.emit({ kind: 'player', playerId: to, topics: ['game'] });
    if (kind === 'attack' && to !== null) {
      const t = this.tribes.membership(to);
      if (t) this.emit({ kind: 'tribe', tribeId: t.tribeId, topics: ['game', 'tribe'] });
    }
  }

  // ---- meta ------------------------------------------------------------------------------------

  getMeta(key: string): string | null {
    const r = this.get('SELECT value FROM meta WHERE key = ?', key);
    return r ? (r.value as string) : null;
  }

  setMeta(key: string, value: string): void {
    this.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  getSettings(): WorldSettings | null {
    const raw = this.getMeta('world_settings');
    return raw ? (JSON.parse(raw) as WorldSettings) : null;
  }

  // ---- players & sessions ----------------------------------------------------------------------

  getPlayerByLowerName(lower: string): PlayerRow | null {
    const r = this.get('SELECT * FROM players WHERE username_lower = ?', lower);
    return r ? toPlayer(r) : null;
  }

  getPlayer(id: number): PlayerRow | null {
    const r = this.get('SELECT * FROM players WHERE id = ?', id);
    return r ? toPlayer(r) : null;
  }

  insertPlayer(
    username: string,
    passwordHash: string,
    createdAt: number,
    protectedUntil: number,
    chieftain: string = DEFAULT_CHIEFTAIN,
    accountId: number | null = null,
  ): number {
    return this.run(
      'INSERT INTO players (username, username_lower, password_hash, created_at, protected_until, chieftain, last_active, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      username,
      username.toLowerCase(),
      passwordHash,
      createdAt,
      protectedUntil,
      chieftain,
      createdAt,
      accountId,
    ).id;
  }

  /** The player linked to a lobby account (players.account_id is unique), or null. */
  getPlayerByAccountId(accountId: number): PlayerRow | null {
    const r = this.get('SELECT * FROM players WHERE account_id = ?', accountId);
    return r ? toPlayer(r) : null;
  }

  // ---- entry-pass nonces (single-use passes from the lobby) ----------------------------------------

  /** Remember a pass nonce until `expiresAt`. False when it was already used. */
  useEntryNonce(nonce: string, expiresAt: number): boolean {
    return this.run('INSERT OR IGNORE INTO used_pass_nonces (nonce, expires_at) VALUES (?, ?)', nonce, expiresAt).changes > 0;
  }

  /** Forget nonces whose pass could no longer be accepted. */
  deleteExpiredEntryNonces(now: number): void {
    this.run('DELETE FROM used_pass_nonces WHERE expires_at <= ?', now);
  }

  countEntryNonces(): number {
    return Number(this.get('SELECT COUNT(*) AS n FROM used_pass_nonces')?.n ?? 0);
  }

  /** Record activity at `t`. Cheap no-op unless the stored time is older than `minGapMs`. Returns whether it wrote. */
  touchActive(playerId: number, t: number, minGapMs: number): boolean {
    return Number(this.run('UPDATE players SET last_active = ? WHERE id = ? AND (last_active IS NULL OR last_active <= ?)', t, playerId, t - minGapMs).changes) > 0;
  }

  // ---- statistics (docs/GAME_DESIGN.md section 16) ---------------------------------------------

  /** Add to a player's lifetime counters. Call inside the transaction of the event being counted. Zero deltas are skipped. */
  addStats(playerId: number | null, delta: Partial<PlayerStatsDto>): void {
    if (playerId === null) return;
    const keys = STAT_KEYS.filter((k) => (delta[k] ?? 0) > 0);
    if (keys.length === 0) return;
    const cols = keys.map(statColumn);
    this.run(
      `INSERT INTO player_stats (player_id, ${cols.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})
       ON CONFLICT(player_id) DO UPDATE SET ${cols.map((c) => `${c} = ${c} + excluded.${c}`).join(', ')}`,
      playerId,
      ...keys.map((k) => Math.floor(delta[k] ?? 0)),
    );
  }

  getStats(playerId: number): PlayerStatsDto {
    const out = emptyStats();
    const r = this.get('SELECT * FROM player_stats WHERE player_id = ?', playerId);
    if (r) for (const k of STAT_KEYS) out[k] = (r[statColumn(k)] as number | undefined) ?? 0;
    return out;
  }

  // ---- caretaker bot ----------------------------------------------------------------------------

  /**
   * Villages of idle, unbanned owners the caretaker may act on at `now` (oldest due first). Uses the
   * `bot_next_at` index, then filters by the owner's activity.
   */
  botDueVillages(now: number, idleBefore: number, limit: number): VillageRecord[] {
    return this.all(
      `${VILLAGE_SQL} WHERE v.owner_id IS NOT NULL AND v.bot_next_at <= ? AND p.banned_at IS NULL
         AND COALESCE(p.last_active, p.created_at) <= ?
       ORDER BY v.bot_next_at, v.id LIMIT ?`,
      now,
      idleBefore,
      limit,
    ).map(toVillage);
  }

  /** Villages whose owner has not been active since `idleBefore`. */
  abandonDueVillages(idleBefore: number, limit: number): VillageRecord[] {
    return this.all(
      `${VILLAGE_SQL} WHERE v.owner_id IS NOT NULL AND COALESCE(p.last_active, p.created_at) <= ? ORDER BY v.id LIMIT ?`,
      idleBefore,
      limit,
    ).map(toVillage);
  }

  /** Turn a village into an abandoned one: no owner, state (troops, queues) untouched. */
  releaseVillage(id: number, name: string): void {
    this.run('UPDATE villages SET owner_id = NULL, name = ?, bot_next_at = 0 WHERE id = ?', name, id);
  }

  /** Remember that `n` more of the player's villages were abandoned, until they dismiss the notice. */
  addAbandonedNotice(playerId: number, n: number): void {
    this.run('UPDATE players SET abandoned_notice = abandoned_notice + ? WHERE id = ?', n, playerId);
  }

  clearAbandonedNotice(playerId: number): void {
    this.run('UPDATE players SET abandoned_notice = 0 WHERE id = ?', playerId);
  }

  setBotNextAt(villageId: number, t: number): void {
    this.run('UPDATE villages SET bot_next_at = ? WHERE id = ?', t, villageId);
  }

  setPremium(playerId: number, premium: boolean): void {
    this.run('UPDATE players SET premium = ? WHERE id = ?', premium ? 1 : 0, playerId);
  }

  setChieftain(playerId: number, chieftain: string): void {
    this.run('UPDATE players SET chieftain = ? WHERE id = ?', chieftain, playerId);
  }

  setProtectedUntil(playerId: number, t: number): void {
    this.run('UPDATE players SET protected_until = ? WHERE id = ?', t, playerId);
  }

  // ---- multi-account detection & bans ------------------------------------------------------------

  /** Remember that this account was seen on this IP. */
  recordIp(playerId: number, ip: string, now: number): void {
    this.run(
      'INSERT INTO player_ips (player_id, ip, first_seen, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(player_id, ip) DO UPDATE SET last_seen = excluded.last_seen',
      playerId,
      ip,
      now,
      now,
    );
  }

  /** How many accounts that are not banned have been seen on this IP. */
  countActiveAccountsOnIp(ip: string): number {
    const r = this.get(
      'SELECT COUNT(DISTINCT i.player_id) AS n FROM player_ips i JOIN players p ON p.id = i.player_id WHERE i.ip = ? AND p.banned_at IS NULL',
      ip,
    );
    return Number(r?.n ?? 0);
  }

  setHouseholdShared(playerId: number, shared: boolean): void {
    this.run('UPDATE players SET household_shared = ? WHERE id = ?', shared ? 1 : 0, playerId);
  }

  /** True when two different accounts have been seen on the same IP (same household or the same person). */
  shareAnIp(a: number, b: number): boolean {
    if (a === b) return false;
    const r = this.get(
      `SELECT 1 AS x FROM player_ips i1 JOIN player_ips i2 ON i1.ip = i2.ip
        WHERE i1.player_id = ? AND i2.player_id = ? LIMIT 1`,
      a,
      b,
    );
    return r !== undefined && r !== null;
  }

  /** True when another account has been seen on any IP this account has used. */
  sharesIpWithAnyone(playerId: number): boolean {
    const r = this.get(
      `SELECT 1 AS x FROM player_ips i1 JOIN player_ips i2 ON i1.ip = i2.ip
        WHERE i1.player_id = ? AND i2.player_id <> i1.player_id LIMIT 1`,
      playerId,
    );
    return r !== undefined && r !== null;
  }

  /** IPs used by two or more accounts, with the accounts on each (for review and banning). */
  sharedIpGroups(): SharedIpGroup[] {
    const rows = this.all(
      `SELECT i.ip AS ip, p.id AS id, p.username AS username, p.banned_at AS banned_at, p.household_shared AS household_shared
         FROM player_ips i JOIN players p ON p.id = i.player_id
        WHERE i.ip IN (SELECT ip FROM player_ips GROUP BY ip HAVING COUNT(*) > 1)
        ORDER BY i.ip, p.id`,
    );
    const groups = new Map<string, SharedIpGroup>();
    for (const r of rows) {
      const ip = r.ip as string;
      const g = groups.get(ip) ?? { ip, players: [] };
      g.players.push({ id: r.id as number, username: r.username as string, bannedAt: (r.banned_at as number | null) ?? null, householdShared: (r.household_shared as number) === 1 });
      groups.set(ip, g);
    }
    return [...groups.values()];
  }

  /** Ban an account and end all its sessions. */
  banPlayer(playerId: number, reason: string, now: number): void {
    this.run('UPDATE players SET banned_at = ?, ban_reason = ? WHERE id = ?', now, reason, playerId);
    this.run('DELETE FROM sessions WHERE player_id = ?', playerId);
    this.emit({ kind: 'player-banned', playerId });
  }

  unbanPlayer(playerId: number): void {
    this.run('UPDATE players SET banned_at = NULL, ban_reason = NULL WHERE id = ?', playerId);
  }

  insertSession(tokenHash: string, playerId: number, createdAt: number, expiresAt: number): void {
    this.run('INSERT INTO sessions (token_hash, player_id, created_at, expires_at) VALUES (?, ?, ?, ?)', tokenHash, playerId, createdAt, expiresAt);
  }

  getSessionPlayer(tokenHash: string, now: number): PlayerRow | null {
    const r = this.get(
      'SELECT p.* FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = ? AND s.expires_at > ? AND p.banned_at IS NULL',
      tokenHash,
      now,
    );
    return r ? toPlayer(r) : null;
  }

  /** Like getSessionPlayer, with the session's own times (for the idle/absolute expiry rules). */
  getSessionWithTimes(tokenHash: string, now: number): { player: PlayerRow; createdAt: number; expiresAt: number } | null {
    const r = this.get(
      'SELECT p.*, s.created_at AS s_created, s.expires_at AS s_expires FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = ? AND s.expires_at > ? AND p.banned_at IS NULL',
      tokenHash,
      now,
    );
    return r ? { player: toPlayer(r), createdAt: r.s_created as number, expiresAt: r.s_expires as number } : null;
  }

  setSessionExpiry(tokenHash: string, expiresAt: number): void {
    this.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', expiresAt, tokenHash);
  }

  deleteSession(tokenHash: string): void {
    this.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
    this.emit({ kind: 'session-ended', tokenHash });
  }

  deleteExpiredSessions(now: number): void {
    this.run('DELETE FROM sessions WHERE expires_at <= ?', now);
  }

  // ---- villages --------------------------------------------------------------------------------

  getVillage(id: number): VillageRecord | null {
    const r = this.get(`${VILLAGE_SQL} WHERE v.id = ?`, id);
    return r ? toVillage(r) : null;
  }

  getVillageAt(x: number, y: number): VillageRecord | null {
    const r = this.get(`${VILLAGE_SQL} WHERE v.x = ? AND v.y = ?`, x, y);
    return r ? toVillage(r) : null;
  }

  villagesOfPlayer(playerId: number): VillageRecord[] {
    return this.all(`${VILLAGE_SQL} WHERE v.owner_id = ? ORDER BY v.id`, playerId).map(toVillage);
  }

  villageExistsAt(x: number, y: number): boolean {
    return this.get('SELECT 1 AS one FROM villages WHERE x = ? AND y = ?', x, y) !== undefined;
  }

  /** Number of villages that have an owner (drives the 'expanding' world layout). */
  playerVillageCount(): number {
    return Number(this.get('SELECT COUNT(*) AS n FROM villages WHERE owner_id IS NOT NULL')?.n ?? 0);
  }

  insertVillage(ownerId: number | null, name: string, x: number, y: number, points: number, state: VillageState): number {
    return this.run('INSERT INTO villages (owner_id, name, x, y, points, state_json) VALUES (?, ?, ?, ?, ?, ?)', ownerId, name, x, y, points, JSON.stringify(state)).id;
  }

  saveVillage(id: number, state: VillageState, points: number): void {
    this.run('UPDATE villages SET state_json = ?, points = ? WHERE id = ?', JSON.stringify(state), points, id);
  }

  /** Ids of all abandoned (npc) villages. */
  abandonedVillageIds(): number[] {
    return this.all('SELECT id FROM villages WHERE owner_id IS NULL ORDER BY id').map((r) => r.id as number);
  }

  /** Refresh the cached points column (building levels change lazily, when a queued job completes). */
  setPoints(id: number, points: number): void {
    this.run('UPDATE villages SET points = ? WHERE id = ?', points, id);
  }

  /** Every player with at least one village, best first (ties: name). Points = sum of village points. */
  playerRanking(): { id: number; username: string; tribeId: number | null; tribeTag: string | null; villages: number; points: number; mainX: number; mainY: number }[] {
    return this.all(
      `SELECT p.id, p.username, tm.tribe_id, tr.tag AS tribe_tag, COUNT(v.id) AS villages, SUM(v.points) AS total_points,
              (SELECT x FROM villages m WHERE m.owner_id = p.id ORDER BY m.points DESC, m.id ASC LIMIT 1) AS main_x,
              (SELECT y FROM villages m WHERE m.owner_id = p.id ORDER BY m.points DESC, m.id ASC LIMIT 1) AS main_y
       FROM players p
       JOIN villages v ON v.owner_id = p.id
       LEFT JOIN tribe_members tm ON tm.player_id = p.id
       LEFT JOIN tribes tr ON tr.id = tm.tribe_id
       GROUP BY p.id
       ORDER BY total_points DESC, p.username_lower ASC, p.id ASC`,
    ).map((r) => ({
      id: r.id as number,
      username: r.username as string,
      tribeId: (r.tribe_id as number | null) ?? null,
      tribeTag: (r.tribe_tag as string | null) ?? null,
      villages: r.villages as number,
      points: r.total_points as number,
      mainX: r.main_x as number,
      mainY: r.main_y as number,
    }));
  }

  mapVillages(x0: number, x1: number, y0: number, y1: number): MapRow[] {
    return this.all(
      `SELECT v.id, v.owner_id, v.name, v.x, v.y, v.points, p.username AS owner_name, COALESCE(p.protected_until, 0) AS owner_protected_until,
              tm.tribe_id AS owner_tribe_id, tr.tag AS owner_tribe_tag, p.chieftain AS owner_chieftain,
              CASE WHEN v.owner_id IS NULL THEN v.state_json END AS npc_state_json
       FROM villages v
       LEFT JOIN players p ON p.id = v.owner_id
       LEFT JOIN tribe_members tm ON tm.player_id = v.owner_id
       LEFT JOIN tribes tr ON tr.id = tm.tribe_id
       WHERE v.x BETWEEN ? AND ? AND v.y BETWEEN ? AND ?
       ORDER BY v.y, v.x`,
      x0,
      x1,
      y0,
      y1,
    ).map((r) => ({
      id: r.id as number,
      ownerId: (r.owner_id as number | null) ?? null,
      ownerName: (r.owner_name as string | null) ?? null,
      ownerProtectedUntil: r.owner_protected_until as number,
      name: r.name as string,
      x: r.x as number,
      y: r.y as number,
      points: r.points as number,
      ownerTribeId: (r.owner_tribe_id as number | null) ?? null,
      ownerTribeTag: (r.owner_tribe_tag as string | null) ?? null,
      ownerChieftain: (r.owner_chieftain as string | null) ?? null,
      npcState: r.npc_state_json ? normalizeVillage(JSON.parse(r.npc_state_json as string) as VillageState) : null,
    }));
  }

  // ---- movements -------------------------------------------------------------------------------

  insertMovement(m: Omit<MovementRow, 'id'>): number {
    const id = this.run(
      'INSERT INTO movements (kind, origin_village_id, target_village_id, units_json, loot_json, depart_at, arrive_at, ranks_json, return_secs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      m.kind,
      m.originVillageId,
      m.targetVillageId,
      JSON.stringify(m.units),
      m.loot ? JSON.stringify(m.loot) : null,
      m.departAt,
      m.arriveAt,
      stampRanks(m.ranks),
      m.returnSecs ?? null,
    ).id;
    this.emitMovement(m.kind, m.originVillageId, m.targetVillageId, true);
    return id;
  }

  getMovement(id: number): MovementRow | null {
    const r = this.get('SELECT * FROM movements WHERE id = ?', id);
    return r ? toMovement(r) : null;
  }

  deleteMovement(id: number): void {
    const m = this.getMovement(id);
    this.run('DELETE FROM movements WHERE id = ?', id);
    if (m) this.emitMovement(m.kind, m.originVillageId, m.targetVillageId, false);
  }

  /** Movements that have arrived by `now`, in processing order. */
  dueMovements(now: number, limit: number): MovementRow[] {
    return this.all('SELECT * FROM movements WHERE arrive_at <= ? ORDER BY arrive_at, id LIMIT ?', now, limit).map(toMovement);
  }

  /** Shipments sent from this village that have not arrived yet. */
  shipmentsInTransit(originVillageId: number): number {
    const r = this.get("SELECT COUNT(*) AS n FROM movements WHERE kind = 'shipment' AND origin_village_id = ?", originVillageId);
    return Number(r?.n ?? 0);
  }

  getMovementView(id: number): MovementView | null {
    const r = this.get(`${MOVEMENT_VIEW_SQL} WHERE m.id = ?`, id);
    return r ? toMovementView(r) : null;
  }

  /**
   * Movements sent from or returning to the player's villages (every kind), plus attacks and support heading for
   * them. Incoming scouts are never listed (they are stealthy); returns that leave a host village for another
   * player's home are the home owner's business only.
   */
  movementViewsForPlayer(playerId: number): MovementView[] {
    return this.all(
      `${MOVEMENT_VIEW_SQL}
       WHERE m.origin_village_id IN (SELECT id FROM villages WHERE owner_id = ?)
          OR (m.kind IN ('attack', 'support', 'shipment') AND m.target_village_id IN (SELECT id FROM villages WHERE owner_id = ?))
       ORDER BY m.arrive_at, m.id`,
      playerId,
      playerId,
    ).map(toMovementView);
  }

  // ---- stationed support -------------------------------------------------------------------------------

  getStationed(id: number): StationedRow | null {
    const r = this.get('SELECT * FROM stationed WHERE id = ?', id);
    return r ? toStationed(r) : null;
  }

  getStationedView(id: number): StationedView | null {
    const r = this.get(`${STATIONED_VIEW_SQL} WHERE s.id = ?`, id);
    return r ? this.toStationedView(r) : null;
  }

  /** Every contingent standing in a host village, oldest first (a stable order for splitting losses). */
  stationedAt(hostVillageId: number): StationedRow[] {
    return this.all('SELECT * FROM stationed WHERE host_village_id = ? ORDER BY id', hostVillageId).map(toStationed);
  }

  /** Others' troops standing in the player's villages. */
  stationedHere(playerId: number): StationedView[] {
    return this.all(
      `${STATIONED_VIEW_SQL} WHERE s.host_village_id IN (SELECT id FROM villages WHERE owner_id = ?) ORDER BY s.arrived_at, s.id`,
      playerId,
    ).map((r) => this.toStationedView(r));
  }

  /** The player's troops standing in other villages. */
  stationedAbroad(playerId: number): StationedView[] {
    return this.all(
      `${STATIONED_VIEW_SQL} WHERE s.home_village_id IN (SELECT id FROM villages WHERE owner_id = ?) ORDER BY s.arrived_at, s.id`,
      playerId,
    ).map((r) => this.toStationedView(r));
  }

  /** Station `units` for a (home, host) pair: merges into the pair's existing contingent, keeping its arrival time. */
  addStationed(
    ownerPlayerId: number,
    homeVillageId: number,
    hostVillageId: number,
    units: Units,
    arrivedAt: number,
    ranks: VillageRanks | null = null,
  ): number {
    const row = this.get('SELECT * FROM stationed WHERE home_village_id = ? AND host_village_id = ?', homeVillageId, hostVillageId);
    if (row) {
      // The newest arrival's ranks stamp the whole contingent.
      const old = toStationed(row);
      this.run('UPDATE stationed SET units_json = ?, ranks_json = ? WHERE id = ?', JSON.stringify(addUnits(old.units, units)), stampRanks(ranks), old.id);
      return old.id;
    }
    return this.run(
      'INSERT INTO stationed (owner_player_id, home_village_id, host_village_id, units_json, arrived_at, ranks_json) VALUES (?, ?, ?, ?, ?, ?)',
      ownerPlayerId,
      homeVillageId,
      hostVillageId,
      JSON.stringify(units),
      arrivedAt,
      stampRanks(ranks),
    ).id;
  }

  setStationedUnits(id: number, units: Units): void {
    this.run('UPDATE stationed SET units_json = ? WHERE id = ?', JSON.stringify(units), id);
  }

  deleteStationed(id: number): void {
    this.run('DELETE FROM stationed WHERE id = ?', id);
  }

  private toStationedView(r: Raw): StationedView {
    const row = toStationed(r);
    return { ...row, home: stubFrom(r, 'h', row.homeVillageId), host: stubFrom(r, 't', row.hostVillageId) };
  }

  // ---- tribe alerts -------------------------------------------------------------------------------------

  /** Incoming attacks on villages of the tribe's members, soonest first. Scouts and support never show up here. */
  tribeAlerts(tribeId: number, limit: number): AlertRow[] {
    return this.all(
      `SELECT m.id, m.depart_at, m.arrive_at,
              o.id AS o_id, o.name AS o_name, o.x AS o_x, o.y AS o_y, o.owner_id AS o_owner_id, op.username AS o_owner_name,
              t.id AS t_id, t.name AS t_name, t.x AS t_x, t.y AS t_y, t.owner_id AS t_owner_id, tp.username AS t_owner_name,
              otr.tag AS o_tribe_tag
       FROM movements m
       JOIN villages o ON o.id = m.origin_village_id
       JOIN villages t ON t.id = m.target_village_id
       LEFT JOIN players op ON op.id = o.owner_id
       LEFT JOIN players tp ON tp.id = t.owner_id
       LEFT JOIN tribe_members otm ON otm.player_id = o.owner_id
       LEFT JOIN tribes otr ON otr.id = otm.tribe_id
       WHERE ${TRIBE_ATTACKS_WHERE}
       ORDER BY m.arrive_at, m.id
       LIMIT ?`,
      tribeId,
      limit,
    ).map((r) => ({
      movementId: r.id as number,
      departAt: r.depart_at as number,
      arriveAt: r.arrive_at as number,
      attacker: stubFrom(r, 'o', r.o_id as number),
      attackerTribeTag: (r.o_tribe_tag as string | null) ?? null,
      target: stubFrom(r, 't', r.t_id as number),
    }));
  }

  countTribeAlerts(tribeId: number): number {
    const r = this.get(`SELECT COUNT(*) AS n FROM movements m WHERE ${TRIBE_ATTACKS_WHERE}`, tribeId);
    return r ? (r.n as number) : 0;
  }

  // ---- reports ---------------------------------------------------------------------------------

  insertReport(r: NewReport): number {
    const id = this.run(
      'INSERT INTO reports (player_id, side, won, title, created_at, read, battle_json) VALUES (?, ?, ?, ?, ?, 0, ?)',
      r.playerId,
      r.side,
      r.won ? 1 : 0,
      r.title,
      r.createdAt,
      reportJson(r),
    ).id;
    this.run(
      `DELETE FROM reports WHERE player_id = ? AND id NOT IN
         (SELECT id FROM reports WHERE player_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)`,
      r.playerId,
      r.playerId,
      REPORTS_KEEP,
    );
    this.emit({ kind: 'player', playerId: r.playerId, topics: ['reports', 'game'] }); // game: the unread count
    return id;
  }

  listReports(playerId: number, limit: number): ReportRow[] {
    return this.all(
      // Reports stored before tribes or scouting existed have no `outcome` / `type` in their JSON: they were all battles.
      `SELECT id, player_id, side, won, title, created_at, read,
              json_extract(battle_json, '$.outcome') AS outcome, json_extract(battle_json, '$.type') AS type
       FROM reports WHERE player_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      playerId,
      limit,
    ).map(toReport);
  }

  getReport(playerId: number, id: number): FullReport | null {
    const r = this.get('SELECT * FROM reports WHERE id = ? AND player_id = ?', id, playerId);
    if (!r) return null;
    const body = parseReportBody(r.battle_json as string);
    const row = toReport({
      ...r,
      type: body.type,
      outcome: body.type === 'battle' ? body.battle.outcome : null,
    });
    return {
      ...row,
      battle: body.type === 'battle' ? body.battle : null,
      scout: body.type === 'scout' ? body.scout : null,
      support: body.type === 'support' ? body.support : null,
      shipment: body.type === 'shipment' ? body.shipment : null,
    };
  }

  markReportRead(playerId: number, id: number): void {
    this.run('UPDATE reports SET read = 1 WHERE id = ? AND player_id = ?', id, playerId);
  }

  unreadReportCount(playerId: number): number {
    const r = this.get('SELECT COUNT(*) AS n FROM reports WHERE player_id = ? AND read = 0', playerId);
    return r ? (r.n as number) : 0;
  }
}
