import type { FastifyInstance } from 'fastify';
import {
  BUILDING_IDS,
  MAX_TRAIN_BATCH,
  MISSIONS,
  MAX_UNIT_COUNT,
  UNIT_IDS,
  type BuildRequest,
  type GameStateResponse,
  type MapResponse,
  type MovementResponse,
  type OwnVillageDto,
  type RecallRequest,
  type SendRequest,
  type SendResponse,
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

  app.post<{ Params: { id: string }; Body: SendRequest }>(
    '/api/villages/:id/send',
    { ...auth, schema: { params: idParams, body: sendBody } },
    async (req, reply): Promise<SendResponse> => {
      const { x, y, units, mission } = req.body;
      const res = ctx.game.send(playerOf(req), Number(req.params.id), x, y, units, mission, req.nowMs);
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
