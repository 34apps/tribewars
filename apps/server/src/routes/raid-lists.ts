// Raid lists, a paid extra (docs/GAME_DESIGN.md "Raid lists"). Contract: packages/engine/src/api.ts ("Raid lists, a paid extra").
// Writes and the send need the world switch AND the player's extra (403 otherwise); every list and row is keyed on the caller (someone
// else's id answers 404 not_found). Rows go out through GameService.send, so every normal send rule applies; the per-account `send`
// rate limit is charged once per row actually tried (ctx.chargeSend), on top of this route's own `raidlists` bucket.

import type { FastifyInstance } from 'fastify';
import {
  GameError,
  RAID_LIST_MAX_ROWS,
  type RaidListRequest,
  type RaidListResponse,
  type RaidListSendRequest,
  type RaidListSendResponse,
  type RaidListsResponse,
  type RaidRowRequest,
  type RaidRowUpdateRequest,
} from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import { playerOf, requireAuth } from './auth.ts';

const COORD = { type: 'integer', minimum: -1_000_000, maximum: 1_000_000 } as const;
const ID = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } as const;

const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', pattern: '^[0-9]{1,12}$' } },
} as const;

const rowParams = {
  type: 'object',
  required: ['id', 'rowId'],
  additionalProperties: false,
  properties: { id: { type: 'string', pattern: '^[0-9]{1,12}$' }, rowId: { type: 'string', pattern: '^[0-9]{1,12}$' } },
} as const;

// Name and units are left untyped on purpose: the schema would coerce nothing useful; checkRaidListName / checkRaidRowUnits are the strict checks.
const listBody = { type: 'object', required: ['name'], additionalProperties: false, properties: { name: {} } } as const;
const rowBody = {
  type: 'object',
  required: ['x', 'y', 'fromVillageId', 'units'],
  additionalProperties: false,
  properties: { x: COORD, y: COORD, fromVillageId: ID, units: {} },
} as const;
const rowUpdateBody = { type: 'object', additionalProperties: false, properties: { fromVillageId: ID, units: {} } } as const;
const sendBody = {
  type: 'object',
  additionalProperties: false,
  properties: { rowIds: { type: 'array', maxItems: RAID_LIST_MAX_ROWS, items: ID } },
} as const;
const emptyBody = { type: 'object', additionalProperties: false } as const;

export function raidListRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { onRequest: requireAuth(ctx) };
  const service = ctx.raidLists;
  type Id = { Params: { id: string } };
  type RowId = { Params: { id: string; rowId: string } };

  app.get('/api/raid-lists', auth, async (req): Promise<RaidListsResponse> => service.snapshot(playerOf(req)));

  app.post<{ Body: RaidListRequest }>('/api/raid-lists', { ...auth, schema: { body: listBody } }, async (req, reply): Promise<RaidListResponse> => {
    const res = service.createList(playerOf(req), req.body.name, req.nowMs);
    void reply.code(201);
    return res;
  });

  app.post<Id & { Body: RaidListRequest }>(
    '/api/raid-lists/:id',
    { ...auth, schema: { params: idParams, body: listBody } },
    async (req): Promise<RaidListResponse> => service.renameList(playerOf(req), Number(req.params.id), req.body.name),
  );

  app.post<Id>('/api/raid-lists/:id/delete', { ...auth, schema: { params: idParams, body: emptyBody } }, async (req, reply): Promise<void> => {
    service.deleteList(playerOf(req), Number(req.params.id));
    void reply.code(204);
  });

  app.post<Id & { Body: RaidRowRequest }>(
    '/api/raid-lists/:id/rows',
    { ...auth, schema: { params: idParams, body: rowBody } },
    async (req, reply): Promise<RaidListResponse> => {
      const res = service.addRow(playerOf(req), Number(req.params.id), req.body, req.nowMs);
      void reply.code(201);
      return res;
    },
  );

  app.post<RowId & { Body: RaidRowUpdateRequest }>(
    '/api/raid-lists/:id/rows/:rowId',
    { ...auth, schema: { params: rowParams, body: rowUpdateBody } },
    async (req): Promise<RaidListResponse> => service.updateRow(playerOf(req), Number(req.params.id), Number(req.params.rowId), req.body),
  );

  app.post<RowId>(
    '/api/raid-lists/:id/rows/:rowId/delete',
    { ...auth, schema: { params: rowParams, body: emptyBody } },
    async (req): Promise<RaidListResponse> => service.deleteRow(playerOf(req), Number(req.params.id), Number(req.params.rowId)),
  );

  app.post<Id & { Body: RaidListSendRequest }>(
    '/api/raid-lists/:id/send',
    { ...auth, schema: { params: idParams, body: sendBody } },
    async (req): Promise<RaidListSendResponse> => {
      const player = playerOf(req);
      const ids = req.body?.rowIds;
      // The schema already checks this; the in-browser preview's validator is a subset, so the handler repeats the check.
      if (ids !== undefined && (!Array.isArray(ids) || ids.length > RAID_LIST_MAX_ROWS || ids.some((n) => !Number.isSafeInteger(n) || n < 1))) {
        throw new GameError('invalid_input', 'rowIds must be a short list of row ids.');
      }
      const res = service.send(player, Number(req.params.id), ids, req.nowMs, () => ctx.chargeSend?.(player.id, req.nowMs) ?? true);
      req.log.info({ playerId: player.id, listId: Number(req.params.id), sent: res.sent, skipped: res.skipped }, 'raid list send');
      return res;
    },
  );
}
