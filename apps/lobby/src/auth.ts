// Passwords (scrypt), sessions (random token, only its SHA-256 stored) and rate limiting.
// The helpers up to AuthService are copies of apps/server/src/auth.ts: keep in sync (hashes must stay interchangeable with the worlds').

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DEFAULT_CHIEFTAIN, GameError, type LobbyAccountDto } from '@clanfire/engine';
import { commonPasswords } from './common-passwords.ts';
import type { AccountRow, Store } from './store.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A session ends after this long without use (every use moves the end forward)... */
export const SESSION_IDLE_MS = 14 * DAY_MS;
/** ...and never lives longer than this from sign-in, however busy. The cookie lives as long, the server enforces both. */
export const SESSION_ABSOLUTE_MS = 60 * DAY_MS;
/** Most sessions one account keeps; a new sign-in beyond that ends the oldest. */
export const SESSION_MAX_PER_ACCOUNT = 10;
/** The idle end is only rewritten when it moves by at least this much (one database write per hour of use at most). */
export const SESSION_SLIDE_STEP_MS = 60 * 60 * 1000;

export const USERNAME_PATTERN = '^[A-Za-z0-9_]{3,20}$';
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** Why a new password is refused, in words for the player; null when it is fine. */
export function passwordProblem(password: string, username: string): string | null {
  if (password.length < PASSWORD_MIN) return `Your password must be at least ${PASSWORD_MIN} characters long.`;
  if (password.length > PASSWORD_MAX) return `Your password can be at most ${PASSWORD_MAX} characters long.`;
  const lower = password.toLowerCase();
  if (username !== '' && lower.includes(username.toLowerCase())) return 'Your password must not contain your username.';
  if (commonPasswords().has(lower)) return 'That password is among the most common ones and easy to guess. Choose a different one.';
  return null;
}

/** Sign-in lockout: the 3rd failed attempt for a name locks it for 30 s, each further failure doubles that, up to 15 minutes. */
export const LOCKOUT_FREE_FAILS = 2;
export const LOCKOUT_BASE_MS = 30_000;
export const LOCKOUT_MAX_MS = 15 * 60_000;
/** Failures older than this are forgotten. */
export const LOCKOUT_FORGET_MS = DAY_MS;
export function lockoutDelayMs(fails: number): number {
  if (fails <= LOCKOUT_FREE_FAILS) return 0;
  return Math.min(LOCKOUT_BASE_MS * 2 ** (fails - LOCKOUT_FREE_FAILS - 1), LOCKOUT_MAX_MS);
}
/** One message for a wrong password, an unknown name and a locked name: the answer never tells which it was. */
export const LOGIN_FAILED_MESSAGE = 'Wrong username or password, or too many failed attempts for this name. Wait a few minutes and try again.';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LEN = 64;

/** Format: `scrypt$<salt hex>$<hash hex>` (16-byte salt, 64-byte key). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1] ?? '', 'hex');
  const expected = Buffer.from(parts[2] ?? '', 'hex');
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = await scryptAsync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | null = null;
/** Verify against a throwaway hash so unknown usernames cost the same time as wrong passwords. */
async function burnVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Fixed-window per-key counter, in memory. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit = 10,
    private readonly windowMs = 60_000,
    private readonly maxKeys = 10_000,
  ) {}

  /** Count one attempt; false when the key is over its limit. */
  allow(key: string, now: number): boolean {
    let e = this.hits.get(key);
    if (!e || e.resetAt <= now) {
      if (this.hits.size >= this.maxKeys) this.sweep(now);
      e = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, e);
    }
    e.count += 1;
    return e.count <= this.limit;
  }

  private sweep(now: number): void {
    for (const [k, e] of this.hits) if (e.resetAt <= now) this.hits.delete(k);
    // Still full (a flood of distinct keys): drop the oldest entries.
    for (const k of this.hits.keys()) {
      if (this.hits.size < this.maxKeys) break;
      this.hits.delete(k);
    }
  }
}

export interface SessionGrant {
  account: AccountRow;
  token: string;
  expiresAt: number;
}

export const IP_GUARD_MESSAGE = 'Only one account per player is allowed. This connection already has an account.';

export class AuthService {
  constructor(
    private readonly store: Store,
    private readonly now: () => number,
    /** Most active accounts allowed per IP at registration; 0 = no limit (multi-account guard off). */
    private readonly maxAccountsPerIp = 0,
    /** Owner switch: a correct but weak (old-policy) password must be replaced at the next sign-in. Default off. */
    private readonly requirePasswordUpgrade = false,
  ) {}

  toDto(a: AccountRow): LobbyAccountDto {
    return { id: a.id, username: a.username, chieftain: a.chieftain, staffRole: a.staffRole, badges: this.store.accountBadges(a.id) };
  }

  /** Create an account, then sign it in. */
  async register(username: string, password: string, chieftain: string = DEFAULT_CHIEFTAIN, ip?: string): Promise<SessionGrant> {
    const problem = passwordProblem(password, username);
    if (problem) throw new GameError('invalid_input', problem);
    const hash = await hashPassword(password);
    try {
      return this.store.tx(() => {
        if (this.store.getAccountByLowerName(username.toLowerCase())) {
          throw new GameError('username_taken', 'That username is already taken.');
        }
        if (ip && this.maxAccountsPerIp > 0 && this.store.countActiveAccountsOnIp(ip) >= this.maxAccountsPerIp) {
          throw new GameError('forbidden', IP_GUARD_MESSAGE);
        }
        const t = this.now();
        const id = this.store.insertAccount({ username, passwordHash: hash, chieftain, createdAt: t });
        const account = this.store.getAccount(id);
        if (!account) throw new Error('account vanished after insert');
        if (ip) this.store.recordIp(id, ip, t);
        this.store.touchLogin(id, t);
        this.store.audit({ at: t, actorId: id, actorIp: ip ?? null, action: 'register', targetAccount: id });
        return this.openSession(account, t);
      });
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed: accounts\.username_lower/.test(err.message)) {
        throw new GameError('username_taken', 'That username is already taken.');
      }
      throw err;
    }
  }

  /**
   * Check name + password with the progressive lockout. Same message, same work (one scrypt) for a wrong password, an
   * unknown name and a locked name, and failures are counted per submitted name whether or not it exists.
   */
  private async verifyCredentials(username: string, password: string): Promise<AccountRow> {
    const key = username.toLowerCase().slice(0, 64);
    const t = this.now();
    const record = this.store.getLoginFailure(key);
    const fails = record && t - record.lastFail < LOCKOUT_FORGET_MS ? record.fails : 0;
    const locked = record !== null && record.lockedUntil > t;
    const account = this.store.getAccountByLowerName(key);
    const ok = account && !locked ? await verifyPassword(password, account.passwordHash) : (await burnVerify(password), false);
    if (!account || !ok) {
      // Attempts while locked do not extend the lock (an attacker could otherwise keep a victim out for ever).
      if (!locked) {
        const n = fails + 1;
        this.store.tx(() => {
          this.store.pruneLoginFailures(t - LOCKOUT_FORGET_MS);
          this.store.setLoginFailure(key, n, t, t + lockoutDelayMs(n));
        });
      }
      throw new GameError('unauthorized', LOGIN_FAILED_MESSAGE);
    }
    if (record) this.store.clearLoginFailure(key);
    return account;
  }

  async login(username: string, password: string, ip?: string): Promise<SessionGrant> {
    const account = await this.verifyCredentials(username, password);
    // Only after the password matched, so a ban never reveals whether a name exists.
    if (account.bannedAt !== null) {
      this.store.audit({ at: this.now(), actorId: account.id, actorIp: ip ?? null, action: 'login_blocked_banned', targetAccount: account.id });
      throw new GameError('forbidden', 'This account has been suspended.');
    }
    if (this.requirePasswordUpgrade) {
      const problem = passwordProblem(password, account.username);
      if (problem) {
        this.store.audit({ at: this.now(), actorId: account.id, actorIp: ip ?? null, action: 'login_password_upgrade_required', targetAccount: account.id });
        throw new GameError('password_change_required', `Your password no longer meets our rules. ${problem} Choose a new one.`);
      }
    }
    return this.store.tx(() => {
      const t = this.now();
      if (ip) this.store.recordIp(account.id, ip, t);
      this.store.touchLogin(account.id, t);
      this.store.audit({ at: t, actorId: account.id, actorIp: ip ?? null, action: 'login', targetAccount: account.id });
      return this.openSession(account, t);
    });
  }

  /** Replace the password (current one checked like at sign-in), end every other session and sign in with a new one. */
  async changePassword(username: string, password: string, newPassword: string, ip?: string): Promise<SessionGrant> {
    const account = await this.verifyCredentials(username, password);
    if (account.bannedAt !== null) throw new GameError('forbidden', 'This account has been suspended.');
    const problem = passwordProblem(newPassword, account.username);
    if (problem) throw new GameError('invalid_input', problem);
    if (newPassword === password) throw new GameError('invalid_input', 'Choose a password that is different from your current one.');
    const hash = await hashPassword(newPassword);
    return this.store.tx(() => {
      const t = this.now();
      this.store.setPasswordHash(account.id, hash);
      this.store.deleteSessionsOf(account.id);
      if (ip) this.store.recordIp(account.id, ip, t);
      this.store.touchLogin(account.id, t);
      this.store.audit({ at: t, actorId: account.id, actorIp: ip ?? null, action: 'password_change', targetAccount: account.id });
      return this.openSession(account, t);
    });
  }

  /** End every lobby session of the account (worlds follow when their short lobby-linked sessions run out). */
  signOutEverywhere(account: AccountRow, ip?: string): void {
    this.store.tx(() => {
      this.store.deleteSessionsOf(account.id);
      this.store.audit({ at: this.now(), actorId: account.id, actorIp: ip ?? null, action: 'logout_all', targetAccount: account.id });
    });
  }

  logout(token: string | undefined): void {
    if (token && TOKEN_RE.test(token)) this.store.deleteSession(sha256Hex(token));
  }

  /** The account a session cookie value belongs to, even when banned (null: unknown, malformed or expired). */
  lookup(token: string | undefined): AccountRow | null {
    if (!token || !TOKEN_RE.test(token)) return null;
    const hash = sha256Hex(token);
    const t = this.now();
    const row = this.store.getSessionAccount(hash, t);
    if (!row) return null;
    // Idle expiry slides with use, but never past the absolute end.
    const end = Math.min(row.createdAt + SESSION_ABSOLUTE_MS, t + SESSION_IDLE_MS);
    if (end - row.expiresAt >= SESSION_SLIDE_STEP_MS) this.store.setSessionExpiry(hash, end);
    return row.account;
  }

  /** Like `lookup` but a banned account counts as signed out. */
  authenticate(token: string | undefined): AccountRow | null {
    const a = this.lookup(token);
    return a && a.bannedAt === null ? a : null;
  }

  private openSession(account: AccountRow, t: number): SessionGrant {
    this.store.deleteExpiredSessions(t);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = t + SESSION_IDLE_MS;
    this.store.insertSession(sha256Hex(token), account.id, t, expiresAt);
    this.store.trimSessions(account.id, SESSION_MAX_PER_ACCOUNT);
    return { account, token, expiresAt };
  }
}
