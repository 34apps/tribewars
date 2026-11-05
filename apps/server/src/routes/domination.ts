// Domination status and world end (contract: packages/engine/src/api.ts). Signed-in players only; reads public numbers
// (ranking points, counts) and writes nothing.

import type { FastifyInstance } from 'fastify';
import type { DominationStatusDto, WorldEndResponse } from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import { requireAuth } from './auth.ts';

export function dominationRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { onRequest: requireAuth(ctx) };
  app.get('/api/domination', auth, async (req): Promise<DominationStatusDto> => ctx.domination.status(req.nowMs));
  app.get('/api/world-end', auth, async (): Promise<WorldEndResponse> => ({ ended: ctx.domination.ended() }));
}
