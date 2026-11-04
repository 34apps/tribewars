import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildTimeMs,
  buildingCost,
  canAfford,
  netProductionPerHour,
  productionPerHour,
  storageCap,
  storageCapForLevel,
  upkeepPerHour,
  vaultProtection,
  createNpcVillage,
} from '../src/index.ts';
import { S1, S10, village } from './helpers.ts';

describe('building cost and time', () => {
  it('cost is base * growth^(L-1), rounded per resource', () => {
    assert.deepEqual(buildingCost('hall', 1), { wood: 90, food: 80, iron: 70, gold: 0 });
    assert.deepEqual(buildingCost('hall', 3), { wood: 143, food: 127, iron: 111, gold: 0 });
    assert.deepEqual(buildingCost('stables', 2), { wood: 330, food: 254, iron: 381, gold: 25 });
  });

  it('time shrinks with Town Hall level and with world speed', () => {
    assert.equal(buildTimeMs('hall', 1, 1, S1), 600_000);
    assert.equal(buildTimeMs('lumber', 3, 1, S1), 608_400);
    assert.equal(buildTimeMs('lumber', 3, 5, S1), 495_546);
    assert.equal(buildTimeMs('hall', 1, 1, S10), 60_000);
  });
});

describe('production, upkeep, storage, vault', () => {
  it('production follows level 0 trickle, level formula and speed', () => {
    const v = village();
    assert.deepEqual(productionPerHour(v, S1), { wood: 30, food: 40, iron: 30, gold: 0 });
    assert.deepEqual(productionPerHour(v, S10), { wood: 300, food: 400, iron: 300, gold: 0 });
    const w = village({ buildings: { lumber: 0, farm: 3, goldmine: 2 } });
    assert.deepEqual(productionPerHour(w, S1), { wood: 5, food: 55, iron: 30, gold: 12 });
    const zero = village({ buildings: { goldmine: 0 } });
    assert.equal(productionPerHour(zero, S1).gold, 0);
  });

  it('upkeep counts troops, away units and queued units; abandoned villages pay none', () => {
    const v = village({ troops: { pikeman: 10, outrider: 2 }, away: { knight: 1 } });
    v.trainQueues.barracks.push({ unit: 'raider', count: 5, done: 2, perUnitMs: 1000, startAt: 0 });
    // 0.25 food per population point: 10*0.25 + 2*0.5 + 1*1 + (5-2)*0.25
    assert.equal(upkeepPerHour(v, S1), 5.25);
    assert.equal(upkeepPerHour(v, S10), 52.5);
    assert.equal(netProductionPerHour(v, S1).food, 40 - 5.25);
    assert.equal(upkeepPerHour(createNpcVillage(2, 0), S1), 0);
  });

  it('storage cap and vault follow their level formulas', () => {
    assert.equal(storageCapForLevel(0), 800);
    assert.equal(storageCap(village()), 1000);
    assert.equal(storageCapForLevel(3), 1538);
    assert.equal(storageCap(village({ buildings: { storehouse: 10 } })), 6931);
    assert.equal(vaultProtection(village()), 0);
    assert.equal(vaultProtection(village({ buildings: { vault: 1 } })), 120);
    assert.equal(vaultProtection(village({ buildings: { vault: 3 } })), 219);
  });

  it('canAfford compares every resource', () => {
    const have = { wood: 10, food: 10, iron: 10, gold: 0 };
    assert.ok(canAfford(have, { wood: 10, food: 0, iron: 5, gold: 0 }));
    assert.ok(!canAfford(have, { wood: 10, food: 0, iron: 5, gold: 1 }));
    assert.ok(!canAfford(have, { wood: Number.NaN, food: 0, iron: 0, gold: 0 }));
  });
});
