// Lobby configuration from environment variables. Fails fast on malformed values.
// The parsing helpers are copies of apps/server/src/env.ts: keep in sync.

import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import type { KeyObject } from 'node:crypto';
import { parseSigningKey } from './pass.ts';

export interface LobbyEnv {
  port: number;
  host: string;
  databasePath: string;
  nodeEnv: string;
  isProduction: boolean;
  /** Trust X-Forwarded-* headers: false, true, a hop count (>= 2) or an IP/CIDR list (only enable behind a reverse proxy you control). */
  trustProxy: boolean | number | string;
  /** Extra full origins (scheme://host[:port]) accepted on writes besides the Host-matching one (ALLOWED_ORIGINS, comma list). */
  allowedOrigins: string[];
  /** Most active accounts per IP at registration (MAX_ACCOUNTS_PER_IP). Default 3 in production, 0 (off) otherwise. */
  maxAccountsPerIp: number;
  /** Ed25519 private key that signs entry passes (LOBBY_SIGNING_KEY). Secret: never log it. */
  signingKey: KeyObject;
}

type Env = Record<string, string | undefined>;

function num(env: Env, name: string, check: (n: number) => boolean, what: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !check(n)) throw new Error(`Invalid ${name}="${raw}": expected ${what}.`);
  return n;
}

export function parseTrustProxy(raw: string | undefined): boolean | number | string {
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

export function parseAllowedOrigins(raw: string | undefined): string[] {
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

/** Load apps/lobby/.env if it exists (path relative to this package, not the cwd). Real environment variables win. */
export function loadDotEnv(): void {
  const file = new URL('../.env', import.meta.url);
  if (existsSync(file)) process.loadEnvFile(file);
}

/** DATABASE_PATH alone, for the CLI tools that must work without a signing key (admin, backup, import). */
export function databasePathOf(env: Env = process.env): string {
  return env.DATABASE_PATH?.trim() || './data/lobby.sqlite';
}

export function loadEnv(env: Env = process.env): LobbyEnv {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const rawKey = env.LOBBY_SIGNING_KEY?.trim();
  if (!rawKey) {
    throw new Error('LOBBY_SIGNING_KEY is required (base64 PKCS#8 DER Ed25519 private key). Create one with: npm run lobby:admin -- keygen');
  }
  return {
    port: num(env, 'PORT', (n) => Number.isInteger(n) && n >= 0 && n <= 65535, 'a port number') ?? 3001,
    host: env.HOST?.trim() || '0.0.0.0',
    databasePath: databasePathOf(env),
    nodeEnv,
    isProduction: nodeEnv === 'production',
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    maxAccountsPerIp: num(env, 'MAX_ACCOUNTS_PER_IP', (n) => Number.isInteger(n) && n >= 0 && n <= 1000, 'an integer from 0 to 1000') ?? (nodeEnv === 'production' ? 3 : 0),
    signingKey: parseSigningKey(rawKey),
  };
}
