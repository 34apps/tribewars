// Builds the Fastify app: database, world, services, hooks, routes and static client.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { DEFAULT_WORLD_ID, GameError, type ApiError, type GameErrorCode, type WorldInfoResponse, type WorldSettings } from '@clanfire/engine';
import { AdvisorService, type AdvisorClient } from './advisor.ts';
import { AuthService, RateLimiter, SESSION_COOKIE, sha256Hex } from './auth.ts';
import type { AppContext } from './context.ts';
import { openDatabase } from './db.ts';
import { statusFor } from './errors.ts';
import { GameService } from './game.ts';
import { ForumService } from './forum-service.ts';
import { MailService } from './mail-service.ts';
import { LiveHub, liveRoutes } from './live.ts';
import { advisorRoutes } from './routes/advisor.ts';
import { authRoutes } from './routes/auth.ts';
import { gameRoutes } from './routes/game.ts';
import { forumRoutes } from './routes/forum.ts';
import { mailRoutes } from './routes/mail.ts';
import { rankingRoutes } from './routes/rankings.ts';
import { reportRoutes } from './routes/reports.ts';
import { staffRoutes } from './routes/staff.ts';
import { supportRoutes } from './routes/support.ts';
import { tribeRoutes } from './routes/tribes.ts';
import { ReportService } from './report-service.ts';
import { StaffService } from './staff-service.ts';
import { CSP, HSTS, PERMISSIONS_POLICY, ROUTE_LIMITS, ROUTE_LIMIT_WINDOW_MS, originAllowed, routeBucket, type RouteBucket } from './security.ts';
import { Store } from './store.ts';
import { SupportService } from './support-service.ts';
import { TribeService } from './tribe-service.ts';
import { checkWorldId, checkWorldName, makeWorldRewrite } from './world-path.ts';
import { initWorld } from './world.ts';

export const BODY_LIMIT = 16 * 1024;
/** Global limits per minute (see the rate-limit hook in buildApp). */
export const RATE_API_PER_IP = 600;
export const RATE_WRITE_PER_IP = 180;
export const RATE_WRITE_PER_SESSION = 120;

export interface BuildAppOptions {
  /** SQLite file, or ':memory:'. */
  dbPath: string;
  /** Clock in ms since epoch. Tests pass a controllable one. */
  now?: () => number;
  /** World settings used only if the database has no world yet (stored settings win). */
  settings?: Partial<WorldSettings>;
  /** Built web client to serve. Default: ../web/dist next to this app. */
  webDistDir?: string;
  /** Fastify logger (true = JSON logs on stdout). Default off. */
  logger?: boolean;
  /** `Secure` session cookie. Default: NODE_ENV === 'production'. */
  secureCookies?: boolean;
  /** Send Strict-Transport-Security. Default: NODE_ENV === 'production'. */
  hsts?: boolean;
  /** Trust X-Forwarded-For (behind a reverse proxy only). */
  trustProxy?: boolean | number | string;
  /** Extra normalized origins (scheme://host[:port], lowercase) accepted on writes when the Origin host differs from Host (CDN/load balancer). */
  allowedOrigins?: readonly string[];
  /** Multi-account guard: most active accounts that may register from one IP. 0/absent = off. */
  maxAccountsPerIp?: number;
  /** Claude client for Mags's advisor. Null/absent = advisor answers `advisor_unavailable`. Tests inject a fake. */
  advisorClient?: AdvisorClient | null;
  /** Live-update heartbeat interval in ms (default 30 s). Tests shorten it. */
  liveHeartbeatMs?: number;
  /** Usernames allowed to use sandbox/test mode (compared lowercase). Absent = nobody. */
  sandboxUsers?: readonly string[];
  /** This world's id (default w1; letters, digits, dashes). Every route also answers under /w/<worldId>/. */
  worldId?: string;
  /** Display name for GET /api/world/info (default "World <worldId>"). */
  worldName?: string;
}

const DEFAULT_WEB_DIST = resolve(import.meta.dirname, '../../web/dist');

function isApiPath(url: string): boolean {
  const path = url.split('?', 1)[0] ?? '';
  return path === '/api' || path.startsWith('/api/');
}

function errorBody(error: GameErrorCode, message: string): ApiError {
  return { error, message };
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const now = opts.now ?? Date.now;
  const worldId = checkWorldId(opts.worldId ?? DEFAULT_WORLD_ID, 'worldId');
  const worldName = checkWorldName(opts.worldName ?? `World ${worldId}`, 'worldName');
  const rewriteWorldPath = makeWorldRewrite(worldId);
  const app = Fastify({
    logger: opts.logger ?? false,
    // "/w/<id>/api/x" is routed as "/api/x": one set of routes, hooks and limits for both paths.
    rewriteUrl: (req) => rewriteWorldPath(req.url ?? '/'),
    bodyLimit: BODY_LIMIT,
    requestTimeout: 30_000,
    // A hop count becomes a function: this Fastify version treats a bare number as "trust nothing".
    trustProxy: typeof opts.trustProxy === 'number' ? (_addr: string, hop: number) => hop < (opts.trustProxy as number) : (opts.trustProxy ?? false),
    // Strict validation: unknown fields are errors (not silently stripped) and nothing is coerced.
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false, allErrors: false } },
  });

  // ---- state -----------------------------------------------------------------------------------
  const db = openDatabase(opts.dbPath);
  app.addHook('onClose', async () => {
    db.close();
  });
  const store = new Store(db);
  store.sandboxUsers = new Set((opts.sandboxUsers ?? []).map((u) => u.toLowerCase()));
  const settings = initWorld(store, opts.settings ?? {}, now(), (msg) => app.log.warn(msg));
  const forum = new ForumService(store);
  const support = new SupportService(store);
  // Live updates: the store hands over events after each commit; the hub pushes them to the right sockets.
  const live = new LiveHub(store, now, app.log, { heartbeatMs: opts.liveHeartbeatMs });
  store.onLive = (events) => live.publish(events);
  live.start();
  app.addHook('onClose', async () => {
    live.stop();
  });
  const ctx: AppContext = {
    store,
    settings,
    now,
    secureCookies: opts.secureCookies ?? process.env.NODE_ENV === 'production',
    worldId,
    worldName,
    limiter: new RateLimiter(10, 60_000),
    live,
    auth: new AuthService(store, settings, now, opts.maxAccountsPerIp ?? 0),
    game: new GameService(store, settings, app.log),
    tribes: new TribeService(store, settings),
    mail: new MailService(store),
    forum,
    support,
    staff: new StaffService(store, support),
    msgReports: new ReportService(store, forum),
  };
  app.decorate('ctx', ctx);
  app.decorateRequest('nowMs', 0);
  app.decorateRequest('player', null);

  // ---- request pipeline --------------------------------------------------------------------------
  // JSON bodies only (no text/plain or form posts); an empty body counts as "no body".
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: BODY_LIMIT }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new GameError('invalid_input', 'The request body is not valid JSON.'), undefined);
    }
  });

  const hsts = opts.hsts ?? process.env.NODE_ENV === 'production';
  const allowedOrigins = new Set((opts.allowedOrigins ?? []).map((o) => o.toLowerCase()));
  app.addHook('onRequest', async (req) => {
    req.nowMs = now();

    // Blocks cross-site form/fetch posts: a browser always sends Origin on those.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      if (!originAllowed(req.headers.origin, req.headers.host, allowedOrigins)) {
        throw new GameError('forbidden', 'Cross-site requests are not allowed.');
      }
    }

    // Bring the world up to date (arrived troops) before the handler reads or changes anything.
    if (isApiPath(req.url)) {
      try {
        ctx.game.processDue(req.nowMs);
      } catch (err) {
        req.log.error({ err }, 'processDue failed');
      }
    }
  });

  app.addHook('onSend', async (req, reply) => {
    void reply.header('X-Content-Type-Options', 'nosniff');
    void reply.header('X-Frame-Options', 'DENY');
    void reply.header('Referrer-Policy', 'same-origin');
    void reply.header('Content-Security-Policy', CSP);
    void reply.header('Permissions-Policy', PERMISSIONS_POLICY);
    if (hsts) void reply.header('Strict-Transport-Security', HSTS);
    if (isApiPath(req.url)) void reply.header('Cache-Control', 'no-store');
  });

  app.setErrorHandler((err: FastifyError | GameError, req, reply) => {
    if (err instanceof GameError) {
      return reply.code(statusFor(err.code)).send(errorBody(err.code, err.message));
    }
    const fe = err as FastifyError;
    if (fe.validation) {
      return reply.code(400).send(errorBody('invalid_input', `Invalid request: ${fe.message}.`));
    }
    if (typeof fe.statusCode === 'number' && fe.statusCode >= 400 && fe.statusCode < 500) {
      return reply.code(fe.statusCode).send(errorBody('invalid_input', fe.message));
    }
    // Unexpected: log details here, tell the client nothing about them.
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send(errorBody('internal_error', 'Something went wrong on the server.'));
  });

  // ---- routes ------------------------------------------------------------------------------------
  await app.register(cookie);

  // Global rate limits (registered after the cookie plugin so the session cookie is parsed).
  // Per IP on every API call, per IP on writes, and per signed-in session on writes. Generous for
  // real play; stops floods. Sign-in/registration keep their own stricter limit (routes/auth.ts).
  const apiLimiter = new RateLimiter(RATE_API_PER_IP, 60_000);
  const writeIpLimiter = new RateLimiter(RATE_WRITE_PER_IP, 60_000);
  const writeSessionLimiter = new RateLimiter(RATE_WRITE_PER_SESSION, 60_000);
  app.addHook('onRequest', async (req, reply) => {
    if (!isApiPath(req.url) || req.url.split('?', 1)[0] === '/api/health') return;
    const t = req.nowMs;
    let ok = apiLimiter.allow(req.ip, t);
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      ok = writeIpLimiter.allow(req.ip, t) && ok;
      const token = req.cookies[SESSION_COOKIE];
      if (token) ok = writeSessionLimiter.allow(sha256Hex(token), t) && ok;
    }
    if (!ok) {
      void reply.header('Retry-After', '60');
      throw new GameError('rate_limited', 'Too many requests. Please slow down and try again in a minute.');
    }
  });

  // Stricter per-account limits per route group (security.ts). preValidation runs after the route's
  // own auth hook, so the player is known; calls without a player fall under the global limits only.
  const routeLimiters = new Map<RouteBucket, RateLimiter>();
  for (const [bucket, limit] of Object.entries(ROUTE_LIMITS) as [RouteBucket, number][]) {
    routeLimiters.set(bucket, new RateLimiter(limit, ROUTE_LIMIT_WINDOW_MS));
  }
  app.addHook('preValidation', async (req, reply) => {
    if (!req.player) return;
    const bucket = routeBucket(req.method, req.routeOptions.url ?? '');
    if (!bucket) return;
    if (!routeLimiters.get(bucket)?.allow(String(req.player.id), req.nowMs)) {
      void reply.header('Retry-After', '60');
      throw new GameError('rate_limited', 'Too many requests. Please slow down and try again in a minute.');
    }
  });

  app.get('/api/health', async (_req, reply) => {
    try {
      store.getMeta('world_settings'); // trivial read: proves the database answers
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
  // Public and private-data-free: id, name, speed, start date. Nothing about players, villages or the database.
  app.get('/api/world/info', async (): Promise<WorldInfoResponse> => {
    const created = Number(store.getMeta('world_created_at'));
    return { id: worldId, name: worldName, speed: settings.speed, startedAt: new Date(Number.isFinite(created) && created > 0 ? created : now()).toISOString() };
  });
  authRoutes(app, ctx);
  gameRoutes(app, ctx);
  reportRoutes(app, ctx);
  tribeRoutes(app, ctx);
  mailRoutes(app, ctx);
  forumRoutes(app, ctx);
  supportRoutes(app, ctx);
  staffRoutes(app, ctx);
  rankingRoutes(app, ctx);
  await liveRoutes(app, ctx, live, allowedOrigins);
  advisorRoutes(app, ctx, new AdvisorService(store, ctx.game, opts.advisorClient ?? null, app.log));

  // ---- static client + SPA fallback --------------------------------------------------------------
  const webDist = resolve(opts.webDistDir ?? DEFAULT_WEB_DIST);
  const serveWeb = existsSync(resolve(webDist, 'index.html'));
  if (serveWeb) {
    await app.register(fastifyStatic, {
      root: webDist,
      dotfiles: 'ignore',
      setHeaders: (reply, path) => {
        // Vite fingerprints /assets/*; everything else (index.html) must always be revalidated.
        void reply.header('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  app.setNotFoundHandler(async (req, reply) => {
    const path = req.url.split('?', 1)[0] ?? '';
    const lastSegment = path.slice(path.lastIndexOf('/') + 1);
    // A "/w/..." path that is still prefixed after the rewrite belongs to another world: never answer it with this world's client.
    const isRoute = (req.method === 'GET' || req.method === 'HEAD') && !isApiPath(req.url) && !lastSegment.includes('.') && !path.startsWith('/w/');
    if (serveWeb && isRoute) {
      void reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    }
    return reply.code(404).send(errorBody('not_found', 'Not found.'));
  });

  return app;
}
