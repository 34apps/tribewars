// Desktop Mail page: conversation filter, thread ordering and day grouping, the "Re:" subject.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAIL_SUBJECT_MAX } from '@clanfire/engine';
import type { MailConversationDto, MailDto } from '@clanfire/engine';
import { dayLabel, filterConversations, replySubject, sortConversations, threadItems, threadOrder } from '../src/views/mail/frame-mail-logic.ts';

const conv = (playerId: number, o: Partial<MailConversationDto> = {}): MailConversationDto => ({
  playerId, player: `P${playerId}`, lastMailId: playerId, lastSubject: 's', lastPreview: 'p', lastAt: 1000 + playerId, lastFromMe: false, unread: 0, ...o,
});
const mail = (id: number, createdAt: number, o: Partial<MailDto> = {}): MailDto => ({
  id, fromId: 2, from: 'Them', toId: 1, to: 'Me', subject: 'Hello', preview: '', createdAt, read: true, body: 'text', ...o,
});
const NOW = new Date(2026, 10, 9, 15, 0).getTime();
const at = (daysAgo: number, h: number) => new Date(2026, 10, 9 - daysAgo, h, 0).getTime();

test('filter keeps only conversations with unread letters', () => {
  const l = [conv(1), conv(2, { unread: 2 }), conv(3)];
  assert.deepEqual(filterConversations(l, 'all').length, 3);
  assert.deepEqual(filterConversations(l, 'unread').map((c) => c.playerId), [2]);
});

test('conversations sort newest first', () => {
  assert.deepEqual(sortConversations([conv(1), conv(3), conv(2)]).map((c) => c.playerId), [3, 2, 1]);
});

test('reply subject: Re: once, empty stays empty, cut to the limit', () => {
  assert.equal(replySubject('Hello'), 'Re: Hello');
  assert.equal(replySubject('Re: Hello'), 'Re: Hello');
  assert.equal(replySubject('re: Hello'), 're: Hello');
  assert.equal(replySubject(''), '');
  assert.equal([...replySubject('x'.repeat(200))].length, MAIL_SUBJECT_MAX);
});

test('thread order is oldest first and merges without duplicates', () => {
  const a = [mail(3, 300), mail(2, 200)];
  const b = [mail(2, 200), mail(1, 100)];
  assert.deepEqual(threadOrder(a, b).map((m) => m.id), [1, 2, 3]);
});

test('day labels', () => {
  assert.equal(dayLabel(at(0, 9), NOW), 'Today');
  assert.equal(dayLabel(at(1, 23), NOW), 'Yesterday');
  assert.notEqual(dayLabel(at(4, 9), NOW), 'Yesterday');
});

test('thread items: day dividers, mine vs theirs, subject only when it changes', () => {
  const ms = [
    mail(1, at(1, 10), { subject: 'Shipment' }),
    mail(2, at(1, 11), { subject: 'Shipment', fromId: 1, from: 'Me' }),
    mail(3, at(0, 9), { subject: 'Coming for you' }),
    mail(4, at(0, 10), { subject: 'Coming for you' }),
  ];
  const it = threadItems(ms, NOW, 1);
  assert.deepEqual(it.map((i) => (i.kind === 'day' ? i.label : `${i.mail.id}${i.mine ? 'm' : ''}${i.showSubject ? 's' : ''}`)), ['Yesterday', '1s', '2m', 'Today', '3s', '4']);
});
