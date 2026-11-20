// The in-browser "server": the real Store / GameService / TribeService / AuthService and the real route modules, running
// on sql.js. This file replaces only apps/server/src/app.ts (Fastify wiring): world setup, processDue before each
// request, session cookie <-> token, and the GameError -> HTTP mapping (done in router.ts).

import initSqlJs, { type SqlJsStatic } from 'sql.js/dist/sql-asm-memory-growth.js';
import type {} from '@fastify/cookie'; // type augmentation: req.cookies / reply.setCookie used by the route modules
import type { FastifyInstance } from 'fastify';
import { EXTRA_PREMIUM_TOOLS, EXTRA_RAID_LISTS, applyWorldConfig, storageCap, villagePoints, worldRules, type WorldSettings } from '@clanfire/engine';
import { AuthService, RateLimiter, SESSION_COOKIE } from '../../server/src/auth.ts';
import type { AppContext } from '../../server/src/context.ts';
import { openDatabase } from '../../server/src/db.ts';
import { DominationService } from '../../server/src/domination-service.ts';
import { GameService } from '../../server/src/game.ts';
import { AccountDataService } from '../../server/src/account-data-service.ts';
import { accountRoutes } from '../../server/src/routes/account.ts';
import { authRoutes } from '../../server/src/routes/auth.ts';
import { gameRoutes } from '../../server/src/routes/game.ts';
import { ForumService } from '../../server/src/forum-service.ts';
import { MailService } from '../../server/src/mail-service.ts';
import { forumRoutes } from '../../server/src/routes/forum.ts';
import { mailRoutes } from '../../server/src/routes/mail.ts';
import { notificationRoutes } from '../../server/src/routes/notifications.ts';
import { rankingRoutes } from '../../server/src/routes/rankings.ts';
import { dominationRoutes } from '../../server/src/routes/domination.ts';
import { siteRoutes } from '../../server/src/routes/sites.ts';
import { troopGroupRoutes } from '../../server/src/routes/troop-groups.ts';
import { noteRoutes } from '../../server/src/routes/notes.ts';
import { firstStepsRoutes } from '../../server/src/routes/first-steps.ts';
import { raidListRoutes } from '../../server/src/routes/raid-lists.ts';
import { autoRoutes } from '../../server/src/routes/auto.ts';
import { RaidListService } from '../../server/src/raid-list-service.ts';
import { reportRoutes } from '../../server/src/routes/reports.ts';
import { tribeRoutes } from '../../server/src/routes/tribes.ts';
import { ReportService } from '../../server/src/report-service.ts';
import { StaffService } from '../../server/src/staff-service.ts';
import { MultiService } from '../../server/src/multi-service.ts';
import { Store } from '../../server/src/store.ts';
import { SupportService } from '../../server/src/support-service.ts';
import { TribeService } from '../../server/src/tribe-service.ts';
import { initWorld } from '../../server/src/world.ts';
import { neverExpireSessions } from './sessions.ts';
import { FakeApp } from './router.ts';
import { configureSqlite, openDatabaseInstance } from './shims/node-sqlite.ts';

/**
 * A new world is the real game at real pace (speed 1, real beginner protection), only small, with few abandoned
 * villages. The owner speeds time up with the speed chip (clock.ts); saved worlds keep the settings they were created with.
 */
export const PREVIEW_WORLD: Partial<WorldSettings> = {
  radius: 30,
  npcDensity: 0.025,
};

/**
 * Demo starter pack (the `?demo` shortcut only; design shots rely on it): a level 4 Storehouse and full stores
 * (wood, food, iron). Real players start from zero.
 */
const STARTER_STOREHOUSE_LEVEL = 4;

export function grantStarterPack(ctx: AppContext, username: string): void {
  const player = ctx.store.getPlayerByLowerName(username.toLowerCase());
  const village = player ? ctx.store.villagesOfPlayer(player.id)[0] : undefined;
  if (!village) return;
  const state = { ...village.state, buildings: { ...village.state.buildings }, resources: { ...village.state.resources } };
  state.buildings.storehouse = Math.max(state.buildings.storehouse, STARTER_STOREHOUSE_LEVEL);
  const cap = storageCap(state);
  for (const r of ['wood', 'food', 'iron'] as const) state.resources[r] = Math.max(state.resources[r], cap);
  ctx.store.saveVillage(village.id, state, villagePoints(state));
}

/**
 * Raid lists (a paid extra) are always on in the preview and every human player has the extra, so the owner can try them. A saved world
 * keeps the settings it was created with, so the switch is also turned on in an existing world (stored, then copied into `settings` in
 * place, the way the server does it on an operator change). Computer players never get the extra.
 */
function enableRaidLists(ctx: AppContext): void {
  const { store, settings } = ctx;
  if (!worldRules(settings).features.raidLists) {
    const config = structuredClone(store.effectiveWorldConfig());
    config.features.raidLists = true;
    store.setWorldConfig(config);
    Object.assign(settings, applyWorldConfig(settings, config));
  }
  grantRaidListsExtra(ctx);
}

/** Give every non-computer player the extra (computer players were created with the password marker 'bot'). One cheap statement. */
function grantRaidListsExtra(ctx: AppContext): void {
  ctx.store.db.prepare("UPDATE players SET premium = premium | ? WHERE password_hash != 'bot' AND (premium & ?) = 0").run(EXTRA_RAID_LISTS, EXTRA_RAID_LISTS);
}

/**
 * Premium tools (5 build slots, auto mode) are always on in the preview and every human player has the extra, so the owner can try them.
 * Same way as the raid lists: the world switch is stored and copied into `settings` in place; computer players never get the extra.
 */
function enablePremiumTools(ctx: AppContext): void {
  const { store, settings } = ctx;
  if (!worldRules(settings).features.premium) {
    const config = structuredClone(store.effectiveWorldConfig());
    config.features.premium = true;
    store.setWorldConfig(config);
    Object.assign(settings, applyWorldConfig(settings, config));
  }
  grantPremiumToolsExtra(ctx);
}

function grantPremiumToolsExtra(ctx: AppContext): void {
  ctx.store.db.prepare("UPDATE players SET premium = premium | ? WHERE password_hash != 'bot' AND (premium & ?) = 0").run(EXTRA_PREMIUM_TOOLS, EXTRA_PREMIUM_TOOLS);
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
  /** Demo only: starter stores for a just-registered account. */
  grantStarterPack(username: string): void;
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
  // Preview has no allow-list: every player may use the client-only design preview (server test-mode actions are not mounted).
  store.isSandboxUser = () => true;
  // ...so test accounts would earn no Renown from fights at all; the computer players (preview_bots) are the one opponent that pays.
  store.isComputerPlayer = (id) => {
    try {
      const raw = store.getMeta('preview_bots');
      return raw ? String(id) in (JSON.parse(raw) as { bots?: Record<string, string> }).bots! : false;
    } catch {
      return false;
    }
  };
  // A new world gets the preview settings and a random map; a restored one keeps the settings it was created with.
  const overrides: Partial<WorldSettings> = store.getSettings() ? {} : { ...PREVIEW_WORLD, seed: 1 + Math.floor(Math.random() * 0x7fffffff) };
  const settings = initWorld(store, overrides, now(), (msg) => console.warn(msg));
  store.world = settings;

  // Staff services are wired so the context is complete; the preview mounts no staff or support routes.
  const forum = new ForumService(store);
  const support = new SupportService(store);
  const game = new GameService(store, settings, { error: (obj, msg) => console.error(msg ?? 'game error', obj) }, now);
  const tribes = new TribeService(store, settings);
  const ctx: AppContext = {
    store,
    settings,
    now,
    secureCookies: false,
    worldId: 'w1',
    worldName: 'Preview',
    limiter: new RateLimiter(30, 60_000),
    auth: new AuthService(store, settings, now),
    game,
    raidLists: new RaidListService(store, settings, game),
    domination: new DominationService(store, settings, game),
    tribes,
    accountData: new AccountDataService(store, game, tribes, 'w1', now),
    mail: new MailService(store),
    forum,
    support,
    staff: new StaffService(store, support),
    multi: new MultiService(store),
    msgReports: new ReportService(store, forum),
  };

  neverExpireSessions(ctx.auth, store);
  enableRaidLists(ctx);
  enablePremiumTools(ctx);

  const app = new FakeApp();
  const fastifyLike = app as unknown as FastifyInstance;
  app.get('/api/health', async () => ({ ok: true }));
  // Public world info: tells the client this world has its own accounts (no lobby), so Settings offers Delete next to Download.
  app.get('/api/world/info', async () => ({ id: ctx.worldId, name: ctx.worldName, speed: settings.speed, startedAt: new Date(now()).toISOString(), lobby: false, ended: false }));
  authRoutes(fastifyLike, ctx);
  accountRoutes(fastifyLike, ctx); // the preview is a world with its own accounts: Download my data + Delete my account (no lobby, so the lobby command routes answer 404)
  gameRoutes(fastifyLike, ctx);
  reportRoutes(fastifyLike, ctx);
  tribeRoutes(fastifyLike, ctx);
  mailRoutes(fastifyLike, ctx);
  notificationRoutes(fastifyLike, ctx);
  forumRoutes(fastifyLike, ctx);
  rankingRoutes(fastifyLike, ctx);
  // The domination bar (Tribe, Ranks) and the map sites, as on the real server (owner 2026-11-06: the bar showed an error).
  dominationRoutes(fastifyLike, ctx);
  siteRoutes(fastifyLike, ctx);
  troopGroupRoutes(fastifyLike, ctx);
  noteRoutes(fastifyLike, ctx);
  raidListRoutes(fastifyLike, ctx);
  autoRoutes(fastifyLike, ctx);
  firstStepsRoutes(fastifyLike, ctx);

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
      if (method === 'POST' && url.startsWith('/api/auth/')) { grantRaidListsExtra(ctx); grantPremiumToolsExtra(ctx); } // a player who just registered has the extra from the next request on
      for (const change of res.cookieChanges) {
        if (change.name !== SESSION_COOKIE) continue;
        sessionToken = change.value;
        backend.onTokenChange(sessionToken);
      }
      return { status: res.status, body: res.body, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...res.headers } };
    },
    processDue() {
      try {
        const t = now();
        const handled = ctx.game.processDue(t);
        // The preview has no caretaker pass: keep the stored state of abandoned villages (their points on the map) fresh here,
        // right after the arrivals (never settle a village past an unresolved arrival). Bounded per call; nothing due = one cheap query.
        return handled + ctx.game.refreshAbandonedVillages(t);
      } catch (err) {
        console.error('tick failed', err);
        return 0;
      }
    },
    exportDatabase() {
      return openDatabaseInstance()?.exportBytes() ?? null;
    },
    grantStarterPack: (username) => grantStarterPack(ctx, username),
    getToken: () => sessionToken,
    setToken(t) {
      sessionToken = t;
    },
    onTokenChange: () => {},
  };
  return backend;
}
