// Auto mode (premium tools; docs/GAME_DESIGN.md "Auto mode and 5 build slots"). Contract: packages/engine/src/api.ts ("Auto mode").
// Every route is bucket `auto`. Reading is open to every player (without the tools everything shows as off); saving needs the world
// switch AND the player's extra (403 otherwise) and the village must be the caller's (403 stranger, 404 unknown).
// The schema keeps keys and types strict; the units list is checked again by the engine (checkAutoSettings) against AUTO_UNIT_IDS.

import type { FastifyInstance } from 'fastify';
import { AUTO_SHARE_STEP, AUTO_UNIT_IDS, type AutoOverviewResponse, type AutoSettingsRequest, type AutoVillageDto } from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import { playerOf, requireAuth } from './auth.ts';

const noQuery = { type: 'object', additionalProperties: false, properties: {} } as const;

const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', pattern: '^[0-9]{1,15}$' } },
} as const;

const settingsBody = {
  type: 'object',
  required: ['on'],
  additionalProperties: false,
  properties: {
    on: { type: 'boolean' },
    buildShare: { type: 'integer', minimum: 0, maximum: 100, multipleOf: AUTO_SHARE_STEP },
    units: { type: 'array', maxItems: AUTO_UNIT_IDS.length, uniqueItems: true, items: { type: 'string', enum: [...AUTO_UNIT_IDS] } },
  },
} as const;

export function autoRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { onRequest: requireAuth(ctx) };

  app.get('/api/auto', { ...auth, schema: { querystring: noQuery } }, async (req): Promise<AutoOverviewResponse> => ctx.game.autoOverview(playerOf(req), req.nowMs));

  app.post<{ Params: { id: string }; Body: AutoSettingsRequest }>(
    '/api/villages/:id/auto',
    { ...auth, schema: { params: idParams, body: settingsBody } },
    async (req): Promise<AutoVillageDto> => ctx.game.setAutoMode(playerOf(req), Number(req.params.id), req.body, req.nowMs),
  );
}
