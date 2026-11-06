import type { FastifyInstance } from 'fastify';
import type { ReportDto, ReportListResponse, ScoutedResponse } from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import { playerOf, requireAuth } from './auth.ts';

export function reportRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { onRequest: requireAuth(ctx) };

  app.get('/api/reports', auth, async (req): Promise<ReportListResponse> => {
    return ctx.game.listReports(playerOf(req));
  });

  app.get<{ Params: { id: string } }>(
    '/api/reports/:id',
    {
      ...auth,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          additionalProperties: false,
          properties: { id: { type: 'string', pattern: '^[0-9]{1,15}$' } },
        },
      },
    },
    async (req): Promise<ReportDto> => {
      return ctx.game.getReport(playerOf(req), Number(req.params.id));
    },
  );

  // The caller's own latest scout intel (building levels) on a village, for the Boulder Sling picker.
  app.get<{ Params: { id: string } }>(
    '/api/scouted/:id',
    {
      ...auth,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          additionalProperties: false,
          properties: { id: { type: 'string', pattern: '^[0-9]{1,9}$' } },
        },
      },
    },
    async (req): Promise<ScoutedResponse> => ctx.game.scoutedBuildings(playerOf(req), Number(req.params.id)),
  );
}
