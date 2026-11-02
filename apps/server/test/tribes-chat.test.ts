import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRIBE_CHAT_KEEP, TRIBE_CHAT_MESSAGE_MAX, type ChatMessageDto, type ChatResponse } from '@clanfire/engine';
import { errorOf, makeApp, ok } from './helpers.ts';
import { addMember, count, newLeader, newPlayer, type P } from './tribe-helpers.ts';

const post = (p: P, text: unknown) => p.c.post('/api/tribe/chat', { text });
const list = async (p: P, after?: number): Promise<ChatMessageDto[]> => {
  const res = await p.c.get(after === undefined ? '/api/tribe/chat' : `/api/tribe/chat?after=${after}`);
  ok(res);
  return res.json<ChatResponse>().messages;
};

test('chat: post, list, after-cursor; plain text, trimmed, length checked', async () => {
  const { app, clock } = await makeApp();
  const lead = await newLeader(app, 'lead', 'Chatters', 'CHAT', 'open');
  const mem = await addMember(app, lead, 'plain');
  assert.deepEqual(await list(lead), [], 'empty to begin with');

  const first = await post(mem, '  hello <b>world</b> & co  ');
  ok(first, 201);
  const m1 = first.json<ChatMessageDto>();
  assert.deepEqual([m1.playerId, m1.username, m1.text, m1.createdAt], [mem.id, 'plain', 'hello <b>world</b> & co', clock.now()]);
  assert.ok(m1.id > 0);
  clock.advance(1500);
  const m2 = (await post(lead, 'second\nline')).json<ChatMessageDto>();
  assert.equal(m2.text, 'second\nline', 'inner newlines stay');
  assert.ok(m2.id > m1.id);

  // Everyone in the tribe sees the same, oldest first.
  assert.deepEqual(await list(lead), [m1, m2]);
  assert.deepEqual(await list(mem), [m1, m2]);
  assert.deepEqual(await list(lead, m1.id), [m2]);
  assert.deepEqual(await list(lead, m2.id), []);
  assert.deepEqual(await list(lead, 0), [m1, m2]);
  assert.deepEqual(await list(lead, 999_999), []);

  // Length: 1..TRIBE_CHAT_MESSAGE_MAX characters after trimming (characters, not UTF-16 units).
  const fail = async (text: unknown, status = 400) => {
    clock.advance(1100);
    errorOf(await post(lead, text), status, 'invalid_input');
  };
  await fail('');
  await fail('   \n\t ');
  await fail('x'.repeat(TRIBE_CHAT_MESSAGE_MAX + 1));
  await fail(' ' + 'x'.repeat(TRIBE_CHAT_MESSAGE_MAX + 1) + ' ');
  await fail('bell\u0007');
  await fail('nul\u0000');
  await fail(`line${String.fromCharCode(0x2028)}separator`);
  await fail('lone \ud800 surrogate');
  await fail(5);
  await fail(undefined);
  errorOf(await lead.c.post('/api/tribe/chat', { text: 'hi', extra: true }), 400, 'invalid_input');
  errorOf(await lead.c.post('/api/tribe/chat', {}), 400, 'invalid_input');
  assert.equal(count(app, 'tribe_messages'), 2, 'rejected messages are not stored');
  clock.advance(1100);
  ok(await post(lead, 'x'.repeat(TRIBE_CHAT_MESSAGE_MAX)), 201);
  clock.advance(1100);
  ok(await post(lead, ' ' + '\u{1F600}'.repeat(TRIBE_CHAT_MESSAGE_MAX) + ' '), 201);
  clock.advance(1100);
  ok(await post(lead, 'a'), 201);

  // Invalid messages did not use up the rate limit (the sequence above ran at one per 1.1 s).
  assert.equal((await list(lead)).length, 5);
  await app.close();
});

test('chat: per-player rate limit (1 per second, 20 per minute) answers 429 rate_limited', async () => {
  const { app, clock } = await makeApp();
  const lead = await newLeader(app, 'lead', 'Rate Tribe', 'RATE', 'open');
  const mem = await addMember(app, lead, 'plain');

  ok(await post(lead, 'one'), 201);
  errorOf(await post(lead, 'two, same millisecond'), 429, 'rate_limited');
  clock.advance(999);
  errorOf(await post(lead, 'two, 999 ms later'), 429, 'rate_limited');
  // The limit is per player.
  ok(await post(mem, 'someone else is fine'), 201);
  clock.advance(1);
  ok(await post(lead, 'two, 1000 ms later'), 201);
  assert.equal(count(app, 'tribe_messages'), 3, 'refused messages are not stored');

  // 20 per minute: this window holds 2 so far; fill it up (18 more at 1.1 s).
  for (let i = 0; i < 18; i++) {
    clock.advance(1100);
    ok(await post(lead, `msg ${i}`), 201);
  }
  clock.advance(1100);
  const blocked = await post(lead, 'one too many');
  errorOf(blocked, 429, 'rate_limited');
  assert.equal(typeof blocked.json<{ message: string }>().message, 'string');
  // Another player is unaffected, and the first player is free again once old messages leave the window.
  ok(await post(mem, 'still fine'), 201);
  clock.advance(60_000);
  ok(await post(lead, 'back again'), 201);
  await app.close();
});

test('chat: paging (last 100, then 100 after a cursor), pruning, and isolation between tribes', async () => {
  const { app, clock } = await makeApp();
  const lead = await newLeader(app, 'lead', 'Pager Tribe', 'PAGE', 'open');
  const other = await newLeader(app, 'rival', 'Rival Tribe', 'RIVAL', 'open');
  const ts = app.ctx.store.tribes;
  const ids: number[] = [];
  for (let i = 0; i < 150; i++) ids.push(ts.insertMessage(lead.tribeId, lead.id, `msg ${i}`, clock.now(), TRIBE_CHAT_KEEP));
  ts.insertMessage(other.tribeId, other.id, 'rival secret', clock.now(), TRIBE_CHAT_KEEP);

  // No cursor: the last 100, oldest first.
  const latest = await list(lead);
  assert.equal(latest.length, 100);
  assert.deepEqual(latest.map((m) => m.text).slice(0, 2), ['msg 50', 'msg 51']);
  assert.equal(latest[99]?.text, 'msg 149');
  assert.ok(latest.every((m, i) => i === 0 || m.id > (latest[i - 1]?.id ?? 0)));
  // With a cursor: strictly newer messages, at most 100, oldest first.
  const afterFirst = await list(lead, ids[0]);
  assert.equal(afterFirst.length, 100);
  assert.equal(afterFirst[0]?.text, 'msg 1');
  assert.deepEqual((await list(lead, ids[119])).map((m) => m.text), Array.from({ length: 30 }, (_, i) => `msg ${120 + i}`));
  assert.deepEqual(await list(lead, ids[149]), []);

  // Tribes only see their own chat.
  assert.deepEqual((await list(other)).map((m) => m.text), ['rival secret']);
  assert.ok(!(await list(lead)).some((m) => m.text === 'rival secret'));

  // Only the newest TRIBE_CHAT_KEEP messages are kept.
  for (let i = 150; i < TRIBE_CHAT_KEEP + 20; i++) ts.insertMessage(lead.tribeId, lead.id, `msg ${i}`, clock.now(), TRIBE_CHAT_KEEP);
  assert.equal(count(app, 'tribe_messages', 'tribe_id = ?', lead.tribeId), TRIBE_CHAT_KEEP);
  assert.equal(count(app, 'tribe_messages', 'tribe_id = ?', other.tribeId), 1);
  const oldest = (await list(lead, 0))[0];
  assert.equal(oldest?.text, 'msg 20');
  // The API path prunes too.
  clock.advance(2000);
  ok(await post(lead, 'newest'), 201);
  assert.equal(count(app, 'tribe_messages', 'tribe_id = ?', lead.tribeId), TRIBE_CHAT_KEEP);
  assert.equal((await list(lead)).at(-1)?.text, 'newest');
  await app.close();
});

test('chat: leaving or being removed ends access; disbanding deletes the history', async () => {
  const { app, clock } = await makeApp();
  const lead = await newLeader(app, 'lead', 'Closing Time', 'CLOSE', 'open');
  const mem = await addMember(app, lead, 'plain');
  const stranger = await newPlayer(app, 'stranger');
  ok(await post(mem, 'before'), 201);
  errorOf(await post(stranger, 'hi'), 409, 'not_in_tribe');
  errorOf(await stranger.c.get('/api/tribe/chat'), 409, 'not_in_tribe');

  ok(await lead.c.post(`/api/tribe/members/${mem.id}/kick`));
  errorOf(await post(mem, 'after'), 409, 'not_in_tribe');
  errorOf(await mem.c.get('/api/tribe/chat'), 409, 'not_in_tribe');
  // The old message stays in the tribe's history, under the author's name.
  assert.deepEqual((await list(lead)).map((m) => [m.username, m.text]), [['plain', 'before']]);

  clock.advance(2000);
  ok(await post(lead, 'last words'), 201);
  ok(await lead.c.post('/api/tribe/disband'));
  assert.equal(count(app, 'tribe_messages'), 0);
  await app.close();
});
