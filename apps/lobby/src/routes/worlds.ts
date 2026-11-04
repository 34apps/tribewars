import type { FastifyInstance } from 'fastify';
import { GameError, WORLD_ID_PATTERN, type EnterWorldResponse, type LobbyWorldsResponse } from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import { signPass } from '../pass.ts';
import { accountOf, requireAccount } from './auth.ts';

export function worldRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/worlds', { onRequest: requireAccount(ctx) }, async (): Promise<LobbyWorldsResponse> => ({
    worlds: ctx.store.listWorlds().map((w) => ({ id: w.id, name: w.name, status: w.status, path: w.path })),
  }));

  // The body is empty or `{}`; anything else is refused.
  app.post<{ Params: { id: string }; Body: unknown }>('/api/worlds/:id/enter', { onRequest: requireAccount(ctx) }, async (req, reply): Promise<EnterWorldResponse> => {
    const account = accountOf(req);
    const worldId = req.params.id;
    if (!WORLD_ID_PATTERN.test(worldId)) throw new GameError('invalid_input', 'Invalid world id.');
    const body = req.body;
    if (body !== undefined && (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).length > 0)) {
      throw new GameError('invalid_input', 'The request body must be empty.');
    }
    // Each pass is a signature and an audit row: cap them per account and per IP.
    const allowedAccount = ctx.enterAccountLimiter.allow(String(account.id), req.nowMs);
    const allowedIp = ctx.enterIpLimiter.allow(req.ip, req.nowMs);
    if (!allowedAccount || !allowedIp) {
      void reply.header('Retry-After', '60');
      throw new GameError('rate_limited', 'Too many attempts. Please wait a minute and try again.');
    }
    const world = ctx.store.getWorld(worldId);
    if (!world) throw new GameError('not_found', 'No such world.');
    if (world.status === 'closed') throw new GameError('forbidden', 'This world is closed.');
    // 'full' still gets a pass: the world decides about newcomers, returning players may always enter.
    const { pass, claims } = signPass({ aid: account.id, name: account.username, wid: world.id, chn: account.chieftain, role: account.staffRole }, ctx.signingKey, req.nowMs);
    ctx.store.audit({ at: req.nowMs, actorId: account.id, actorIp: req.ip, action: 'enter', targetAccount: account.id, detail: world.id });
    return { pass, path: world.path, expiresAt: claims.exp };
  });
}
