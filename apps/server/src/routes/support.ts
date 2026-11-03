// Player side of support: own tickets, and reporting messages or players. Contract: packages/engine/src/api.ts.

import type { FastifyInstance } from 'fastify';
import {
  MESSAGE_REPORT_CATEGORIES,
  MESSAGE_REPORT_KINDS,
  PLAYER_TICKET_CATEGORIES,
  type CreateMessageReportRequest,
  type CreateTicketRequest,
  type MessageReportReceipt,
  type TicketDto,
  type TicketListResponse,
  type TicketReplyRequest,
} from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import { playerOf, requireAuth } from './auth.ts';

const ID = { type: 'string', pattern: '^[0-9]{1,15}$' } as const;
const idParams = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } } as const;

// Lengths are re-checked in characters by the services; these caps only bound the bytes parsed.
const createBody = {
  type: 'object',
  required: ['category', 'subject', 'body'],
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: [...PLAYER_TICKET_CATEGORIES] },
    subject: { type: 'string', maxLength: 600 },
    body: { type: 'string', maxLength: 16000 },
  },
} as const;

const replyBody = {
  type: 'object',
  required: ['body'],
  additionalProperties: false,
  properties: { body: { type: 'string', maxLength: 16000 } },
} as const;

const reportBody = {
  type: 'object',
  required: ['kind', 'category'],
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: [...MESSAGE_REPORT_KINDS] },
    refId: { type: 'integer', minimum: 1, maximum: 1_000_000_000_000 },
    username: { type: 'string', maxLength: 64 },
    category: { type: 'string', enum: [...MESSAGE_REPORT_CATEGORIES] },
    note: { type: 'string', maxLength: 2000 },
  },
} as const;

export function supportRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { onRequest: requireAuth(ctx) };
  const svc = ctx.support;

  app.get('/api/tickets', auth, async (req): Promise<TicketListResponse> => svc.list(playerOf(req)));

  app.post<{ Body: CreateTicketRequest }>('/api/tickets', { ...auth, schema: { body: createBody } }, async (req, reply): Promise<TicketDto> => {
    const res = svc.create(playerOf(req), req.body, req.nowMs);
    void reply.code(201);
    return res;
  });

  app.get<{ Params: { id: string } }>(
    '/api/tickets/:id',
    { ...auth, schema: { params: idParams } },
    async (req): Promise<TicketDto> => svc.get(playerOf(req), Number(req.params.id), req.nowMs),
  );

  app.post<{ Params: { id: string }; Body: TicketReplyRequest }>(
    '/api/tickets/:id/messages',
    { ...auth, schema: { params: idParams, body: replyBody } },
    async (req, reply): Promise<TicketDto> => {
      const res = svc.reply(playerOf(req), Number(req.params.id), req.body.body, req.nowMs);
      void reply.code(201);
      return res;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/tickets/:id/close',
    { ...auth, schema: { params: idParams } },
    async (req): Promise<TicketDto> => svc.close(playerOf(req), Number(req.params.id), req.nowMs),
  );

  app.post<{ Body: CreateMessageReportRequest }>(
    '/api/reports',
    { ...auth, schema: { body: reportBody } },
    async (req, reply): Promise<MessageReportReceipt> => {
      const res = ctx.msgReports.create(playerOf(req), req.body, req.nowMs);
      void reply.code(201);
      return res;
    },
  );
}
