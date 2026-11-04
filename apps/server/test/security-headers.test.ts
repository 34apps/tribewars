import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CSP, ROUTE_LIMITS, routeBucket, type RouteBucket } from '../src/security.ts';
import { Client, MINUTE, PASSWORD, errorOf, makeApp, ok, register } from './helpers.ts';

const headers = { host: 'clanfire.test' };

test('security headers on API, 404 and error responses; no HSTS outside production', async () => {
  const { app } = await makeApp({ hsts: false });
  for (const url of ['/api/health', '/api/nope', '/some/page']) {
    const r = await app.inject({ method: 'GET', url, headers });
    assert.equal(r.headers['content-security-policy'], CSP, url);
    assert.match(String(r.headers['permissions-policy']), /camera=\(\)/);
    assert.match(String(r.headers['permissions-policy']), /microphone=\(\)/);
    assert.match(String(r.headers['permissions-policy']), /geolocation=\(\)/);
    assert.equal(r.headers['strict-transport-security'], undefined, url);
  }
  const csp = String((await app.inject({ method: 'GET', url: '/api/health', headers })).headers['content-security-policy']);
  for (const part of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"]) {
    assert.ok(csp.includes(part), part);
  }
  assert.ok(!/script-src[^;]*unsafe/.test(csp), 'no unsafe script sources');
});

test('HSTS is sent when enabled (production), one year with subdomains', async () => {
  const { app } = await makeApp({ hsts: true });
  const r = await app.inject({ method: 'GET', url: '/api/health', headers });
  assert.equal(r.headers['strict-transport-security'], 'max-age=31536000; includeSubDomains');
});

test('route patterns map to the intended limit buckets', () => {
  const cases: [string, string, RouteBucket | null][] = [
    ['POST', '/api/villages/:id/send', 'send'],
    ['POST', '/api/stationed/:id/recall', 'send'],
    ['POST', '/api/villages/:id/build', 'build'],
    ['POST', '/api/villages/:id/train', 'train'],
    ['POST', '/api/villages/:id/research', 'research'],
    ['POST', '/api/villages/:id/ship', 'market'],
    ['POST', '/api/villages/:id/feast', 'feast'],
    ['GET', '/api/rankings/renown', 'rankings'],
    ['POST', '/api/tribe/diplomacy', 'tribe'],
    ['POST', '/api/tribes', 'tribe'],
    ['POST', '/api/invites/:id/accept', 'tribe'],
    ['GET', '/api/tribes', 'search'],
    ['GET', '/api/players/:id', 'search'],
    ['GET', '/api/mail', 'mail'],
    ['POST', '/api/mail', 'mail'],
    ['GET', '/api/rankings/players', 'rankings'],
    ['GET', '/api/state', null],
    ['GET', '/api/map', null],
  ];
  for (const [m, p, b] of cases) assert.equal(routeBucket(m, p), b, `${m} ${p}`);
});

/** One representative call per bucket; invalid bodies still count (the limit runs before validation). */
const CALLS: Record<RouteBucket, (c: Client, vid: number) => ReturnType<Client['call']>> = {
  send: (c, v) => c.post(`/api/villages/${v}/send`, {}),
  build: (c, v) => c.post(`/api/villages/${v}/build`, {}),
  train: (c, v) => c.post(`/api/villages/${v}/train`, {}),
  research: (c, v) => c.post(`/api/villages/${v}/research`, {}),
  market: (c, v) => c.post(`/api/villages/${v}/ship`, {}),
  feast: (c, v) => c.post(`/api/villages/${v}/feast`, {}),
  tribe: (c) => c.post('/api/tribe/leave'),
  mail: (c) => c.get('/api/mail'),
  search: (c) => c.get('/api/tribes'),
  rankings: (c) => c.get('/api/rankings/players'),
};

for (const bucket of Object.keys(ROUTE_LIMITS) as RouteBucket[]) {
  test(`per-account limit "${bucket}": refused past ${ROUTE_LIMITS[bucket]}/min for one account, others unaffected, resets`, async () => {
    const { app, clock } = await makeApp();
    const a = await register(app, 'alice', '10.0.0.1');
    const b = await register(app, 'bob', '10.0.0.2');
    const va = (await a.village()).id;
    const vb = (await b.village()).id;
    const call = CALLS[bucket];
    for (let i = 0; i < ROUTE_LIMITS[bucket]; i++) {
      const r = await call(a, va);
      assert.notEqual(r.statusCode, 429, `call ${i + 1} should pass`);
    }
    const blocked = await call(a, va);
    errorOf(blocked, 429, 'rate_limited');
    assert.equal(blocked.headers['retry-after'], '60');
    // Same account from a new session and another IP is still limited (key is the account, not session/IP).
    const a2 = new Client(app, '10.0.0.9');
    ok(await a2.post('/api/auth/login', { username: 'alice', password: PASSWORD }));
    errorOf(await call(a2, va), 429, 'rate_limited');
    // Another account is unaffected.
    assert.notEqual((await call(b, vb)).statusCode, 429);
    clock.advance(MINUTE + 1);
    assert.notEqual((await call(a, va)).statusCode, 429);
  });
}
