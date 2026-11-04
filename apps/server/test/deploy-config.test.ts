import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadEnv } from '../src/env.ts';
import { HOST, makeApp } from './helpers.ts';

test('SANDBOX_USERS default: dev name outside production, empty in production, explicit wins', () => {
  assert.deepEqual(loadEnv({}).sandboxUsers, ['metinaltinbas']);
  assert.deepEqual(loadEnv({ NODE_ENV: 'production' }).sandboxUsers, []);
  assert.deepEqual(loadEnv({ NODE_ENV: 'production', SANDBOX_USERS: 'Alice, bob' }).sandboxUsers, ['alice', 'bob']);
  assert.deepEqual(loadEnv({ SANDBOX_USERS: '' }).sandboxUsers, []);
});

test('ALLOWED_ORIGINS parsing', () => {
  assert.deepEqual(loadEnv({}).allowedOrigins, []);
  assert.deepEqual(loadEnv({ ALLOWED_ORIGINS: 'https://Play.Clanfire.com/, http://localhost:5173 ,https://play.clanfire.com' }).allowedOrigins, [
    'https://play.clanfire.com',
    'http://localhost:5173',
  ]);
  for (const bad of ['play.clanfire.com', 'ftp://x.com', 'https://x.com/path', 'https://x.com/?q=1', 'not a url']) {
    assert.throws(() => loadEnv({ ALLOWED_ORIGINS: bad }), /ALLOWED_ORIGINS/, bad);
  }
});

test('TRUST_PROXY parsing', () => {
  assert.equal(loadEnv({}).trustProxy, false);
  for (const v of ['0', 'false', 'no']) assert.equal(loadEnv({ TRUST_PROXY: v }).trustProxy, false);
  for (const v of ['1', 'true', 'YES']) assert.equal(loadEnv({ TRUST_PROXY: v }).trustProxy, true);
  assert.equal(loadEnv({ TRUST_PROXY: '2' }).trustProxy, 2);
  assert.equal(loadEnv({ TRUST_PROXY: '10.0.0.0/8, 192.168.1.5' }).trustProxy, '10.0.0.0/8,192.168.1.5');
  assert.equal(loadEnv({ TRUST_PROXY: '::1' }).trustProxy, '::1');
  for (const bad of ['maybe', '-3', '1.5x', 'abc.def', '10.0.0.1,']) assert.throws(() => loadEnv({ TRUST_PROXY: bad }), /TRUST_PROXY/, bad);
});

test('Origin check: allow-listed foreign Origin passes, unlisted gets 403, same-host and missing Origin still pass', async () => {
  const { app } = await makeApp({ allowedOrigins: ['https://play.example.com'] });
  const post = (origin: string | undefined) =>
    app.inject({ method: 'POST', url: '/api/nope', headers: { host: 'internal.alb', ...(origin ? { origin } : {}) }, payload: {} });
  assert.equal((await post('https://play.example.com')).statusCode, 404); // passed the Origin check
  assert.equal((await post('https://PLAY.example.com')).statusCode, 404);
  assert.equal((await post('https://evil.example.org')).statusCode, 403);
  assert.equal((await post('http://play.example.com')).statusCode, 403); // scheme differs
  assert.equal((await post(undefined)).statusCode, 404);
  const same = await app.inject({ method: 'POST', url: '/api/nope', headers: { host: HOST, origin: `https://${HOST}` }, payload: {} });
  assert.equal(same.statusCode, 404);
});

test('health answers 200 {ok:true} and 503 when the database fails', async () => {
  const { app } = await makeApp();
  const r = await app.inject({ method: 'GET', url: '/api/health', headers: { host: HOST } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { ok: true });
  app.ctx.store.getMeta = () => {
    throw new Error('db down');
  };
  const bad = await app.inject({ method: 'GET', url: '/api/health', headers: { host: HOST } });
  assert.equal(bad.statusCode, 503);
  assert.deepEqual(bad.json(), { ok: false });
});

test('trustProxy hop count reaches Fastify (client IP is read that many hops from the right)', async () => {
  const { app } = await makeApp({ trustProxy: 2 });
  app.get('/api/ip', async (req) => ({ ip: req.ip }));
  const r = await app.inject({ method: 'GET', url: '/api/ip', headers: { host: HOST, 'x-forwarded-for': '9.9.9.9, 1.2.3.4, 5.6.7.8' } });
  assert.equal(r.json<{ ip: string }>().ip, '1.2.3.4');
});
