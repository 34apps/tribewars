// POST /api/stats/page: the one analytics call of the browser (docs/ANALYTICS.md). The client says "this page was opened for the first time
// this session"; the SERVER decides whether anything is sent (analytics on, player not opted out) and sends it. Always 204, so the answer
// never tells the client whether tracking is on. Signed in only, rate-limited (security.ts bucket `stats`), page id from a fixed list.

import type { FastifyInstance } from 'fastify';
import { STATS_PAGES, type StatsPageRequest } from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import { playerOf, requireAuth } from './auth.ts';

export function statsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post<{ Body: StatsPageRequest }>(
    '/api/stats/page',
    {
      onRequest: requireAuth(ctx, false),
      schema: { body: { type: 'object', required: ['page'], additionalProperties: false, properties: { page: { type: 'string', enum: [...STATS_PAGES] } } } },
    },
    async (req, reply) => {
      ctx.analytics?.pageOpen(playerOf(req).id, req.body.page);
      return reply.code(204).send();
    },
  );
}
