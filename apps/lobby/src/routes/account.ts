// Account data rights: deletion (with the deletion info shown first) and the data export. Contract: end of packages/engine/src/api.ts.

import type { FastifyInstance } from 'fastify';
import { ACCOUNT_DELETE_CONFIRM, GameError, LOBBY_SESSION_COOKIE, type AccountDeleteRequest, type AccountDeletionInfoDto, type LobbyMeResponse, type LobbyShareStatsRequest } from '@clanfire/engine';
import { PASSWORD_MAX } from '../auth.ts';
import type { AppContext } from '../context.ts';
import { COOKIE_PATH, accountOf, rateLimit, requireAccount } from './auth.ts';

export function accountRoutes(app: FastifyInstance, ctx: AppContext): void {
  const deleteSchema = {
    body: {
      type: 'object',
      required: ['password', 'confirm'],
      additionalProperties: false,
      properties: {
        password: { type: 'string', minLength: 1, maxLength: PASSWORD_MAX },
        confirm: { type: 'string', maxLength: 32 },
      },
    },
  };

  // The "Share play stats" switch (docs/ANALYTICS.md). Own account only. Worlds follow at the account's next entry (the pass carries it).
  app.post<{ Body: LobbyShareStatsRequest }>(
    '/api/account/share-stats',
    { schema: { body: { type: 'object', required: ['share'], additionalProperties: false, properties: { share: { type: 'boolean' } } } }, onRequest: requireAccount(ctx) },
    async (req): Promise<LobbyMeResponse> => {
      const account = accountOf(req);
      ctx.store.setShareStats(account.id, req.body.share);
      ctx.store.audit({ at: req.nowMs, actorId: account.id, actorIp: null, action: req.body.share ? 'share_stats_on' : 'share_stats_off', targetAccount: account.id, detail: '' });
      return { account: ctx.auth.toDto(ctx.store.getAccount(account.id) ?? account) };
    },
  );

  app.get('/api/account/deletion-info', { onRequest: requireAccount(ctx) }, async (req): Promise<AccountDeletionInfoDto> => ctx.accountData.deletionInfo(accountOf(req)));

  // Same password check and lockout as sign-in (and the same per-IP bucket as sign-in and change-password).
  app.post<{ Body: AccountDeleteRequest }>(
    '/api/account/delete',
    { schema: deleteSchema, onRequest: [requireAccount(ctx), rateLimit(ctx, 'login')] },
    async (req, reply) => {
      const account = accountOf(req);
      if (req.body.confirm !== ACCOUNT_DELETE_CONFIRM) throw new GameError('invalid_input', `Type ${ACCOUNT_DELETE_CONFIRM} to confirm.`);
      await ctx.auth.verifyCredentials(account.username, req.body.password);
      ctx.accountData.deleteAccount(account.id, { kind: 'self', ip: req.ip });
      void reply.clearCookie(LOBBY_SESSION_COOKIE, { path: COOKIE_PATH, httpOnly: true, sameSite: 'lax', secure: ctx.secureCookies });
      // Tell the worlds right away; whatever fails is retried by the maintenance timer.
      void ctx.dispatcher.runPending().catch(() => {});
      return reply.code(204).send();
    },
  );

  app.get('/api/account/export', { onRequest: requireAccount(ctx) }, async (req, reply) => {
    const account = accountOf(req);
    if (!ctx.exportLimiter.allow(String(account.id), req.nowMs)) {
      void reply.header('Retry-After', '600');
      throw new GameError('rate_limited', 'You can download your data twice in 10 minutes. Please try again later.');
    }
    const dto = await ctx.accountData.exportAccount(account);
    void reply.header('Content-Disposition', `attachment; filename="clanflame-data-${account.username}.json"`);
    void reply.header('Cache-Control', 'no-store');
    void reply.header('Content-Type', 'application/json; charset=utf-8');
    return reply.send(JSON.stringify(dto, null, 2));
  });
}
