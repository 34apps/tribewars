// First steps card (docs/GAME_DESIGN.md "First steps"). The state itself rides on GET /api/state (`firstSteps`);
// these two routes claim a reward and fold the card away. Contract: packages/engine/src/api.ts.

import type { FastifyInstance } from 'fastify';
import { FIRST_STEPS, type FirstStepClaimRequest, type FirstStepClaimResponse, type FirstStepHiddenRequest, type FirstStepId, type FirstStepsDto } from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import { playerOf, requireAuth } from './auth.ts';

const claimParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', enum: FIRST_STEPS.map((s) => s.id) } },
} as const;

const claimBody = {
  type: 'object',
  required: ['villageId'],
  additionalProperties: false,
  properties: { villageId: { type: 'integer', minimum: 1, maximum: 2_000_000_000 } },
} as const;

const hiddenBody = {
  type: 'object',
  required: ['hidden'],
  additionalProperties: false,
  properties: { hidden: { type: 'boolean' } },
} as const;

export function firstStepsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { onRequest: requireAuth(ctx) };

  app.post<{ Params: { id: FirstStepId }; Body: FirstStepClaimRequest }>(
    '/api/first-steps/:id/claim',
    { ...auth, schema: { params: claimParams, body: claimBody } },
    async (req): Promise<FirstStepClaimResponse> => ctx.game.claimFirstStep(playerOf(req), req.params.id, req.body.villageId, req.nowMs),
  );

  app.post<{ Body: FirstStepHiddenRequest }>(
    '/api/first-steps/hidden',
    { ...auth, schema: { body: hiddenBody } },
    async (req): Promise<FirstStepsDto> => ctx.game.setFirstStepsHidden(playerOf(req), req.body.hidden, req.nowMs),
  );
}
