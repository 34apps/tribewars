// All SQL lives here: prepared statements with bound parameters only.

import type { DatabaseSync } from 'node:sqlite';
import {
  normalizeUnits,
  normalizeVillage,
  type BattleReportData,
  type Mission,
  type Resources,
  type ScoutReportData,
  type SupportReportData,
  type Units,
  type VillageState,
  type WorldSettings,
} from '@clanfire/engine';
import { SqlBase, type Raw } from './sql.ts';
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

export type MovementKind = Mission | 'return';

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
}

export type ReportSide = 'attack' | 'defense' | 'support';
export type ReportType = 'battle' | 'scout' | 'support';

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
  | { type: 'support'; support: SupportReportData };

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
};

const MOVEMENT_VIEW_SQL = `
SELECT m.id, m.kind, m.origin_village_id, m.target_village_id, m.units_json, m.loot_json, m.depart_at, m.arrive_at,
       o.name AS o_name, o.x AS o_x, o.y AS o_y, o.owner_id AS o_owner_id, op.username AS o_owner_name,
       t.name AS t_name, t.x AS t_x, t.y AS t_y, t.owner_id AS t_owner_id, tp.username AS t_owner_name
FROM movements m
JOIN villages o ON o.id = m.origin_village_id
JOIN villages t ON t.id = m.target_village_id
LEFT JOIN players op ON op.id = o.owner_id
LEFT JOIN players tp ON tp.id = t.owner_id`;

const STATIONED_VIEW_SQL = `
SELECT s.id, s.owner_player_id, s.home_village_id, s.host_village_id, s.units_json, s.arrived_at,
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
  };
}

function reportTypeOf(raw: unknown): ReportType {
  return raw === 'scout' || raw === 'support' ? raw : 'battle'; // reports saved before scouting have no type
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
    return { type, scout: { ...d, intel: d.intel ? { ...d.intel, troops: normalizeUnits(d.intel.troops) } : null } };
  }
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
  };
}

export class Store extends SqlBase {
  private depth = 0;
  /** Tribe tables. Shares this connection, so it takes part in `tx`. */
  readonly tribes: TribeStore;

  constructor(db: DatabaseSync) {
    super(db);
    this.tribes = new TribeStore(db);
  }

  /** Run `fn` inside BEGIN IMMEDIATE ... COMMIT; roll back and rethrow on error. Re-entrant. */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // The transaction may already be gone; the original error matters more.
      }
      throw err;
    } finally {
      this.depth = 0;
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

  insertPlayer(username: string, passwordHash: string, createdAt: number, protectedUntil: number): number {
    return this.run(
      'INSERT INTO players (username, username_lower, password_hash, created_at, protected_until) VALUES (?, ?, ?, ?, ?)',
      username,
      username.toLowerCase(),
      passwordHash,
      createdAt,
      protectedUntil,
    ).id;
  }

  setProtectedUntil(playerId: number, t: number): void {
    this.run('UPDATE players SET protected_until = ? WHERE id = ?', t, playerId);
  }

  insertSession(tokenHash: string, playerId: number, createdAt: number, expiresAt: number): void {
    this.run('INSERT INTO sessions (token_hash, player_id, created_at, expires_at) VALUES (?, ?, ?, ?)', tokenHash, playerId, createdAt, expiresAt);
  }

  getSessionPlayer(tokenHash: string, now: number): PlayerRow | null {
    const r = this.get(
      'SELECT p.* FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = ? AND s.expires_at > ?',
      tokenHash,
      now,
    );
    return r ? toPlayer(r) : null;
  }

  deleteSession(tokenHash: string): void {
    this.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
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

  insertVillage(ownerId: number | null, name: string, x: number, y: number, points: number, state: VillageState): number {
    return this.run('INSERT INTO villages (owner_id, name, x, y, points, state_json) VALUES (?, ?, ?, ?, ?, ?)', ownerId, name, x, y, points, JSON.stringify(state)).id;
  }

  saveVillage(id: number, state: VillageState, points: number): void {
    this.run('UPDATE villages SET state_json = ?, points = ? WHERE id = ?', JSON.stringify(state), points, id);
  }

  /** Refresh the cached points column (building levels change lazily, when a queued job completes). */
  setPoints(id: number, points: number): void {
    this.run('UPDATE villages SET points = ? WHERE id = ?', points, id);
  }

  mapVillages(x0: number, x1: number, y0: number, y1: number): MapRow[] {
    return this.all(
      `SELECT v.id, v.owner_id, v.name, v.x, v.y, v.points, p.username AS owner_name, COALESCE(p.protected_until, 0) AS owner_protected_until,
              tm.tribe_id AS owner_tribe_id, tr.tag AS owner_tribe_tag
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
    }));
  }

  // ---- movements -------------------------------------------------------------------------------

  insertMovement(m: Omit<MovementRow, 'id'>): number {
    return this.run(
      'INSERT INTO movements (kind, origin_village_id, target_village_id, units_json, loot_json, depart_at, arrive_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m.kind,
      m.originVillageId,
      m.targetVillageId,
      JSON.stringify(m.units),
      m.loot ? JSON.stringify(m.loot) : null,
      m.departAt,
      m.arriveAt,
    ).id;
  }

  getMovement(id: number): MovementRow | null {
    const r = this.get('SELECT * FROM movements WHERE id = ?', id);
    return r ? toMovement(r) : null;
  }

  deleteMovement(id: number): void {
    this.run('DELETE FROM movements WHERE id = ?', id);
  }

  /** Movements that have arrived by `now`, in processing order. */
  dueMovements(now: number, limit: number): MovementRow[] {
    return this.all('SELECT * FROM movements WHERE arrive_at <= ? ORDER BY arrive_at, id LIMIT ?', now, limit).map(toMovement);
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
          OR (m.kind IN ('attack', 'support') AND m.target_village_id IN (SELECT id FROM villages WHERE owner_id = ?))
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
  addStationed(ownerPlayerId: number, homeVillageId: number, hostVillageId: number, units: Units, arrivedAt: number): number {
    const row = this.get('SELECT * FROM stationed WHERE home_village_id = ? AND host_village_id = ?', homeVillageId, hostVillageId);
    if (row) {
      const old = toStationed(row);
      this.setStationedUnits(old.id, addUnits(old.units, units));
      return old.id;
    }
    return this.run(
      'INSERT INTO stationed (owner_player_id, home_village_id, host_village_id, units_json, arrived_at) VALUES (?, ?, ?, ?, ?)',
      ownerPlayerId,
      homeVillageId,
      hostVillageId,
      JSON.stringify(units),
      arrivedAt,
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
