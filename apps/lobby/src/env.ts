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
  /** Ask for a new password at the next sign-in when the current one breaks the password rules (PASSWORD_UPGRADE_ON_LOGIN=1). Default off. */
  requirePasswordUpgrade: boolean;
  /** Ed25519 private key that signs entry passes (LOBBY_SIGNING_KEY). Secret: never log it. */
  signingKey: KeyObject;
  /** Template with `{id}` for a world's API base (WORLD_API_URL), used for lobby -> world commands. null = not configured (commands queue up). */
  worldApiUrl: string | null;
  /** Stripe secret key (STRIPE_SECRET_KEY) and webhook signing secret (STRIPE_WEBHOOK_SECRET); payments are on only when BOTH are set. Secrets: never log them. */
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  paymentsEnabled: boolean;
  /** Public address of the site, scheme://host (PUBLIC_URL): required when payments are on. */
  publicUrl: string | null;
  /** Let Stripe Tax add VAT (STRIPE_TAX=1). */
  stripeTax: boolean;
  /** Where the owner's alerts are POSTed as JSON (ALERT_WEBHOOK_URL), optional. */
  alertWebhookUrl: string | null;
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

/** PUBLIC_URL: scheme://host[:port] only. Returns the normalized origin. */
export function parsePublicUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('Invalid PUBLIC_URL: not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid PUBLIC_URL: must be http or https.');
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash || url.username || url.password) {
    throw new Error('Invalid PUBLIC_URL: give only scheme://host[:port], no path.');
  }
  return url.origin;
}

/** Stripe settings. Error messages never contain the key values. */
export function parseStripeEnv(env: Env): Pick<LobbyEnv, 'stripeSecretKey' | 'stripeWebhookSecret' | 'paymentsEnabled' | 'publicUrl' | 'stripeTax' | 'alertWebhookUrl'> {
  const key = env.STRIPE_SECRET_KEY?.trim() || null;
  const whsec = env.STRIPE_WEBHOOK_SECRET?.trim() || null;
  if ((key === null) !== (whsec === null)) throw new Error('Set both STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, or neither.');
  const rawPublic = env.PUBLIC_URL?.trim();
  const publicUrl = rawPublic ? parsePublicUrl(rawPublic) : null;
  if (key !== null) {
    if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/.test(key)) throw new Error('STRIPE_SECRET_KEY does not look like a Stripe secret or restricted key.');
    if (!/^whsec_[A-Za-z0-9]{8,}$/.test(whsec ?? '')) throw new Error('STRIPE_WEBHOOK_SECRET does not look like a Stripe webhook signing secret (whsec_...).');
    // Nothing goes live before the VAT registration (owner, 2026-11-20).
    if (/^(sk|rk)_live_/.test(key) && !parseFlag(env.PAYMENTS_LIVE, 'PAYMENTS_LIVE')) {
      throw new Error('Refusing to start with a live Stripe key: set PAYMENTS_LIVE=1 once the VAT registration is done.');
    }
    if (publicUrl === null) throw new Error('PUBLIC_URL is required when payments are enabled (for example https://clanflame.example).');
  }
  const alertRaw = env.ALERT_WEBHOOK_URL?.trim();
  let alertWebhookUrl: string | null = null;
  if (alertRaw) {
    let u: URL;
    try {
      u = new URL(alertRaw);
    } catch {
      throw new Error('Invalid ALERT_WEBHOOK_URL: not a valid URL.');
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Invalid ALERT_WEBHOOK_URL: must be http or https.');
    alertWebhookUrl = u.toString();
  }
  return { stripeSecretKey: key, stripeWebhookSecret: whsec, paymentsEnabled: key !== null, publicUrl, stripeTax: parseFlag(env.STRIPE_TAX, 'STRIPE_TAX'), alertWebhookUrl };
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
    requirePasswordUpgrade: parseFlag(env.PASSWORD_UPGRADE_ON_LOGIN, 'PASSWORD_UPGRADE_ON_LOGIN'),
    signingKey: parseSigningKey(rawKey),
    worldApiUrl: parseWorldApiUrl(env.WORLD_API_URL, nodeEnv === 'production'),
    ...parseStripeEnv(env),
  };
}

/** 1/true/yes = on, 0/false/no/empty = off; anything else fails fast. */
export function parseFlag(raw: string | undefined, name: string): boolean {
  const v = (raw ?? '').trim();
  if (v === '' || /^(0|false|no)$/i.test(v)) return false;
  if (/^(1|true|yes)$/i.test(v)) return true;
  throw new Error(`Invalid ${name}="${raw}": expected 1 or 0.`);
}

/**
 * WORLD_API_URL: http(s) URL containing `{id}`, no query or fragment, e.g. `http://game-{id}:3000/w/{id}/api`. Unset: in development
 * `http://127.0.0.1:3000/w/{id}/api` (the dev world; the game strips /w/<id> itself), in production null (commands queue up, logged).
 */
export function parseWorldApiUrl(raw: string | undefined, production: boolean): string | null {
  const v = (raw ?? '').trim();
  if (v === '') return production ? null : 'http://127.0.0.1:3000/w/{id}/api';
  let url: URL;
  try {
    url = new URL(v.split('{id}').join('x'));
  } catch {
    throw new Error(`Invalid WORLD_API_URL="${raw}": not a valid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Invalid WORLD_API_URL="${raw}": must be http or https.`);
  if (url.search || url.hash || url.username || url.password) throw new Error(`Invalid WORLD_API_URL="${raw}": no query, fragment or credentials.`);
  if (!v.includes('{id}')) throw new Error(`Invalid WORLD_API_URL="${raw}": it must contain {id}.`);
  return v;
}
