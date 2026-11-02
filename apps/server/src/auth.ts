// Passwords (scrypt), sessions (random token, only its SHA-256 stored) and rate limiting.

import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import {
  DEFAULT_CHIEFTAIN,
  GameError,
  createPlayerVillage,
  findSpawnLocation,
  mulberry32,
  protectionEndsAt,
  villagePoints,
  type PlayerDto,
  type WorldSettings,
} from '@clanfire/engine';
import type { PlayerRow, Store } from './store.ts';

export const SESSION_COOKIE = 'tw_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const USERNAME_PATTERN = '^[A-Za-z0-9_]{3,20}$';
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LEN = 64;

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
  player: PlayerRow;
  token: string;
  expiresAt: number;
}

export class AuthService {
  constructor(
    private readonly store: Store,
    private readonly settings: WorldSettings,
    private readonly now: () => number,
  ) {}

  toDto(p: PlayerRow): PlayerDto {
    return { id: p.id, username: p.username, protectedUntil: p.protectedUntil, tribe: this.store.tribes.playerTribe(p.id), chieftain: p.chieftain };
  }

  /** Create a player and their first village atomically, then sign them in. */
  async register(username: string, password: string, chieftain: string = DEFAULT_CHIEFTAIN): Promise<SessionGrant> {
    const hash = await hashPassword(password);
    try {
      return this.store.tx(() => {
        if (this.store.getPlayerByLowerName(username.toLowerCase())) {
          throw new GameError('username_taken', 'That username is already taken.');
        }
        const t = this.now();
        const playerId = this.store.insertPlayer(username, hash, t, protectionEndsAt(t, this.settings), chieftain);
        let spot;
        try {
          spot = findSpawnLocation((x, y) => this.store.villageExistsAt(x, y), mulberry32(randomInt(0, 0xffffffff)), this.settings);
        } catch (err) {
          if (err instanceof GameError && err.code === 'not_found') throw new GameError('forbidden', 'This world is full.');
          throw err;
        }
        const state = createPlayerVillage(t);
        this.store.insertVillage(playerId, `${username}'s village`, spot.x, spot.y, villagePoints(state), state);
        const player = this.store.getPlayer(playerId);
        if (!player) throw new Error('player vanished after insert');
        return this.openSession(player, t);
      });
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed: players\.username_lower/.test(err.message)) {
        throw new GameError('username_taken', 'That username is already taken.');
      }
      throw err;
    }
  }

  async login(username: string, password: string): Promise<SessionGrant> {
    const player = this.store.getPlayerByLowerName(username.toLowerCase());
    const ok = player ? await verifyPassword(password, player.passwordHash) : (await burnVerify(password), false);
    if (!player || !ok) throw new GameError('unauthorized', 'Wrong username or password.');
    return this.store.tx(() => this.openSession(player, this.now()));
  }

  /** Change the player's chieftain portrait and return the updated row. */
  setChieftain(player: PlayerRow, chieftain: string): PlayerRow {
    this.store.setChieftain(player.id, chieftain);
    return this.store.getPlayer(player.id) ?? { ...player, chieftain };
  }

  logout(token: string | undefined): void {
    if (token && TOKEN_RE.test(token)) this.store.deleteSession(sha256Hex(token));
  }

  /** The player a session cookie value belongs to, or null (unknown, malformed or expired). */
  authenticate(token: string | undefined): PlayerRow | null {
    if (!token || !TOKEN_RE.test(token)) return null;
    return this.store.getSessionPlayer(sha256Hex(token), this.now());
  }

  private openSession(player: PlayerRow, t: number): SessionGrant {
    this.store.deleteExpiredSessions(t);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = t + SESSION_TTL_MS;
    this.store.insertSession(sha256Hex(token), player.id, t, expiresAt);
    return { player, token, expiresAt };
  }
}
