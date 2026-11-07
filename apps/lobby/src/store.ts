// All lobby SQL. Prepared statements with bound parameters only.

import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { BADGE_KINDS, isBadgeKind, isStaffRole, type AccountBadgeDto, type BadgeKind, type StaffRole, type WorldEndKind, type WorldStatus } from '@clanfire/engine';

type Raw = Record<string, unknown>;
type Param = string | number | null;

export interface AccountRow {
  id: number;
  username: string;
  usernameLower: string;
  passwordHash: string;
  chieftain: string;
  createdAt: number;
  lastLogin: number | null;
  bannedAt: number | null;
  banReason: string | null;
  staffRole: StaffRole | null;
}

export interface NewAccount {
  username: string;
  passwordHash: string;
  chieftain: string;
  createdAt: number;
  bannedAt?: number | null;
  banReason?: string | null;
  staffRole?: StaffRole | null;
}

export interface WorldRow {
  id: string;
  name: string;
  status: WorldStatus;
  path: string;
  createdAt: number;
  sortOrder: number;
}

export interface HallOfFameRow {
  worldId: string;
  worldName: string;
  endedAt: number;
  kind: WorldEndKind;
  winnerName: string | null;
  winnerTag: string | null;
  topJson: string;
}

export interface NewAudit {
  at: number;
  actorId: number | null;
  actorIp: string | null;
  action: string;
  targetAccount: number | null;
  detail?: string;
}

export interface SharedIpGroup {
  ip: string;
  accounts: { id: number; username: string; bannedAt: number | null }[];
}

const toAccount = (r: Raw): AccountRow => {
  const role = r.staff_role;
  return {
  id: r.id as number,
  username: r.username as string,
  usernameLower: r.username_lower as string,
  passwordHash: r.password_hash as string,
  chieftain: r.chieftain as string,
  createdAt: r.created_at as number,
  lastLogin: (r.last_login as number | null) ?? null,
  bannedAt: (r.banned_at as number | null) ?? null,
  banReason: (r.ban_reason as string | null) ?? null,
  staffRole: isStaffRole(role) ? role : null,
  };
};

const toWorld = (r: Raw): WorldRow => ({
  id: r.id as string,
  name: r.name as string,
  status: r.status as WorldStatus,
  path: r.path as string,
  createdAt: r.created_at as number,
  sortOrder: r.sort_order as number,
});

export class Store {
  private readonly cache = new Map<string, StatementSync>();
  private depth = 0;

  constructor(readonly db: DatabaseSync) {}

  private q(sql: string): StatementSync {
    let st = this.cache.get(sql);
    if (!st) {
      st = this.db.prepare(sql);
      this.cache.set(sql, st);
    }
    return st;
  }

  private get(sql: string, ...params: Param[]): Raw | undefined {
    return this.q(sql).get(...params) as Raw | undefined;
  }

  private all(sql: string, ...params: Param[]): Raw[] {
    return this.q(sql).all(...params) as Raw[];
  }

  private run(sql: string, ...params: Param[]): { changes: number; id: number } {
    const r = this.q(sql).run(...params);
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
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

  // ---- accounts ----------------------------------------------------------------------------------

  insertAccount(a: NewAccount): number {
    return this.run(
      'INSERT INTO accounts (username, username_lower, password_hash, chieftain, created_at, banned_at, ban_reason, staff_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      a.username,
      a.username.toLowerCase(),
      a.passwordHash,
      a.chieftain,
      a.createdAt,
      a.bannedAt ?? null,
      a.banReason ?? null,
      a.staffRole ?? null,
    ).id;
  }

  getAccount(id: number): AccountRow | null {
    const r = this.get('SELECT * FROM accounts WHERE id = ?', id);
    return r ? toAccount(r) : null;
  }

  getAccountByLowerName(lower: string): AccountRow | null {
    const r = this.get('SELECT * FROM accounts WHERE username_lower = ?', lower);
    return r ? toAccount(r) : null;
  }

  touchLogin(id: number, t: number): void {
    this.run('UPDATE accounts SET last_login = ? WHERE id = ?', t, id);
  }

  /** Ban an account and end all its sessions. */
  banAccount(id: number, reason: string, now: number): void {
    this.run('UPDATE accounts SET banned_at = ?, ban_reason = ? WHERE id = ?', now, reason, id);
    this.run('DELETE FROM sessions WHERE account_id = ?', id);
  }

  unbanAccount(id: number): void {
    this.run('UPDATE accounts SET banned_at = NULL, ban_reason = NULL WHERE id = ?', id);
  }

  setStaffRole(id: number, role: StaffRole | null): void {
    this.run('UPDATE accounts SET staff_role = ? WHERE id = ?', role, id);
  }

  // ---- sessions ----------------------------------------------------------------------------------

  insertSession(tokenHash: string, accountId: number, createdAt: number, expiresAt: number): void {
    this.run('INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)', tokenHash, accountId, createdAt, expiresAt);
  }

  /** The account a live session belongs to, with the session's own times. A banned account is returned too: the caller decides what to answer. */
  getSessionAccount(tokenHash: string, now: number): { account: AccountRow; createdAt: number; expiresAt: number } | null {
    const r = this.get(
      'SELECT a.*, s.created_at AS s_created, s.expires_at AS s_expires FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?',
      tokenHash,
      now,
    );
    return r ? { account: toAccount(r), createdAt: r.s_created as number, expiresAt: r.s_expires as number } : null;
  }

  setSessionExpiry(tokenHash: string, expiresAt: number): void {
    this.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', expiresAt, tokenHash);
  }

  /** Keep only the newest `keep` sessions of an account (by creation time); the rest end. */
  trimSessions(accountId: number, keep: number): void {
    this.run(
      'DELETE FROM sessions WHERE account_id = ? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE account_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)',
      accountId,
      accountId,
      keep,
    );
  }

  // ---- sign-in failures (progressive lockout) -----------------------------------------------------

  getLoginFailure(name: string): { fails: number; lastFail: number; lockedUntil: number } | null {
    const r = this.get('SELECT fails, last_fail, locked_until FROM login_failures WHERE name = ?', name);
    return r ? { fails: r.fails as number, lastFail: r.last_fail as number, lockedUntil: r.locked_until as number } : null;
  }

  setLoginFailure(name: string, fails: number, lastFail: number, lockedUntil: number): void {
    this.run(
      'INSERT INTO login_failures (name, fails, last_fail, locked_until) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET fails = excluded.fails, last_fail = excluded.last_fail, locked_until = excluded.locked_until',
      name,
      fails,
      lastFail,
      lockedUntil,
    );
  }

  clearLoginFailure(name: string): void {
    this.run('DELETE FROM login_failures WHERE name = ?', name);
  }

  /** Forget failure records that no longer count (last failure older than `before`). */
  pruneLoginFailures(before: number): void {
    this.run('DELETE FROM login_failures WHERE last_fail < ? AND locked_until < ?', before, before);
  }

  setPasswordHash(id: number, hash: string): void {
    this.run('UPDATE accounts SET password_hash = ? WHERE id = ?', hash, id);
  }

  deleteSession(tokenHash: string): void {
    this.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
  }

  deleteSessionsOf(accountId: number): void {
    this.run('DELETE FROM sessions WHERE account_id = ?', accountId);
  }

  deleteExpiredSessions(now: number): void {
    this.run('DELETE FROM sessions WHERE expires_at <= ?', now);
  }

  /** Number of sessions an account has (tests and the CLI). */
  sessionCount(accountId: number): number {
    return Number(this.get('SELECT COUNT(*) AS n FROM sessions WHERE account_id = ?', accountId)?.n ?? 0);
  }

  // ---- multi-account detection (moved here from the worlds) --------------------------------------

  /** Remember that this account was seen on this IP. */
  recordIp(accountId: number, ip: string, now: number): void {
    this.run(
      'INSERT INTO account_ips (account_id, ip, first_seen, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, ip) DO UPDATE SET last_seen = excluded.last_seen',
      accountId,
      ip,
      now,
      now,
    );
  }

  /** How many accounts that are not banned have been seen on this IP. */
  countActiveAccountsOnIp(ip: string): number {
    const r = this.get('SELECT COUNT(DISTINCT i.account_id) AS n FROM account_ips i JOIN accounts a ON a.id = i.account_id WHERE i.ip = ? AND a.banned_at IS NULL', ip);
    return Number(r?.n ?? 0);
  }

  /** IPs used by two or more accounts, with the accounts on each (for review and banning). */
  sharedIpGroups(): SharedIpGroup[] {
    const rows = this.all(
      `SELECT i.ip AS ip, a.id AS id, a.username AS username, a.banned_at AS banned_at
         FROM account_ips i JOIN accounts a ON a.id = i.account_id
        WHERE i.ip IN (SELECT ip FROM account_ips GROUP BY ip HAVING COUNT(*) > 1)
        ORDER BY i.ip, a.id`,
    );
    const groups = new Map<string, SharedIpGroup>();
    for (const r of rows) {
      const ip = r.ip as string;
      const g = groups.get(ip) ?? { ip, accounts: [] };
      g.accounts.push({ id: r.id as number, username: r.username as string, bannedAt: (r.banned_at as number | null) ?? null });
      groups.set(ip, g);
    }
    return [...groups.values()];
  }

  // ---- worlds ------------------------------------------------------------------------------------

  listWorlds(): WorldRow[] {
    return this.all('SELECT * FROM worlds ORDER BY sort_order, id').map(toWorld);
  }

  getWorld(id: string): WorldRow | null {
    const r = this.get('SELECT * FROM worlds WHERE id = ?', id);
    return r ? toWorld(r) : null;
  }

  countWorlds(): number {
    return Number(this.get('SELECT COUNT(*) AS n FROM worlds')?.n ?? 0);
  }

  /** Adds a world after the last one (sort_order = highest + 10). */
  insertWorld(w: { id: string; name: string; status: WorldStatus; path: string; createdAt: number }): void {
    const max = Number(this.get('SELECT COALESCE(MAX(sort_order), 0) AS m FROM worlds')?.m ?? 0);
    this.run('INSERT INTO worlds (id, name, status, path, created_at, sort_order) VALUES (?, ?, ?, ?, ?, ?)', w.id, w.name, w.status, w.path, w.createdAt, max + 10);
  }

  setWorldStatus(id: string, status: WorldStatus): void {
    this.run('UPDATE worlds SET status = ? WHERE id = ?', status, id);
  }

  renameWorld(id: string, name: string): void {
    this.run('UPDATE worlds SET name = ? WHERE id = ?', name, id);
  }

  removeWorld(id: string): void {
    this.run('DELETE FROM worlds WHERE id = ?', id);
  }

  // ---- badges and Hall of Fame ---------------------------------------------------------------------

  hasHallOfFame(worldId: string): boolean {
    return this.get('SELECT 1 AS x FROM hall_of_fame WHERE world_id = ?', worldId) !== undefined;
  }

  /** True when the row was new (an existing world_id is left alone). */
  insertHallOfFame(h: HallOfFameRow): boolean {
    return (
      this.run(
        'INSERT OR IGNORE INTO hall_of_fame (world_id, world_name, ended_at, kind, winner_name, winner_tag, top_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        h.worldId,
        h.worldName,
        h.endedAt,
        h.kind,
        h.winnerName,
        h.winnerTag,
        h.topJson,
      ).changes > 0
    );
  }

  /** Newest end first. */
  listHallOfFame(limit: number): HallOfFameRow[] {
    return this.all('SELECT * FROM hall_of_fame ORDER BY ended_at DESC, world_id LIMIT ?', limit).map((r) => ({
      worldId: r.world_id as string,
      worldName: r.world_name as string,
      endedAt: r.ended_at as number,
      kind: r.kind as WorldEndKind,
      winnerName: (r.winner_name as string | null) ?? null,
      winnerTag: (r.winner_tag as string | null) ?? null,
      topJson: r.top_json as string,
    }));
  }

  /** True when the badge was new (an existing one is left alone). */
  insertAccountBadge(accountId: number, worldId: string, badge: BadgeKind, place: number | null, endedAt: number): boolean {
    return this.run('INSERT OR IGNORE INTO account_badges (account_id, world_id, badge, place, ended_at) VALUES (?, ?, ?, ?, ?)', accountId, worldId, badge, place, endedAt).changes > 0;
  }

  deleteAccountBadge(accountId: number, worldId: string, badge: BadgeKind): boolean {
    return this.run('DELETE FROM account_badges WHERE account_id = ? AND world_id = ? AND badge = ?', accountId, worldId, badge).changes > 0;
  }

  accountExists(id: number): boolean {
    return this.get('SELECT 1 AS x FROM accounts WHERE id = ?', id) !== undefined;
  }

  /** The account's badges, newest world first (world name from the Hall of Fame, else the world list, else the id). */
  accountBadges(accountId: number): AccountBadgeDto[] {
    const rows = this.all(
      `SELECT b.world_id, b.badge, b.place, b.ended_at, COALESCE(h.world_name, w.name, b.world_id) AS world_name
         FROM account_badges b
         LEFT JOIN hall_of_fame h ON h.world_id = b.world_id
         LEFT JOIN worlds w ON w.id = b.world_id
        WHERE b.account_id = ?
        ORDER BY b.ended_at DESC, b.world_id`,
      accountId,
    );
    const out: AccountBadgeDto[] = [];
    for (const r of rows) {
      if (!isBadgeKind(r.badge)) continue;
      out.push({ worldId: r.world_id as string, worldName: r.world_name as string, badge: r.badge, place: (r.place as number | null) ?? null, endedAt: r.ended_at as number });
    }
    // Within one world: BADGE_KINDS order (stable sort keeps the world order).
    return out.sort((a, b) => b.endedAt - a.endedAt || (a.worldId < b.worldId ? -1 : a.worldId > b.worldId ? 1 : 0) || BADGE_KINDS.indexOf(a.badge) - BADGE_KINDS.indexOf(b.badge));
  }

  // ---- audit log ---------------------------------------------------------------------------------

  /** Append a row to the audit log (never put secrets in `detail`). */
  audit(e: NewAudit): void {
    this.run(
      'INSERT INTO audit_log (at, actor_id, actor_ip, action, target_account, detail) VALUES (?, ?, ?, ?, ?, ?)',
      e.at,
      e.actorId,
      e.actorIp,
      e.action,
      e.targetAccount,
      (e.detail ?? '').slice(0, 500),
    );
  }

  /** Newest audit rows first (tests and the CLI). */
  auditRows(limit = 100): { id: number; at: number; actorId: number | null; actorIp: string | null; action: string; targetAccount: number | null; detail: string }[] {
    return this.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', limit).map((r) => ({
      id: r.id as number,
      at: r.at as number,
      actorId: (r.actor_id as number | null) ?? null,
      actorIp: (r.actor_ip as string | null) ?? null,
      action: r.action as string,
      targetAccount: (r.target_account as number | null) ?? null,
      detail: r.detail as string,
    }));
  }
}
