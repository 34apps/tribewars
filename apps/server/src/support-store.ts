// SQL for support tickets, their messages and the formal message templates. Rules live in support-service.ts.

import type { MessageTemplateDto, TemplateKind, TicketCategory, TicketPriority, TicketStatus } from '@clanfire/engine';
import { SqlBase, type Raw } from './sql.ts';

export interface TicketRow {
  id: number;
  playerId: number;
  playerName: string;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignedTo: number | null;
  assignedName: string | null;
  openedByStaff: boolean;
  createdAt: number;
  updatedAt: number;
  lastPlayerReadAt: number | null;
  lastStaffMessageAt: number | null;
}

export interface TicketMessageRow {
  id: number;
  ticketId: number;
  authorId: number | null;
  authorName: string;
  isStaff: boolean;
  internal: boolean;
  body: string;
  templateId: number | null;
  createdAt: number;
}

export interface NewTicket {
  playerId: number;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  assignedTo: number | null;
  openedByStaff: boolean;
  createdAt: number;
}

export interface NewTicketMessage {
  ticketId: number;
  authorId: number;
  isStaff: boolean;
  internal: boolean;
  body: string;
  templateId: number | null;
  createdAt: number;
}

export interface QueueFilter {
  status?: TicketStatus;
  category?: TicketCategory;
  assignee?: number;
  unassigned?: boolean;
}

const UNREAD = '(t.last_staff_message_at IS NOT NULL AND (t.last_player_read_at IS NULL OR t.last_player_read_at < t.last_staff_message_at))';

const TICKET_SQL = `SELECT t.*, pp.username AS player_name, ap.username AS assigned_name, ${UNREAD} AS unread
  FROM tickets t JOIN players pp ON pp.id = t.player_id LEFT JOIN players ap ON ap.id = t.assigned_to`;

const toTicket = (r: Raw): TicketRow & { unread: boolean } => ({
  id: r.id as number,
  playerId: r.player_id as number,
  playerName: r.player_name as string,
  category: r.category as TicketCategory,
  subject: r.subject as string,
  status: r.status as TicketStatus,
  priority: r.priority as TicketPriority,
  assignedTo: (r.assigned_to as number | null) ?? null,
  assignedName: (r.assigned_name as string | null) ?? null,
  openedByStaff: (r.opened_by_staff as number) === 1,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
  lastPlayerReadAt: (r.last_player_read_at as number | null) ?? null,
  lastStaffMessageAt: (r.last_staff_message_at as number | null) ?? null,
  unread: (r.unread as number) === 1,
});

const toMessage = (r: Raw): TicketMessageRow => ({
  id: r.id as number,
  ticketId: r.ticket_id as number,
  authorId: (r.author_id as number | null) ?? null,
  authorName: (r.author_name as string | null) ?? 'former player',
  isStaff: (r.is_staff as number) === 1,
  internal: (r.internal as number) === 1,
  body: r.body as string,
  templateId: (r.template_id as number | null) ?? null,
  createdAt: r.created_at as number,
});

const toTemplate = (r: Raw): MessageTemplateDto => ({
  id: r.id as number,
  key: r.key as string,
  title: r.title as string,
  kind: r.kind as TemplateKind,
  body: r.body as string,
  updatedBy: (r.updated_by as number | null) ?? null,
  updatedAt: r.updated_at as number,
});

export class SupportStore extends SqlBase {
  // ---- tickets -------------------------------------------------------------------------------------

  byId(id: number): (TicketRow & { unread: boolean }) | null {
    const r = this.get(`${TICKET_SQL} WHERE t.id = ?`, id);
    return r ? toTicket(r) : null;
  }

  insertTicket(n: NewTicket): number {
    return this.run(
      `INSERT INTO tickets (player_id, category, subject, status, assigned_to, opened_by_staff, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      n.playerId,
      n.category,
      n.subject,
      n.status,
      n.assignedTo,
      n.openedByStaff ? 1 : 0,
      n.createdAt,
      n.createdAt,
    ).id;
  }

  insertMessage(n: NewTicketMessage): number {
    return this.run(
      'INSERT INTO ticket_messages (ticket_id, author_id, is_staff, internal, body, template_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      n.ticketId,
      n.authorId,
      n.isStaff ? 1 : 0,
      n.internal ? 1 : 0,
      n.body,
      n.templateId,
      n.createdAt,
    ).id;
  }

  messages(ticketId: number, withInternal: boolean): TicketMessageRow[] {
    return this.all(
      `SELECT m.*, p.username AS author_name FROM ticket_messages m LEFT JOIN players p ON p.id = m.author_id
       WHERE m.ticket_id = ?${withInternal ? '' : ' AND m.internal = 0'} ORDER BY m.id`,
      ticketId,
    ).map(toMessage);
  }

  listForPlayer(playerId: number, limit: number): Array<TicketRow & { unread: boolean }> {
    return this.all(`${TICKET_SQL} WHERE t.player_id = ? ORDER BY t.updated_at DESC, t.id DESC LIMIT ?`, playerId, limit).map(toTicket);
  }

  unreadCount(playerId: number): number {
    return Number(this.get(`SELECT COUNT(*) AS n FROM tickets t WHERE t.player_id = ? AND ${UNREAD}`, playerId)?.n ?? 0);
  }

  /** Tickets the player opened that are still going (staff-initiated notices never count against the cap). */
  openCount(playerId: number): number {
    return Number(this.get("SELECT COUNT(*) AS n FROM tickets WHERE player_id = ? AND opened_by_staff = 0 AND status IN ('open', 'pending')", playerId)?.n ?? 0);
  }

  createdSince(playerId: number, since: number): number {
    return Number(this.get('SELECT COUNT(*) AS n FROM tickets WHERE player_id = ? AND opened_by_staff = 0 AND created_at > ?', playerId, since)?.n ?? 0);
  }

  /** The player's own messages since `since` (for the reply rate limit) and the time of the latest one. */
  playerMessageStats(playerId: number, since: number): { count: number; last: number | null } {
    const r = this.get('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM ticket_messages WHERE author_id = ? AND is_staff = 0 AND created_at > ?', playerId, since);
    return { count: Number(r?.n ?? 0), last: (r?.last as number | null) ?? null };
  }

  setStatus(id: number, status: TicketStatus, t: number): void {
    this.run('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?', status, t, id);
  }

  setPriority(id: number, priority: TicketPriority, t: number): void {
    this.run('UPDATE tickets SET priority = ?, updated_at = ? WHERE id = ?', priority, t, id);
  }

  setAssignee(id: number, assignee: number | null, t: number): void {
    this.run('UPDATE tickets SET assigned_to = ?, updated_at = ? WHERE id = ?', assignee, t, id);
  }

  touch(id: number, t: number): void {
    this.run('UPDATE tickets SET updated_at = ? WHERE id = ?', t, id);
  }

  markStaffMessage(id: number, t: number): void {
    this.run('UPDATE tickets SET last_staff_message_at = ?, updated_at = ? WHERE id = ?', t, t, id);
  }

  markPlayerRead(id: number, t: number): void {
    this.run('UPDATE tickets SET last_player_read_at = ? WHERE id = ?', t, id);
  }

  /** Staff queue: open before pending before solved before closed, high priority first, longest waiting first. */
  queue(f: QueueFilter, limit: number, offset: number): Array<TicketRow & { unread: boolean }> {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (f.status !== undefined) {
      where.push('t.status = ?');
      params.push(f.status);
    }
    if (f.category !== undefined) {
      where.push('t.category = ?');
      params.push(f.category);
    }
    if (f.assignee !== undefined) {
      where.push('t.assigned_to = ?');
      params.push(f.assignee);
    }
    if (f.unassigned) where.push('t.assigned_to IS NULL');
    const sql = `${TICKET_SQL}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'pending' THEN 1 WHEN 'solved' THEN 2 ELSE 3 END,
               CASE t.priority WHEN 'high' THEN 0 ELSE 1 END, t.updated_at ASC, t.id ASC LIMIT ? OFFSET ?`;
    return this.all(sql, ...params, limit, offset).map(toTicket);
  }

  // ---- templates -----------------------------------------------------------------------------------

  templates(): MessageTemplateDto[] {
    return this.all('SELECT * FROM message_templates ORDER BY kind, key').map(toTemplate);
  }

  templateById(id: number): MessageTemplateDto | null {
    const r = this.get('SELECT * FROM message_templates WHERE id = ?', id);
    return r ? toTemplate(r) : null;
  }

  templateKeyTaken(key: string, exceptId = 0): boolean {
    return this.get('SELECT 1 AS x FROM message_templates WHERE key = ? AND id <> ?', key, exceptId) !== undefined;
  }

  insertTemplate(key: string, title: string, kind: TemplateKind, body: string, by: number, t: number): number {
    return this.run('INSERT INTO message_templates (key, title, kind, body, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)', key, title, kind, body, by, t).id;
  }

  updateTemplate(id: number, title: string, kind: TemplateKind, body: string, by: number, t: number): void {
    this.run('UPDATE message_templates SET title = ?, kind = ?, body = ?, updated_by = ?, updated_at = ? WHERE id = ?', title, kind, body, by, t, id);
  }

  deleteTemplate(id: number): void {
    this.run('DELETE FROM message_templates WHERE id = ?', id);
  }
}
