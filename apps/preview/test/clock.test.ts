import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clock as pageClock, createClock } from '../src/clock.ts';

function fake(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

test('game time follows real time at rate 1', () => {
  const r = fake();
  const c = createClock(r.now);
  const t0 = c.gameNow();
  r.advance(5000);
  assert.equal(c.gameNow(), t0 + 5000);
});

test('setRate keeps time continuous and speeds up afterwards', () => {
  const r = fake();
  const c = createClock(r.now);
  r.advance(1000);
  const before = c.gameNow();
  c.setRate(100);
  assert.equal(c.gameNow(), before);
  r.advance(1000);
  assert.equal(c.gameNow(), before + 100_000);
  c.setRate(1);
  const mid = c.gameNow();
  r.advance(1000);
  assert.equal(c.gameNow(), mid + 1000);
  c.setRate(0.5); // below 1 is ignored
  assert.equal(c.getRate(), 1);
});

test('skip only moves forward', () => {
  const r = fake();
  const c = createClock(r.now);
  const t0 = c.gameNow();
  c.skip(3_600_000);
  assert.equal(c.gameNow(), t0 + 3_600_000);
  c.skip(-5000);
  c.skip(0);
  assert.equal(c.gameNow(), t0 + 3_600_000);
  r.advance(10);
  assert.equal(c.gameNow(), t0 + 3_600_010);
});

test('change listeners fire on setRate and skip', () => {
  const c = createClock(fake().now);
  let n = 0;
  const off = c.onChange(() => n++);
  c.setRate(10);
  c.skip(1000);
  off();
  c.skip(1000);
  assert.equal(n, 2);
});

test('snapshot / restore: closed page passes at 1x, saved rate resumes', () => {
  const r = fake();
  const a = createClock(r.now);
  a.setRate(1000);
  r.advance(2000);
  const snap = a.snapshot();
  assert.equal(snap.rate, 1000);
  r.advance(60_000); // page closed for a minute
  const b = createClock(r.now);
  b.restore(snap);
  assert.equal(b.gameNow(), snap.virtual + 60_000);
  assert.equal(b.getRate(), 1000);
  r.advance(1000);
  assert.equal(b.gameNow(), snap.virtual + 60_000 + 1_000_000);
});

test('restore of a broken rate falls back to 1x', () => {
  const r = fake();
  const c = createClock(r.now);
  c.restore({ virtual: r.now(), rate: 0, realAt: r.now() });
  assert.equal(c.getRate(), 1);
});

test('the page clock replaces Date: no-arg constructor and Date.now use game time, arguments unchanged', () => {
  const before = Date.now();
  pageClock.skip(86_400_000);
  assert.ok(Date.now() >= before + 86_400_000);
  assert.ok(new Date().getTime() >= before + 86_400_000);
  assert.equal(new Date(5).getTime(), 5);
  assert.equal(new Date('2026-01-01T00:00:00Z').getTime(), Date.UTC(2026, 0, 1));
  assert.ok(new Date() instanceof Date);
});
