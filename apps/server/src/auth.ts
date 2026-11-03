// Passwords (scrypt), sessions (random token, only its SHA-256 stored) and rate limiting.

import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import {
  DEFAULT_CHIEFTAIN,
  GameError,
  createNpcVillage,
  createPlayerVillage,
  findExpandingSpawn,
  findSpawnLocation,
  generateNpcsForSpawn,
  mulberry32,
  protectionEndsAt,
  villagePoints,
  abandonIdleDays,
  type AbandonedNoticeDto,
  type PlayerDto,
  type WorldSettings,
} from '@clanfire/engine';
import type { PlayerRow, Store } from './store.ts';
import { NPC_VILLAGE_NAME } from './world.ts';

/** The "your villages were abandoned" news for the player DTO, or null when there is none. */
export function abandonedNoticeOf(p: PlayerRow, s: WorldSettings): AbandonedNoticeDto | null {
  return p.abandonedNotice > 0 ? { villages: p.abandonedNotice, idleDays: abandonIdleDays(s) } : null;
}

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
    /** Most active accounts allowed per IP at registration; 0 = no limit (multi-account guard off). */
    private readonly maxAccountsPerIp = 0,
  ) {}

  toDto(p: PlayerRow): PlayerDto {
    return { id: p.id, username: p.username, protectedUntil: p.protectedUntil, tribe: this.store.tribes.playerTribe(p.id), chieftain: p.chieftain, premium: p.premium, householdShared: p.householdShared, abandonedNotice: abandonedNoticeOf(p, this.settings), sandbox: this.store.isSandboxUser(p.username), staffRole: p.staffRole };
  }

  /** The player has read the "villages abandoned" news: clear it and return the updated row. */
  dismissAbandonedNotice(player: PlayerRow): PlayerRow {
    this.store.clearAbandonedNotice(player.id);
    return this.store.getPlayer(player.id) ?? { ...player, abandonedNotice: 0 };
  }

  /** Settings: report (or withdraw the report) that others play from the same household. */
  setHouseholdShared(player: PlayerRow, shared: boolean): PlayerRow {
    this.store.setHouseholdShared(player.id, shared);
    return this.store.getPlayer(player.id) ?? { ...player, householdShared: shared };
  }

  /** Create a player and their first village atomically, then sign them in. */
  async register(username: string, password: string, chieftain: string = DEFAULT_CHIEFTAIN, ip?: string): Promise<SessionGrant> {
    const hash = await hashPassword(password);
    try {
      return this.store.tx(() => {
        if (this.store.getPlayerByLowerName(username.toLowerCase())) {
          throw new GameError('username_taken', 'That username is already taken.');
        }
        if (ip && this.maxAccountsPerIp > 0 && this.store.countActiveAccountsOnIp(ip) >= this.maxAccountsPerIp) {
          throw new GameError('forbidden', 'Only one account per player is allowed. This connection already has an account.');
        }
        const t = this.now();
        const playerId = this.store.insertPlayer(username, hash, t, protectionEndsAt(t, this.settings), chieftain);
        try {
          this.spawnVillage(playerId, `${username}'s village`, t);
        } catch (err) {
          if (err instanceof GameError && err.code === 'not_found') throw new GameError('forbidden', 'This world is full.');
          throw err;
        }
        const player = this.store.getPlayer(playerId);
        if (!player) throw new Error('player vanished after insert');
        if (ip) this.store.recordIp(player.id, ip, t);
        this.store.audit({ at: t, actorId: player.id, actorIp: ip ?? null, action: 'register', targetPlayer: player.id });
        return this.openSession(player, t);
      });
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed: players\.username_lower/.test(err.message)) {
        throw new GameError('username_taken', 'That username is already taken.');
      }
      throw err;
    }
  }

  async login(username: string, password: string, ip?: string): Promise<SessionGrant> {
    const player = this.store.getPlayerByLowerName(username.toLowerCase());
    const ok = player ? await verifyPassword(password, player.passwordHash) : (await burnVerify(password), false);
    if (!player || !ok) throw new GameError('unauthorized', 'Wrong username or password.');
    // Only after the password matched, so a ban never reveals whether a name exists.
    if (player.bannedAt !== null) {
      this.store.audit({ at: this.now(), actorId: player.id, actorIp: ip ?? null, action: 'login_blocked_banned', targetPlayer: player.id });
      throw new GameError('forbidden', 'This account has been suspended.');
    }
    return this.store.tx(() => {
      const t = this.now();
      if (ip) this.store.recordIp(player.id, ip, t);
      this.store.audit({ at: t, actorId: player.id, actorIp: ip ?? null, action: 'login', targetPlayer: player.id });
      this.store.touchActive(player.id, t, 0);
      this.ensureVillage(player);
      return this.openSession(player, t);
    });
  }

  /** A returning player whose villages were abandoned after a long absence starts over with a fresh village (new beginner protection). */
  ensureVillage(player: PlayerRow): void {
    if (this.store.villagesOfPlayer(player.id).length > 0) return;
    this.store.tx(() => {
      const t = this.now();
      this.spawnVillage(player.id, `${player.username}'s village`, t);
      this.store.setProtectedUntil(player.id, protectionEndsAt(t, this.settings));
    });
  }

  /**
   * Place a new player village. In the 'expanding' layout it lands at the edge of the growing populated disc and
   * brings abandoned villages around it (a fixed few plus a chance of more); otherwise it lands anywhere free.
   */
  private spawnVillage(playerId: number, name: string, t: number): void {
    const occupied = (x: number, y: number): boolean => this.store.villageExistsAt(x, y);
    const rng = mulberry32(randomInt(0, 0xffffffff));
    const expanding = this.settings.layout === 'expanding';
    const spot = expanding
      ? findExpandingSpawn(occupied, rng, this.settings, this.store.playerVillageCount())
      : findSpawnLocation(occupied, rng, this.settings);
    const state = createPlayerVillage(t);
    this.store.insertVillage(playerId, name, spot.x, spot.y, villagePoints(state), state);
    if (!expanding) return;
    for (const p of generateNpcsForSpawn(spot, occupied, rng, this.settings)) {
      const npc = createNpcVillage(p.tier, t, randomInt(0, 0xffffffff));
      this.store.insertVillage(null, NPC_VILLAGE_NAME, p.x, p.y, villagePoints(npc), npc);
    }
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
