import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IP_GUARD_MESSAGE } from '../src/auth.ts';
import { RATE_AUTH_PER_IP, RATE_WRITE_PER_IP } from '../src/app.ts';
import { CSP, HSTS, originAllowed } from '../src/security.ts';
import { Client, PASSWORD, errorOf, makeApp, ok, register } from './helpers.ts';

const REGISTER = '/lobby/api/auth/register';
const LOGIN = '/lobby/api/auth/login';

test('IP guard: the third registration from one IP is refused, other IPs are fine', async () => {
  const { app } = await makeApp({ maxAccountsPerIp: 2 });
  await register(app, 'one_one', '192.0.2.1');
  await register(app, 'two_two', '192.0.2.1');
  const res = await new Client(app, '192.0.2.1').post(REGISTER, { username: 'three_three', password: PASSWORD });
  errorOf(res, 403, 'forbidden');
  assert.equal(res.json<{ message: string }>().message, IP_GUARD_MESSAGE);
  assert.equal(IP_GUARD_MESSAGE, 'Only one account per player is allowed. This connection already has an account.');
  assert.equal(res.cookies.length, 0);
  assert.equal(app.ctx.store.getAccountByLowerName('three_three'), null, 'nothing was created');
  await register(app, 'three_three', '192.0.2.2');
});

test('IP guard: a banned account no longer counts', async () => {
  const { app } = await makeApp({ maxAccountsPerIp: 2 });
  await register(app, 'one_one', '192.0.2.1');
  await register(app, 'two_two', '192.0.2.1');
  errorOf(await new Client(app, '192.0.2.1').post(REGISTER, { username: 'three_three', password: PASSWORD }), 403, 'forbidden');
  app.ctx.store.banAccount(1, 'test', 1);
  ok(await new Client(app, '192.0.2.1').post(REGISTER, { username: 'three_three', password: PASSWORD }), 201);
});

test('IP guard: sign-ins count too, so an IP an account signed in from is used up', async () => {
  const { app } = await makeApp({ maxAccountsPerIp: 1 });
  await register(app, 'one_one', '192.0.2.1');
  ok(await new Client(app, '192.0.2.2').post(LOGIN, { username: 'one_one', password: PASSWORD }));
  errorOf(await new Client(app, '192.0.2.2').post(REGISTER, { username: 'two_two', password: PASSWORD }), 403, 'forbidden');
  // Signing in again from the same IP does not use up a second slot.
  ok(await new Client(app, '192.0.2.2').post(LOGIN, { username: 'one_one', password: PASSWORD }));
  assert.equal(app.ctx.store.countActiveAccountsOnIp('192.0.2.2'), 1);
});

test('IP guard: 0 (and absent) means off', async () => {
  for (const maxAccountsPerIp of [0, undefined]) {
    const { app } = await makeApp({ maxAccountsPerIp });
    for (let i = 0; i < 5; i++) await register(app, `user_${i}`, '192.0.2.1');
    assert.equal(app.ctx.store.countActiveAccountsOnIp('192.0.2.1'), 5);
  }
});

test('IP guard: shared IPs show up for the operator', async () => {
  const { app } = await makeApp();
  await register(app, 'one_one', '192.0.2.1');
  await register(app, 'two_two', '192.0.2.1');
  await register(app, 'alone_x', '192.0.2.5');
  const groups = app.ctx.store.sharedIpGroups();
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.ip, '192.0.2.1');
  assert.deepEqual(groups[0]?.accounts.map((a) => a.username), ['one_one', 'two_two']);
});

test('rate limit: sign-in attempts per IP', async () => {
  const { app } = await makeApp();
  const c = new Client(app, '192.0.2.50');
  for (let i = 0; i < RATE_AUTH_PER_IP; i++) errorOf(await c.post(LOGIN, { username: 'nobody', password: 'wrong password' }), 401, 'unauthorized');
  const res = await c.post(LOGIN, { username: 'nobody', password: 'wrong password' });
  errorOf(res, 429, 'rate_limited');
  assert.equal(res.headers['retry-after'], '60');
  // Another IP is unaffected; registration has its own counter.
  errorOf(await new Client(app, '192.0.2.51').post(LOGIN, { username: 'nobody', password: 'wrong password' }), 401, 'unauthorized');
  ok(await c.post(REGISTER, { username: 'still_ok', password: PASSWORD }), 201);
});

test('rate limit: registrations per IP, and the window resets', async () => {
  const { app, clock } = await makeApp();
  const c = new Client(app, '192.0.2.60');
  for (let i = 0; i < RATE_AUTH_PER_IP; i++) ok(await new Client(app, '192.0.2.60').post(REGISTER, { username: `user_${i}`, password: PASSWORD }), 201);
  errorOf(await c.post(REGISTER, { username: 'one_more', password: PASSWORD }), 429, 'rate_limited');
  clock.advance(61_000);
  ok(await c.post(REGISTER, { username: 'one_more', password: PASSWORD }), 201);
});

test('rate limit: global write limit per IP, health is exempt', async () => {
  const { app } = await makeApp();
  const c = new Client(app, '192.0.2.70');
  // logout is a cheap write; the sign-in counters are not involved
  for (let i = 0; i < RATE_WRITE_PER_IP; i++) assert.equal((await c.post('/lobby/api/auth/logout')).statusCode, 204);
  errorOf(await c.post('/lobby/api/auth/logout'), 429, 'rate_limited');
  ok(await c.get('/lobby/api/health'));
});

test('Origin check: a cross-site POST is 403, same-origin and non-browser pass', async () => {
  const { app } = await makeApp({ allowedOrigins: ['https://play.example.com'] });
  const c = new Client(app);
  const body = { username: 'cross_site', password: PASSWORD };
  errorOf(await c.post(REGISTER, body, { origin: 'https://evil.example' }), 403, 'forbidden');
  errorOf(await c.post(REGISTER, body, { origin: 'null' }), 403, 'forbidden');
  errorOf(await c.post(REGISTER, body, { origin: 'not a url' }), 403, 'forbidden');
  errorOf(await c.post('/lobby/api/auth/logout', undefined, { origin: 'https://evil.example' }), 403, 'forbidden');
  assert.equal(app.ctx.store.getAccountByLowerName('cross_site'), null);
  // A listed origin (CDN / another host name) passes, as does a request without Origin (curl, server to server).
  ok(await c.post(REGISTER, body, { origin: 'https://play.example.com' }), 201);
  const noOrigin = await app.inject({ method: 'POST', url: '/lobby/api/auth/login', headers: { host: 'lobby.test', 'content-type': 'application/json' }, payload: JSON.stringify({ username: 'cross_site', password: PASSWORD }), remoteAddress: '192.0.2.9' });
  assert.equal(noOrigin.statusCode, 200);
  // Reads are never blocked by Origin.
  ok(await c.get('/lobby/api/auth/me', { origin: 'https://evil.example' }));
  // The helper itself
  assert.equal(originAllowed(undefined, 'a.test', new Set()), true);
  assert.equal(originAllowed('http://A.test', 'a.test', new Set()), true);
  assert.equal(originAllowed('http://b.test', 'a.test', new Set()), false);
  assert.equal(originAllowed('https://b.test', 'a.test', new Set(['https://b.test'])), true);
});

test('security headers on every response, HSTS only when asked, no-store on the API', async () => {
  const { app } = await makeApp();
  for (const url of ['/lobby/api/health', '/api/health', '/lobby/api/nothing-here', '/lobby/api/auth/me']) {
    const res = await new Client(app).get(url);
    assert.equal(res.headers['x-content-type-options'], 'nosniff', url);
    assert.equal(res.headers['x-frame-options'], 'DENY', url);
    assert.equal(res.headers['referrer-policy'], 'same-origin', url);
    assert.equal(res.headers['content-security-policy'], CSP, url);
    assert.match(String(res.headers['permissions-policy']), /camera=\(\)/, url);
    assert.equal(res.headers['strict-transport-security'], undefined, url);
    assert.equal(res.headers['cache-control'], 'no-store', url);
  }
  const prod = await makeApp({ hsts: true });
  assert.equal((await new Client(prod.app).get('/lobby/api/health')).headers['strict-transport-security'], HSTS);
});

test('routing: health under /lobby/api and bare /api, other paths are 404 JSON', async () => {
  const { app } = await makeApp();
  const c = new Client(app);
  assert.deepEqual((await c.get('/lobby/api/health')).json(), { ok: true });
  assert.deepEqual((await c.get('/api/health')).json(), { ok: true });
  assert.deepEqual((await c.get('/lobby/api/health?x=1')).json(), { ok: true });
  for (const url of ['/', '/lobby', '/lobby/', '/lobbyist/api/health', '/lobby/api/nothing', '/w/w1/api/health', '/lobby/lobby/api/health']) {
    errorOf(await c.get(url), 404, 'not_found');
  }
  errorOf(await c.post('/lobby/api/nothing', {}), 404, 'not_found');
});

test('too large a body is refused', async () => {
  const { app } = await makeApp();
  const res = await new Client(app).post(REGISTER, { username: 'big_body', password: PASSWORD, chieftain: 'x'.repeat(20_000) });
  assert.equal(res.statusCode, 413);
});

test('trustProxy: the client IP comes from X-Forwarded-For only when trusted', async () => {
  const trusted = await makeApp({ trustProxy: true, maxAccountsPerIp: 1 });
  const viaProxy = (name: string, ip: string) =>
    new Client(trusted.app, '10.0.0.1').post(REGISTER, { username: name, password: PASSWORD }, { 'x-forwarded-for': ip });
  ok(await viaProxy('proxied_a', '203.0.113.1'), 201);
  errorOf(await viaProxy('proxied_b', '203.0.113.1'), 403, 'forbidden');
  ok(await viaProxy('proxied_c', '203.0.113.2'), 201);

  // Untrusted: the header is ignored, every request is the socket's IP.
  const direct = await makeApp({ maxAccountsPerIp: 1 });
  const spoof = (name: string, ip: string) =>
    new Client(direct.app, '10.0.0.1').post(REGISTER, { username: name, password: PASSWORD }, { 'x-forwarded-for': ip });
  ok(await spoof('direct_a', '203.0.113.1'), 201);
  errorOf(await spoof('direct_b', '203.0.113.2'), 403, 'forbidden');
});
