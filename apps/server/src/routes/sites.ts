// Map sites (Fire Shrines): the list and recalling troops. Sending troops to a site uses the normal send route
// (POST /api/villages/:id/send with the site's tile). Contract: packages/engine/src/api.ts.

import type { FastifyInstance } from 'fastify';
import { MAX_UNIT_COUNT, UNIT_IDS, type MovementResponse, type SiteRecallRequest, type SitesResponse } from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import { playerOf, requireAuth } from './auth.ts';

const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', pattern: '^[0-9]{1,6}$' } },
} as const;

const unitCounts = Object.fromEntries(UNIT_IDS.map((u) => [u, { type: 'integer', minimum: 0, maximum: MAX_UNIT_COUNT }]));

const recallBody = {
  type: 'object',
  required: ['villageId'],
  additionalProperties: false,
  properties: {
    villageId: { type: 'integer', minimum: 1, maximum: 2_000_000_000 },
    units: { type: 'object', additionalProperties: false, properties: unitCounts },
  },
} as const;

export function siteRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { onRequest: requireAuth(ctx) };
  app.get('/api/sites', auth, async (req): Promise<SitesResponse> => ctx.game.sites.list(playerOf(req), req.nowMs));

  app.post<{ Params: { id: string }; Body: SiteRecallRequest }>(
    '/api/sites/:id/recall',
    { ...auth, schema: { params: idParams, body: recallBody } },
    async (req, reply): Promise<MovementResponse> => {
      const res = ctx.game.recallSite(playerOf(req), Number(req.params.id), req.body.villageId, req.body.units, req.nowMs);
      void reply.code(201);
      return res;
    },
  );
}
