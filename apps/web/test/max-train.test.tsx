// No fixed limit on one Recruit order (owner, 2026-11-18): "max" fills what the village can pay for and house.
import { DEFAULT_WORLD, MAX_TRAIN_BATCH, UNITS, applyTrain, checkTrain, createPlayerVillage } from '@clanfire/engine';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maxTrainable } from '../src/rules.ts';

test('a village with room and resources for 3,500 Raiders queues them in one order, and max returns 3,500', () => {
  const s = { ...DEFAULT_WORLD, speed: 1 };
  const v = createPlayerVillage(0);
  v.buildings.barracks = 3;
  v.buildings.longhouse = 25;
  const c = UNITS.raider.cost;
  v.resources = { wood: c.wood * 3500, food: c.food * 3500, iron: c.iron * 3500, gold: c.gold * 3500 };
  assert.ok(3500 < MAX_TRAIN_BATCH);
  assert.equal(maxTrainable(v, 'raider', 0, s), 3500);
  assert.equal(checkTrain(v, 'raider', 3500, 0, s).ok, true);
  const after = applyTrain(v, 'raider', 3500, 0, s);
  assert.equal(after.trainQueues.barracks[0]?.count, 3500);
  assert.equal(checkTrain(v, 'raider', MAX_TRAIN_BATCH + 1, 0, s).ok, false);
});
