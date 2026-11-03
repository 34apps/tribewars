import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RATE_API_PER_IP, RATE_WRITE_PER_IP } from '../src/app.ts';
import { MINUTE, makeApp } from './helpers.ts';

const headers = { host: 'clanfire.test' };

test('global limit: reads over the per-IP cap answer 429 + Retry-After; health is exempt; window resets', async () => {
  const { app, clock } = await makeApp();
  for (let i = 0; i < RATE_API_PER_IP; i++) {
    const r = await app.inject({ method: 'GET', url: '/api/nope', headers });
    assert.equal(r.statusCode, 404);
  }
  const blocked = await app.inject({ method: 'GET', url: '/api/nope', headers });
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.json<{ error: string }>().error, 'rate_limited');
  assert.equal(blocked.headers['retry-after'], '60');
  assert.equal((await app.inject({ method: 'GET', url: '/api/health', headers })).statusCode, 200);
  clock.advance(MINUTE + 1);
  assert.equal((await app.inject({ method: 'GET', url: '/api/nope', headers })).statusCode, 404);
});

test('global limit: writes have a lower per-IP cap', async () => {
  const { app } = await makeApp();
  for (let i = 0; i < RATE_WRITE_PER_IP; i++) {
    const r = await app.inject({ method: 'POST', url: '/api/nope', headers, payload: {} });
    assert.equal(r.statusCode, 404);
  }
  const blocked = await app.inject({ method: 'POST', url: '/api/nope', headers, payload: {} });
  assert.equal(blocked.statusCode, 429);
});
