// Pure helpers behind the Renown card and the Feast stepper (src/renown.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEAST_COST, FEAST_DAILY_PER_LEVEL } from '@clanfire/engine';
import type { Resources } from '@clanfire/engine';
import { clampFeastCount, currentFeastAllowance, feastMaxCount, feastTotal, renownProgress, renownToGo } from '../src/renown.ts';

const stock = (wood: number, food: number, iron: number, gold = 0): Resources => ({ wood, food, iron, gold });

test('feastMaxCount is limited by the allowance and by the scarcest resource', () => {
  const unit = FEAST_COST.wood;
  assert.ok(unit > 0);
  // Plenty of everything: the allowance decides.
  assert.equal(feastMaxCount(stock(1e9, 1e9, 1e9, 1e9), 3), 3);
  // Nothing left today.
  assert.equal(feastMaxCount(stock(1e9, 1e9, 1e9, 1e9), 0), 0);
  // One resource short for a second Feast.
  assert.equal(feastMaxCount(stock(unit * 5, unit * 5, unit * 2 + 1, 1e9), 9), 2);
  // Not enough for even one.
  assert.equal(feastMaxCount(stock(0, 0, 0), 9), 0);
  // Bad numbers never give a negative or fractional count.
  assert.equal(feastMaxCount(stock(1e9, 1e9, 1e9, 1e9), -4), 0);
  assert.equal(feastMaxCount(stock(1e9, 1e9, 1e9, 1e9), Number.NaN), 0);
  assert.equal(feastMaxCount(stock(1e9, 1e9, 1e9, 1e9), 2.9), 2);
});

test('clampFeastCount keeps the stepper inside 1..max, and 0 when nothing is possible', () => {
  assert.equal(clampFeastCount(5, 3), 3);
  assert.equal(clampFeastCount(0, 3), 1);
  assert.equal(clampFeastCount(-2, 3), 1);
  assert.equal(clampFeastCount(2, 3), 2);
  assert.equal(clampFeastCount(2.7, 3), 2);
  assert.equal(clampFeastCount(2, 0), 0);
  assert.equal(clampFeastCount(Number.NaN, 4), 1);
});

test('feastTotal multiplies the Feast bundle', () => {
  const t = feastTotal(3);
  for (const r of ['wood', 'food', 'iron', 'gold'] as const) assert.equal(t[r], FEAST_COST[r] * 3);
  assert.equal(feastTotal(0).wood, 0);
  // The constant itself is untouched.
  assert.equal(FEAST_COST.wood, feastTotal(1).wood);
});

test('currentFeastAllowance: an ended window counts as empty, a finished level raises the maximum', () => {
  const open = { max: FEAST_DAILY_PER_LEVEL, used: 2, left: FEAST_DAILY_PER_LEVEL - 2, windowEnd: 10_000 };
  const during = currentFeastAllowance(open, 1, 5_000);
  assert.deepEqual(during, { max: FEAST_DAILY_PER_LEVEL, used: 2, left: FEAST_DAILY_PER_LEVEL - 2, windowEnd: 10_000 });
  const after = currentFeastAllowance(open, 1, 10_000);
  assert.deepEqual(after, { max: FEAST_DAILY_PER_LEVEL, used: 0, left: FEAST_DAILY_PER_LEVEL, windowEnd: null });
  const levelUp = currentFeastAllowance(open, 2, 5_000);
  assert.equal(levelUp.max, FEAST_DAILY_PER_LEVEL * 2);
  assert.equal(levelUp.left, FEAST_DAILY_PER_LEVEL * 2 - 2);
  const none = currentFeastAllowance({ max: 0, used: 0, left: 0, windowEnd: null }, 0, 0);
  assert.equal(none.max, 0);
  assert.equal(none.left, 0);
});

test('renownToGo and renownProgress', () => {
  assert.equal(renownToGo({ balance: 120, nextVillageCost: 300 }), 180);
  assert.equal(renownToGo({ balance: 400, nextVillageCost: 300 }), 0);
  assert.equal(renownProgress({ balance: 150, nextVillageCost: 300 }), 0.5);
  assert.equal(renownProgress({ balance: 900, nextVillageCost: 300 }), 1);
  assert.equal(renownProgress({ balance: 0, nextVillageCost: 300 }), 0);
  assert.equal(renownProgress({ balance: 5, nextVillageCost: 0 }), 1);
});
