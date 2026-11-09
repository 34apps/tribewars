// SQL for the mail table: prepared statements with bound parameters only. Rules live in mail-service.ts.
// Lists are newest first and keyset-paged by (created_at, id); the unread count uses a partial index.

import { SqlBase, type Raw } from './sql.ts';

export interface MailRow {
  id: number;
  fromId: number;
  from: string;
  toId: number;
  to: string;
  subject: string;
  body: string;
  createdAt: number;
  readAt: number | null;
  deletedBySender: boolean;
  deletedByRecipient: boolean;
}

export interface ConversationRow {
  playerId: number;
  player: string;
  lastMailId: number;
  lastSubject: string;
  lastBody: string;
  lastAt: number;
  lastFromMe: boolean;
  unread: number;
}

const SELECT = `SELECT m.id, m.from_player, m.to_player, m.subject, m.body, m.created_at, m.read_at,
       m.deleted_by_sender, m.deleted_by_recipient, f.username AS from_name, t.username AS to_name
  FROM mail m
  JOIN players f ON f.id = m.from_player
  JOIN players t ON t.id = m.to_player`;

const toRow = (r: Raw): MailRow => ({
  id: r.id as number,
  fromId: r.from_player as number,
  from: r.from_name as string,
  toId: r.to_player as number,
  to: r.to_name as string,
  subject: r.subject as string,
  body: r.body as string,
  createdAt: r.created_at as number,
  readAt: (r.read_at as number | null) ?? null,
  deletedBySender: (r.deleted_by_sender as number) === 1,
  deletedByRecipient: (r.deleted_by_recipient as number) === 1,
});

export class MailStore extends SqlBase {
  byId(id: number): MailRow | null {
    const r = this.get(`${SELECT} WHERE m.id = ?`, id);
    return r ? toRow(r) : null;
  }

  /** One page of a box, newest first: `limit` rows after the `before` cursor (an id) when given. */
  page(playerId: number, box: 'inbox' | 'sent', before: number | null, limit: number): MailRow[] {
    const [who, hidden] = box === 'inbox' ? ['m.to_player', 'm.deleted_by_recipient'] : ['m.from_player', 'm.deleted_by_sender'];
    const cursor = before === null ? '' : 'AND (m.created_at, m.id) < (SELECT created_at, id FROM mail WHERE id = ?)';
    const sql = `${SELECT} WHERE ${who} = ? AND ${hidden} = 0 ${cursor} ORDER BY m.created_at DESC, m.id DESC LIMIT ?`;
    const rows = before === null ? this.all(sql, playerId, limit) : this.all(sql, playerId, before, limit);
    return rows.map(toRow);
  }

  insert(from: number, to: number, subject: string, body: string, t: number): number {
    const id = this.run('INSERT INTO mail (from_player, to_player, subject, body, created_at) VALUES (?, ?, ?, ?, ?)', from, to, subject, body, t).id;
    this.emit({ kind: 'player', playerId: to, topics: ['mail', 'game'] }); // game: the unread count
    if (from !== to) this.emit({ kind: 'player', playerId: from, topics: ['mail'] }); // their other tabs: sent box
    return id;
  }

  markRead(id: number, playerId: number, t: number): void {
    this.run('UPDATE mail SET read_at = ? WHERE id = ? AND to_player = ? AND read_at IS NULL', t, id, playerId);
  }

  unreadCount(playerId: number): number {
    const r = this.q('SELECT COUNT(*) AS n FROM mail WHERE to_player = ? AND read_at IS NULL AND deleted_by_recipient = 0').get(playerId) as Raw;
    return r.n as number;
  }

  /** Mails the recipient still has (read or not). */
  inboxCount(playerId: number): number {
    const r = this.q('SELECT COUNT(*) AS n FROM mail WHERE to_player = ? AND deleted_by_recipient = 0').get(playerId) as Raw;
    return r.n as number;
  }

  /** Drop the recipient's oldest read mail. False when every mail in the inbox is unread. */
  dropOldestRead(playerId: number): boolean {
    const r = this.q(
      `SELECT id FROM mail WHERE to_player = ? AND deleted_by_recipient = 0 AND read_at IS NOT NULL
       ORDER BY created_at ASC, id ASC LIMIT 1`,
    ).get(playerId) as Raw | undefined;
    if (!r) return false;
    this.hide(r.id as number, 'recipient');
    return true;
  }

  /** Hide one side's copy; the row is removed once both sides have. */
  hide(id: number, side: 'sender' | 'recipient'): void {
    const col = side === 'sender' ? 'deleted_by_sender' : 'deleted_by_recipient';
    this.run(`UPDATE mail SET ${col} = 1 WHERE id = ?`, id);
    this.run('DELETE FROM mail WHERE id = ? AND deleted_by_sender = 1 AND deleted_by_recipient = 1', id);
  }

  /** One page of conversations (one row per other player), newest last-letter first. Hidden letters are ignored. */
  conversations(me: number, limit: number, offset: number): ConversationRow[] {
    const rows = this.all(
      `WITH v AS (
         SELECT id, CASE WHEN from_player = ? THEN to_player ELSE from_player END AS other,
                CASE WHEN to_player = ? AND read_at IS NULL THEN 1 ELSE 0 END AS unread
           FROM mail WHERE (from_player = ? AND deleted_by_sender = 0) OR (to_player = ? AND deleted_by_recipient = 0)),
       g AS (SELECT other, MAX(id) AS last_id, SUM(unread) AS unread FROM v GROUP BY other ORDER BY last_id DESC LIMIT ? OFFSET ?)
       SELECT g.other, g.last_id, g.unread, p.username, m.subject, m.body, m.created_at, m.from_player
         FROM g JOIN players p ON p.id = g.other JOIN mail m ON m.id = g.last_id ORDER BY g.last_id DESC`,
      me, me, me, me, limit, offset,
    );
    return rows.map((r) => ({
      playerId: r.other as number,
      player: r.username as string,
      lastMailId: r.last_id as number,
      lastSubject: r.subject as string,
      lastBody: r.body as string,
      lastAt: r.created_at as number,
      lastFromMe: (r.from_player as number) === me,
      unread: r.unread as number,
    }));
  }

  conversationCount(me: number): number {
    const r = this.get(
      `SELECT COUNT(DISTINCT CASE WHEN from_player = ? THEN to_player ELSE from_player END) AS n
         FROM mail WHERE (from_player = ? AND deleted_by_sender = 0) OR (to_player = ? AND deleted_by_recipient = 0)`,
      me, me, me,
    );
    return (r?.n as number) ?? 0;
  }

  /** Letters between `me` and `other` that `me` has not hidden, newest first (by id), keyset-paged. */
  thread(me: number, other: number, before: number | null, limit: number): MailRow[] {
    const cursor = before === null ? '' : 'AND m.id < ?';
    const sql = `${SELECT}
      WHERE ((m.from_player = ? AND m.to_player = ? AND m.deleted_by_sender = 0)
          OR (m.from_player = ? AND m.to_player = ? AND m.deleted_by_recipient = 0)) ${cursor}
      ORDER BY m.id DESC LIMIT ?`;
    const rows = before === null ? this.all(sql, me, other, other, me, limit) : this.all(sql, me, other, other, me, before, limit);
    return rows.map(toRow);
  }

  /** Mark every unread letter from `other` to `me` read; returns how many changed. */
  markConversationRead(me: number, other: number, t: number): number {
    return this.run(
      'UPDATE mail SET read_at = ? WHERE from_player = ? AND to_player = ? AND read_at IS NULL AND deleted_by_recipient = 0',
      t, other, me,
    ).changes;
  }

  /** Hide every letter between the two for `me` only; rows hidden by both sides are removed. */
  hideConversation(me: number, other: number): void {
    this.run('UPDATE mail SET deleted_by_sender = 1 WHERE from_player = ? AND to_player = ?', me, other);
    this.run('UPDATE mail SET deleted_by_recipient = 1 WHERE from_player = ? AND to_player = ?', other, me);
    this.run(
      `DELETE FROM mail WHERE deleted_by_sender = 1 AND deleted_by_recipient = 1
         AND ((from_player = ? AND to_player = ?) OR (from_player = ? AND to_player = ?))`,
      me, other, other, me,
    );
  }
}
