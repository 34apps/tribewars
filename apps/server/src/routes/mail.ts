import type { FastifyInstance } from 'fastify';
import type {
  MailBox,
  MailConversationReadResponse,
  MailConversationsResponse,
  MailDto,
  MailListResponse,
  MailThreadResponse,
  SendMailRequest,
} from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import { playerOf, requireAuth } from './auth.ts';

const ID = { type: 'string', pattern: '^[0-9]{1,15}$' } as const;

const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: ID },
} as const;

const playerParams = {
  type: 'object',
  required: ['playerId'],
  additionalProperties: false,
  properties: { playerId: ID },
} as const;

const convQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { page: { type: 'string', pattern: '^[0-9]{1,5}$' } },
} as const;

const threadQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { before: ID, limit: { type: 'string', pattern: '^[0-9]{1,3}$' } },
} as const;

const emptyBody = { type: 'object', additionalProperties: false } as const;

const listQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { box: { type: 'string', enum: ['inbox', 'sent'] }, before: ID },
} as const;

// Lengths are re-checked in characters by the service; these caps only bound the bytes parsed.
const sendBody = {
  type: 'object',
  required: ['to', 'subject', 'body'],
  additionalProperties: false,
  properties: {
    to: { type: 'string', maxLength: 64 },
    subject: { type: 'string', maxLength: 400 },
    body: { type: 'string', maxLength: 16000 },
  },
} as const;

export function mailRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { onRequest: requireAuth(ctx) };
  const svc = ctx.mail;

  app.get<{ Querystring: { box?: MailBox; before?: string } }>(
    '/api/mail',
    { ...auth, schema: { querystring: listQuery } },
    async (req): Promise<MailListResponse> =>
      svc.list(playerOf(req), req.query.box ?? 'inbox', req.query.before === undefined ? null : Number(req.query.before)),
  );

  app.get<{ Querystring: { page?: string } }>(
    '/api/mail/conversations',
    { ...auth, schema: { querystring: convQuery } },
    async (req): Promise<MailConversationsResponse> => svc.conversations(playerOf(req), req.query.page === undefined ? 0 : Number(req.query.page)),
  );

  app.get<{ Params: { playerId: string }; Querystring: { before?: string; limit?: string } }>(
    '/api/mail/conversation/:playerId',
    { ...auth, schema: { params: playerParams, querystring: threadQuery } },
    async (req): Promise<MailThreadResponse> =>
      svc.thread(
        playerOf(req),
        Number(req.params.playerId),
        req.query.before === undefined ? null : Number(req.query.before),
        req.query.limit === undefined ? null : Number(req.query.limit),
      ),
  );

  app.post<{ Params: { playerId: string } }>(
    '/api/mail/conversation/:playerId/read',
    { ...auth, schema: { params: playerParams, body: emptyBody } },
    async (req): Promise<MailConversationReadResponse> => svc.markConversationRead(playerOf(req), Number(req.params.playerId), req.nowMs),
  );

  app.post<{ Params: { playerId: string } }>(
    '/api/mail/conversation/:playerId/delete',
    { ...auth, schema: { params: playerParams, body: emptyBody } },
    async (req, reply): Promise<void> => {
      svc.removeConversation(playerOf(req), Number(req.params.playerId));
      void reply.code(204);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/mail/:id',
    { ...auth, schema: { params: idParams } },
    async (req): Promise<MailDto> => svc.get(playerOf(req), Number(req.params.id), req.nowMs),
  );

  app.post<{ Body: SendMailRequest }>(
    '/api/mail',
    { ...auth, schema: { body: sendBody } },
    async (req, reply): Promise<MailDto> => {
      const res = svc.send(playerOf(req), req.body, req.nowMs);
      void reply.code(201);
      return res;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/mail/:id',
    { ...auth, schema: { params: idParams } },
    async (req, reply): Promise<void> => {
      svc.remove(playerOf(req), Number(req.params.id));
      void reply.code(204);
    },
  );
}
