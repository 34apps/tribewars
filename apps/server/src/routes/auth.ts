import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { GameError, isChieftainId, type AuthRequest, type ChieftainRequest, type MeResponse } from '@clanfire/engine';
import { PASSWORD_MAX, PASSWORD_MIN, SESSION_COOKIE, SESSION_TTL_MS, USERNAME_PATTERN, type SessionGrant } from '../auth.ts';
import type { AppContext } from '../context.ts';
import type { PlayerRow } from '../store.ts';

/** Route-level hook: attach the signed-in player or answer 401. Runs before body validation. */
export function requireAuth(ctx: AppContext) {
  return async (req: FastifyRequest): Promise<void> => {
    const player = ctx.auth.authenticate(req.cookies[SESSION_COOKIE]);
    if (!player) throw new GameError('unauthorized', 'Please sign in.');
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

  const setSession = (reply: FastifyReply, grant: SessionGrant): void => {
    void reply.setCookie(SESSION_COOKIE, grant.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: ctx.secureCookies,
      maxAge: SESSION_TTL_MS / 1000,
    });
  };

  app.post<{ Body: AuthRequest }>(
    '/api/auth/register',
    { schema: registerSchema, onRequest: rateLimit(ctx, 'register') },
    async (req, reply): Promise<MeResponse> => {
      if (req.body.chieftain !== undefined) checkChieftain(req.body.chieftain);
      const grant = await ctx.auth.register(req.body.username, req.body.password, req.body.chieftain);
      setSession(reply, grant);
      void reply.code(201);
      return { player: ctx.auth.toDto(grant.player) };
    },
  );

  app.post<{ Body: AuthRequest }>(
    '/api/auth/login',
    { schema: loginSchema, onRequest: rateLimit(ctx, 'login') },
    async (req, reply): Promise<MeResponse> => {
      const grant = await ctx.auth.login(req.body.username, req.body.password);
      setSession(reply, grant);
      return { player: ctx.auth.toDto(grant.player) };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    ctx.auth.logout(req.cookies[SESSION_COOKIE]);
    void reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: ctx.secureCookies });
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

  app.get('/api/auth/me', async (req): Promise<MeResponse> => {
    const player = ctx.auth.authenticate(req.cookies[SESSION_COOKIE]);
    return { player: player ? ctx.auth.toDto(player) : null };
  });
}
