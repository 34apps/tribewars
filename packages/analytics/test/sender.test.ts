import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import {
  AnalyticsSender,
  BACKOFF_BASE_MS,
  BATCH_EVENTS,
  BATCH_MAX_AGE_MS,
  IID_RE,
  NO_ANALYTICS,
  analyticsFromEnv,
  iidOf,
  validateEvent,
} from '../src/index.ts';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A fake fetch that answers with the given statuses in turn (the last one repeats; 0 = network error). */
function fakeFetch(statuses: number[] = [200]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    const s = statuses[Math.min(calls.length - 1, statuses.length - 1)]!;
    if (s === 0) throw new TypeError('fetch failed');
    return new Response(null, { status: s });
  }) as unknown as typeof fetch;
  return { f, calls };
}

function make(statuses?: number[], over: { maxQueued?: number } = {}) {
  const clock = { t: Date.UTC(2026, 10, 20, 12, 0, 0) };
  const { f, calls } = fakeFetch(statuses);
  const warnings: string[] = [];
  const s = new AnalyticsSender({ salt: 'test-salt', app: '0.1.0-dev', fetch: f, now: () => clock.t, log: { warn: (m) => warnings.push(m) }, timer: false, ...over });
  return { s, clock, calls, warnings };
}

test('iid is the first 32 hex of HMAC-SHA256(salt, subject) and never contains the subject', () => {
  const iid = iidOf('salt', '42');
  assert.match(iid, IID_RE);
  assert.equal(iid, createHmac('sha256', 'salt').update('42').digest('hex').slice(0, 32));
  assert.notEqual(iid, iidOf('other', '42'));
  assert.notEqual(iid, iidOf('salt', '43'));
});

test('validateEvent applies the wire format rules', () => {
  assert.equal(validateEvent('register_done'), null);
  assert.equal(validateEvent('iap_done', { product: 'flames_100', price_micros: 2_500_000, currency: 'EUR', first: 1 }, 3), null);
  assert.match(validateEvent('Bad')!, /event name/);
  assert.match(validateEvent('1abc')!, /event name/);
  assert.match(validateEvent('a'.repeat(41))!, /event name/);
  assert.match(validateEvent('x', { Bad: 1 })!, /param name/);
  assert.match(validateEvent('x', { a: 'Has Space' })!, /value/);
  assert.match(validateEvent('x', { a: 'UPPERCASE' })!, /value/); // only a 3-letter currency may be upper case
  assert.match(validateEvent('x', { a: 'a'.repeat(41) })!, /value/);
  assert.match(validateEvent('x', { a: Number.NaN })!, /value/);
  assert.match(validateEvent('x', { a: true as unknown as number })!, /value/);
  assert.match(validateEvent('x', { a: null as unknown as number })!, /value/);
  const nine = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i]));
  assert.match(validateEvent('x', nine)!, /params/);
  assert.match(validateEvent('x', {}, -1)!, /lvl/);
  assert.match(validateEvent('x', {}, 1.5)!, /lvl/);
});

test('invalid events are dropped and logged, never queued', async () => {
  const { s, calls, warnings } = make();
  s.track('1', 'Bad Name');
  s.track('1', 'ok_event', { place: 'Berlin Mitte' });
  assert.equal(s.pending, 0);
  assert.equal(warnings.length, 2);
  await s.flush();
  assert.equal(calls.length, 0);
});

test('a batch has exactly the wire keys, plat web, a hex iid, integer seq and .NET ticks', async () => {
  const { s, clock, calls } = make();
  s.track('7', 'register_done');
  s.track('7', 'ftue_step', { step: 'world_joined' }, 1);
  await s.flush();
  assert.equal(calls.length, 1);
  const c = calls[0]!;
  assert.match(c.url, /\/v1\/batch$/);
  assert.match(c.headers['x-project-key']!, /^ak_/);
  assert.deepEqual(Object.keys(c.body).sort(), ['app', 'events', 'iid', 'plat', 'seq', 'v']);
  assert.equal(c.body.v, 1);
  assert.equal(c.body.plat, 'web');
  assert.equal(c.body.app, '0.1.0-dev');
  assert.match(c.body.iid as string, IID_RE);
  assert.ok(Number.isSafeInteger(c.body.seq as number) && (c.body.seq as number) >= 0);
  const events = c.body.events as Array<{ e: string; utc: number; lvl?: number; p?: unknown }>;
  assert.equal(events.length, 2);
  assert.deepEqual(Object.keys(events[0]!).sort(), ['e', 'utc']);
  assert.equal((events[0]!.utc - 621_355_968_000_000_000) / 10_000, clock.t);
  assert.equal(events[1]!.lvl, 1);
  assert.deepEqual(events[1]!.p, { step: 'world_joined' });
});

test('batches per iid: 20 events go at once, fewer wait for 30 s', async () => {
  const { s, clock, calls } = make();
  for (let i = 0; i < BATCH_EVENTS; i++) s.track('a', 'page_open', { page: 'map' });
  await Promise.resolve();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1, 'the 20th event sealed the batch');
  assert.equal((calls[0]!.body.events as unknown[]).length, BATCH_EVENTS);
  s.track('b', 'page_open', { page: 'map' });
  s.track('c', 'page_open', { page: 'map' });
  s.pump();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1, 'less than 30 s: still waiting');
  clock.t += BATCH_MAX_AGE_MS;
  s.pump();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 3, 'one batch per iid');
  assert.notEqual(calls[1]!.body.iid, calls[2]!.body.iid);
  assert.equal(s.pending, 0);
});

test('seq is flush time ms * 1000 + a counter and grows for every batch', async () => {
  const { s, clock, calls } = make();
  s.track('a', 'register_done');
  s.track('b', 'register_done');
  s.track('c', 'register_done');
  await s.flush();
  const seqs = calls.map((c) => c.body.seq as number);
  assert.equal(seqs.length, 3);
  assert.equal(seqs[0], clock.t * 1000);
  assert.equal(seqs[1], clock.t * 1000 + 1);
  assert.equal(seqs[2], clock.t * 1000 + 2);
});

test('retry keeps the same seq on network error, 429 and 5xx, with growing waits', async () => {
  const { s, clock, calls } = make([0, 429, 503, 200]);
  s.track('a', 'register_done');
  await s.flush();
  assert.equal(calls.length, 1);
  assert.equal(s.pending, 1, 'kept for a retry');
  s.pump();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1, 'not before the wait is over');
  clock.t += BACKOFF_BASE_MS;
  s.pump();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 2);
  clock.t += BACKOFF_BASE_MS; // the second wait is twice as long
  s.pump();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 2);
  clock.t += BACKOFF_BASE_MS;
  s.pump();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 3);
  clock.t += 10 * BACKOFF_BASE_MS;
  s.pump();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 4);
  assert.equal(new Set(calls.map((c) => c.body.seq)).size, 1, 'same seq on every attempt');
  assert.equal(s.pending, 0);
});

test('400, 401 and 413 are not retried: the batch is dropped and counted', async () => {
  for (const status of [400, 401, 413]) {
    const { s, calls, warnings } = make([status]);
    s.track('a', 'register_done');
    await s.flush();
    await s.flush();
    assert.equal(calls.length, 1, `status ${status}`);
    assert.equal(s.pending, 0);
    assert.equal(s.droppedTotal, 1);
    assert.equal(warnings.length, 1);
  }
});

test('the queue is bounded: extra events are dropped and reported as `dropped` with the next batch', async () => {
  const { s, calls } = make([200], { maxQueued: 3 });
  for (let i = 0; i < 5; i++) s.track(`p${i}`, 'register_done');
  assert.equal(s.pending, 3);
  assert.equal(s.droppedTotal, 2);
  await s.flush();
  assert.equal(calls.length, 3);
  assert.equal(calls[0]!.body.dropped, 2, 'the loss is reported once');
  s.track('x', 'register_done');
  await s.flush();
  assert.equal(calls.at(-1)!.body.dropped, undefined);
});

test('track and flush never throw, also when fetch itself throws', async () => {
  const s = new AnalyticsSender({ salt: 's', app: '1.0.0', fetch: (() => {
    throw new Error('boom');
  }) as unknown as typeof fetch, timer: false });
  assert.doesNotThrow(() => s.track('a', 'register_done'));
  assert.doesNotThrow(() => s.track(undefined as unknown as string, 'register_done'));
  await s.flush();
});

test('off unless ANALYTICS=1 and a salt: everything is a no-op and nothing is fetched', async () => {
  const { f, calls } = fakeFetch();
  for (const env of [{}, { ANALYTICS: '1' }, { ANALYTICS: '0', ANALYTICS_SALT: 'x' }, { ANALYTICS_SALT: 'x' }, { ANALYTICS: 'true', ANALYTICS_SALT: 'x' }]) {
    const a = analyticsFromEnv(env, { version: '0.1.0', fetch: f });
    assert.equal(a.enabled, false);
    assert.equal(a, NO_ANALYTICS);
    a.track('1', 'register_done');
    await a.flush();
    await a.close();
  }
  assert.equal(calls.length, 0);
  const on = analyticsFromEnv({ ANALYTICS: '1', ANALYTICS_SALT: 'x' }, { version: '0.1.0', fetch: f });
  assert.equal(on.enabled, true);
  await on.close();
});

test('ANALYTICS_APP overrides the version (valid labels only)', async () => {
  const { f, calls } = fakeFetch();
  const a = analyticsFromEnv({ ANALYTICS: '1', ANALYTICS_SALT: 'x', ANALYTICS_APP: '0.1.0-dev' }, { version: '0.1.0', fetch: f });
  a.track('1', 'register_done');
  await a.flush();
  assert.equal(calls[0]!.body.app, '0.1.0-dev');
  const warnings: string[] = [];
  const b = analyticsFromEnv({ ANALYTICS: '1', ANALYTICS_SALT: 'x', ANALYTICS_APP: 'bad label!' }, { version: '0.1.0', fetch: f, log: { warn: (m) => warnings.push(m) } });
  b.track('1', 'register_done');
  await b.flush();
  assert.equal(calls[1]!.body.app, '0.1.0');
  assert.equal(warnings.length, 1);
  await a.close();
  await b.close();
});
