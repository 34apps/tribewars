import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANCEL_WINDOW_MS, canCancel, cancelReturnMs } from '../src/index.ts';

const m = (kind: string) => ({ kind, departAt: 1000, arriveAt: 1000 + 10 * CANCEL_WINDOW_MS });

test('canCancel: inside the window for outgoing kinds only', () => {
  for (const k of ['attack', 'scout', 'support', 'shipment']) {
    assert.equal(canCancel(m(k), 1000 + CANCEL_WINDOW_MS), true);
    assert.equal(canCancel(m(k), 1001 + CANCEL_WINDOW_MS), false);
  }
  assert.equal(canCancel(m('return'), 2000), false);
});

test('canCancel: never once arrived', () => {
  assert.equal(canCancel({ kind: 'attack', departAt: 0, arriveAt: 50_000 }, 50_000), false);
});

test('cancelReturnMs: elapsed time with a one second floor', () => {
  assert.equal(cancelReturnMs(1000, 31_000), 30_000);
  assert.equal(cancelReturnMs(1000, 1000), 1000);
});
