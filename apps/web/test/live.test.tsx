// Pure parts of the live-update socket: frame guard, backoff, poll interval.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiBase, withApiBase } from '../src/api.ts';
import { LIVE_POLL_MS, RECONNECT_MAX_MS, backoffMs, liveUrl, parseLiveMessage, pollMs } from '../src/hooks/live.ts';

test('parseLiveMessage accepts the three server frames and drops unknown topics', () => {
  assert.deepEqual(parseLiveMessage('{"type":"hello"}'), { type: 'hello' });
  assert.deepEqual(parseLiveMessage('{"type":"pong"}'), { type: 'pong' });
  assert.deepEqual(parseLiveMessage('{"type":"hint","topics":["game","nope","chat",7]}'), { type: 'hint', topics: ['game', 'chat'] });
});

test('parseLiveMessage ignores malformed frames', () => {
  for (const raw of ['', 'not json', 'null', '42', '[]', '{"type":"hint"}', '{"type":"hint","topics":"game"}', '{"type":"other"}', new ArrayBuffer(2), undefined]) {
    assert.equal(parseLiveMessage(raw), null);
  }
  assert.equal(parseLiveMessage(`{"type":"hint","topics":["game"],"pad":"${'x'.repeat(5000)}"}`), null);
});

test('backoffMs grows from about 1 s to a 30 s cap, with jitter', () => {
  assert.equal(backoffMs(0, 0.5), 1000);
  assert.equal(backoffMs(1, 0.5), 2000);
  assert.equal(backoffMs(3, 0.5), 8000);
  assert.ok(backoffMs(0, 0) >= 800 && backoffMs(0, 1) <= 1200);
  for (const n of [5, 6, 20, 1000]) assert.ok(backoffMs(n, 1) <= RECONNECT_MAX_MS);
  assert.equal(backoffMs(20, 0.5), RECONNECT_MAX_MS);
});

test('pollMs slows polls to 60 s only while connected', () => {
  assert.equal(pollMs(10_000, false), 10_000);
  assert.equal(pollMs(5000, true), LIVE_POLL_MS);
});

test('liveUrl is same-origin and follows https', () => {
  assert.equal(liveUrl({ protocol: 'http:', host: 'localhost:5173' }), 'ws://localhost:5173/api/live');
  assert.equal(liveUrl({ protocol: 'https:', host: 'game.example' }), 'wss://game.example/api/live');
});

test('API base follows the /w/<id>/ prefix of the page URL (default /api)', () => {
  assert.equal(apiBase('/'), '/api');
  assert.equal(apiBase('/index.html'), '/api');
  assert.equal(apiBase('/w/w1/'), '/w/w1/api');
  assert.equal(apiBase('/w/w2'), '/w/w2/api');
  assert.equal(apiBase('/w/bad_id/'), '/api');
  assert.equal(liveUrl({ protocol: 'https:', host: 'play.example.com', pathname: '/w/w2/' }), 'wss://play.example.com/w/w2/api/live');
  assert.equal(liveUrl({ protocol: 'https:', host: 'play.example.com', pathname: '/' }), 'wss://play.example.com/api/live');
});

test('withApiBase prefixes API paths under a world page and leaves others alone', () => {
  const g = globalThis as { window?: unknown };
  const saved = g.window;
  try {
    g.window = { location: { pathname: '/w/w1/' } };
    assert.equal(withApiBase('/api/state'), '/w/w1/api/state');
    assert.equal(withApiBase('/api/map?x=1&y=2'), '/w/w1/api/map?x=1&y=2');
    assert.equal(withApiBase('/other'), '/other');
    g.window = { location: { pathname: '/' } };
    assert.equal(withApiBase('/api/state'), '/api/state');
  } finally {
    g.window = saved;
  }
});
