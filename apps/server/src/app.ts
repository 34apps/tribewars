// Builds the Fastify app: database, world, services, hooks, routes and static client.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { GameError, type ApiError, type GameErrorCode, type WorldSettings } from '@clanfire/engine';
import { AdvisorService, type AdvisorClient } from './advisor.ts';
import { AuthService, RateLimiter, SESSION_COOKIE, sha256Hex } from './auth.ts';
import type { AppContext } from './context.ts';
import { openDatabase } from './db.ts';
import { statusFor } from './errors.ts';
import { GameService } from './game.ts';
import { MailService } from './mail-service.ts';
import { advisorRoutes } from './routes/advisor.ts';
import { authRoutes } from './routes/auth.ts';
import { gameRoutes } from './routes/game.ts';
import { mailRoutes } from './routes/mail.ts';
import { rankingRoutes } from './routes/rankings.ts';
import { reportRoutes } from './routes/reports.ts';
import { tribeRoutes } from './routes/tribes.ts';
import { Store } from './store.ts';
import { TribeService } from './tribe-service.ts';
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
  /** Trust X-Forwarded-For (behind a reverse proxy only). */
  trustProxy?: boolean;
  /** Multi-account guard: most active accounts that may register from one IP. 0/absent = off. */
  maxAccountsPerIp?: number;
  /** Claude client for Mags's advisor. Null/absent = advisor answers `advisor_unavailable`. Tests inject a fake. */
  advisorClient?: AdvisorClient | null;
  /** Usernames allowed to use sandbox/test mode (compared lowercase). Absent = nobody. */
  sandboxUsers?: readonly string[];
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
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: BODY_LIMIT,
    requestTimeout: 30_000,
    trustProxy: opts.trustProxy ?? false,
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
  const ctx: AppContext = {
    store,
    settings,
    now,
    secureCookies: opts.secureCookies ?? process.env.NODE_ENV === 'production',
    limiter: new RateLimiter(10, 60_000),
    auth: new AuthService(store, settings, now, opts.maxAccountsPerIp ?? 0),
    game: new GameService(store, settings, app.log),
    tribes: new TribeService(store, settings),
    mail: new MailService(store),
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

  app.addHook('onRequest', async (req) => {
    req.nowMs = now();

    // Blocks cross-site form/fetch posts: a browser always sends Origin on those.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      const origin = req.headers.origin;
      if (origin !== undefined) {
        let originHost: string | null = null;
        try {
          originHost = new URL(origin).host.toLowerCase();
        } catch {
          // "null" or garbage: refuse below.
        }
        if (originHost === null || originHost !== (req.headers.host ?? '').toLowerCase()) {
          throw new GameError('forbidden', 'Cross-site requests are not allowed.');
        }
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

  app.get('/api/health', async () => ({ ok: true }));
  authRoutes(app, ctx);
  gameRoutes(app, ctx);
  reportRoutes(app, ctx);
  tribeRoutes(app, ctx);
  mailRoutes(app, ctx);
  rankingRoutes(app, ctx);
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
    const isRoute = (req.method === 'GET' || req.method === 'HEAD') && !isApiPath(req.url) && !lastSegment.includes('.');
    if (serveWeb && isRoute) {
      void reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    }
    return reply.code(404).send(errorBody('not_found', 'Not found.'));
  });

  return app;
}
