// All SQL lives here: prepared statements with bound parameters only.

import type { DatabaseSync } from 'node:sqlite';
import type { BattleReportData, Resources, Units, VillageState, WorldSettings } from '@tribewars/engine';
import { SqlBase, type Raw } from './sql.ts';
import { TribeStore } from './tribe-store.ts';

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

export type MovementKind = 'attack' | 'return';

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

export interface ReportRow {
  id: number;
  playerId: number;
  side: 'attack' | 'defense';
  won: boolean;
  title: string;
  createdAt: number;
  read: boolean;
  outcome: 'battle' | 'called_off';
}

export interface NewReport {
  playerId: number;
  side: 'attack' | 'defense';
  won: boolean;
  title: string;
  createdAt: number;
  battle: BattleReportData;
}

const MOVEMENT_VIEW_SQL = `
SELECT m.id, m.kind, m.origin_village_id, m.target_village_id, m.units_json, m.loot_json, m.depart_at, m.arrive_at,
       o.name AS o_name, o.x AS o_x, o.y AS o_y, o.owner_id AS o_owner_id, op.username AS o_owner_name,
       t.name AS t_name, t.x AS t_x, t.y AS t_y, t.owner_id AS t_owner_id, tp.username AS t_owner_name
FROM movements m
JOIN villages o ON o.id = m.origin_village_id
JOIN villages t ON t.id = m.target_village_id
LEFT JOIN players op ON op.id = o.owner_id
LEFT JOIN players tp ON tp.id = t.owner_id`;

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
    state: JSON.parse(r.state_json as string) as VillageState,
  };
}

function toMovement(r: Raw): MovementRow {
  return {
    id: r.id as number,
    kind: r.kind as MovementKind,
    originVillageId: r.origin_village_id as number,
    targetVillageId: r.target_village_id as number,
    units: JSON.parse(r.units_json as string) as Units,
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

function toReport(r: Raw, outcome: ReportRow['outcome']): ReportRow {
  return {
    id: r.id as number,
    playerId: r.player_id as number,
    side: r.side as 'attack' | 'defense',
    won: r.won === 1,
    title: r.title as string,
    createdAt: r.created_at as number,
    read: r.read === 1,
    outcome,
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

  /** Movements sent from, returning to, or attacking (as an incoming attack) the player's villages. */
  movementViewsForPlayer(playerId: number): MovementView[] {
    return this.all(
      `${MOVEMENT_VIEW_SQL}
       WHERE m.origin_village_id IN (SELECT id FROM villages WHERE owner_id = ?)
          OR (m.kind = 'attack' AND m.target_village_id IN (SELECT id FROM villages WHERE owner_id = ?))
       ORDER BY m.arrive_at, m.id`,
      playerId,
      playerId,
    ).map(toMovementView);
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
      JSON.stringify(r.battle),
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
      // Reports stored before tribes existed have no `outcome` in their JSON: they were all battles.
      `SELECT id, player_id, side, won, title, created_at, read, json_extract(battle_json, '$.outcome') AS outcome
       FROM reports WHERE player_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      playerId,
      limit,
    ).map((r) => toReport(r, r.outcome === 'called_off' ? 'called_off' : 'battle'));
  }

  getReport(playerId: number, id: number): (ReportRow & { battle: BattleReportData }) | null {
    const r = this.get('SELECT * FROM reports WHERE id = ? AND player_id = ?', id, playerId);
    if (!r) return null;
    // Reports stored before tribes existed have no `outcome`: they were all battles.
    const battle = JSON.parse(r.battle_json as string) as Omit<BattleReportData, 'outcome'> & { outcome?: BattleReportData['outcome'] };
    const outcome = battle.outcome ?? 'battle';
    return { ...toReport(r, outcome), battle: { ...battle, outcome } };
  }

  markReportRead(playerId: number, id: number): void {
    this.run('UPDATE reports SET read = 1 WHERE id = ? AND player_id = ?', id, playerId);
  }

  unreadReportCount(playerId: number): number {
    const r = this.get('SELECT COUNT(*) AS n FROM reports WHERE player_id = ? AND read = 0', playerId);
    return r ? (r.n as number) : 0;
  }
}
