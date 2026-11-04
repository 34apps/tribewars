// Builds the Fastify app of the lobby: database, services, hooks and routes. API only: no static files.

import type { KeyObject } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { GameError, LOBBY_SESSION_COOKIE, type ApiError, type GameErrorCode } from '@clanfire/engine';
import { AuthService, RateLimiter, sha256Hex } from './auth.ts';
import type { AppContext } from './context.ts';
import { openDatabase } from './db.ts';
import { statusFor } from './errors.ts';
import { authRoutes } from './routes/auth.ts';
import { worldRoutes } from './routes/worlds.ts';
import { CSP, HSTS, PERMISSIONS_POLICY, originAllowed } from './security.ts';
import { Store } from './store.ts';
import { rewriteLobbyUrl } from './worlds.ts';

export const BODY_LIMIT = 16 * 1024;
/** Limits per minute (see the rate-limit hook in buildApp). Smaller than a world's: the lobby is only sign-in and a click per world. */
export const RATE_API_PER_IP = 300;
export const RATE_WRITE_PER_IP = 90;
export const RATE_WRITE_PER_SESSION = 60;
/** Sign-in and registration attempts per IP (separate counters). */
export const RATE_AUTH_PER_IP = 10;
/** Entering a world: passes per account and per IP. */
export const RATE_ENTER_PER_ACCOUNT = 20;
export const RATE_ENTER_PER_IP = 60;

export interface BuildAppOptions {
  /** SQLite file, or ':memory:'. */
  dbPath: string;
  /** Ed25519 private key that signs entry passes (required; the lobby has no purpose without it). */
  signingKey: KeyObject;
  /** Clock in ms since epoch. Tests pass a controllable one. */
  now?: () => number;
  /** Fastify logger (true = JSON logs on stdout). Default off. */
  logger?: boolean;
  /** `Secure` session cookie. Default: NODE_ENV === 'production'. */
  secureCookies?: boolean;
  /** Send Strict-Transport-Security. Default: NODE_ENV === 'production'. */
  hsts?: boolean;
  /** Trust X-Forwarded-For (behind a reverse proxy only). */
  trustProxy?: boolean | number | string;
  /** Extra normalized origins (scheme://host[:port], lowercase) accepted on writes when the Origin host differs from Host. */
  allowedOrigins?: readonly string[];
  /** Multi-account guard: most active accounts that may register from one IP. 0/absent = off. */
  maxAccountsPerIp?: number;
  /** A correct but weak password must be replaced at the next sign-in (PASSWORD_UPGRADE_ON_LOGIN). Default off. */
  requirePasswordUpgrade?: boolean;
}

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
    // "/lobby/api/x" is routed as "/api/x"; a bare "/api/x" works too.
    rewriteUrl: (req) => rewriteLobbyUrl(req.url ?? '/'),
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
  if (store.countWorlds() === 0) {
    app.log.warn('No worlds are configured: players see an empty list. Add one with: npm run lobby:admin -- world-add <id> <name>');
  }
  // The session cookie is always Secure in production: refuse to start otherwise.
  const production = process.env.NODE_ENV === 'production';
  const secureCookies = opts.secureCookies ?? production;
  if (production && !secureCookies) throw new Error('Refusing to start: the session cookie must be Secure when NODE_ENV=production.');
  const ctx: AppContext = {
    store,
    now,
    auth: new AuthService(store, now, opts.maxAccountsPerIp ?? 0, opts.requirePasswordUpgrade ?? false),
    signingKey: opts.signingKey,
    secureCookies,
    limiter: new RateLimiter(RATE_AUTH_PER_IP, 60_000),
    enterAccountLimiter: new RateLimiter(RATE_ENTER_PER_ACCOUNT, 60_000),
    enterIpLimiter: new RateLimiter(RATE_ENTER_PER_IP, 60_000),
  };
  app.decorate('ctx', ctx);
  app.decorateRequest('nowMs', 0);
  app.decorateRequest('account', null);

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

  // Global rate limits (after the cookie plugin so the session cookie is parsed): per IP on every API call, per IP on
  // writes, per session on writes. Sign-in/registration keep their own stricter limit (routes/auth.ts).
  const apiLimiter = new RateLimiter(RATE_API_PER_IP, 60_000);
  const writeIpLimiter = new RateLimiter(RATE_WRITE_PER_IP, 60_000);
  const writeSessionLimiter = new RateLimiter(RATE_WRITE_PER_SESSION, 60_000);
  app.addHook('onRequest', async (req, reply) => {
    if (!isApiPath(req.url) || req.url.split('?', 1)[0] === '/api/health') return;
    const t = req.nowMs;
    let ok = apiLimiter.allow(req.ip, t);
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      ok = writeIpLimiter.allow(req.ip, t) && ok;
      const token = req.cookies[LOBBY_SESSION_COOKIE];
      if (token) ok = writeSessionLimiter.allow(sha256Hex(token), t) && ok;
    }
    if (!ok) {
      void reply.header('Retry-After', '60');
      throw new GameError('rate_limited', 'Too many requests. Please slow down and try again in a minute.');
    }
  });

  app.get('/api/health', async (_req, reply) => {
    try {
      store.countWorlds(); // trivial read: proves the database answers
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
  authRoutes(app, ctx);
  worldRoutes(app, ctx);

  app.setNotFoundHandler(async (_req, reply) => reply.code(404).send(errorBody('not_found', 'Not found.')));

  return app;
}
