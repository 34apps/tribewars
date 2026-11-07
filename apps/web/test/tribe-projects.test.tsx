// Tribe projects: plain effect sentences and the Roads travel-time preview (apps/web/src/tribe/Projects.tsx, hooks/useRoadsLevel.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectText } from '../src/tribe/Projects.tsx';
import { withRoads } from '../src/hooks/useRoadsLevel.ts';

test('effect sentences use the exact numbers from the server', () => {
  assert.equal(effectText('roads', 0.2), 'Support and shipments between members 20% faster');
  assert.equal(effectText('wards', 0.08), 'Sites you hold defend 8% better');
  assert.equal(effectText('watchtower', 1), 'Warnings show rough size');
  assert.match(effectText('watchtower', 3), /about how many troops/);
});

test('Roads shorten travel by the level bonus, rounded up', () => {
  assert.equal(withRoads(1000, 0), 1000);
  assert.equal(withRoads(1000, 1), 900);
  assert.equal(withRoads(1001, 2), 801);
  assert.equal(withRoads(1000, 3), 700);
});
