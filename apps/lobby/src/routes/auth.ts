import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { GameError, LOBBY_PREFIX, LOBBY_SESSION_COOKIE, isChieftainId, type LobbyAuthRequest, type LobbyMeResponse } from '@clanfire/engine';
import { PASSWORD_MAX, PASSWORD_MIN, SESSION_TTL_MS, USERNAME_PATTERN, type SessionGrant } from '../auth.ts';
import type { AppContext } from '../context.ts';
import type { AccountRow } from '../store.ts';

/** The session cookie only travels to /lobby/..., never to the worlds that share the domain. */
export const COOKIE_PATH = `${LOBBY_PREFIX}/`;

/** Route-level hook: attach the signed-in account or answer 401 (403 for a banned one). Runs before body validation. */
export function requireAccount(ctx: AppContext) {
  return async (req: FastifyRequest): Promise<void> => {
    const account = ctx.auth.lookup(req.cookies[LOBBY_SESSION_COOKIE]);
    if (!account) throw new GameError('unauthorized', 'Please sign in.');
    if (account.bannedAt !== null) {
      ctx.store.deleteSessionsOf(account.id); // a ban normally already did this; make sure
      throw new GameError('forbidden', 'This account has been suspended.');
    }
    req.account = account;
  };
}

/** The account attached by `requireAccount`. */
export function accountOf(req: FastifyRequest): AccountRow {
  if (!req.account) throw new GameError('unauthorized', 'Please sign in.');
  return req.account;
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

  const cookieAttrs = { path: COOKIE_PATH, httpOnly: true, sameSite: 'lax', secure: ctx.secureCookies } as const;
  const setSession = (reply: FastifyReply, grant: SessionGrant): void => {
    void reply.setCookie(LOBBY_SESSION_COOKIE, grant.token, { ...cookieAttrs, maxAge: SESSION_TTL_MS / 1000 });
  };

  app.post<{ Body: LobbyAuthRequest }>(
    '/api/auth/register',
    { schema: registerSchema, onRequest: rateLimit(ctx, 'register') },
    async (req, reply): Promise<LobbyMeResponse> => {
      if (req.body.chieftain !== undefined && !isChieftainId(req.body.chieftain)) throw new GameError('invalid_input', 'Unknown chieftain.');
      const grant = await ctx.auth.register(req.body.username, req.body.password, req.body.chieftain, req.ip);
      setSession(reply, grant);
      void reply.code(201);
      return { account: ctx.auth.toDto(grant.account) };
    },
  );

  app.post<{ Body: LobbyAuthRequest }>(
    '/api/auth/login',
    { schema: loginSchema, onRequest: rateLimit(ctx, 'login') },
    async (req, reply): Promise<LobbyMeResponse> => {
      const grant = await ctx.auth.login(req.body.username, req.body.password, req.ip);
      setSession(reply, grant);
      return { account: ctx.auth.toDto(grant.account) };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    ctx.auth.logout(req.cookies[LOBBY_SESSION_COOKIE]);
    void reply.clearCookie(LOBBY_SESSION_COOKIE, cookieAttrs);
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (req): Promise<LobbyMeResponse> => {
    const account = ctx.auth.authenticate(req.cookies[LOBBY_SESSION_COOKIE]);
    return { account: account ? ctx.auth.toDto(account) : null };
  });
}
