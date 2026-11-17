import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildTimeMs,
  buildingCost,
  canAfford,
  productionPerHour,
  storageCap,
  storageCapForLevel,
  vaultProtection,
} from '../src/index.ts';
import { S1, S10, village } from './helpers.ts';

describe('building cost and time', () => {
  it('cost is base * growth^(L-1), rounded per resource', () => {
    assert.deepEqual(buildingCost('hall', 1), { wood: 135, food: 120, iron: 105, gold: 0 });
    assert.deepEqual(buildingCost('hall', 3), { wood: 204, food: 182, iron: 159, gold: 0 });
    assert.deepEqual(buildingCost('stables', 2), { wood: 476, food: 366, iron: 549, gold: 24 });
  });

  it('time shrinks with Town Hall level and with world speed', () => {
    assert.equal(buildTimeMs('hall', 1, 1, S1), 600_000);
    assert.equal(buildTimeMs('lumber', 3, 1, S1), 573_352);
    assert.equal(buildTimeMs('lumber', 3, 5, S1), 480_112);
    assert.equal(buildTimeMs('hall', 1, 1, S10), 60_000);
  });
});

describe('production, storage, vault', () => {
  it('production follows level 0 trickle, level formula and speed', () => {
    const v = village();
    assert.deepEqual(productionPerHour(v, S1), { wood: 54, food: 72, iron: 54, gold: 0 });
    assert.deepEqual(productionPerHour(v, S10), { wood: 540, food: 720, iron: 540, gold: 0 });
    const w = village({ buildings: { lumber: 0, farm: 3, goldmine: 2 } });
    assert.deepEqual(productionPerHour(w, S1), { wood: 9, food: 91, iron: 54, gold: 3 });
    const zero = village({ buildings: { goldmine: 0 } });
    assert.equal(productionPerHour(zero, S1).gold, 0);
  });

  it('troops, away units and queued units never change the food rate (no upkeep)', () => {
    const v = village({ troops: { pikeman: 10, outrider: 2 }, away: { knight: 1 } });
    v.trainQueues.barracks.push({ unit: 'raider', count: 5, done: 2, perUnitMs: 1000, startAt: 0 });
    assert.deepEqual(productionPerHour(v, S1), productionPerHour(village(), S1));
    assert.equal(productionPerHour(v, S1).food, 72);
    assert.equal(productionPerHour(v, S10).food, 720);
  });

  it('storage cap and vault follow their level formulas', () => {
    assert.equal(storageCapForLevel(0), 1350);
    assert.equal(storageCap(village()), 1800);
    assert.equal(storageCapForLevel(3), 2494);
    assert.equal(storageCap(village({ buildings: { storehouse: 10 } })), 7803);
    assert.equal(vaultProtection(village()), 0);
    assert.equal(vaultProtection(village({ buildings: { vault: 1 } })), 120);
    assert.equal(vaultProtection(village({ buildings: { vault: 3 } })), 197);
    assert.equal(vaultProtection(village({ buildings: { vault: 12 } })), 1813); // level 12 hides what the old level 10 hid
  });

  it('canAfford compares every resource', () => {
    const have = { wood: 10, food: 10, iron: 10, gold: 0 };
    assert.ok(canAfford(have, { wood: 10, food: 0, iron: 5, gold: 0 }));
    assert.ok(!canAfford(have, { wood: 10, food: 0, iron: 5, gold: 1 }));
    assert.ok(!canAfford(have, { wood: Number.NaN, food: 0, iron: 0, gold: 0 }));
  });
});
