// World session expiry: idle 14 days (slides with use), absolute 60 days, short fixed sessions for lobby entry passes.

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign as edSign } from 'node:crypto';
import { afterEach, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { ENTRY_PASS_DOMAIN, ENTRY_PASS_TTL_MS, type MeResponse } from '@clanfire/engine';
import { LOBBY_WORLD_SESSION_MS, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from '../src/auth.ts';
import { Client, HOUR, makeApp, ok, register } from './helpers.ts';

const DAY = 24 * HOUR;
const closers: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of closers.splice(0)) await a.close();
});

const meOf = async (c: Client): Promise<MeResponse['player']> => (await c.get('/api/auth/me')).json<MeResponse>().player;

test('the limits are 14 days idle and 60 days absolute', () => {
  assert.equal(SESSION_IDLE_MS, 14 * DAY);
  assert.equal(SESSION_ABSOLUTE_MS, 60 * DAY);
});

test('idle: a session unused for 14 days ends; use keeps it alive', async () => {
  const { app, clock } = await makeApp();
  closers.push(app);
  const idle = await register(app, 'Idle_One');
  const busy = await register(app, 'Busy_One');
  for (let i = 0; i < 5; i++) {
    clock.advance(10 * DAY);
    assert.ok(await meOf(busy), `busy session alive on day ${(i + 1) * 10}`);
  }
  assert.equal(await meOf(idle), null, 'the idle session ended after 14 days without use');
});

test('absolute: even a busy session ends 60 days after sign-in', async () => {
  const { app, clock } = await makeApp();
  closers.push(app);
  const c = await register(app, 'Busy_Two');
  for (let d = 5; d <= 55; d += 5) {
    clock.advance(5 * DAY);
    assert.ok(await meOf(c), `alive on day ${d}`);
  }
  clock.advance(6 * DAY); // day 61
  assert.equal(await meOf(c), null);
});

test('the session cookie lives as long as the absolute limit', async () => {
  const { app } = await makeApp();
  closers.push(app);
  const res = await new Client(app).post('/api/auth/register', { username: 'Cookie_One', password: 'correct horse battery' });
  assert.equal(res.cookies.find((c) => c.name === 'tw_session')?.maxAge, SESSION_ABSOLUTE_MS / 1000);
});

test('a session opened with a lobby pass is short, fixed (does not slide) and ends after LOBBY_WORLD_SESSION_MS', async () => {
  const pair = generateKeyPairSync('ed25519');
  const der = pair.publicKey.export({ type: 'spki', format: 'der' });
  const kid = createHash('sha256').update(der).digest('hex').slice(0, 16);
  const { app, clock } = await makeApp({ lobbyPublicKey: der.toString('base64') });
  closers.push(app);
  const claims = { v: 1, kid, aid: 5, name: 'Lobby_Lia', wid: 'w1', chn: 'ysra', role: null, iat: clock.t, exp: clock.t + ENTRY_PASS_TTL_MS, nonce: randomBytes(16).toString('base64url') };
  const part = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const pass = `${part}.${edSign(null, Buffer.from(`${ENTRY_PASS_DOMAIN}\n${part}`, 'utf8'), pair.privateKey).toString('base64url')}`;
  const c = new Client(app, '10.8.0.1');
  const res = await c.post('/api/auth/enter', { pass });
  ok(res, 201);
  const cookie = res.cookies.find((x) => x.name === 'tw_session' && x.value !== '');
  assert.ok(cookie);
  assert.equal(cookie.maxAge, LOBBY_WORLD_SESSION_MS / 1000);
  c.cookie = `tw_session=${cookie.value}`;

  clock.advance(LOBBY_WORLD_SESSION_MS - HOUR);
  assert.ok(await meOf(c), 'alive just before the end');
  clock.advance(2 * HOUR); // use did not extend it
  assert.equal(await meOf(c), null, 'ended after the fixed lobby window, so the browser must go through the lobby again');
});
