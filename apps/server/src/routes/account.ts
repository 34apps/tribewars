// Account data (docs/PRIVACY.md): the player's own export, deletion in a world with its own accounts, and the signed commands the lobby
// sends when it deletes an account or builds a full export. Contract: end of packages/engine/src/api.ts.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ACCOUNT_DELETE_CONFIRM, GameError, type AccountDeleteRequest, type LobbyCommandRequest, type WorldExportDto } from '@clanfire/engine';
import { ENTRY_PASS_MAX_CHARS } from '../entry-pass.ts';
import { SESSION_COOKIE, verifyPassword } from '../auth.ts';
import type { AppContext } from '../context.ts';
import { sessionCookiePath } from '../world-path.ts';
import { playerOf, rateLimit, requireAuth } from './auth.ts';

export function accountRoutes(app: FastifyInstance, ctx: AppContext): void {
  const data = ctx.accountData;
  if (!data) return; // a context without the service mounts nothing

  const onlyWithLobby = async (): Promise<void> => {
    if (!ctx.lobby) throw new GameError('not_found', 'Not found.');
  };
  const onlyWithoutLobby = async (): Promise<void> => {
    if (ctx.lobby) throw new GameError('forbidden', 'Delete your account in the lobby.');
  };

  const cookiePath = (req: FastifyRequest): string => sessionCookiePath(String(req.originalUrl ?? req.url ?? ''), ctx.worldId);

  // ---- the player's own export (every mode) -------------------------------------------------------------
  app.get('/api/account/export', { onRequest: requireAuth(ctx, false) }, async (req, reply): Promise<WorldExportDto> => {
    const player = playerOf(req);
    const dto = data.exportFor(player, req.nowMs);
    void reply.header('Content-Disposition', `attachment; filename="clanflame-${ctx.worldId}-${player.username.replace(/[^A-Za-z0-9_-]/g, '_')}.json"`);
    void reply.header('Cache-Control', 'no-store');
    return dto;
  });

  // ---- deletion in a world with its own accounts (no lobby) ------------------------------------------------
  app.post<{ Body: AccountDeleteRequest }>(
    '/api/account/delete',
    {
      schema: {
        body: {
          type: 'object',
          required: ['password', 'confirm'],
          additionalProperties: false,
          properties: { password: { type: 'string', minLength: 1, maxLength: 256 }, confirm: { type: 'string', maxLength: 32 } },
        },
      },
      // Same attempt limit as sign-in (per IP): a stolen session must not be able to guess the password here.
      onRequest: [onlyWithoutLobby, rateLimit(ctx, 'login'), requireAuth(ctx, false)],
    },
    async (req, reply) => {
      const player = playerOf(req);
      if (req.body.confirm !== ACCOUNT_DELETE_CONFIRM) throw new GameError('invalid_input', `Type ${ACCOUNT_DELETE_CONFIRM} to confirm.`);
      if (!(await verifyPassword(req.body.password, player.passwordHash))) throw new GameError('unauthorized', 'Wrong password.');
      data.deletePlayer(player.id, req.nowMs, { via: 'self', actorId: player.id, actorIp: req.ip });
      void reply.clearCookie(SESSION_COOKIE, { path: cookiePath(req), httpOnly: true, sameSite: 'lax', secure: ctx.secureCookies });
      if (cookiePath(req) !== '/') void reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: ctx.secureCookies });
      return reply.code(204).send();
    },
  );

  // ---- lobby -> world commands (server to server: no cookie, no Origin; the signature is the credential) ------------------
  const commandSchema = {
    body: { type: 'object', required: ['command'], additionalProperties: false, properties: { command: { type: 'string', maxLength: ENTRY_PASS_MAX_CHARS } } },
  };
  app.post<{ Body: LobbyCommandRequest }>('/api/lobby/account/delete', { schema: commandSchema, onRequest: onlyWithLobby }, async (req): Promise<{ done: true }> => {
    const lobby = ctx.lobby;
    if (!lobby) throw new GameError('not_found', 'Not found.');
    return data.runLobbyCommand(req.body.command, lobby.keys, 'account_delete', req.ip);
  });
  app.post<{ Body: LobbyCommandRequest }>('/api/lobby/account/export', { schema: commandSchema, onRequest: onlyWithLobby }, async (req): Promise<WorldExportDto> => {
    const lobby = ctx.lobby;
    if (!lobby) throw new GameError('not_found', 'Not found.');
    return data.runLobbyCommand(req.body.command, lobby.keys, 'account_export', req.ip);
  });
}
