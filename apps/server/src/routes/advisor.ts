// POST /api/advisor/ask: Mags the Tinker answers a question using the player's real state. Not imported by apps/preview.

import type { FastifyInstance } from 'fastify';
import { ADVISOR_QUESTION_MAX, GameError, type AdvisorAskRequest, type AdvisorAskResponse } from '@clanfire/engine';
import type { AdvisorService } from '../advisor.ts';
import type { AppContext } from '../context.ts';
import { playerOf, requireAuth } from './auth.ts';

export function advisorRoutes(app: FastifyInstance, ctx: AppContext, advisor: AdvisorService): void {
  app.post<{ Body: AdvisorAskRequest }>(
    '/api/advisor/ask',
    {
      onRequest: requireAuth(ctx),
      schema: {
        body: {
          type: 'object',
          required: ['question'],
          additionalProperties: false,
          // Length is checked after trimming, below (a little slack here for surrounding whitespace).
          properties: { question: { type: 'string', maxLength: ADVISOR_QUESTION_MAX * 2 } },
        },
      },
    },
    async (req): Promise<AdvisorAskResponse> => {
      const question = req.body.question.trim();
      if (question === '' || question.length > ADVISOR_QUESTION_MAX) {
        throw new GameError('invalid_input', `Ask Mags a question of 1 to ${ADVISOR_QUESTION_MAX} characters.`);
      }
      return advisor.ask(playerOf(req), question, req.nowMs);
    },
  );
}
