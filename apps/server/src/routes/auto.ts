// Auto mode (premium tools; docs/GAME_DESIGN.md "Auto mode and 5 build slots"). Contract: packages/engine/src/api.ts ("Auto mode").
// Every route is bucket `auto`. Reading is open to every player (without the tools everything shows as off); saving needs the world
// switch AND the player's extra (403 otherwise) and the village must be the caller's (403 stranger, 404 unknown).
// The schema keeps keys and types strict (goal objects: known ids only, integer ranges); the engine checks again (checkAutoSettings).

import type { FastifyInstance } from 'fastify';
import { AUTO_GOAL_MAX_TROOPS, AUTO_UNIT_IDS, BUILDINGS, BUILDING_IDS, type AutoOverviewResponse, type AutoSettingsRequest, type AutoVillageDto } from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import { playerOf, requireAuth } from './auth.ts';

const noQuery = { type: 'object', additionalProperties: false, properties: {} } as const;

const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', pattern: '^[0-9]{1,15}$' } },
} as const;

const troopGoalProps = Object.fromEntries(AUTO_UNIT_IDS.map((u) => [u, { type: 'integer', minimum: 0, maximum: AUTO_GOAL_MAX_TROOPS }]));
const buildingGoalProps = Object.fromEntries(BUILDING_IDS.map((b) => [b, { type: 'integer', minimum: 0, maximum: BUILDINGS[b].maxLevel }]));

const settingsBody = {
  type: 'object',
  required: ['on'],
  additionalProperties: false,
  properties: {
    on: { type: 'boolean' },
    troopGoals: { type: 'object', additionalProperties: false, properties: troopGoalProps },
    buildingGoals: { type: 'object', additionalProperties: false, properties: buildingGoalProps },
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
