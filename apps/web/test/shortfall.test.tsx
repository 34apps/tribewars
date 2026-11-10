import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BuildingLevels, Resources } from '@clanfire/engine';
import { goldNeverArrives, needsGoldText, unreachableResources } from '../src/shortfall.ts';

const r = (wood: number, food: number, iron: number, gold: number): Resources => ({ wood, food, iron, gold });
const cap = 1000;

test('gold that is short with no production is unreachable', () => {
  const net = r(10, 10, 10, 0);
  assert.deepEqual(unreachableResources(r(500, 500, 500, 0), net, r(100, 0, 0, 50), cap), ['gold']);
  assert.equal(goldNeverArrives(r(500, 500, 500, 0), net, r(100, 0, 0, 50), cap), true);
});

test('enough gold in stock, or gold being produced, is not a shortfall', () => {
  assert.equal(goldNeverArrives(r(0, 0, 0, 60), r(1, 1, 1, 0), r(0, 0, 0, 50), cap), false);
  assert.equal(goldNeverArrives(r(0, 0, 0, 0), r(1, 1, 1, 3), r(0, 0, 0, 50), cap), false);
  assert.deepEqual(unreachableResources(r(0, 0, 0, 0), r(1, 1, 1, 3), r(10, 0, 0, 5), cap), []);
});

test('other resources with no production are named too; a cost above storage is never reached', () => {
  assert.deepEqual(unreachableResources(r(0, 0, 0, 100), r(0, 5, 5, 0), r(10, 0, 0, 5), cap), ['wood']);
  assert.deepEqual(unreachableResources(r(0, 0, 0, 0), r(1, 1, 1, 3), r(0, 0, 0, 5000), cap), ['gold']);
  assert.equal(goldNeverArrives(r(0, 0, 0, 0), r(1, 1, 1, 0), r(0, 0, 0, 5000), cap), false);
});

test('the gold text mentions Town Hall 3 only while the Gold Mine is locked', () => {
  const b = (hall: number, goldmine: number) => ({ hall, goldmine }) as BuildingLevels;
  assert.equal(needsGoldText(b(1, 0)), 'Needs gold · build a Gold Mine (needs Town Hall 3)');
  assert.equal(needsGoldText(b(3, 0)), 'Needs gold · build a Gold Mine');
});
