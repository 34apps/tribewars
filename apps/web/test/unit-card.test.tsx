// Unit info cards: the pure helpers (bars against the strongest unit, field time text, flipping, training counts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UNITS, UNIT_IDS } from '@clanfire/engine';
import { flipUnit, inTraining, perFieldText, statBars, stockLine, strongest } from '../src/components/unitCardLogic.ts';

test('strongest unit per stat comes from the engine data', () => {
  for (const key of ['attack', 'defenseInfantry', 'defenseCavalry'] as const) {
    const top = strongest(UNIT_IDS, key);
    assert.equal(top.value, Math.max(...UNIT_IDS.map((u) => UNITS[u][key])));
  }
});

test('stat bars: the best unit is full, others are in proportion, never zero-width when they have a value', () => {
  const best = strongest(UNIT_IDS, 'attack');
  const full = statBars(best.unit, UNIT_IDS)[0];
  assert.equal(full?.pct, 100);
  const raider = statBars('raider', UNIT_IDS)[0];
  assert.equal(raider?.value, UNITS.raider.attack);
  assert.equal(raider?.pct, Math.max(3, Math.round((UNITS.raider.attack / best.value) * 100)));
  assert.equal(raider?.best, best.unit);
});

test('perFieldText is minutes:seconds', () => {
  assert.equal(perFieldText(600_000), '10:00');
  assert.equal(perFieldText(90_500), '1:31');
  assert.equal(perFieldText(30_000), '0:30');
  assert.equal(perFieldText(Infinity), '–');
});

test('flipUnit wraps in both directions', () => {
  const list = ['pikeman', 'guard', 'raider'] as const;
  assert.equal(flipUnit(list, 'raider', 1), 'pikeman');
  assert.equal(flipUnit(list, 'pikeman', -1), 'raider');
  assert.equal(flipUnit(list, 'guard', 1), 'raider');
  assert.equal(flipUnit(list, 'knight', 1), 'pikeman');
});

test('inTraining sums what is still waiting; stockLine hides zeros', () => {
  const t = inTraining({
    barracks: [{ unit: 'raider', count: 5, done: 1, perUnitMs: 1, startAt: 0 }, { unit: 'pikeman', count: 3, done: 0, perUnitMs: 1, startAt: 0 }],
    stables: [{ unit: 'raider', count: 2, done: 2, perUnitMs: 1, startAt: 0 }],
  });
  assert.equal(t.raider, 4);
  assert.equal(t.pikeman, 3);
  assert.equal(stockLine(12, 4, 5), '12 at home · 4 away · 5 training');
  assert.equal(stockLine(0, 0, 0), '0 at home');
});
