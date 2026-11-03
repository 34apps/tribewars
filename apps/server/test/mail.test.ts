import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAIL_BODY_MAX,
  MAIL_INBOX_KEEP,
  MAIL_MIN_GAP_MS,
  MAIL_PAGE_SIZE,
  MAIL_PER_HOUR,
  MAIL_PER_MINUTE,
  MAIL_SUBJECT_MAX,
  type MailDto,
  type MailListResponse,
} from '@clanfire/engine';
import { HOUR, errorOf, makeApp, ok } from './helpers.ts';
import { newPlayer, type P } from './tribe-helpers.ts';

const send = (p: P, to: string, body: unknown, subject: unknown = '') => p.c.post('/api/mail', { to, subject, body });
const box = async (p: P, which: 'inbox' | 'sent', before?: number): Promise<MailListResponse> => {
  const res = await p.c.get(`/api/mail?box=${which}${before === undefined ? '' : `&before=${before}`}`);
  ok(res);
  return res.json<MailListResponse>();
};
const unread = async (p: P): Promise<number> => (await p.c.state()).unreadMail;

test('mail: send, receive, unread count rises and falls on read, sent box', async () => {
  const { app, clock } = await makeApp();
  const a = await newPlayer(app, 'alice');
  const b = await newPlayer(app, 'bob');
  assert.equal(await unread(b), 0);

  const res = await send(a, 'BOB', '  Hello <b>Bob</b>  ', 'Hi');
  ok(res, 201);
  const m = res.json<MailDto>();
  assert.deepEqual([m.from, m.to, m.subject, m.body, m.createdAt, m.read], ['alice', 'bob', 'Hi', 'Hello <b>Bob</b>', clock.now(), true]);
  clock.advance(MAIL_MIN_GAP_MS);
  ok(await send(a, 'bob', 'second'), 201);
  assert.equal(await unread(b), 2);
  assert.equal(await unread(a), 0, 'sender has nothing unread');

  const inbox = await box(b, 'inbox');
  assert.equal(inbox.unread, 2);
  assert.deepEqual(inbox.mails.map((x) => x.preview), ['second', 'Hello <b>Bob</b>']);
  assert.ok(inbox.mails.every((x) => !x.read));

  const read = await b.c.get(`/api/mail/${m.id}`);
  ok(read);
  assert.equal(read.json<MailDto>().body, 'Hello <b>Bob</b>');
  assert.equal(await unread(b), 1);
  ok(await b.c.get(`/api/mail/${m.id}`));
  assert.equal(await unread(b), 1, 'reading twice does not go below');
  assert.equal((await box(b, 'inbox')).mails.find((x) => x.id === m.id)?.read, true);

  // The sender reading their own mail does not mark it read for the recipient.
  const second = inbox.mails[0]!;
  ok(await a.c.get(`/api/mail/${second.id}`));
  assert.equal(await unread(b), 1);

  const sent = await box(a, 'sent');
  assert.deepEqual(sent.mails.map((x) => x.to), ['bob', 'bob']);
  assert.equal(sent.nextBefore, null);
  assert.deepEqual((await box(a, 'inbox')).mails, []);
});

test('mail: per-side delete; strangers get not_found; unknown recipient; self mail', async () => {
  const { app, clock } = await makeApp();
  const a = await newPlayer(app, 'alice');
  const b = await newPlayer(app, 'bob');
  const c = await newPlayer(app, 'carol');
  const m = (await send(a, 'bob', 'secret')).json<MailDto>();

  errorOf(await c.c.get(`/api/mail/${m.id}`), 404, 'not_found');
  errorOf(await c.c.delete(`/api/mail/${m.id}`), 404, 'not_found');
  errorOf(await a.c.get('/api/mail/99999'), 404, 'not_found');
  assert.equal(await unread(b), 1, 'a stranger poking did not change anything');

  clock.advance(MAIL_MIN_GAP_MS);
  errorOf(await send(a, 'nobody', 'x'), 404, 'not_found');
  errorOf(await send(a, 'ALICE', 'x'), 400, 'invalid_input');

  assert.equal((await a.c.delete(`/api/mail/${m.id}`)).statusCode, 204);
  assert.deepEqual((await box(a, 'sent')).mails, []);
  errorOf(await a.c.get(`/api/mail/${m.id}`), 404, 'not_found');
  assert.equal((await box(b, 'inbox')).mails.length, 1, 'the recipient still has it');
  ok(await b.c.get(`/api/mail/${m.id}`));
  assert.equal(await unread(b), 0);
  assert.equal((await b.c.delete(`/api/mail/${m.id}`)).statusCode, 204);
  assert.equal(app.ctx.store.mail.byId(m.id), null, 'row removed when both sides deleted');

  // Deleting an unread mail lowers the unread count.
  const m2 = (await send(c, 'bob', 'again')).json<MailDto>();
  assert.equal(await unread(b), 1);
  assert.equal((await b.c.delete(`/api/mail/${m2.id}`)).statusCode, 204);
  assert.equal(await unread(b), 0);
});

test('mail: input rules, emoji round-trip, control characters refused, unknown fields', async () => {
  const { app, clock } = await makeApp();
  const a = await newPlayer(app, 'alice');
  const b = await newPlayer(app, 'bob');
  const gap = () => clock.advance(MAIL_MIN_GAP_MS);

  const emoji = 'GG 😀🔥 👨‍👩‍👧 ✌️';
  const m = (await send(a, 'bob', emoji, '🔥 news')).json<MailDto>();
  const got = (await b.c.get(`/api/mail/${m.id}`)).json<MailDto>();
  assert.equal(got.body, emoji);
  assert.equal(got.subject, '🔥 news');

  for (const [body, subject] of [
    ['', ''],
    ['   \n ', ''],
    ['x'.repeat(MAIL_BODY_MAX + 1), ''],
    ['ok', 'y'.repeat(MAIL_SUBJECT_MAX + 1)],
    ['bad\u0000nul', ''],
    ['bell\u0007', ''],
    ['lone \ud800 surrogate', ''],
    ['rtl ‮ override', ''],
    ['ok', 'tab\u0001'],
  ] as const) {
    gap();
    errorOf(await send(a, 'bob', body, subject), 400, 'invalid_input');
  }
  gap();
  ok(await send(a, 'bob', 'x'.repeat(MAIL_BODY_MAX), 'y'.repeat(MAIL_SUBJECT_MAX)), 201);
  gap();
  ok(await send(a, 'bob', '😀'.repeat(MAIL_BODY_MAX)), 201); // counted in characters, not UTF-16 units
  gap();
  assert.equal((await send(a, 'bob', 'multi\nline\tok')).json<MailDto>().body, 'multi\nline\tok');
  gap();
  errorOf(await send(a, 'bob', 123), 400, 'invalid_input');
  errorOf(await a.c.post('/api/mail', { to: 'bob', body: 'x' }), 400, 'invalid_input');
  errorOf(await a.c.post('/api/mail', { to: 'bob', subject: '', body: 'x', from: 'carol' }), 400, 'invalid_input');
  errorOf(await a.c.get('/api/mail?box=trash'), 400, 'invalid_input');
  errorOf(await a.c.get('/api/mail/abc'), 400, 'invalid_input');

  // Cross-site posts are refused.
  errorOf(await a.c.post('/api/mail', { to: 'bob', subject: '', body: 'x' }, { origin: 'http://evil.example' }), 403, 'forbidden');
});

test('mail: signed-out requests are refused', async () => {
  const { app } = await makeApp();
  const res = await app.inject({ method: 'GET', url: '/api/mail', headers: { host: 'clanfire.test' } });
  assert.equal(res.statusCode, 401);
});

test('mail: pages of 30, newest first, cursor', async () => {
  const { app, clock } = await makeApp();
  const a = await newPlayer(app, 'alice');
  const b = await newPlayer(app, 'bob');
  const total = MAIL_PAGE_SIZE + 5;
  for (let i = 1; i <= total; i++) {
    clock.advance(HOUR); // stays under the hourly cap
    ok(await send(a, 'bob', `m${i}`), 201);
  }
  const p1 = await box(b, 'inbox');
  assert.equal(p1.mails.length, MAIL_PAGE_SIZE);
  assert.equal(p1.mails[0]!.preview, `m${total}`);
  assert.notEqual(p1.nextBefore, null);
  const p2 = await box(b, 'inbox', p1.nextBefore!);
  assert.deepEqual(p2.mails.map((x) => x.preview), ['m5', 'm4', 'm3', 'm2', 'm1']);
  assert.equal(p2.nextBefore, null);
});

test('mail: inbox cap drops the oldest read mail; refuses when all are unread', async () => {
  const { app, clock } = await makeApp();
  const a = await newPlayer(app, 'alice');
  const b = await newPlayer(app, 'bob');
  const ms = app.ctx.store.mail;
  // Fill straight in the database (the limiter would make this slow); alice is the sender.
  let first = 0;
  for (let i = 0; i < MAIL_INBOX_KEEP; i++) {
    const id = ms.insert(a.id, b.id, '', `old${i}`, clock.now() - 1000 + i);
    if (i === 0) first = id;
  }
  assert.equal(await unread(b), MAIL_INBOX_KEEP);
  clock.advance(MAIL_MIN_GAP_MS);
  errorOf(await send(a, 'bob', 'one too many'), 409, 'queue_full');

  // Read the 3rd-oldest only: that one is dropped, not the older unread ones.
  ok(await b.c.get(`/api/mail/${first + 2}`));
  clock.advance(MAIL_MIN_GAP_MS);
  ok(await send(a, 'bob', 'fits now'), 201);
  assert.equal(ms.byId(first + 2)!.deletedByRecipient, true);
  assert.equal(ms.byId(first)!.deletedByRecipient, false);
  assert.equal(ms.inboxCount(b.id), MAIL_INBOX_KEEP);
  assert.equal(await unread(b), MAIL_INBOX_KEEP);
});

test('mail: rate limit (gap, per minute, per hour)', async () => {
  const { app, clock } = await makeApp();
  const a = await newPlayer(app, 'alice');
  await newPlayer(app, 'bob');
  const limited = async () => errorOf(await send(a, 'bob', 'spam'), 429, 'rate_limited');

  ok(await send(a, 'bob', 'one'), 201);
  await limited(); // same instant: under the minimum gap
  clock.advance(MAIL_MIN_GAP_MS - 1);
  await limited();
  clock.advance(1);
  ok(await send(a, 'bob', 'two'), 201);

  for (let i = 2; i < MAIL_PER_MINUTE; i++) {
    clock.advance(MAIL_MIN_GAP_MS);
    ok(await send(a, 'bob', `n${i}`), 201);
  }
  clock.advance(MAIL_MIN_GAP_MS);
  await limited(); // MAIL_PER_MINUTE already sent within the minute
  clock.advance(60_000);
  ok(await send(a, 'bob', 'later'), 201);

});

test('mail: hourly cap per sender; recovers after the hour', async () => {
  const { app, clock } = await makeApp();
  const a = await newPlayer(app, 'alice');
  await newPlayer(app, 'bob');
  const step = Math.ceil(60_000 / MAIL_PER_MINUTE) + 1; // slow enough for the per-minute cap
  for (let i = 0; i < MAIL_PER_HOUR; i++) {
    ok(await send(a, 'bob', `h${i}`), 201);
    clock.advance(step);
  }
  errorOf(await send(a, 'bob', 'over'), 429, 'rate_limited');
  clock.advance(HOUR);
  ok(await send(a, 'bob', 'back'), 201);
});
