import type { FastifyInstance } from 'fastify';
import type { MailBox, MailDto, MailListResponse, SendMailRequest } from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import { playerOf, requireAuth } from './auth.ts';

const ID = { type: 'string', pattern: '^[0-9]{1,15}$' } as const;

const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: ID },
} as const;

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
