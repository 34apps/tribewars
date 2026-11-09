import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAIL_BODY_MAX,
  MAIL_CONV_PAGE_SIZE,
  MAIL_INBOX_KEEP,
  MAIL_MIN_GAP_MS,
  MAIL_PAGE_SIZE,
  MAIL_PER_HOUR,
  MAIL_PER_MINUTE,
  MAIL_SUBJECT_MAX,
  MAIL_THREAD_MAX,
  type MailConversationReadResponse,
  type MailConversationsResponse,
  type MailDto,
  type MailListResponse,
  type MailThreadResponse,
} from '@clanfire/engine';
import { Client, HOUR, errorOf, makeApp, ok } from './helpers.ts';
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

// ---- Conversations -------------------------------------------------------------------------------------

const convs = async (p: P, page = 0): Promise<MailConversationsResponse> => {
  const res = await p.c.get(`/api/mail/conversations?page=${page}`);
  ok(res);
  return res.json<MailConversationsResponse>();
};
const thread = async (p: P, other: number, qs = ''): Promise<MailThreadResponse> => {
  const res = await p.c.get(`/api/mail/conversation/${other}${qs}`);
  ok(res);
  return res.json<MailThreadResponse>();
};

test('mail conversations: grouping, order, unread, preview, no side effects on read of thread', async () => {
  const { app, clock } = await makeApp();
  const a = await newPlayer(app, 'alice');
  const b = await newPlayer(app, 'bob');
  const c = await newPlayer(app, 'carol');
  const tick = () => clock.advance(MAIL_MIN_GAP_MS);
  ok(await send(b, 'alice', 'b1', 'S1'), 201);
  tick();
  ok(await send(a, 'bob', 'a1', 'S2'), 201);
  tick();
  ok(await send(b, 'alice', 'b2', 'S3'), 201);
  tick();
  ok(await send(c, 'alice', 'x'.repeat(500), 'S4'), 201);
  tick();
  ok(await send(a, 'carol', 'a-to-c', 'S5'), 201);
  tick();
  ok(await send(b, 'alice', 'b3', 'S6'), 201);

  const r = await convs(a);
  assert.equal(r.total, 2);
  assert.equal(r.pageSize, MAIL_CONV_PAGE_SIZE);
  assert.deepEqual(r.conversations.map((x) => [x.player, x.lastSubject, x.lastFromMe, x.unread]), [
    ['bob', 'S6', false, 3],
    ['carol', 'S5', true, 1],
  ]);
  assert.equal(r.unread, 4);

  // Bob's side: alice's one letter is unread; his own letters are not counted.
  const rb = await convs(b);
  assert.deepEqual(rb.conversations.map((x) => [x.player, x.lastFromMe, x.unread]), [['alice', true, 1]]);

  // The thread: both directions, newest first, full body, and reading it changes nothing.
  const t = await thread(a, b.id);
  assert.deepEqual(t.mails.map((m) => m.body), ['b3', 'b2', 'a1', 'b1']);
  assert.equal(t.nextBefore, null);
  assert.ok(t.mails.some((m) => !m.read));
  assert.equal(await unread(a), 4, 'GET thread does not mark read');
});

test('mail conversations: preview is capped like the list preview', async () => {
  const { app } = await makeApp();
  const a = await newPlayer(app, 'alice');
  const b = await newPlayer(app, 'bob');
  ok(await send(b, 'alice', 'y'.repeat(1000)), 201);
  const r = await convs(a);
  const inbox = await box(a, 'inbox');
  assert.equal(r.conversations[0]!.lastPreview, inbox.mails[0]!.preview);
  assert.ok(r.conversations[0]!.lastPreview.length < 1000);
});

test('mail conversations: paging over conversations and thread before/limit', async () => {
  const { app, clock } = await makeApp();
  const a = await newPlayer(app, 'alice');
  const others: P[] = [];
  const total = MAIL_CONV_PAGE_SIZE + 3;
  for (let i = 0; i < total; i++) others.push(await newPlayer(app, `play${i}`));
  for (const o of others) {
    ok(await send(o, 'alice', 'hi'), 201);
    clock.advance(60_000 / MAIL_PER_MINUTE + 1);
  }
  const p0 = await convs(a, 0);
  const p1 = await convs(a, 1);
  assert.equal(p0.total, total);
  assert.equal(p0.conversations.length, MAIL_CONV_PAGE_SIZE);
  assert.equal(p1.conversations.length, 3);
  assert.equal(p0.conversations[0]!.player, `play${total - 1}`, 'newest first');
  assert.equal(new Set([...p0.conversations, ...p1.conversations].map((x) => x.playerId)).size, total);
  assert.equal((await convs(a, 5)).conversations.length, 0);

  const b = others[0]!;
  for (let i = 0; i < 6; i++) {
    ok(await send(b, 'alice', `m${i}`), 201);
    clock.advance(MAIL_MIN_GAP_MS + 1000);
  }
  const first = await thread(a, b.id, '?limit=4');
  assert.deepEqual(first.mails.map((m) => m.body), ['m5', 'm4', 'm3', 'm2']);
  assert.equal(first.nextBefore, first.mails[3]!.id);
  const second = await thread(a, b.id, `?limit=4&before=${first.nextBefore}`);
  assert.deepEqual(second.mails.map((m) => m.body), ['m1', 'm0', 'hi']);
  assert.equal(second.nextBefore, null);
});

test('mail conversations: strangers see nothing; read marks only that player; delete is per side', async () => {
  const { app, clock } = await makeApp();
  const a = await newPlayer(app, 'alice');
  const b = await newPlayer(app, 'bob');
  const c = await newPlayer(app, 'carol');
  const d = await newPlayer(app, 'dave');
  ok(await send(b, 'alice', 'from-bob-1'), 201);
  clock.advance(MAIL_MIN_GAP_MS);
  ok(await send(b, 'alice', 'from-bob-2'), 201);
  clock.advance(MAIL_MIN_GAP_MS);
  ok(await send(c, 'alice', 'from-carol'), 201);
  clock.advance(MAIL_MIN_GAP_MS);
  ok(await send(a, 'bob', 'to-bob'), 201);

  // A third player sees nothing of alice/bob, and an unknown id is just empty.
  assert.deepEqual((await thread(d, a.id)).mails, []);
  assert.deepEqual((await thread(d, b.id)).mails, []);
  assert.deepEqual((await thread(a, 999999)).mails, []);
  assert.equal((await convs(d)).total, 0);
  const none = await d.c.post(`/api/mail/conversation/${a.id}/read`, {});
  ok(none);
  assert.equal(none.json<MailConversationReadResponse>().marked, 0);
  assert.equal(await unread(a), 3);

  // Carol's mail stays unread when alice reads bob's conversation.
  const rd = await a.c.post(`/api/mail/conversation/${b.id}/read`, {});
  ok(rd);
  assert.deepEqual(rd.json<MailConversationReadResponse>(), { marked: 2, unread: 1 });
  assert.equal(await unread(a), 1);
  assert.equal((await convs(a)).conversations.find((x) => x.player === 'carol')!.unread, 1);
  assert.equal((await thread(a, b.id)).mails.find((m) => m.body === 'from-bob-1')!.read, true);
  assert.equal((await thread(b, a.id)).mails.find((m) => m.body === 'to-bob')!.read, false, 'bob has not read alice');

  // Delete hides for alice only.
  const del = await a.c.post(`/api/mail/conversation/${b.id}/delete`, {});
  assert.equal(del.statusCode, 204);
  assert.deepEqual((await thread(a, b.id)).mails, []);
  assert.deepEqual((await convs(a)).conversations.map((x) => x.player), ['carol']);
  assert.deepEqual((await thread(b, a.id)).mails.map((m) => m.body), ['to-bob', 'from-bob-2', 'from-bob-1']);
  assert.equal((await convs(b)).conversations[0]!.player, 'alice');
  // A new letter after the delete starts the thread again, without the old ones.
  clock.advance(MAIL_MIN_GAP_MS);
  ok(await send(b, 'alice', 'fresh'), 201);
  assert.deepEqual((await thread(a, b.id)).mails.map((m) => m.body), ['fresh']);
  // Deleting also hides sent mails for bob's side only when bob deletes; a stranger deleting changes nothing.
  assert.equal((await d.c.post(`/api/mail/conversation/${b.id}/delete`, {})).statusCode, 204);
  assert.equal((await thread(b, a.id)).mails.length, 4);
  assert.equal((await b.c.post(`/api/mail/conversation/${a.id}/delete`, {})).statusCode, 204);
  assert.deepEqual((await thread(b, a.id)).mails, []);
});

test('mail conversations: validation and auth', async () => {
  const { app } = await makeApp();
  const a = await newPlayer(app, 'alice');
  for (const url of ['/api/mail/conversation/abc', '/api/mail/conversation/-1', '/api/mail/conversation/1.5', '/api/mail/conversation/1?limit=0',
    `/api/mail/conversation/1?limit=${MAIL_THREAD_MAX + 1}`, '/api/mail/conversation/1?limit=x', '/api/mail/conversation/1?before=x', '/api/mail/conversation/1?extra=1',
    '/api/mail/conversations?page=-1', '/api/mail/conversations?page=x', '/api/mail/conversations?extra=1']) {
    errorOf(await a.c.get(url), 400, 'invalid_input');
  }
  for (const act of ['read', 'delete']) {
    errorOf(await a.c.post(`/api/mail/conversation/abc/${act}`, {}), 400, 'invalid_input');
    errorOf(await a.c.post(`/api/mail/conversation/1/${act}`, { x: 1 }), 400, 'invalid_input');
  }
  ok(await a.c.get(`/api/mail/conversation/1?limit=${MAIL_THREAD_MAX}`));

  const anon = new Client(app, '10.9.9.9');
  for (const [m, url] of [['get', '/api/mail/conversations'], ['get', '/api/mail/conversation/1'], ['post', '/api/mail/conversation/1/read'], ['post', '/api/mail/conversation/1/delete']] as const) {
    assert.equal((await (m === 'get' ? anon.get(url) : anon.post(url, {}))).statusCode, 401, url);
  }
  // Cross-site post is refused.
  errorOf(await a.c.post('/api/mail/conversation/1/read', {}, { origin: 'http://evil.example' }), 403, 'forbidden');
});
