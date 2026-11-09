// Pure helpers for the desktop Mail page (FrameMail.tsx): conversation filter and paging, thread ordering and day grouping,
// the "Re:" subject. No React, no I/O.

import { MAIL_SUBJECT_MAX } from '@clanfire/engine';
import type { MailConversationDto, MailDto } from '@clanfire/engine';

export type MailFilter = 'all' | 'unread';

/** People per page of the list (the list never scrolls). */
export const MAIL_PEOPLE_PER_PAGE = 9;

export function filterConversations(list: MailConversationDto[], f: MailFilter): MailConversationDto[] {
  return f === 'unread' ? list.filter((c) => c.unread > 0) : list;
}

/** Newest first, as the server sorts; keeps ties stable. */
export function sortConversations(list: MailConversationDto[]): MailConversationDto[] {
  return [...list].sort((a, b) => b.lastAt - a.lastAt || b.lastMailId - a.lastMailId);
}

/** "Re: Hello"; never "Re: Re: Hello"; cut to the subject limit. An empty subject stays empty. */
export function replySubject(last: string): string {
  const s = last.trim();
  if (s === '') return '';
  const re = /^re:\s/i.test(s) ? s : `Re: ${s}`;
  return [...re].slice(0, MAIL_SUBJECT_MAX).join('');
}

/** Merge letter lists (any order, may overlap) into one oldest-first list without duplicates. */
export function threadOrder(...lists: MailDto[][]): MailDto[] {
  const byId = new Map<number, MailDto>();
  for (const l of lists) for (const m of l) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
}

/** "Today", "Yesterday" or "Mon 3 Nov" for the divider above a day's letters. */
export function dayLabel(ts: number, now: number): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (ts >= start.getTime()) return 'Today';
  start.setDate(start.getDate() - 1);
  if (ts >= start.getTime()) return 'Yesterday';
  return new Date(ts).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

const sameDay = (a: number, b: number): boolean => new Date(a).toDateString() === new Date(b).toDateString();

export type ThreadItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'mail'; key: string; mail: MailDto; mine: boolean; showSubject: boolean };

/** Oldest-first letters -> day dividers and cards; the subject shows on the first letter and whenever it changes. */
export function threadItems(mails: MailDto[], now: number, myId: number): ThreadItem[] {
  const out: ThreadItem[] = [];
  let prev: MailDto | null = null;
  for (const m of mails) {
    if (prev === null || !sameDay(prev.createdAt, m.createdAt)) out.push({ kind: 'day', key: `d${m.id}`, label: dayLabel(m.createdAt, now) });
    const subject = m.subject.trim();
    out.push({ kind: 'mail', key: `m${m.id}`, mail: m, mine: m.fromId === myId, showSubject: subject !== '' && (prev === null || prev.subject.trim() !== subject) });
    prev = m;
  }
  return out;
}

/** "14:53" in the viewer's locale. */
export const letterTime = (ts: number): string => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
