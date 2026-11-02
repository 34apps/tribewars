import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { MeResponse } from '@tribewars/engine';
import { Client, HOUR, MINUTE, PASSWORD, errorOf, makeApp, ok, register } from './helpers.ts';

const DAY = 24 * HOUR;

test('register, me, logout, login flow', async () => {
  const { app } = await makeApp();
  const c = new Client(app);

  // Signed out: me is 200 with a null player.
  const anon = await c.get('/api/auth/me');
  ok(anon);
  assert.deepEqual(anon.json<MeResponse>(), { player: null });

  const reg = await c.post('/api/auth/register', { username: 'Alice_1', password: PASSWORD });
  ok(reg, 201);
  const setCookie = String(reg.headers['set-cookie']);
  assert.match(setCookie, /^tw_session=[A-Za-z0-9_-]{43};/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /Max-Age=2592000/);
  assert.doesNotMatch(setCookie, /Secure/i);
  const created = reg.json<MeResponse>().player;
  assert.ok(created);
  assert.equal(created.username, 'Alice_1');
  assert.ok(created.protectedUntil > 0);

  const me = await c.get('/api/auth/me');
  assert.deepEqual(me.json<MeResponse>().player, created);

  // The new player owns exactly one village, named after them.
  const st = await c.state();
  assert.equal(st.villages.length, 1);
  assert.equal(st.villages[0]?.name, "Alice_1's village");

  const out = await c.post('/api/auth/logout');
  assert.equal(out.statusCode, 204);
  assert.match(String(out.headers['set-cookie']), /tw_session=;/);
  assert.equal(c.cookie, '');
  assert.deepEqual((await c.get('/api/auth/me')).json<MeResponse>(), { player: null });

  // Sign back in (username is case-insensitive).
  const login = await c.post('/api/auth/login', { username: 'alice_1', password: PASSWORD });
  ok(login);
  assert.equal(login.json<MeResponse>().player?.id, created.id);
  assert.equal((await c.get('/api/auth/me')).json<MeResponse>().player?.username, 'Alice_1');
  await app.close();
});

test('logout ends the session on the server, not only in the browser', async () => {
  const { app } = await makeApp();
  const c = await register(app, 'bob');
  const stolen = c.cookie;
  await c.post('/api/auth/logout');
  const replay = new Client(app);
  replay.cookie = stolen;
  errorOf(await replay.get('/api/state'), 401, 'unauthorized');
  await app.close();
});

test('duplicate usernames are refused, case-insensitively', async () => {
  const { app } = await makeApp();
  await register(app, 'Carol');
  const c = new Client(app);
  errorOf(await c.post('/api/auth/register', { username: 'carol', password: PASSWORD }), 409, 'username_taken');
  errorOf(await c.post('/api/auth/register', { username: 'CAROL', password: PASSWORD }), 409, 'username_taken');
  await app.close();
});

test('register validates username, password and unknown fields', async () => {
  const { app } = await makeApp();
  const bad: unknown[] = [
    { username: 'ab', password: PASSWORD },
    { username: 'a'.repeat(21), password: PASSWORD },
    { username: 'bad name', password: PASSWORD },
    { username: 'émile', password: PASSWORD },
    { username: "x'; DROP TABLE players;--", password: PASSWORD },
    { username: 'dave', password: 'short' },
    { username: 'dave', password: 'x'.repeat(129) },
    { username: 'dave' },
    { username: 'dave', password: PASSWORD, admin: true },
    { username: 12345, password: PASSWORD },
    { username: 'dave', password: 12345678 },
    [],
    'nope',
  ];
  // One address per attempt: the per-IP limiter counts invalid attempts too.
  for (const [i, body] of bad.entries()) {
    errorOf(await new Client(app, `10.1.0.${i}`).post('/api/auth/register', body), 400, 'invalid_input');
  }
  // Boundary values are accepted.
  ok(await new Client(app, '10.0.0.1').post('/api/auth/register', { username: 'abc', password: '12345678' }), 201);
  ok(await new Client(app, '10.0.0.2').post('/api/auth/register', { username: 'a'.repeat(20), password: 'x'.repeat(128) }), 201);
  await app.close();
});

test('login: wrong password and unknown user get the same generic answer', async () => {
  const { app } = await makeApp();
  await register(app, 'erin');
  const c = new Client(app);
  const wrong = await c.post('/api/auth/login', { username: 'erin', password: 'not the password' });
  const unknown = await c.post('/api/auth/login', { username: 'nobody', password: 'not the password' });
  errorOf(wrong, 401, 'unauthorized');
  errorOf(unknown, 401, 'unauthorized');
  assert.equal(wrong.json<{ message: string }>().message, unknown.json<{ message: string }>().message);
  assert.match(wrong.json<{ message: string }>().message, /Wrong username or password/);
  assert.equal(c.cookie, '');
  await app.close();
});

test('passwords are scrypt-hashed and only a hash of the session token is stored', async () => {
  const { app } = await makeApp();
  const c = await register(app, 'frank');
  const player = app.ctx.store.db.prepare('SELECT password_hash FROM players WHERE username = ?').get('frank') as { password_hash: string };
  const parts = player.password_hash.split('$');
  assert.equal(parts.length, 3);
  assert.equal(parts[0], 'scrypt');
  assert.match(parts[1] ?? '', /^[0-9a-f]{32}$/);
  assert.match(parts[2] ?? '', /^[0-9a-f]+$/);
  assert.ok(!player.password_hash.includes(PASSWORD));

  const token = c.cookie.split('=')[1] ?? '';
  const rows = app.ctx.store.db.prepare('SELECT token_hash FROM sessions').all() as Array<{ token_hash: string }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.token_hash, createHash('sha256').update(token).digest('hex'));
  assert.notEqual(rows[0]?.token_hash, token);
  await app.close();
});

test('two accounts with the same password get different salts', async () => {
  const { app } = await makeApp();
  await register(app, 'gina');
  await register(app, 'hank');
  const rows = app.ctx.store.db.prepare('SELECT password_hash FROM players').all() as Array<{ password_hash: string }>;
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0]?.password_hash, rows[1]?.password_hash);
  await app.close();
});

test('sessions expire after 30 days', async () => {
  const { app, clock } = await makeApp();
  const c = await register(app, 'ivy');
  clock.advance(29 * DAY);
  ok(await c.get('/api/state'));
  clock.advance(2 * DAY);
  errorOf(await c.get('/api/state'), 401, 'unauthorized');
  assert.deepEqual((await c.get('/api/auth/me')).json<MeResponse>(), { player: null });
  await app.close();
});

test('game routes require a session', async () => {
  const { app } = await makeApp();
  const c = new Client(app);
  for (const url of ['/api/state', '/api/map?x=0&y=0&w=5&h=5', '/api/reports', '/api/reports/1']) {
    errorOf(await c.get(url), 401, 'unauthorized');
  }
  errorOf(await c.post('/api/villages/1/build', { building: 'hall' }), 401, 'unauthorized');
  errorOf(await c.post('/api/villages/1/train', { unit: 'pikeman', count: 1 }), 401, 'unauthorized');
  errorOf(await c.post('/api/villages/1/send', { x: 0, y: 0, units: { pikeman: 1 } }), 401, 'unauthorized');
  // A forged or malformed cookie is no better than none.
  c.cookie = 'tw_session=' + 'A'.repeat(43);
  errorOf(await c.get('/api/state'), 401, 'unauthorized');
  c.cookie = 'tw_session=garbage';
  errorOf(await c.get('/api/state'), 401, 'unauthorized');
  // Health is public.
  const health = await c.get('/api/health');
  ok(health);
  assert.deepEqual(health.json(), { ok: true });
  await app.close();
});

test('sign-in and registration are rate limited per IP', async () => {
  const { app, clock } = await makeApp();
  await register(app, 'jack', '10.0.0.1');
  const attacker = new Client(app, '10.0.0.9');
  for (let i = 0; i < 10; i++) {
    errorOf(await attacker.post('/api/auth/login', { username: 'jack', password: 'guess number ' + i }), 401, 'unauthorized');
  }
  const blocked = await attacker.post('/api/auth/login', { username: 'jack', password: PASSWORD });
  errorOf(blocked, 429, 'rate_limited');
  assert.equal(blocked.headers['retry-after'], '60');
  // Another address is unaffected.
  ok(await new Client(app, '10.0.0.2').post('/api/auth/login', { username: 'jack', password: PASSWORD }));
  // Registration has its own budget and limit.
  for (let i = 0; i < 10; i++) {
    errorOf(await attacker.post('/api/auth/register', { username: 'x', password: PASSWORD }), 400, 'invalid_input');
  }
  errorOf(await attacker.post('/api/auth/register', { username: 'valid_name', password: PASSWORD }), 429, 'rate_limited');
  // The window passes.
  clock.advance(MINUTE + 1000);
  ok(await attacker.post('/api/auth/login', { username: 'jack', password: PASSWORD }));
  await app.close();
});

test('cross-site POSTs are refused (Origin must match Host)', async () => {
  const { app } = await makeApp();
  const c = new Client(app);
  const body = { username: 'kate', password: PASSWORD };
  errorOf(await c.post('/api/auth/register', body, { origin: 'https://evil.example' }), 403, 'forbidden');
  errorOf(await c.post('/api/auth/register', body, { origin: 'http://tribewars.test.evil.example' }), 403, 'forbidden');
  errorOf(await c.post('/api/auth/register', body, { origin: 'null' }), 403, 'forbidden');
  errorOf(await c.post('/api/auth/register', body, { origin: 'not a url' }), 403, 'forbidden');
  assert.equal((app.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n, 0);
  // Same host passes, whatever the scheme (TLS is usually terminated by a proxy).
  ok(await c.post('/api/auth/register', body, { origin: 'https://tribewars.test' }), 201);
  // Non-browser clients send no Origin at all.
  const noOrigin = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { host: 'tribewars.test' }, payload: body });
  ok(noOrigin);
  // The check also guards logged-in actions.
  const villageId = (await c.village()).id;
  errorOf(await c.post(`/api/villages/${villageId}/build`, { building: 'lumber' }, { origin: 'https://evil.example' }), 403, 'forbidden');
  // Reads are not state-changing.
  ok(await c.get('/api/state', { origin: 'https://evil.example' }));
  await app.close();
});

test('only JSON bodies are accepted, and they are size limited', async () => {
  const { app } = await makeApp();
  const post = (headers: Record<string, string>, payload: string) =>
    app.inject({ method: 'POST', url: '/api/auth/register', headers: { host: 'tribewars.test', ...headers }, payload });

  const form = await post({ 'content-type': 'application/x-www-form-urlencoded' }, 'username=lena&password=' + PASSWORD);
  assert.equal(form.statusCode, 415, form.body);
  const text = await post({ 'content-type': 'text/plain' }, JSON.stringify({ username: 'lena', password: PASSWORD }));
  assert.equal(text.statusCode, 415, text.body);
  assert.equal(text.json<{ error: string }>().error, 'invalid_input');
  errorOf(await post({ 'content-type': 'application/json' }, '{"username": '), 400, 'invalid_input');
  const big = await post({ 'content-type': 'application/json' }, JSON.stringify({ username: 'lena', password: PASSWORD, pad: 'x'.repeat(20_000) }));
  assert.equal(big.statusCode, 413, big.body);
  assert.equal((app.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n, 0);

  // Logout accepts an empty JSON body (clients that always set the header).
  const empty = await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { host: 'tribewars.test', 'content-type': 'application/json' },
    payload: '',
  });
  assert.equal(empty.statusCode, 204);
  await app.close();
});

test('session cookie is Secure when configured for production', async () => {
  const { app } = await makeApp({ secureCookies: true });
  const res = await new Client(app).post('/api/auth/register', { username: 'mona', password: PASSWORD });
  ok(res, 201);
  assert.match(String(res.headers['set-cookie']), /; Secure/i);
  assert.match(String(res.headers['set-cookie']), /HttpOnly/i);
  await app.close();
});

test('unknown API routes are JSON 404s; API responses are not cacheable', async () => {
  const { app } = await makeApp();
  const c = new Client(app);
  const res = await c.get('/api/does-not-exist');
  errorOf(res, 404, 'not_found');
  assert.equal(res.headers['cache-control'], 'no-store');
  errorOf(await c.post('/api/does-not-exist', {}), 404, 'not_found');
  assert.equal((await c.get('/api/health')).headers['x-content-type-options'], 'nosniff');
  await app.close();
});
