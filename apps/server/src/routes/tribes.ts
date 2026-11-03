// Tribe routes (contract: packages/engine/src/api.ts). Every route needs a signed-in player; the rules live in
// TribeService. Mutations are POST + JSON like the rest of the API (Origin check in app.ts).

import type { FastifyInstance } from 'fastify';
import {
  RECRUITMENT_MODES,
  TRIBE_ROLES,
  DIPLOMACY_KINDS,
  type ApplyRequest,
  type ChatMessageDto,
  type ChatRequest,
  type ChatResponse,
  type CreateTribeRequest,
  type DiplomacyRequest,
  type InviteRequest,
  type MyTribeResponse,
  type RoleRequest,
  type SetGrantsRequest,
  type TransferRequest,
  type TribeDto,
  type TribeMemberDto,
  type TribeAlertsResponse,
  type TribeListResponse,
  type TribeSettingsRequest,
} from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import { playerOf, requireAuth } from './auth.ts';

const ID = { type: 'string', pattern: '^[0-9]{1,15}$' } as const;

function params<K extends string>(...names: K[]) {
  return {
    type: 'object',
    required: names,
    additionalProperties: false,
    properties: Object.fromEntries(names.map((n) => [n, ID])),
  } as const;
}

const RECRUITMENT = { type: 'string', enum: [...RECRUITMENT_MODES] } as const;
// Generous schema limits only guard against huge strings; the precise length rules run in the service
// (they count characters after trimming and give readable messages).
const createBody = {
  type: 'object',
  required: ['name', 'tag', 'recruitment'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    tag: { type: 'string', minLength: 1, maxLength: 20 },
    description: { type: 'string', maxLength: 4000 },
    recruitment: RECRUITMENT,
  },
} as const;

const applyBody = {
  type: 'object',
  required: ['message'],
  additionalProperties: false,
  properties: { message: { type: 'string', maxLength: 2000 } },
} as const;

const settingsBody = {
  type: 'object',
  additionalProperties: false,
  properties: { description: { type: 'string', maxLength: 4000 }, recruitment: RECRUITMENT },
} as const;

const inviteBody = {
  type: 'object',
  required: ['username'],
  additionalProperties: false,
  properties: { username: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

const roleBody = {
  type: 'object',
  required: ['role'],
  additionalProperties: false,
  properties: { role: { type: 'string', enum: TRIBE_ROLES.filter((r) => r !== 'leader') } },
} as const;

// Which rights are grantable is the engine's call (parseGrants in the service); this only bounds the shape.
const grantsBody = {
  type: 'object',
  required: ['grants'],
  additionalProperties: false,
  properties: { grants: { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 40 } } },
} as const;

const transferBody = {
  type: 'object',
  required: ['playerId'],
  additionalProperties: false,
  properties: { playerId: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } },
} as const;

const diplomacyBody = {
  type: 'object',
  required: ['tag', 'kind'],
  additionalProperties: false,
  properties: {
    tag: { type: 'string', minLength: 1, maxLength: 20 },
    kind: { type: 'string', enum: [...DIPLOMACY_KINDS] },
  },
} as const;

const chatBody = {
  type: 'object',
  required: ['text'],
  additionalProperties: false,
  properties: { text: { type: 'string', maxLength: 4000 } },
} as const;

const listQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { q: { type: 'string', maxLength: 64 } },
} as const;

const chatQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { after: ID },
} as const;

export function tribeRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { onRequest: requireAuth(ctx) };
  const svc = ctx.tribes;
  type IdParams = { Params: { id: string } };

  // ---- public views and joining --------------------------------------------------------------------

  app.get<{ Querystring: { q?: string } }>(
    '/api/tribes',
    { ...auth, schema: { querystring: listQuery } },
    async (req): Promise<TribeListResponse> => svc.list(req.query.q),
  );

  app.get<IdParams>(
    '/api/tribes/:id',
    { ...auth, schema: { params: params('id') } },
    async (req): Promise<TribeDto> => svc.get(Number(req.params.id), req.nowMs),
  );

  app.post<{ Body: CreateTribeRequest }>(
    '/api/tribes',
    { ...auth, schema: { body: createBody } },
    async (req, reply): Promise<MyTribeResponse> => {
      const res = svc.found(playerOf(req), req.body, req.nowMs);
      void reply.code(201);
      return res;
    },
  );

  app.post<IdParams>(
    '/api/tribes/:id/join',
    { ...auth, schema: { params: params('id') } },
    async (req): Promise<MyTribeResponse> => svc.join(playerOf(req), Number(req.params.id), req.nowMs),
  );

  app.post<IdParams & { Body: ApplyRequest }>(
    '/api/tribes/:id/apply',
    { ...auth, schema: { params: params('id'), body: applyBody } },
    async (req, reply): Promise<MyTribeResponse> => {
      const res = svc.apply(playerOf(req), Number(req.params.id), req.body.message, req.nowMs);
      void reply.code(201);
      return res;
    },
  );

  // ---- my tribe ------------------------------------------------------------------------------------

  app.get('/api/tribe', auth, async (req): Promise<MyTribeResponse> => svc.mine(playerOf(req), req.nowMs));

  app.post<{ Body: TribeSettingsRequest }>(
    '/api/tribe/settings',
    { ...auth, schema: { body: settingsBody } },
    async (req): Promise<MyTribeResponse> => svc.updateSettings(playerOf(req), req.body, req.nowMs),
  );

  app.post<{ Body: InviteRequest }>(
    '/api/tribe/invites',
    { ...auth, schema: { body: inviteBody } },
    async (req, reply): Promise<MyTribeResponse> => {
      const res = svc.invite(playerOf(req), req.body.username, req.nowMs);
      void reply.code(201);
      return res;
    },
  );

  app.post<IdParams>(
    '/api/tribe/invites/:id/cancel',
    { ...auth, schema: { params: params('id') } },
    async (req): Promise<MyTribeResponse> => svc.cancelInvite(playerOf(req), Number(req.params.id), req.nowMs),
  );

  app.post<IdParams>(
    '/api/tribe/applications/:id/accept',
    { ...auth, schema: { params: params('id') } },
    async (req): Promise<MyTribeResponse> => svc.acceptApplication(playerOf(req), Number(req.params.id), req.nowMs),
  );

  app.post<IdParams>(
    '/api/tribe/applications/:id/decline',
    { ...auth, schema: { params: params('id') } },
    async (req): Promise<MyTribeResponse> => svc.declineApplication(playerOf(req), Number(req.params.id), req.nowMs),
  );

  app.post<{ Params: { playerId: string } }>(
    '/api/tribe/members/:playerId/kick',
    { ...auth, schema: { params: params('playerId') } },
    async (req): Promise<MyTribeResponse> => svc.kick(playerOf(req), Number(req.params.playerId), req.nowMs),
  );

  app.post<{ Params: { playerId: string }; Body: RoleRequest }>(
    '/api/tribe/members/:playerId/role',
    { ...auth, schema: { params: params('playerId'), body: roleBody } },
    async (req): Promise<MyTribeResponse> => svc.setRole(playerOf(req), Number(req.params.playerId), req.body.role, req.nowMs),
  );

  app.put<{ Params: { playerId: string }; Body: SetGrantsRequest }>(
    '/api/tribe/members/:playerId/permissions',
    { ...auth, schema: { params: params('playerId'), body: grantsBody } },
    async (req): Promise<TribeMemberDto> => svc.setGrants(playerOf(req), Number(req.params.playerId), req.body.grants, req.nowMs),
  );

  app.post<{ Body: TransferRequest }>(
    '/api/tribe/transfer',
    { ...auth, schema: { body: transferBody } },
    async (req): Promise<MyTribeResponse> => svc.transfer(playerOf(req), req.body.playerId, req.nowMs),
  );

  app.post('/api/tribe/leave', auth, async (req): Promise<MyTribeResponse> => svc.leave(playerOf(req), req.nowMs));

  app.post('/api/tribe/disband', auth, async (req): Promise<MyTribeResponse> => svc.disband(playerOf(req), req.nowMs));

  // ---- diplomacy -----------------------------------------------------------------------------------

  app.post<{ Body: DiplomacyRequest }>(
    '/api/tribe/diplomacy',
    { ...auth, schema: { body: diplomacyBody } },
    async (req, reply): Promise<MyTribeResponse> => {
      const res = svc.diplomacy(playerOf(req), req.body.tag, req.body.kind, req.nowMs);
      void reply.code(201);
      return res;
    },
  );

  app.post<IdParams>(
    '/api/tribe/diplomacy/proposals/:id/accept',
    { ...auth, schema: { params: params('id') } },
    async (req): Promise<MyTribeResponse> => svc.acceptProposal(playerOf(req), Number(req.params.id), req.nowMs),
  );

  app.post<IdParams>(
    '/api/tribe/diplomacy/proposals/:id/decline',
    { ...auth, schema: { params: params('id') } },
    async (req): Promise<MyTribeResponse> => svc.declineProposal(playerOf(req), Number(req.params.id), req.nowMs),
  );

  app.post<IdParams>(
    '/api/tribe/diplomacy/proposals/:id/withdraw',
    { ...auth, schema: { params: params('id') } },
    async (req): Promise<MyTribeResponse> => svc.withdrawProposal(playerOf(req), Number(req.params.id), req.nowMs),
  );

  app.post<IdParams>(
    '/api/tribe/diplomacy/relations/:id/cancel',
    { ...auth, schema: { params: params('id') } },
    async (req): Promise<MyTribeResponse> => svc.cancelRelation(playerOf(req), Number(req.params.id), req.nowMs),
  );

  // ---- incoming attacks on members (scouts and support are not shown) ------------------------------------

  app.get('/api/tribe/alerts', auth, async (req): Promise<TribeAlertsResponse> => ctx.game.tribeAlerts(playerOf(req)));

  // ---- chat ----------------------------------------------------------------------------------------

  app.get<{ Querystring: { after?: string } }>(
    '/api/tribe/chat',
    { ...auth, schema: { querystring: chatQuery } },
    async (req): Promise<ChatResponse> => svc.chatList(playerOf(req), req.query.after === undefined ? null : Number(req.query.after)),
  );

  app.post<{ Body: ChatRequest }>(
    '/api/tribe/chat',
    { ...auth, schema: { body: chatBody } },
    async (req, reply): Promise<ChatMessageDto> => {
      const res = svc.chatPost(playerOf(req), req.body.text, req.nowMs);
      void reply.code(201);
      return res;
    },
  );

  // ---- the invited / applying player (works while tribeless) ----------------------------------------

  app.post<IdParams>(
    '/api/invites/:id/accept',
    { ...auth, schema: { params: params('id') } },
    async (req): Promise<MyTribeResponse> => svc.acceptInvite(playerOf(req), Number(req.params.id), req.nowMs),
  );

  app.post<IdParams>(
    '/api/invites/:id/decline',
    { ...auth, schema: { params: params('id') } },
    async (req): Promise<MyTribeResponse> => svc.declineInvite(playerOf(req), Number(req.params.id), req.nowMs),
  );

  app.post<IdParams>(
    '/api/applications/:id/withdraw',
    { ...auth, schema: { params: params('id') } },
    async (req): Promise<MyTribeResponse> => svc.withdrawApplication(playerOf(req), Number(req.params.id), req.nowMs),
  );
}
