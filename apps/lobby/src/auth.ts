// Passwords (scrypt), sessions (random token, only its SHA-256 stored) and rate limiting.
// The helpers up to AuthService are copies of apps/server/src/auth.ts: keep in sync (hashes must stay interchangeable with the worlds').

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DEFAULT_CHIEFTAIN, GameError, type LobbyAccountDto } from '@clanfire/engine';
import type { AccountRow, Store } from './store.ts';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const USERNAME_PATTERN = '^[A-Za-z0-9_]{3,20}$';
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

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
  ) {}

  toDto(a: AccountRow): LobbyAccountDto {
    return { id: a.id, username: a.username, chieftain: a.chieftain, staffRole: a.staffRole };
  }

  /** Create an account, then sign it in. */
  async register(username: string, password: string, chieftain: string = DEFAULT_CHIEFTAIN, ip?: string): Promise<SessionGrant> {
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

  async login(username: string, password: string, ip?: string): Promise<SessionGrant> {
    const account = this.store.getAccountByLowerName(username.toLowerCase());
    const ok = account ? await verifyPassword(password, account.passwordHash) : (await burnVerify(password), false);
    if (!account || !ok) throw new GameError('unauthorized', 'Wrong username or password.');
    // Only after the password matched, so a ban never reveals whether a name exists.
    if (account.bannedAt !== null) {
      this.store.audit({ at: this.now(), actorId: account.id, actorIp: ip ?? null, action: 'login_blocked_banned', targetAccount: account.id });
      throw new GameError('forbidden', 'This account has been suspended.');
    }
    return this.store.tx(() => {
      const t = this.now();
      if (ip) this.store.recordIp(account.id, ip, t);
      this.store.touchLogin(account.id, t);
      this.store.audit({ at: t, actorId: account.id, actorIp: ip ?? null, action: 'login', targetAccount: account.id });
      return this.openSession(account, t);
    });
  }

  logout(token: string | undefined): void {
    if (token && TOKEN_RE.test(token)) this.store.deleteSession(sha256Hex(token));
  }

  /** The account a session cookie value belongs to, even when banned (null: unknown, malformed or expired). */
  lookup(token: string | undefined): AccountRow | null {
    if (!token || !TOKEN_RE.test(token)) return null;
    return this.store.getSessionAccount(sha256Hex(token), this.now());
  }

  /** Like `lookup` but a banned account counts as signed out. */
  authenticate(token: string | undefined): AccountRow | null {
    const a = this.lookup(token);
    return a && a.bannedAt === null ? a : null;
  }

  private openSession(account: AccountRow, t: number): SessionGrant {
    this.store.deleteExpiredSessions(t);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = t + SESSION_TTL_MS;
    this.store.insertSession(sha256Hex(token), account.id, t, expiresAt);
    return { account, token, expiresAt };
  }
}
