// The in-browser "server": the real Store / GameService / TribeService / AuthService and the real route modules, running
// on sql.js. This file replaces only apps/server/src/app.ts (Fastify wiring): world setup, processDue before each
// request, session cookie <-> token, and the GameError -> HTTP mapping (done in router.ts).

import initSqlJs, { type SqlJsStatic } from 'sql.js/dist/sql-asm-memory-growth.js';
import type {} from '@fastify/cookie'; // type augmentation: req.cookies / reply.setCookie used by the route modules
import type { FastifyInstance } from 'fastify';
import { storageCap, villagePoints, type WorldSettings } from '@clanfire/engine';
import { AuthService, RateLimiter, SESSION_COOKIE } from '../../server/src/auth.ts';
import type { AppContext } from '../../server/src/context.ts';
import { openDatabase } from '../../server/src/db.ts';
import { GameService } from '../../server/src/game.ts';
import { authRoutes } from '../../server/src/routes/auth.ts';
import { gameRoutes } from '../../server/src/routes/game.ts';
import { rankingRoutes } from '../../server/src/routes/rankings.ts';
import { reportRoutes } from '../../server/src/routes/reports.ts';
import { tribeRoutes } from '../../server/src/routes/tribes.ts';
import { Store } from '../../server/src/store.ts';
import { TribeService } from '../../server/src/tribe-service.ts';
import { initWorld } from '../../server/src/world.ts';
import { FakeApp } from './router.ts';
import { configureSqlite, openDatabaseInstance } from './shims/node-sqlite.ts';

/**
 * A world that is playable in minutes: small, and fast (all durations divide by `speed`).
 * protectionHours / speed = 1.5 h / 25 = 3.6 minutes of beginner protection; abandoned villages grow every 4 h / 25 = 9.6 min.
 */
export const PREVIEW_WORLD: Partial<WorldSettings> = {
  speed: 25,
  radius: 30,
  npcDensity: 0.025,
  protectionHours: 1.5,
  npcGrowthHours: 4,
};

/**
 * Preview starter pack: a new village starts with a level 4 Storehouse and full stores (1,900 wood, food and iron).
 * At 25x speed buildings finish in seconds but income stays slow compared with their cost, so without this the first
 * raid would be ~20 minutes away and a tribe about as far. Only this one village's state changes; every rule still
 * runs as in the real game.
 */
const STARTER_STOREHOUSE_LEVEL = 4;

function grantStarterPack(ctx: AppContext, username: string): void {
  const player = ctx.store.getPlayerByLowerName(username.toLowerCase());
  const village = player ? ctx.store.villagesOfPlayer(player.id)[0] : undefined;
  if (!village) return;
  const state = { ...village.state, buildings: { ...village.state.buildings }, resources: { ...village.state.resources } };
  state.buildings.storehouse = Math.max(state.buildings.storehouse, STARTER_STOREHOUSE_LEVEL);
  const cap = storageCap(state);
  for (const r of ['wood', 'food', 'iron'] as const) state.resources[r] = Math.max(state.resources[r], cap);
  ctx.store.saveVillage(village.id, state, villagePoints(state));
}

export interface ApiResult {
  status: number;
  body: string | null;
  headers: Record<string, string>;
}

export interface Backend {
  ctx: AppContext;
  /** Run one API request. `url` is the path with query, e.g. "/api/state". */
  request(method: string, url: string, bodyText: string | undefined): Promise<ApiResult>;
  /** Resolve due troop movements. Returns how many were handled. */
  processDue(): number;
  /** Serialised database for saving, or null when it cannot be exported right now. */
  exportDatabase(): Uint8Array | null;
  /** The current session token (the cookie the real server would set) and a way to set it back after a reload. */
  getToken(): string | null;
  setToken(token: string | null): void;
  onTokenChange: (token: string | null) => void;
}

/** The asm.js build logs a deprecation notice aimed at library users; it only clutters the console here. */
async function loadSqlJs(): Promise<SqlJsStatic> {
  const warn = console.warn;
  console.warn = (...args: unknown[]): void => {
    if (typeof args[0] === 'string' && args[0].startsWith('sql.js: the asm.js build is deprecated')) return;
    warn.apply(console, args);
  };
  try {
    return await initSqlJs();
  } finally {
    console.warn = warn;
  }
}

export async function createBackend(saved: Uint8Array | null, token: string | null): Promise<Backend> {
  const SQL = await loadSqlJs();
  configureSqlite(SQL, saved);

  const now = (): number => Date.now();
  const db = openDatabase(':memory:');
  const store = new Store(db);
  // A new world gets the preview settings and a random map; a restored one keeps the settings it was created with.
  const overrides: Partial<WorldSettings> = store.getSettings() ? {} : { ...PREVIEW_WORLD, seed: 1 + Math.floor(Math.random() * 0x7fffffff) };
  const settings = initWorld(store, overrides, now(), (msg) => console.warn(msg));

  const ctx: AppContext = {
    store,
    settings,
    now,
    secureCookies: false,
    limiter: new RateLimiter(30, 60_000),
    auth: new AuthService(store, settings, now),
    game: new GameService(store, settings, { error: (obj, msg) => console.error(msg ?? 'game error', obj) }),
    tribes: new TribeService(store, settings),
  };

  const app = new FakeApp();
  const fastifyLike = app as unknown as FastifyInstance;
  app.get('/api/health', async () => ({ ok: true }));
  authRoutes(fastifyLike, ctx);
  gameRoutes(fastifyLike, ctx);
  reportRoutes(fastifyLike, ctx);
  tribeRoutes(fastifyLike, ctx);
  rankingRoutes(fastifyLike, ctx);

  let sessionToken = token;

  const backend: Backend = {
    ctx,
    async request(method, url, bodyText) {
      const t = now();
      // Bring the world up to date (arrived troops) before the handler reads or changes anything.
      try {
        ctx.game.processDue(t);
      } catch (err) {
        console.error('processDue failed', err);
      }
      const res = await app.handle({ method, url, bodyText, cookies: { [SESSION_COOKIE]: sessionToken ?? undefined }, nowMs: t });
      if (res.status === 201 && method === 'POST' && url === '/api/auth/register') {
        try {
          const { username } = JSON.parse(bodyText ?? '{}') as { username?: string };
          if (username) grantStarterPack(ctx, username);
        } catch (err) {
          console.error('starter pack failed', err);
        }
      }
      for (const change of res.cookieChanges) {
        if (change.name !== SESSION_COOKIE) continue;
        sessionToken = change.value;
        backend.onTokenChange(sessionToken);
      }
      return { status: res.status, body: res.body, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...res.headers } };
    },
    processDue() {
      try {
        return ctx.game.processDue(now());
      } catch (err) {
        console.error('tick failed', err);
        return 0;
      }
    },
    exportDatabase() {
      return openDatabaseInstance()?.exportBytes() ?? null;
    },
    getToken: () => sessionToken,
    setToken(t) {
      sessionToken = t;
    },
    onTokenChange: () => {},
  };
  return backend;
}
