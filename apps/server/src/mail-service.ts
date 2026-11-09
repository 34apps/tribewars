// Mail: player-to-player plain-text messages (docs/GAME_DESIGN.md, Mail). Every mutation runs in one
// transaction (Store.tx). Text goes through the same sanitiser as tribe chat; the client renders it as text.

import {
  GameError,
  MAIL_BODY_MAX,
  MAIL_CONV_PAGE_SIZE,
  MAIL_INBOX_KEEP,
  MAIL_MIN_GAP_MS,
  MAIL_PAGE_SIZE,
  MAIL_PER_HOUR,
  MAIL_PER_MINUTE,
  MAIL_PREVIEW_CHARS,
  MAIL_SUBJECT_MAX,
  MAIL_THREAD_DEFAULT,
  MAIL_THREAD_MAX,
  type MailBox,
  type MailConversationReadResponse,
  type MailConversationsResponse,
  type MailDto,
  type MailListResponse,
  type MailSummaryDto,
  type MailThreadResponse,
  type SendMailRequest,
} from '@clanfire/engine';
import type { MailRow } from './mail-store.ts';
import { assertNotMuted } from './mute.ts';
import type { PlayerRow, Store } from './store.ts';
import { cleanText, len } from './tribe-service.ts';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const MAX_TRACKED = 5000;

/** Per-sender spam guard in memory: a minimum gap, a per-minute and a per-hour cap. Nothing is recorded on refusal. */
class MailLimiter {
  private readonly recent = new Map<number, number[]>();

  allow(playerId: number, now: number): boolean {
    const times = (this.recent.get(playerId) ?? []).filter((x) => x > now - HOUR);
    const last = times[times.length - 1];
    const lastMinute = times.filter((x) => x > now - MINUTE).length;
    if ((last !== undefined && now - last < MAIL_MIN_GAP_MS) || lastMinute >= MAIL_PER_MINUTE || times.length >= MAIL_PER_HOUR) {
      this.recent.set(playerId, times);
      return false;
    }
    if (this.recent.size >= MAX_TRACKED && !this.recent.has(playerId)) this.sweep(now);
    times.push(now);
    this.recent.set(playerId, times);
    return true;
  }

  private sweep(now: number): void {
    for (const [id, times] of this.recent) {
      const last = times[times.length - 1];
      if (last === undefined || last <= now - HOUR) this.recent.delete(id);
    }
  }
}

const notFound = (): GameError => new GameError('not_found', 'That message does not exist.');

function summary(m: MailRow, viewerId: number): MailSummaryDto {
  const preview = [...m.body].slice(0, MAIL_PREVIEW_CHARS).join('');
  return {
    id: m.id,
    fromId: m.fromId,
    from: m.from,
    toId: m.toId,
    to: m.to,
    subject: m.subject,
    preview,
    createdAt: m.createdAt,
    read: m.fromId === viewerId || m.readAt !== null,
  };
}

export class MailService {
  private readonly limiter = new MailLimiter();

  constructor(private readonly store: Store) {}

  private get ms() {
    return this.store.mail;
  }

  unreadCount(playerId: number): number {
    return this.ms.unreadCount(playerId);
  }

  list(player: PlayerRow, box: MailBox, before: number | null): MailListResponse {
    const rows = this.ms.page(player.id, box, before, MAIL_PAGE_SIZE + 1);
    const more = rows.length > MAIL_PAGE_SIZE;
    const shown = more ? rows.slice(0, MAIL_PAGE_SIZE) : rows;
    return {
      mails: shown.map((m) => summary(m, player.id)),
      nextBefore: more ? shown[shown.length - 1]!.id : null,
      unread: this.ms.unreadCount(player.id),
    };
  }

  conversations(player: PlayerRow, page: number): MailConversationsResponse {
    const rows = this.ms.conversations(player.id, MAIL_CONV_PAGE_SIZE, page * MAIL_CONV_PAGE_SIZE);
    return {
      conversations: rows.map(({ lastBody, ...r }) => ({ ...r, lastPreview: [...lastBody].slice(0, MAIL_PREVIEW_CHARS).join('') })),
      total: this.ms.conversationCount(player.id),
      page,
      pageSize: MAIL_CONV_PAGE_SIZE,
      unread: this.ms.unreadCount(player.id),
    };
  }

  /** Read-only: full letters between the caller and `other`, no read marking. Unknown or silent players give an empty list. */
  thread(player: PlayerRow, other: number, before: number | null, limit: number | null): MailThreadResponse {
    const n = limit ?? MAIL_THREAD_DEFAULT;
    if (!Number.isInteger(n) || n < 1 || n > MAIL_THREAD_MAX) throw new GameError('invalid_input', `The limit must be 1 to ${MAIL_THREAD_MAX}.`);
    const rows = this.ms.thread(player.id, other, before, n + 1);
    const more = rows.length > n;
    const shown = more ? rows.slice(0, n) : rows;
    return {
      mails: shown.map((m) => ({ ...summary(m, player.id), body: m.body })),
      nextBefore: more ? shown[shown.length - 1]!.id : null,
    };
  }

  markConversationRead(player: PlayerRow, other: number, t: number): MailConversationReadResponse {
    return this.store.tx(() => ({
      marked: this.ms.markConversationRead(player.id, other, t),
      unread: this.ms.unreadCount(player.id),
    }));
  }

  /** Hide the whole conversation for the caller only. */
  removeConversation(player: PlayerRow, other: number): void {
    this.store.tx(() => this.ms.hideConversation(player.id, other));
  }

  /** Full message; only sender or recipient (and only while they have not deleted it). Reading as recipient marks it read. */
  get(player: PlayerRow, id: number, t: number): MailDto {
    return this.store.tx(() => {
      const m = this.visible(player, id);
      if (m.toId === player.id && m.readAt === null) {
        this.ms.markRead(id, player.id, t);
        m.readAt = t;
      }
      return { ...summary(m, player.id), body: m.body };
    });
  }

  send(player: PlayerRow, req: SendMailRequest, t: number): MailDto {
    assertNotMuted(player, t);
    const toName = cleanText(req.to, 'The recipient').normalize('NFC');
    const subject = cleanText(req.subject, 'The subject');
    const body = cleanText(req.body, 'The message');
    if (toName === '') throw new GameError('invalid_input', 'Say who the mail is for.');
    if (len(subject) > MAIL_SUBJECT_MAX) throw new GameError('invalid_input', `The subject can have at most ${MAIL_SUBJECT_MAX} characters.`);
    const n = len(body);
    if (n < 1 || n > MAIL_BODY_MAX) throw new GameError('invalid_input', `A mail needs 1 to ${MAIL_BODY_MAX} characters.`);

    return this.store.tx(() => {
      const to = this.store.getPlayerByLowerName(toName.toLowerCase());
      if (!to) throw new GameError('not_found', `There is no player called "${toName}".`);
      if (to.id === player.id) throw new GameError('invalid_input', "You can't send mail to yourself.");
      if (!this.limiter.allow(player.id, t)) throw new GameError('rate_limited', 'You are sending mail too fast. Please slow down.');
      if (this.ms.inboxCount(to.id) >= MAIL_INBOX_KEEP && !this.ms.dropOldestRead(to.id)) {
        throw new GameError('queue_full', `${to.username}'s inbox is full. Try again later.`);
      }
      const id = this.ms.insert(player.id, to.id, subject, body, t);
      return { ...summary(this.ms.byId(id)!, player.id), body };
    });
  }

  /** Hide the message for the caller only. */
  remove(player: PlayerRow, id: number): void {
    this.store.tx(() => {
      const m = this.visible(player, id);
      this.ms.hide(id, m.fromId === player.id ? 'sender' : 'recipient');
    });
  }

  /** The mail if it exists and the caller is a party who has not deleted it; otherwise not_found (never forbidden). */
  private visible(player: PlayerRow, id: number): MailRow {
    const m = this.ms.byId(id);
    if (!m) throw notFound();
    const asSender = m.fromId === player.id && !m.deletedBySender;
    const asRecipient = m.toId === player.id && !m.deletedByRecipient;
    if (!asSender && !asRecipient) throw notFound();
    return m;
  }
}
