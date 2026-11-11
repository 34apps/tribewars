// Texts for the terrain part of the send preview (src/map/travel.ts). The numbers themselves are the engine's (tested there).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Route } from '@clanfire/engine';
import { slowGroundText, slowTripText } from '../src/map/travel.ts';

const route = (tiles: Partial<Route['tiles']>): Route => {
  const full = { grass: 0, forest: 0, hills: 0, mountain: 0, lake: 0, ...tiles };
  const length = full.grass + full.forest + full.hills + full.mountain + full.lake;
  return { length, step: 1, samples: [], tiles: full };
};

test('slowTripText says in words which ground slows the trip and by how much', () => {
  const r = route({ grass: 5, hills: 5.9, forest: 15.7 });
  assert.equal(slowTripText(r, 3_600_000, 3_600_000), null);
  assert.equal(slowTripText(r, 3_600_000, 3_888_000), 'Forest and hills on the way: 8% slower');
  assert.equal(slowTripText(r, 3_600_000, 3_600_001), 'Forest and hills on the way: 1% slower');
  assert.equal(slowTripText(r, 0, 5), null);
  assert.equal(slowTripText(r, 3_600_000, Infinity), null);
  assert.equal(slowTripText(route({ grass: 9 }), 3_600_000, 4_000_000), 'Rough ground on the way: 11% slower');
});

test('slowGroundText names the slow ground, most first, and leaves grass out', () => {
  assert.equal(slowGroundText(route({ grass: 9 })), '');
  assert.equal(slowGroundText(route({ grass: 5, hills: 2.14 })), 'hills');
  assert.equal(slowGroundText(route({ grass: 5, forest: 1.44, lake: 3 })), 'water and forest');
  assert.equal(slowGroundText(route({ forest: 1, hills: 3, mountain: 2 })), 'hills, mountains and forest');
});
