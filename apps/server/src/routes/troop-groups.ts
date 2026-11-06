// Saved troop groups (a send-form convenience, docs/GAME_DESIGN.md army section). Contract: packages/engine/src/api.ts.
// Every statement is keyed on the caller's player id; someone else's group id answers 404 not_found like a missing one.

import type { FastifyInstance } from 'fastify';
import {
  GameError,
  TROOP_GROUP_MAX,
  checkTroopGroup,
  type TroopGroupDto,
  type TroopGroupRequest,
  type TroopGroupResponse,
  type TroopGroupsResponse,
} from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import type { TroopGroupRow } from '../troop-group-store.ts';
import { playerOf, requireAuth } from './auth.ts';

const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', pattern: '^[0-9]{1,12}$' } },
} as const;

// Values are left untyped on purpose: the schema would coerce "5" to 5; checkTroopGroup is the strict check.
const groupBody = {
  type: 'object',
  required: ['name', 'units'],
  additionalProperties: false,
  properties: { name: {}, units: {} },
} as const;

const emptyBody = { type: 'object', additionalProperties: false } as const;

const toDto = (g: TroopGroupRow): TroopGroupDto => ({ id: g.id, name: g.name, units: g.units });

function checked(body: TroopGroupRequest): { name: string; units: TroopGroupRow['units'] } {
  const c = checkTroopGroup(body.name, body.units);
  if (!c.ok) throw new GameError('invalid_input', c.message);
  return c;
}

const notFound = (): GameError => new GameError('not_found', 'That troop group does not exist.');

export function troopGroupRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { onRequest: requireAuth(ctx) };
  const { store } = ctx;
  type Id = { Params: { id: string } };

  app.get('/api/troop-groups', auth, async (req): Promise<TroopGroupsResponse> => ({ groups: store.troopGroups.list(playerOf(req).id).map(toDto) }));

  app.post<{ Body: TroopGroupRequest }>(
    '/api/troop-groups',
    { ...auth, schema: { body: groupBody } },
    async (req, reply): Promise<TroopGroupResponse> => {
      const player = playerOf(req);
      const { name, units } = checked(req.body);
      const row = store.tx(() => {
        if (store.troopGroups.count(player.id) >= TROOP_GROUP_MAX) {
          throw new GameError('group_limit', `You can save at most ${TROOP_GROUP_MAX} troop groups. Delete one first.`);
        }
        const id = store.troopGroups.insert(player.id, name, units, req.nowMs);
        return store.troopGroups.get1(player.id, id);
      });
      if (!row) throw new GameError('internal_error', 'The group was not saved.');
      void reply.code(201);
      return { group: toDto(row) };
    },
  );

  app.post<Id & { Body: TroopGroupRequest }>(
    '/api/troop-groups/:id',
    { ...auth, schema: { params: idParams, body: groupBody } },
    async (req): Promise<TroopGroupResponse> => {
      const player = playerOf(req);
      const id = Number(req.params.id);
      const { name, units } = checked(req.body);
      const row = store.tx(() => {
        if (!store.troopGroups.update(player.id, id, name, units)) return null;
        return store.troopGroups.get1(player.id, id);
      });
      if (!row) throw notFound();
      return { group: toDto(row) };
    },
  );

  app.post<Id>(
    '/api/troop-groups/:id/delete',
    { ...auth, schema: { params: idParams, body: emptyBody } },
    async (req, reply): Promise<void> => {
      if (!store.tx(() => store.troopGroups.delete(playerOf(req).id, Number(req.params.id)))) throw notFound();
      void reply.code(204);
    },
  );
}
