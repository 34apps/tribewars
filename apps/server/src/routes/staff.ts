// Staff area: /api/staff/*. Every route re-reads the caller's role from the database. Anyone who is not staff gets
// 404 (the area is not revealed); staff with too low a role get 403. Contract: packages/engine/src/api.ts.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  GameError,
  MESSAGE_REPORT_CATEGORIES,
  MESSAGE_REPORT_STATUSES,
  TEMPLATE_KEY_PATTERN,
  TEMPLATE_KINDS,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  staffRank,
  type AssignTicketRequest,
  type AuditListResponse,
  type BanRequest,
  type MessageReportCategory,
  type MessageReportStatus,
  type MessageTemplateDto,
  type ModerationNoteRequest,
  type MuteRequest,
  type ResolveReportRequest,
  type StaffMeResponse,
  type StaffPlayerDetailDto,
  type StaffPlayerListResponse,
  type StaffReportDto,
  type StaffReportListResponse,
  type StaffRole,
  type StaffTicketDto,
  type StaffTicketListResponse,
  type StaffTicketReplyRequest,
  type TemplateListResponse,
  type TemplateRequest,
  type TicketCategory,
  type TicketPriorityRequest,
  type TicketStatus,
  type TicketStatusRequest,
  type UpdateTemplateRequest,
  type WarnRequest,
} from '@clanfire/engine';
import { SESSION_COOKIE } from '../auth.ts';
import type { AppContext } from '../context.ts';
import type { StaffActing } from '../support-service.ts';
import { playerOf } from './auth.ts';

const ID = { type: 'string', pattern: '^[0-9]{1,15}$' } as const;
const INT_ID = { type: 'integer', minimum: 1, maximum: 1_000_000_000_000 } as const;
const idParams = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } } as const;
const TEXT = { type: 'string', maxLength: 16000 } as const;
const REASON = { type: 'string', maxLength: 1200 } as const;

const noticeProps = { templateId: INT_ID, extra: TEXT } as const;
const muteBody = {
  type: 'object',
  required: ['minutes', 'reason'],
  additionalProperties: false,
  properties: { minutes: { type: 'integer', minimum: 1, maximum: 10_000_000 }, reason: REASON, ...noticeProps },
} as const;
const banBody = {
  type: 'object',
  required: ['reason'],
  additionalProperties: false,
  properties: { reason: REASON, ...noticeProps },
} as const;
const warnBody = { type: 'object', additionalProperties: false, properties: { reason: REASON, ...noticeProps } } as const;
const noteBody = { type: 'object', additionalProperties: false, properties: { reason: REASON } } as const;

const replyBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    body: TEXT,
    templateId: INT_ID,
    internal: { type: 'boolean' },
    status: { type: 'string', enum: [...TICKET_STATUSES] },
  },
} as const;
const assignBody = {
  type: 'object',
  required: ['assigneeId'],
  additionalProperties: false,
  properties: { assigneeId: { anyOf: [INT_ID, { type: 'null' }] } },
} as const;
const statusBody = { type: 'object', required: ['status'], additionalProperties: false, properties: { status: { type: 'string', enum: [...TICKET_STATUSES] } } } as const;
const priorityBody = {
  type: 'object',
  required: ['priority'],
  additionalProperties: false,
  properties: { priority: { type: 'string', enum: [...TICKET_PRIORITIES] } },
} as const;
const resolveBody = {
  type: 'object',
  required: ['status'],
  additionalProperties: false,
  properties: { status: { type: 'string', enum: ['actioned', 'dismissed'] }, resolutionNote: { type: 'string', maxLength: 2000 } },
} as const;

const templateProps = {
  title: { type: 'string', maxLength: 400 },
  kind: { type: 'string', enum: [...TEMPLATE_KINDS] },
  body: { type: 'string', maxLength: 16000 },
} as const;
const templateBody = {
  type: 'object',
  required: ['key', 'title', 'kind', 'body'],
  additionalProperties: false,
  properties: { key: { type: 'string', pattern: TEMPLATE_KEY_PATTERN }, ...templateProps },
} as const;
const templateUpdateBody = { type: 'object', additionalProperties: false, properties: templateProps } as const;

const playerQuery = {
  type: 'object',
  required: ['query'],
  additionalProperties: false,
  properties: { query: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;
const auditQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { player: ID, action: { type: 'string', pattern: '^[a-z_]{1,40}$' }, before: ID, limit: { type: 'string', pattern: '^[0-9]{1,4}$' } },
} as const;
const reportQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: [...MESSAGE_REPORT_STATUSES] },
    category: { type: 'string', enum: [...MESSAGE_REPORT_CATEGORIES] },
    before: ID,
  },
} as const;
const ticketQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: [...TICKET_STATUSES] },
    category: { type: 'string', enum: [...TICKET_CATEGORIES] },
    assignee: ID,
    unassigned: { type: 'string', enum: ['1', 'true'] },
    offset: { type: 'string', pattern: '^[0-9]{1,6}$' },
  },
} as const;

/** Signed in AND staff of at least `min`, judged from the database row on every request. */
function requireStaff(ctx: AppContext, min: StaffRole) {
  return async (req: FastifyRequest): Promise<void> => {
    const player = ctx.auth.authenticate(req.cookies[SESSION_COOKIE]);
    if (!player || staffRank(player.staffRole) === 0) throw new GameError('not_found', 'Not found.');
    if (staffRank(player.staffRole) < staffRank(min)) throw new GameError('forbidden', 'Your role does not allow this.');
    req.player = player;
  };
}

const acting = (req: FastifyRequest): StaffActing => ({ staff: playerOf(req), ip: req.ip, t: req.nowMs });

/** Lets bodiless POSTs through a body schema (`{}`). */
const emptyBody = async (req: FastifyRequest): Promise<void> => {
  if (req.body === undefined) req.body = {};
};

export function staffRoutes(app: FastifyInstance, ctx: AppContext): void {
  const support = (min: StaffRole = 'support') => ({ onRequest: requireStaff(ctx, min) });
  const mod = { onRequest: requireStaff(ctx, 'moderator') };
  const admin = { onRequest: requireStaff(ctx, 'admin') };
  const tickets = ctx.support;

  app.get('/api/staff/me', support(), async (req): Promise<StaffMeResponse> => ctx.staff.me(playerOf(req)));

  // ---- players and moderation --------------------------------------------------------------------
  app.get<{ Querystring: { query: string } }>(
    '/api/staff/players',
    { ...support(), schema: { querystring: playerQuery } },
    async (req): Promise<StaffPlayerListResponse> => ctx.staff.search(req.query.query, req.nowMs),
  );
  app.get<{ Params: { id: string } }>(
    '/api/staff/players/:id',
    { ...support(), schema: { params: idParams } },
    async (req): Promise<StaffPlayerDetailDto> => ctx.staff.detail(acting(req), Number(req.params.id)),
  );
  app.post<{ Params: { id: string }; Body: MuteRequest }>(
    '/api/staff/players/:id/mute',
    { ...mod, schema: { params: idParams, body: muteBody } },
    async (req): Promise<StaffPlayerDetailDto> => ctx.staff.mute(acting(req), Number(req.params.id), req.body),
  );
  app.post<{ Params: { id: string }; Body: ModerationNoteRequest }>(
    '/api/staff/players/:id/unmute',
    { ...mod, preValidation: emptyBody, schema: { params: idParams, body: noteBody } },
    async (req): Promise<StaffPlayerDetailDto> => ctx.staff.unmute(acting(req), Number(req.params.id), req.body),
  );
  app.post<{ Params: { id: string }; Body: BanRequest }>(
    '/api/staff/players/:id/ban',
    { ...mod, schema: { params: idParams, body: banBody } },
    async (req): Promise<StaffPlayerDetailDto> => ctx.staff.ban(acting(req), Number(req.params.id), req.body),
  );
  app.post<{ Params: { id: string }; Body: ModerationNoteRequest }>(
    '/api/staff/players/:id/unban',
    { ...mod, preValidation: emptyBody, schema: { params: idParams, body: noteBody } },
    async (req): Promise<StaffPlayerDetailDto> => ctx.staff.unban(acting(req), Number(req.params.id), req.body),
  );
  app.post<{ Params: { id: string }; Body: WarnRequest }>(
    '/api/staff/players/:id/warn',
    { ...mod, preValidation: emptyBody, schema: { params: idParams, body: warnBody } },
    async (req): Promise<StaffPlayerDetailDto> => ctx.staff.warn(acting(req), Number(req.params.id), req.body),
  );

  app.get<{ Querystring: { player?: string; action?: string; before?: string; limit?: string } }>(
    '/api/staff/audit',
    { ...mod, schema: { querystring: auditQuery } },
    async (req): Promise<AuditListResponse> => {
      const q = req.query;
      return ctx.staff.audit(
        {
          ...(q.player === undefined ? {} : { player: Number(q.player) }),
          ...(q.action === undefined ? {} : { action: q.action }),
          ...(q.before === undefined ? {} : { before: Number(q.before) }),
        },
        q.limit === undefined ? 50 : Number(q.limit),
      );
    },
  );

  // ---- reports -----------------------------------------------------------------------------------
  app.get<{ Querystring: { status?: MessageReportStatus; category?: MessageReportCategory; before?: string } }>(
    '/api/staff/reports',
    { ...mod, schema: { querystring: reportQuery } },
    async (req): Promise<StaffReportListResponse> => {
      const q = req.query;
      return ctx.msgReports.list({
        ...(q.status === undefined ? {} : { status: q.status }),
        ...(q.category === undefined ? {} : { category: q.category }),
        ...(q.before === undefined ? {} : { before: Number(q.before) }),
      });
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/staff/reports/:id',
    { ...mod, schema: { params: idParams } },
    async (req): Promise<StaffReportDto> => ctx.msgReports.get(Number(req.params.id)),
  );
  app.post<{ Params: { id: string }; Body: ResolveReportRequest }>(
    '/api/staff/reports/:id/resolve',
    { ...mod, schema: { params: idParams, body: resolveBody } },
    async (req): Promise<StaffReportDto> => ctx.msgReports.resolve(acting(req), Number(req.params.id), req.body),
  );

  // ---- tickets -----------------------------------------------------------------------------------
  app.get<{ Querystring: { status?: TicketStatus; category?: TicketCategory; assignee?: string; unassigned?: string; offset?: string } }>(
    '/api/staff/tickets',
    { ...support(), schema: { querystring: ticketQuery } },
    async (req): Promise<StaffTicketListResponse> => {
      const q = req.query;
      return tickets.queue(
        {
          ...(q.status === undefined ? {} : { status: q.status }),
          ...(q.category === undefined ? {} : { category: q.category }),
          ...(q.assignee === undefined ? {} : { assignee: Number(q.assignee) }),
          ...(q.unassigned === undefined ? {} : { unassigned: true }),
        },
        q.offset === undefined ? 0 : Number(q.offset),
      );
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/staff/tickets/:id',
    { ...support(), schema: { params: idParams } },
    async (req): Promise<StaffTicketDto> => tickets.staffGet(Number(req.params.id), req.nowMs),
  );
  app.post<{ Params: { id: string }; Body: StaffTicketReplyRequest }>(
    '/api/staff/tickets/:id/messages',
    { ...support(), schema: { params: idParams, body: replyBody } },
    async (req, reply): Promise<StaffTicketDto> => {
      const res = tickets.staffReply(acting(req), Number(req.params.id), req.body);
      void reply.code(201);
      return res;
    },
  );
  app.post<{ Params: { id: string }; Body: AssignTicketRequest }>(
    '/api/staff/tickets/:id/assign',
    { ...support(), schema: { params: idParams, body: assignBody } },
    async (req): Promise<StaffTicketDto> => tickets.assign(acting(req), Number(req.params.id), req.body.assigneeId),
  );
  app.post<{ Params: { id: string }; Body: TicketStatusRequest }>(
    '/api/staff/tickets/:id/status',
    { ...support(), schema: { params: idParams, body: statusBody } },
    async (req): Promise<StaffTicketDto> => tickets.setStatus(acting(req), Number(req.params.id), req.body.status),
  );
  app.post<{ Params: { id: string }; Body: TicketPriorityRequest }>(
    '/api/staff/tickets/:id/priority',
    { ...support(), schema: { params: idParams, body: priorityBody } },
    async (req): Promise<StaffTicketDto> => tickets.setPriority(acting(req), Number(req.params.id), req.body.priority),
  );

  // ---- templates ---------------------------------------------------------------------------------
  app.get('/api/staff/templates', support(), async (): Promise<TemplateListResponse> => ({ templates: tickets.templates() }));
  app.post<{ Body: TemplateRequest }>(
    '/api/staff/templates',
    { ...admin, schema: { body: templateBody } },
    async (req, reply): Promise<MessageTemplateDto> => {
      const res = tickets.createTemplate(acting(req), req.body);
      void reply.code(201);
      return res;
    },
  );
  app.put<{ Params: { id: string }; Body: UpdateTemplateRequest }>(
    '/api/staff/templates/:id',
    { ...admin, schema: { params: idParams, body: templateUpdateBody } },
    async (req): Promise<MessageTemplateDto> => tickets.updateTemplate(acting(req), Number(req.params.id), req.body),
  );
  app.delete<{ Params: { id: string } }>(
    '/api/staff/templates/:id',
    { ...admin, schema: { params: idParams } },
    async (req, reply): Promise<void> => {
      tickets.deleteTemplate(acting(req), Number(req.params.id));
      void reply.code(204);
    },
  );
}
