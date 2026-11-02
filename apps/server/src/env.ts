// Server configuration from environment variables. Fails fast on malformed values.

import type { WorldSettings } from '@tribewars/engine';

export interface ServerEnv {
  port: number;
  host: string;
  databasePath: string;
  nodeEnv: string;
  isProduction: boolean;
  /** Trust X-Forwarded-* headers (only enable behind a reverse proxy you control). */
  trustProxy: boolean;
  /** World settings given in the environment. Only used when a new world is created. */
  worldOverrides: Partial<WorldSettings>;
}

type Env = Record<string, string | undefined>;

function num(env: Env, name: string, check: (n: number) => boolean, what: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !check(n)) throw new Error(`Invalid ${name}="${raw}": expected ${what}.`);
  return n;
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

  return {
    port: num(env, 'PORT', (n) => Number.isInteger(n) && n >= 0 && n <= 65535, 'a port number') ?? 3000,
    host: env.HOST?.trim() || '0.0.0.0',
    databasePath: env.DATABASE_PATH?.trim() || './data/tribewars.sqlite',
    nodeEnv,
    isProduction: nodeEnv === 'production',
    trustProxy: /^(1|true|yes)$/i.test(env.TRUST_PROXY ?? ''),
    worldOverrides,
  };
}
