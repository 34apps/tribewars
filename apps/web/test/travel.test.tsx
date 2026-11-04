// Texts for the terrain part of the send preview (src/map/travel.ts). The numbers themselves are the engine's (tested there).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Route } from '@clanfire/engine';
import { slowdownText, slowGroundText } from '../src/map/travel.ts';

const route = (tiles: Partial<Route['tiles']>): Route => {
  const full = { grass: 0, forest: 0, hills: 0, mountain: 0, lake: 0, ...tiles };
  const length = full.grass + full.forest + full.hills + full.mountain + full.lake;
  return { length, step: 1, samples: [], tiles: full };
};

test('slowdownText shows the percentage only when terrain makes the trip longer', () => {
  assert.equal(slowdownText(3_600_000, 3_600_000), null);
  assert.equal(slowdownText(3_600_000, 4_032_000), '+12%');
  assert.equal(slowdownText(3_600_000, 3_600_001), '+1%');
  assert.equal(slowdownText(0, 5), null);
  assert.equal(slowdownText(3_600_000, Infinity), null);
});

test('slowGroundText names the slow ground in fields and leaves grass out', () => {
  assert.equal(slowGroundText(route({ grass: 9 })), '');
  assert.equal(slowGroundText(route({ grass: 5, hills: 2.14 })), '2.1 fields of hills');
  assert.equal(slowGroundText(route({ grass: 5, forest: 1.44, lake: 3 })), '1.4 fields of forest, 3.0 of water');
});
