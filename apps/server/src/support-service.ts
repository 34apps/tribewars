// Support tickets (player side and staff side) and the formal message templates. Plain text only, cleaned with the
// same sanitiser as mail. Every mutation runs in one transaction. A player only ever sees their own tickets (else
// not_found) and never the internal staff notes.

import {
  GameError,
  PLAYER_TICKET_CATEGORIES,
  STAFF_PAGE_SIZE,
  TEMPLATE_BODY_MAX,
  TEMPLATE_KEY_PATTERN,
  TEMPLATE_TITLE_MAX,
  TICKETS_OPEN_MAX,
  TICKETS_PER_DAY,
  TICKET_BODY_MAX,
  TICKET_LIST_MAX,
  TICKET_MSG_MIN_GAP_MS,
  TICKET_MSG_PER_HOUR,
  TICKET_MSG_PER_MINUTE,
  TICKET_SUBJECT_MAX,
  renderTemplate,
  staffRank,
  type CreateTicketRequest,
  type MessageTemplateDto,
  type StaffTicketDto,
  type StaffTicketListResponse,
  type StaffTicketReplyRequest,
  type StaffTicketSummaryDto,
  type TemplateKind,
  type TemplateRequest,
  type TicketCategory,
  type TicketDto,
  type TicketListResponse,
  type TicketMessageDto,
  type TicketPriority,
  type TicketStatus,
  type TicketSummaryDto,
  type UpdateTemplateRequest,
} from '@clanfire/engine';
import { toPlayerSummary } from './staff-store.ts';
import type { PlayerRow, Store } from './store.ts';
import type { TicketMessageRow, TicketRow } from './support-store.ts';
import { cleanText, len } from './tribe-service.ts';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

type TicketWithUnread = TicketRow & { unread: boolean };

/** Who acts, from where, and when (for the audit log). */
export interface StaffActing {
  staff: PlayerRow;
  ip: string;
  t: number;
}

const notFound = (): GameError => new GameError('not_found', 'That ticket does not exist.');
const invalid = (message: string): GameError => new GameError('invalid_input', message);

function text(raw: string, what: string, max: number): string {
  const s = cleanText(raw, what);
  const n = len(s);
  if (n < 1 || n > max) throw invalid(`${what} needs 1 to ${max} characters.`);
  return s;
}

const categoryLabel = (c: string): string => c.replace(/_/g, ' ');

function summary(t: TicketWithUnread): TicketSummaryDto {
  return {
    id: t.id,
    category: t.category,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    openedByStaff: t.openedByStaff,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    unread: t.unread,
  };
}

const messageDto = (m: TicketMessageRow): TicketMessageDto => ({
  id: m.id,
  authorId: m.authorId,
  authorName: m.authorName,
  isStaff: m.isStaff,
  internal: m.internal,
  body: m.body,
  templateId: m.templateId,
  createdAt: m.createdAt,
});

export class SupportService {
  constructor(private readonly store: Store) {}

  private get ss() {
    return this.store.support;
  }

  // ---- player side -------------------------------------------------------------------------------

  list(player: PlayerRow): TicketListResponse {
    return {
      tickets: this.ss.listForPlayer(player.id, TICKET_LIST_MAX).map(summary),
      unread: this.ss.unreadCount(player.id),
    };
  }

  /** Unread staff replies (cheap; for badges). */
  unreadCount(playerId: number): number {
    return this.ss.unreadCount(playerId);
  }

  create(player: PlayerRow, req: CreateTicketRequest, t: number): TicketDto {
    if (!(PLAYER_TICKET_CATEGORIES as readonly string[]).includes(req.category)) throw invalid('Unknown ticket category.');
    const subject = text(req.subject, 'The subject', TICKET_SUBJECT_MAX);
    const body = text(req.body, 'The message', TICKET_BODY_MAX);
    return this.store.tx(() => {
      if (this.ss.openCount(player.id) >= TICKETS_OPEN_MAX) {
        throw new GameError('queue_full', `You already have ${TICKETS_OPEN_MAX} open tickets. Please wait for an answer or close one first.`);
      }
      if (this.ss.createdSince(player.id, t - DAY) >= TICKETS_PER_DAY) {
        throw new GameError('rate_limited', 'You have opened many tickets today. Please try again tomorrow.');
      }
      this.checkMessageRate(player.id, t);
      const id = this.ss.insertTicket({ playerId: player.id, category: req.category, subject, status: 'open', assignedTo: null, openedByStaff: false, createdAt: t });
      this.ss.insertMessage({ ticketId: id, authorId: player.id, isStaff: false, internal: false, body, templateId: null, createdAt: t });
      return this.playerView(this.own(player, id));
    });
  }

  /** Own ticket with its public messages; marks it read. */
  get(player: PlayerRow, id: number, t: number): TicketDto {
    return this.store.tx(() => {
      const row = this.own(player, id);
      this.ss.markPlayerRead(id, t);
      return this.playerView({ ...row, unread: false });
    });
  }

  reply(player: PlayerRow, id: number, rawBody: string, t: number): TicketDto {
    const body = text(rawBody, 'The message', TICKET_BODY_MAX);
    return this.store.tx(() => {
      const row = this.own(player, id);
      if (row.status === 'closed') throw new GameError('forbidden', 'This ticket is closed. Please open a new one.');
      this.checkMessageRate(player.id, t);
      this.ss.insertMessage({ ticketId: id, authorId: player.id, isStaff: false, internal: false, body, templateId: null, createdAt: t });
      this.ss.setStatus(id, 'open', t); // answers a pending ticket and reopens a solved one
      return this.playerView(this.own(player, id));
    });
  }

  close(player: PlayerRow, id: number, t: number): TicketDto {
    return this.store.tx(() => {
      const row = this.own(player, id);
      if (row.status !== 'closed') this.ss.setStatus(id, 'closed', t);
      return this.playerView(this.own(player, row.id));
    });
  }

  private own(player: PlayerRow, id: number): TicketWithUnread {
    const row = this.ss.byId(id);
    if (!row || row.playerId !== player.id) throw notFound();
    return row;
  }

  private playerView(row: TicketWithUnread): TicketDto {
    return { ...summary(row), messages: this.ss.messages(row.id, false).map(messageDto) };
  }

  /** Spam guard on the player's own messages, counted in the database: a gap, a per-minute and a per-hour cap. */
  private checkMessageRate(playerId: number, t: number): void {
    const hour = this.ss.playerMessageStats(playerId, t - HOUR);
    const minute = this.ss.playerMessageStats(playerId, t - MINUTE);
    if ((hour.last !== null && t - hour.last < TICKET_MSG_MIN_GAP_MS) || minute.count >= TICKET_MSG_PER_MINUTE || hour.count >= TICKET_MSG_PER_HOUR) {
      throw new GameError('rate_limited', 'You are sending messages too fast. Please slow down.');
    }
  }

  // ---- staff side --------------------------------------------------------------------------------

  queue(filter: { status?: TicketStatus; category?: TicketCategory; assignee?: number; unassigned?: boolean }, offset: number): StaffTicketListResponse {
    const rows = this.ss.queue(filter, STAFF_PAGE_SIZE + 1, offset);
    return { tickets: rows.slice(0, STAFF_PAGE_SIZE).map((r) => this.staffSummary(r)), hasMore: rows.length > STAFF_PAGE_SIZE };
  }

  staffGet(id: number, t: number): StaffTicketDto {
    return this.staffView(this.byId(id), t);
  }

  staffReply(a: StaffActing, id: number, req: StaffTicketReplyRequest): StaffTicketDto {
    const internal = req.internal === true;
    const typed = req.body === undefined ? '' : cleanText(req.body, 'The message');
    if (req.body !== undefined && len(typed) > TICKET_BODY_MAX) throw invalid(`The message can have at most ${TICKET_BODY_MAX} characters.`);
    return this.store.tx(() => {
      const row = this.byId(id);
      let body = typed;
      let templateId: number | null = null;
      if (req.templateId !== undefined) {
        const tpl = this.template(req.templateId);
        templateId = tpl.id;
        if (body === '') body = this.render(tpl, a.staff, row.playerName, row.id, row.category);
      }
      if (body === '') throw invalid('Write a message or pick a template.');
      if (len(body) > TICKET_BODY_MAX) throw invalid(`The message can have at most ${TICKET_BODY_MAX} characters.`);
      this.ss.insertMessage({ ticketId: id, authorId: a.staff.id, isStaff: true, internal, body, templateId, createdAt: a.t });
      if (internal) {
        this.ss.touch(id, a.t);
      } else {
        this.ss.markStaffMessage(id, a.t);
      }
      const next = req.status ?? (internal ? row.status : 'pending');
      if (next !== row.status) this.changeStatus(a, row, next, 'with reply');
      return this.staffView(this.byId(id), a.t);
    });
  }

  /** Support may only take or release their own tickets; moderator and admin may hand a ticket to any staff member. */
  assign(a: StaffActing, id: number, assigneeId: number | null): StaffTicketDto {
    return this.store.tx(() => {
      const row = this.byId(id);
      if (staffRank(a.staff.staffRole) < staffRank('moderator')) {
        const selfTake = assigneeId === a.staff.id;
        const selfRelease = assigneeId === null && row.assignedTo === a.staff.id;
        if (!selfTake && !selfRelease) throw new GameError('forbidden', 'Support staff can only assign tickets to themselves.');
      }
      if (assigneeId !== null && !this.store.staff.isStaffId(assigneeId)) throw invalid('That player is not a staff member.');
      if (assigneeId !== row.assignedTo) {
        this.ss.setAssignee(id, assigneeId, a.t);
        this.store.audit({ at: a.t, actorId: a.staff.id, actorIp: a.ip, action: 'ticket_assign', targetPlayer: row.playerId, detail: `ticket #${id}: ${row.assignedTo ?? 'nobody'} -> ${assigneeId ?? 'nobody'}` });
      }
      return this.staffView(this.byId(id), a.t);
    });
  }

  setStatus(a: StaffActing, id: number, status: TicketStatus): StaffTicketDto {
    return this.store.tx(() => {
      const row = this.byId(id);
      if (row.status !== status) this.changeStatus(a, row, status, '');
      return this.staffView(this.byId(id), a.t);
    });
  }

  setPriority(a: StaffActing, id: number, priority: TicketPriority): StaffTicketDto {
    return this.store.tx(() => {
      const row = this.byId(id);
      if (row.priority !== priority) {
        this.ss.setPriority(id, priority, a.t);
        this.store.audit({ at: a.t, actorId: a.staff.id, actorIp: a.ip, action: 'ticket_priority', targetPlayer: row.playerId, detail: `ticket #${id}: ${row.priority} -> ${priority}` });
      }
      return this.staffView(this.byId(id), a.t);
    });
  }

  /**
   * A staff-initiated ticket (category `moderation`) carrying a formal notice to the player: the rendered template,
   * the extra text, or both. Does not count against the player's open-ticket cap. Call inside a transaction.
   */
  openNotice(a: StaffActing, target: { id: number; username: string }, subject: string, templateId: number | undefined, extra: string | undefined): number {
    const tpl = templateId === undefined ? null : this.template(templateId);
    const extraText = extra === undefined ? '' : cleanText(extra, 'The extra text');
    const id = this.ss.insertTicket({ playerId: target.id, category: 'moderation', subject, status: 'pending', assignedTo: a.staff.id, openedByStaff: true, createdAt: a.t });
    const parts = [tpl ? this.render(tpl, a.staff, target.username, id, 'moderation') : '', extraText].filter((s) => s !== '');
    const body = parts.join('\n\n');
    if (body === '') throw invalid('A notice needs a template or some text.');
    if (len(body) > TICKET_BODY_MAX) throw invalid(`The notice can have at most ${TICKET_BODY_MAX} characters.`);
    this.ss.insertMessage({ ticketId: id, authorId: a.staff.id, isStaff: true, internal: false, body, templateId: tpl?.id ?? null, createdAt: a.t });
    this.ss.markStaffMessage(id, a.t);
    return id;
  }

  private changeStatus(a: StaffActing, row: TicketRow, status: TicketStatus, how: string): void {
    this.ss.setStatus(row.id, status, a.t);
    this.store.audit({ at: a.t, actorId: a.staff.id, actorIp: a.ip, action: 'ticket_status', targetPlayer: row.playerId, detail: `ticket #${row.id}: ${row.status} -> ${status}${how ? ` (${how})` : ''}` });
  }

  private byId(id: number): TicketWithUnread {
    const row = this.ss.byId(id);
    if (!row) throw notFound();
    return row;
  }

  private staffSummary(r: TicketWithUnread): StaffTicketSummaryDto {
    return { ...summary(r), playerId: r.playerId, playerName: r.playerName, assignedTo: r.assignedTo, assignedName: r.assignedName, lastStaffMessageAt: r.lastStaffMessageAt };
  }

  private staffView(r: TicketWithUnread, now: number): StaffTicketDto {
    const player = this.store.staff.lookup(r.playerId);
    if (!player) throw notFound();
    return { ...this.staffSummary(r), messages: this.ss.messages(r.id, true).map(messageDto), player: toPlayerSummary(player, now) };
  }

  // ---- templates ---------------------------------------------------------------------------------

  templates(): MessageTemplateDto[] {
    return this.ss.templates();
  }

  createTemplate(a: StaffActing, req: TemplateRequest): MessageTemplateDto {
    const v = this.checkTemplate(req.title, req.body);
    if (!new RegExp(TEMPLATE_KEY_PATTERN).test(req.key)) throw invalid('The key needs 2 to 40 characters: a-z, 0-9, - and _.');
    return this.store.tx(() => {
      if (this.ss.templateKeyTaken(req.key)) throw invalid('A template with that key already exists.');
      const id = this.ss.insertTemplate(req.key, v.title, req.kind, v.body, a.staff.id, a.t);
      this.store.audit({ at: a.t, actorId: a.staff.id, actorIp: a.ip, action: 'template_create', detail: `template ${req.key}` });
      return this.template(id);
    });
  }

  updateTemplate(a: StaffActing, id: number, req: UpdateTemplateRequest): MessageTemplateDto {
    return this.store.tx(() => {
      const cur = this.template(id);
      const v = this.checkTemplate(req.title ?? cur.title, req.body ?? cur.body);
      const kind: TemplateKind = req.kind ?? cur.kind;
      this.ss.updateTemplate(id, v.title, kind, v.body, a.staff.id, a.t);
      this.store.audit({ at: a.t, actorId: a.staff.id, actorIp: a.ip, action: 'template_update', detail: `template ${cur.key}` });
      return this.template(id);
    });
  }

  deleteTemplate(a: StaffActing, id: number): void {
    this.store.tx(() => {
      const cur = this.template(id);
      this.ss.deleteTemplate(id);
      this.store.audit({ at: a.t, actorId: a.staff.id, actorIp: a.ip, action: 'template_delete', detail: `template ${cur.key}` });
    });
  }

  private checkTemplate(title: string, body: string): { title: string; body: string } {
    return { title: text(title, 'The title', TEMPLATE_TITLE_MAX), body: text(body, 'The template text', TEMPLATE_BODY_MAX) };
  }

  private template(id: number): MessageTemplateDto {
    const tpl = this.ss.templateById(id);
    if (!tpl) throw new GameError('not_found', 'That template does not exist.');
    return tpl;
  }

  private render(tpl: MessageTemplateDto, staff: PlayerRow, playerName: string, ticketId: number, category: string): string {
    return renderTemplate(tpl.body, { player: playerName, staff: staff.username, ticket: `#${ticketId}`, category: categoryLabel(category) });
  }
}
