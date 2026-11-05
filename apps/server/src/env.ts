// Server configuration from environment variables. Fails fast on malformed values.

import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { DEFAULT_WORLD_ID, checkWorldConfigInput, type WorldSettings } from '@clanfire/engine';
import { parsePublicKeys } from './entry-pass.ts';
import { checkWorldId, checkWorldName } from './world-path.ts';

export interface ServerEnv {
  port: number;
  host: string;
  databasePath: string;
  /** This process's world (WORLD_ID, default w1): answers under /w/<id>/api as well as /api. Letters, digits, dashes; the server refuses to start otherwise. */
  worldId: string;
  /** Display name shown in world info (WORLD_NAME, default "World <id>"). */
  worldName: string;
  nodeEnv: string;
  isProduction: boolean;
  /** Trust X-Forwarded-* headers: false, true, a hop count (>= 2) or an IP/CIDR list (only enable behind a reverse proxy you control). */
  trustProxy: boolean | number | string;
  /** Extra full origins (scheme://host[:port]) accepted on writes besides the Host-matching one (ALLOWED_ORIGINS, comma list). */
  allowedOrigins: string[];
  /** Most active accounts per IP at registration (MAX_ACCOUNTS_PER_IP). Default 3 in production (households may share; troops between them are blocked), 0 (off) in development. */
  maxAccountsPerIp: number;
  /** World settings given in the environment. Only used when a new world is created. */
  worldOverrides: Partial<WorldSettings>;
  /** WORLD_CONFIG: a JSON object with some per-world rules, e.g. {"conquest":{"holdHours":4},"pace":{"unitSpeed":2}}. Only used when a new world is created. */
  worldConfig?: Record<string, unknown>;
  /** Anthropic key for Mags's advisor; null = advisor off. Only set when ADVISOR_ENABLED=true (owner: no AI spend by default). Secret: never log it. */
  anthropicApiKey: string | null;
  /** Lowercase usernames allowed to use sandbox/test mode (SANDBOX_USERS, comma list; default metinaltinbas outside production, empty in production; empty = nobody). */
  sandboxUsers: string[];
  /**
   * LOBBY_PUBLIC_KEY: the lobby's Ed25519 public key(s), comma list of base64 SPKI DER or PEM. Set = this world only accepts
   * entry passes from the lobby (its own register/login are off). null = no lobby (empty/unset). Validated at start;
   * the value is a public key, but errors never print it.
   */
  lobbyPublicKeys: string | null;
}

type Env = Record<string, string | undefined>;

function num(env: Env, name: string, check: (n: number) => boolean, what: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !check(n)) throw new Error(`Invalid ${name}="${raw}": expected ${what}.`);
  return n;
}

function parseTrustProxy(raw: string | undefined): boolean | number | string {
  const v = (raw ?? '').trim();
  if (v === '' || /^(0|false|no)$/i.test(v)) return false;
  if (/^(1|true|yes)$/i.test(v)) return true;
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    if (Number.isSafeInteger(n) && n >= 2 && n <= 100) return n;
  } else if (/[.:]/.test(v)) {
    const parts = v.split(',').map((x) => x.trim());
    const isAddr = (x: string): boolean => {
      const [ip, prefix, ...extra] = x.split('/');
      if (extra.length > 0 || isIP(ip ?? '') === 0) return false;
      return prefix === undefined || (/^\d{1,3}$/.test(prefix) && Number(prefix) <= (isIP(ip!) === 4 ? 32 : 128));
    };
    if (parts.every(isAddr)) return parts.join(',');
  }
  throw new Error(`Invalid TRUST_PROXY="${raw}": expected true/false, a hop count >= 2, or a comma list of IPs/CIDRs.`);
}

function parseAllowedOrigins(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? '').split(',')) {
    const item = part.trim();
    if (item === '') continue;
    let url: URL;
    try {
      url = new URL(item);
    } catch {
      throw new Error(`Invalid ALLOWED_ORIGINS entry "${item}": not a valid URL.`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Invalid ALLOWED_ORIGINS entry "${item}": must be http or https.`);
    if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash || url.username || url.password) {
      throw new Error(`Invalid ALLOWED_ORIGINS entry "${item}": give only scheme://host[:port], no path.`);
    }
    const origin = url.origin.toLowerCase();
    if (!out.includes(origin)) out.push(origin);
  }
  return out;
}

/** WORLD_CONFIG: JSON object with some per-world rules. Unset/empty = none. Bad JSON or a bad value stops the server from starting. */
function parseWorldConfigEnv(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid WORLD_CONFIG: not valid JSON (expected an object such as {"conquest":{"holdHours":4}}).');
  }
  const check = checkWorldConfigInput(parsed);
  if (!check.ok) throw new Error(`Invalid WORLD_CONFIG: ${check.message}`);
  return parsed as Record<string, unknown>;
}

/** Load apps/server/.env if it exists (path relative to this package, not the cwd). Real environment variables win. */
export function loadDotEnv(): void {
  const file = new URL('../.env', import.meta.url);
  if (existsSync(file)) process.loadEnvFile(file);
}

export function loadEnv(env: Env = process.env): ServerEnv {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const worldOverrides: Partial<WorldSettings> = {};

  const speed = num(env, 'WORLD_SPEED', (n) => n > 0 && n <= 10_000, 'a number > 0');
  const seed = num(env, 'WORLD_SEED', Number.isSafeInteger, 'an integer');
  const radius = num(env, 'WORLD_RADIUS', (n) => Number.isInteger(n) && n >= 5 && n <= 1000, 'an integer from 5 to 1000');
  if (speed !== undefined) worldOverrides.speed = speed;
  if (seed !== undefined) worldOverrides.seed = seed;
  if (radius !== undefined) worldOverrides.radius = radius;
  const layout = env.WORLD_LAYOUT?.trim();
  if (layout) {
    if (layout !== 'scattered' && layout !== 'expanding') throw new Error(`Invalid WORLD_LAYOUT="${layout}": expected scattered or expanding.`);
    worldOverrides.layout = layout;
  }

  const worldConfig = parseWorldConfigEnv(env.WORLD_CONFIG);

  const worldId = checkWorldId(env.WORLD_ID?.trim() || DEFAULT_WORLD_ID);
  const worldName = checkWorldName(env.WORLD_NAME?.trim() || `World ${worldId}`);

  const lobbyRaw = env.LOBBY_PUBLIC_KEY?.trim() ?? '';
  // Fail fast on a malformed key; a list with only empty entries ("," or ", ,") counts as a mistake, not "off".
  if (lobbyRaw !== '' && parsePublicKeys(lobbyRaw).length === 0) throw new Error('Invalid LOBBY_PUBLIC_KEY: no key found in the list.');

  return {
    port: num(env, 'PORT', (n) => Number.isInteger(n) && n >= 0 && n <= 65535, 'a port number') ?? 3000,
    host: env.HOST?.trim() || '0.0.0.0',
    databasePath: env.DATABASE_PATH?.trim() || './data/clanfire.sqlite',
    worldId,
    worldName,
    nodeEnv,
    isProduction: nodeEnv === 'production',
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    maxAccountsPerIp: num(env, 'MAX_ACCOUNTS_PER_IP', (n) => Number.isInteger(n) && n >= 0 && n <= 1000, 'an integer from 0 to 1000') ?? (nodeEnv === 'production' ? 3 : 0),
    worldOverrides,
    ...(worldConfig ? { worldConfig } : {}),
    sandboxUsers: (env.SANDBOX_USERS ?? (nodeEnv === 'production' ? '' : 'metinaltinbas'))
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s !== ''),
    anthropicApiKey: /^(1|true|yes)$/i.test(env.ADVISOR_ENABLED ?? '') ? env.ANTHROPIC_API_KEY?.trim() || null : null,
    lobbyPublicKeys: lobbyRaw === '' ? null : lobbyRaw,
  };
}
