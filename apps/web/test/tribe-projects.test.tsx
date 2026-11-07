// Tribe projects: plain effect sentences and the Roads travel-time preview (apps/web/src/tribe/Projects.tsx, hooks/useRoadsLevel.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectText, shortEffect, shortNext } from '../src/tribe/Projects.tsx';
import { withRoads } from '../src/hooks/useRoadsLevel.ts';

test('effect sentences use the exact numbers from the server', () => {
  assert.equal(effectText('roads', 0.2), 'Support and shipments between members 20% faster');
  assert.equal(effectText('wards', 0.08), 'Sites you hold defend 8% better');
  assert.equal(effectText('watchtower', 1), 'Warnings show rough size');
  assert.match(effectText('watchtower', 3), /about how many troops/);
});

test('short effects are terse values with a label', () => {
  assert.deepEqual(shortEffect('roads', 0.2), { value: '20%', label: 'faster trips between members' });
  assert.equal(shortEffect('roads', 0).value, '0%');
  assert.equal(shortEffect('wards', 0.08).value, '8%');
  assert.equal(shortEffect('wards', 0.08).label, 'defence at held sites');
  assert.deepEqual(
    [0, 1, 2, 3].map((l) => shortEffect('watchtower', l).value),
    ['–', 'size', 'size, slowest', 'size, slowest, count'],
  );
  assert.equal(shortEffect('watchtower', 1).label, 'in warnings');
  assert.deepEqual([1, 2, 3].map((l) => shortNext('watchtower', l)), ['size', '+ slowest', '+ count']);
  assert.equal(shortNext('roads', 0.2), '20%');
});

test('Roads shorten travel by the level bonus, rounded up', () => {
  assert.equal(withRoads(1000, 0), 1000);
  assert.equal(withRoads(1000, 1), 900);
  assert.equal(withRoads(1001, 2), 801);
  assert.equal(withRoads(1000, 3), 700);
});
