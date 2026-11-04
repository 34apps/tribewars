// All lobby SQL. Prepared statements with bound parameters only.

import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { isStaffRole, type StaffRole, type WorldStatus } from '@clanfire/engine';

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

  /** The account a live session belongs to. A banned account is returned too: the caller decides what to answer. */
  getSessionAccount(tokenHash: string, now: number): AccountRow | null {
    const r = this.get('SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?', tokenHash, now);
    return r ? toAccount(r) : null;
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
