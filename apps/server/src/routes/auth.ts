import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ACTIVITY_WRITE_INTERVAL_MS, GameError, isChieftainId, type AuthRequest, type ChieftainRequest, type EnterPassRequest, type HouseholdRequest,type MeResponse } from '@clanfire/engine';
import { ENTRY_PASS_MAX_CHARS } from '../entry-pass.ts';
import { PASSWORD_MAX, PASSWORD_MIN, SESSION_COOKIE, USERNAME_PATTERN, type SessionGrant } from '../auth.ts';
import type { AppContext } from '../context.ts';
import type { PlayerRow } from '../store.ts';
import { sessionCookiePath } from '../world-path.ts';

/** Route-level hook: attach the signed-in player or answer 401. Runs before body validation. */
export function requireAuth(ctx: AppContext) {
  return async (req: FastifyRequest): Promise<void> => {
    const player = ctx.auth.authenticate(req.cookies[SESSION_COOKIE]);
    if (!player) throw new GameError('unauthorized', 'Please sign in.');
    // Activity stamp for the caretaker bot: the row we already loaded tells us when a write is due (at most every few minutes).
    if (req.nowMs - player.lastActive >= ACTIVITY_WRITE_INTERVAL_MS) ctx.store.touchActive(player.id, req.nowMs, 0);
    // No village (abandoned after a long absence, or the last one was taken): start again at once with a new village.
    ctx.auth.ensureStartingVillage(player);
    req.player = player;
  };
}

/** The player attached by `requireAuth`. */
export function playerOf(req: FastifyRequest): PlayerRow {
  if (!req.player) throw new GameError('unauthorized', 'Please sign in.');
  return req.player;
}

function rateLimit(ctx: AppContext, name: string) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!ctx.limiter.allow(`${name}:${req.ip}`, req.nowMs)) {
      void reply.header('Retry-After', '60');
      throw new GameError('rate_limited', 'Too many attempts. Please wait a minute and try again.');
    }
  };
}

export function authRoutes(app: FastifyInstance, ctx: AppContext): void {
  const registerSchema = {
    body: {
      type: 'object',
      required: ['username', 'password'],
      additionalProperties: false,
      properties: {
        username: { type: 'string', pattern: USERNAME_PATTERN },
        password: { type: 'string', minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX },
        chieftain: { type: 'string', maxLength: 64 },
      },
    },
  };
  const chieftainSchema = {
    body: {
      type: 'object',
      required: ['chieftain'],
      additionalProperties: false,
      properties: { chieftain: { type: 'string', maxLength: 64 } },
    },
  };
  const checkChieftain = (id: string): void => {
    if (!isChieftainId(id)) throw new GameError('invalid_input', 'Unknown chieftain.');
  };
  // Sign-in is lenient about format: a wrong shape is just "wrong username or password".
  const loginSchema = {
    body: {
      type: 'object',
      required: ['username', 'password'],
      additionalProperties: false,
      properties: {
        username: { type: 'string', minLength: 1, maxLength: 64 },
        password: { type: 'string', minLength: 1, maxLength: PASSWORD_MAX },
      },
    },
  };

  // Served under /w/<id>/ the cookie is scoped to that path, so two worlds on one domain never share a session.
  // The old /api path keeps Path=/ (dev, tests, the current single-world install).
  const cookiePath = (req: FastifyRequest): string => sessionCookiePath(String(req.originalUrl ?? req.url ?? ''), ctx.worldId);
  // A Path=/ cookie from before world paths existed would be sent along (after the new one) and could outlive a logout.
  const clearLegacy = (req: FastifyRequest, reply: FastifyReply): void => {
    if (cookiePath(req) !== '/') void reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: ctx.secureCookies });
  };

  const setSession = (req: FastifyRequest, reply: FastifyReply, grant: SessionGrant): void => {
    clearLegacy(req, reply);
    void reply.setCookie(SESSION_COOKIE, grant.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: cookiePath(req),
      secure: ctx.secureCookies,
      maxAge: grant.cookieMaxAgeMs / 1000,
    });
  };

  // With lobby keys the world has no accounts of its own: register/login are closed before any counter or password work.
  const closedWithLobby = async (): Promise<void> => {
    if (ctx.lobby) throw new GameError('forbidden', 'Sign in through the lobby.');
  };
  const onlyWithLobby = async (): Promise<void> => {
    if (!ctx.lobby) throw new GameError('not_found', 'Not found.');
  };

  app.post<{ Body: EnterPassRequest }>(
    '/api/auth/enter',
    {
      // The pass is the credential: capped at 2 KB before anything reads it. Never logged, never in a URL.
      schema: { body: { type: 'object', required: ['pass'], additionalProperties: false, properties: { pass: { type: 'string', maxLength: ENTRY_PASS_MAX_CHARS } } } },
      onRequest: [onlyWithLobby, rateLimit(ctx, 'enter')],
    },
    async (req, reply): Promise<MeResponse> => {
      const lobby = ctx.lobby;
      if (!lobby) throw new GameError('not_found', 'Not found.');
      const { grant, created } = ctx.auth.enterWithPass(req.body.pass, lobby.keys, ctx.worldId, req.ip);
      setSession(req, reply, grant);
      void reply.code(created ? 201 : 200);
      return { player: ctx.auth.toDto(grant.player) };
    },
  );

  app.post<{ Body: AuthRequest }>(
    '/api/auth/register',
    { schema: registerSchema, onRequest: [closedWithLobby, rateLimit(ctx, 'register')] },
    async (req, reply): Promise<MeResponse> => {
      if (req.body.chieftain !== undefined) checkChieftain(req.body.chieftain);
      const grant = await ctx.auth.register(req.body.username, req.body.password, req.body.chieftain, req.ip);
      setSession(req, reply, grant);
      void reply.code(201);
      return { player: ctx.auth.toDto(grant.player) };
    },
  );

  app.post<{ Body: AuthRequest }>(
    '/api/auth/login',
    { schema: loginSchema, onRequest: [closedWithLobby, rateLimit(ctx, 'login')] },
    async (req, reply): Promise<MeResponse> => {
      const grant = await ctx.auth.login(req.body.username, req.body.password, req.ip);
      setSession(req, reply, grant);
      return { player: ctx.auth.toDto(grant.player) };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    ctx.auth.logout(req.cookies[SESSION_COOKIE]);
    void reply.clearCookie(SESSION_COOKIE, { path: cookiePath(req), httpOnly: true, sameSite: 'lax', secure: ctx.secureCookies });
    clearLegacy(req, reply);
    return reply.code(204).send();
  });

  app.post<{ Body: ChieftainRequest }>(
    '/api/me/chieftain',
    { onRequest: requireAuth(ctx), schema: chieftainSchema },
    async (req): Promise<MeResponse> => {
      checkChieftain(req.body.chieftain);
      return { player: ctx.auth.toDto(ctx.auth.setChieftain(playerOf(req), req.body.chieftain)) };
    },
  );

  app.post<{ Body: HouseholdRequest }>(
    '/api/me/household',
    {
      onRequest: requireAuth(ctx),
      schema: { body: { type: 'object', required: ['shared'], additionalProperties: false, properties: { shared: { type: 'boolean' } } } },
    },
    async (req): Promise<MeResponse> => ({ player: ctx.auth.toDto(ctx.auth.setHouseholdShared(playerOf(req), req.body.shared)) }),
  );

  app.post(
    '/api/me/abandoned-notice/dismiss',
    { onRequest: requireAuth(ctx) },
    async (req): Promise<MeResponse> => ({ player: ctx.auth.toDto(ctx.auth.dismissAbandonedNotice(playerOf(req))) }),
  );

  app.get('/api/auth/me', async (req): Promise<MeResponse> => {
    const player = ctx.auth.authenticate(req.cookies[SESSION_COOKIE]);
    return { player: player ? ctx.auth.toDto(player) : null };
  });
}
