import type { FastifyInstance } from 'fastify';
import {
  BUILDING_IDS,
  MAX_TRAIN_BATCH,
  MISSIONS,
  MAX_UNIT_COUNT,
  RANK_TRACKS,
  RESOURCE_IDS,
  UNIT_IDS,
  type RankRequest,
  type ResearchRequest,
  type BuildRequest,
  type CancelBuildRequest,
  type CancelResponse,
  type CancelResearchRequest,
  type CancelTrainRequest,
  MAX_RESEARCH_QUEUE,
  MAX_TRAIN_QUEUE,
  MAX_BUILD_QUEUE,
  type FeastRequest,
  type FeastResponse,
  type GameStateResponse,
  type MapResponse,
  type MovementResponse,
  type OwnVillageDto,
  type RecallRequest,
  type SendRequest,
  type SendResponse,
  type SendShipmentRequest,
  type SendShipmentResponse,
  type TrainRequest,
} from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import { playerOf, requireAuth } from './auth.ts';

const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', pattern: '^[0-9]{1,15}$' } },
} as const;

const COORD = { type: 'integer', minimum: -1_000_000, maximum: 1_000_000 } as const;

const unitCounts = Object.fromEntries(UNIT_IDS.map((u) => [u, { type: 'integer', minimum: 0, maximum: MAX_UNIT_COUNT }]));

const buildBody = {
  type: 'object',
  required: ['building'],
  additionalProperties: false,
  properties: { building: { type: 'string', enum: [...BUILDING_IDS] } },
} as const;

const trainBody = {
  type: 'object',
  required: ['unit', 'count'],
  additionalProperties: false,
  properties: {
    unit: { type: 'string', enum: [...UNIT_IDS] },
    count: { type: 'integer', minimum: 1, maximum: MAX_TRAIN_BATCH },
  },
} as const;

const cancelBuildBody = {
  type: 'object',
  required: ['index'],
  additionalProperties: false,
  properties: { index: { type: 'integer', minimum: 0, maximum: MAX_BUILD_QUEUE } },
} as const;

const cancelResearchBody = {
  type: 'object',
  required: ['index'],
  additionalProperties: false,
  properties: { index: { type: 'integer', minimum: 0, maximum: MAX_RESEARCH_QUEUE } },
} as const;

// A Feast count is a small whole number; the engine's daily limit (FEAST_DAILY_PER_LEVEL x Banner Hall level) is far below this cap.
const FEAST_MAX_COUNT = 100;
const feastBody = {
  type: 'object',
  required: ['count'],
  additionalProperties: false,
  properties: { count: { type: 'integer', minimum: 1, maximum: FEAST_MAX_COUNT } },
} as const;

const cancelTrainBody = {
  type: 'object',
  required: ['building', 'index'],
  additionalProperties: false,
  properties: {
    building: { type: 'string', enum: ['barracks', 'stables'] },
    index: { type: 'integer', minimum: 0, maximum: MAX_TRAIN_QUEUE },
  },
} as const;

const researchBody = {
  type: 'object',
  required: ['unit'],
  additionalProperties: false,
  properties: { unit: { type: 'string', enum: [...UNIT_IDS] } },
} as const;

const rankBody = {
  type: 'object',
  required: ['unit', 'track'],
  additionalProperties: false,
  properties: {
    unit: { type: 'string', enum: [...UNIT_IDS] },
    track: { type: 'string', enum: [...RANK_TRACKS] },
  },
} as const;

const unitsObject = { type: 'object', additionalProperties: false, properties: unitCounts } as const;

const sendBody = {
  type: 'object',
  required: ['x', 'y', 'units', 'mission'],
  additionalProperties: false,
  properties: {
    x: COORD,
    y: COORD,
    units: unitsObject,
    mission: { type: 'string', enum: [...MISSIONS] },
    travelSeconds: { type: 'integer', minimum: 0, maximum: 86400 },
    returnSeconds: { type: 'integer', minimum: 0, maximum: 86400 },
  },
} as const;

const resourceAmounts = Object.fromEntries(RESOURCE_IDS.map((r) => [r, { type: 'integer', minimum: 0, maximum: 1_000_000_000 }]));

const shipBody = {
  type: 'object',
  required: ['x', 'y', 'resources'],
  additionalProperties: false,
  properties: {
    x: COORD,
    y: COORD,
    resources: { type: 'object', additionalProperties: false, properties: resourceAmounts },
  },
} as const;

// `units` omitted = bring everybody home. A request without any body counts as `{}` (see the route's preValidation).
const recallBody = {
  type: 'object',
  additionalProperties: false,
  properties: { units: unitsObject },
} as const;

// Query values are strings (type coercion is off globally); the handler turns them into integers.
const INT_QUERY = { type: 'string', pattern: '^-?[0-9]{1,7}$' } as const;
const mapQuery = {
  type: 'object',
  required: ['x', 'y', 'w', 'h'],
  additionalProperties: false,
  properties: { x: INT_QUERY, y: INT_QUERY, w: INT_QUERY, h: INT_QUERY },
} as const;

export function gameRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { onRequest: requireAuth(ctx) };

  // Test mode: the service refuses accounts outside SANDBOX_USERS (403 forbidden). Logged as an audit line.
  for (const action of ['max', 'reset'] as const) {
    app.post(`/api/sandbox/${action}`, auth, async (req): Promise<GameStateResponse> => {
      const res = ctx.game.sandbox(playerOf(req), action, req.nowMs);
      req.log.warn({ playerId: playerOf(req).id, action }, 'sandbox action');
      return res;
    });
  }

  app.post<{ Body: { seconds: number } }>(
    '/api/sandbox/warp',
    {
      ...auth,
      schema: {
        body: {
          type: 'object',
          required: ['seconds'],
          additionalProperties: false,
          properties: { seconds: { type: 'integer', minimum: 0, maximum: 3600 } },
        },
      },
    },
    async (req): Promise<GameStateResponse> => {
      const res = ctx.game.sandboxWarp(playerOf(req), req.body.seconds, req.nowMs);
      req.log.warn({ playerId: playerOf(req).id, action: 'warp', seconds: req.body.seconds }, 'sandbox action');
      return res;
    },
  );

  app.post('/api/sandbox/clear-abandoned', auth, async (req): Promise<GameStateResponse> => {
    const res = ctx.game.sandboxClearAbandoned(playerOf(req), req.nowMs);
    req.log.warn({ playerId: playerOf(req).id, action: 'clear-abandoned' }, 'sandbox action');
    return res;
  });

  app.get('/api/state', auth, async (req): Promise<GameStateResponse> => ctx.game.getState(playerOf(req), req.nowMs));

  app.post<{ Params: { id: string }; Body: BuildRequest }>(
    '/api/villages/:id/build',
    { ...auth, schema: { params: idParams, body: buildBody } },
    async (req): Promise<OwnVillageDto> => ctx.game.build(playerOf(req), Number(req.params.id), req.body.building, req.nowMs),
  );

  app.post<{ Params: { id: string }; Body: TrainRequest }>(
    '/api/villages/:id/train',
    { ...auth, schema: { params: idParams, body: trainBody } },
    async (req): Promise<OwnVillageDto> =>
      ctx.game.train(playerOf(req), Number(req.params.id), req.body.unit, req.body.count, req.nowMs),
  );

  app.post<{ Params: { id: string }; Body: CancelBuildRequest }>(
    '/api/villages/:id/cancel-build',
    { ...auth, schema: { params: idParams, body: cancelBuildBody } },
    async (req): Promise<CancelResponse> => ctx.game.cancelBuild(playerOf(req), Number(req.params.id), req.body.index, req.nowMs),
  );

  app.post<{ Params: { id: string }; Body: CancelTrainRequest }>(
    '/api/villages/:id/cancel-train',
    { ...auth, schema: { params: idParams, body: cancelTrainBody } },
    async (req): Promise<CancelResponse> =>
      ctx.game.cancelTrain(playerOf(req), Number(req.params.id), req.body.building, req.body.index, req.nowMs),
  );

  app.post<{ Params: { id: string }; Body: CancelResearchRequest }>(
    '/api/villages/:id/cancel-research',
    { ...auth, schema: { params: idParams, body: cancelResearchBody } },
    async (req): Promise<CancelResponse> => ctx.game.cancelResearch(playerOf(req), Number(req.params.id), req.body.index, req.nowMs),
  );

  app.post<{ Params: { id: string }; Body: ResearchRequest }>(
    '/api/villages/:id/research',
    { ...auth, schema: { params: idParams, body: researchBody } },
    async (req): Promise<OwnVillageDto> => ctx.game.research(playerOf(req), Number(req.params.id), req.body.unit, req.nowMs),
  );

  app.post<{ Params: { id: string }; Body: FeastRequest }>(
    '/api/villages/:id/feast',
    { ...auth, schema: { params: idParams, body: feastBody } },
    async (req): Promise<FeastResponse> => ctx.game.feast(playerOf(req), Number(req.params.id), req.body.count, req.nowMs),
  );

  for (const action of ['rank', 'respec'] as const) {
    app.post<{ Params: { id: string }; Body: RankRequest }>(
      `/api/villages/:id/${action}`,
      { ...auth, schema: { params: idParams, body: rankBody } },
      async (req): Promise<OwnVillageDto> => {
        const { unit, track } = req.body;
        const res = ctx.game[action](playerOf(req), Number(req.params.id), unit, track, req.nowMs);
        if (action === 'respec') req.log.info({ playerId: playerOf(req).id, villageId: req.params.id, unit, track }, 'respec');
        return res;
      },
    );
  }

  app.post<{ Params: { id: string }; Body: SendRequest }>(
    '/api/villages/:id/send',
    { ...auth, schema: { params: idParams, body: sendBody } },
    async (req, reply): Promise<SendResponse> => {
      const { x, y, units, mission, travelSeconds, returnSeconds } = req.body;
      const res = ctx.game.send(playerOf(req), Number(req.params.id), x, y, units, mission, req.nowMs, { travelSeconds, returnSeconds });
      void reply.code(201);
      return res;
    },
  );

  app.post<{ Params: { id: string }; Body: SendShipmentRequest }>(
    '/api/villages/:id/ship',
    { ...auth, schema: { params: idParams, body: shipBody } },
    async (req, reply): Promise<SendShipmentResponse> => {
      const { x, y, resources } = req.body;
      const res = ctx.game.sendShipment(playerOf(req), Number(req.params.id), x, y, resources, req.nowMs);
      void reply.code(201);
      return res;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/movements/:id/cancel',
    { ...auth, schema: { params: idParams } },
    async (req, reply): Promise<MovementResponse> => {
      const res = ctx.game.cancel(playerOf(req), Number(req.params.id), req.nowMs);
      void reply.code(201);
      return res;
    },
  );

  // ---- support troops standing in a village (section 12) --------------------------------------------------

  app.post<{ Params: { id: string }; Body: RecallRequest }>(
    '/api/stationed/:id/recall',
    {
      ...auth,
      // The JSON parser hands over `undefined` for an empty body, which the object schema would refuse.
      preValidation: async (req) => {
        if (req.body === undefined) (req as { body: unknown }).body = {};
      },
      schema: { params: idParams, body: recallBody },
    },
    async (req, reply): Promise<MovementResponse> => {
      const res = ctx.game.recall(playerOf(req), Number(req.params.id), req.body.units, req.nowMs);
      void reply.code(201);
      return res;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/stationed/:id/send-back',
    { ...auth, schema: { params: idParams } },
    async (req, reply): Promise<MovementResponse> => {
      const res = ctx.game.sendBack(playerOf(req), Number(req.params.id), req.nowMs);
      void reply.code(201);
      return res;
    },
  );

  app.get<{ Querystring: { x: string; y: string; w: string; h: string } }>(
    '/api/map',
    { ...auth, schema: { querystring: mapQuery } },
    async (req): Promise<MapResponse> => {
      const { x, y, w, h } = req.query;
      return ctx.game.map(playerOf(req), Number(x), Number(y), Number(w), Number(h), req.nowMs);
    },
  );
}
