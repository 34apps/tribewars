// Pure helpers behind the Renown card and the Feast stepper (src/renown.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEAST_COST, FEAST_MAX_COUNT, feastPrice } from '@clanfire/engine';
import type { Resources } from '@clanfire/engine';
import {
  clampFeastCount,
  feastDiscountPercent,
  feastMaxCount,
  feastTotal,
  nextFeastDiscountPercent,
  renownProgress,
  renownToGo,
} from '../src/renown.ts';

const stock = (wood: number, food: number, iron: number, gold = 0): Resources => ({ wood, food, iron, gold });

test('feastMaxCount follows the scarcest resource, with no daily limit, up to the request cap', () => {
  const unit = FEAST_COST.wood;
  assert.equal(feastMaxCount(stock(1e12, 1e12, 1e12, 1e12), FEAST_COST), FEAST_MAX_COUNT);
  // One resource short for a second Feast.
  assert.equal(feastMaxCount(stock(unit * 5, unit * 5 * 3, unit * 2 + 1, 1e9), FEAST_COST), 2);
  assert.equal(feastMaxCount(stock(0, 0, 0), FEAST_COST), 0);
  // The level price counts: level 4 is cheaper, so more Feasts fit.
  const rich = stock(100_000, 100_000, 100_000);
  assert.ok(feastMaxCount(rich, feastPrice(4)) > feastMaxCount(rich, feastPrice(1)));
});

test('clampFeastCount keeps the amount inside 1..max, and 0 when nothing is possible', () => {
  assert.equal(clampFeastCount(5, 3), 3);
  assert.equal(clampFeastCount(0, 3), 1);
  assert.equal(clampFeastCount(-2, 3), 1);
  assert.equal(clampFeastCount(2, 3), 2);
  assert.equal(clampFeastCount(2.7, 3), 2);
  assert.equal(clampFeastCount(2, 0), 0);
  assert.equal(clampFeastCount(Number.NaN, 4), 1);
});

test('feastTotal multiplies one Feast price', () => {
  const t = feastTotal(3, feastPrice(2));
  for (const r of ['wood', 'food', 'iron', 'gold'] as const) assert.equal(t[r], feastPrice(2)[r] * 3);
  assert.equal(feastTotal(0, FEAST_COST).wood, 0);
  assert.equal(feastTotal(1, FEAST_COST).wood, FEAST_COST.wood);
});

test('level discounts for the page: 0 / 10 / 20 / 30 percent, next level shown, none past the highest', () => {
  assert.deepEqual([1, 2, 3, 4].map(feastDiscountPercent), [0, 10, 20, 30]);
  assert.equal(feastDiscountPercent(0), 0);
  assert.deepEqual([1, 2, 3, 4].map(nextFeastDiscountPercent), [10, 20, 30, null]);
});

test('renownToGo and renownProgress', () => {
  assert.equal(renownToGo({ balance: 120, nextVillageCost: 300 }), 180);
  assert.equal(renownToGo({ balance: 400, nextVillageCost: 300 }), 0);
  assert.equal(renownProgress({ balance: 150, nextVillageCost: 300 }), 0.5);
  assert.equal(renownProgress({ balance: 900, nextVillageCost: 300 }), 1);
  assert.equal(renownProgress({ balance: 0, nextVillageCost: 300 }), 0);
  assert.equal(renownProgress({ balance: 5, nextVillageCost: 0 }), 1);
});
