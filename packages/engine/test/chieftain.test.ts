import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHIEFTAIN_MAX_BATCH,
  RENOWN_VILLAGE_BASE,
  TRAIN_TIME_FACTOR,
  TRAINING_BUILDING_IDS,
  UNITS,
  UNIT_IDS,
  applyTrain,
  armySpeed,
  checkMission,
  checkTrain,
  chieftainRefund,
  flatTravelTimeMs,
  normalizeVillage,
  populationUsage,
  settleVillage,
  trainTimeMs,
  villageRenownCost,
  villageRenownPrice,
} from '../src/index.ts';
import type { VillageState } from '../src/index.ts';
import { HOUR, S1, S10, units, village } from './helpers.ts';

const rich = (bannerhall = 1): VillageState =>
  village({ buildings: { bannerhall, farm: 10 }, resources: { wood: 20000, food: 20000, iron: 20000, gold: 1000 } });

describe('Chieftain unit', () => {
  it('has the design numbers', () => {
    const c = UNITS.chieftain;
    assert.deepEqual([c.attack, c.defenseInfantry, c.defenseCavalry, c.speed, c.carry], [0, 10, 10, 5, 0]);
    assert.deepEqual(c.cost, { wood: 4000, food: 3000, iron: 5000, gold: 150 });
    assert.equal(c.trainTimeSec, 6 * 3600);
    assert.equal(c.building, 'bannerhall');
    assert.equal(c.unitClass, 'infantry');
    assert.ok(UNIT_IDS.includes('chieftain'));
    assert.ok(TRAINING_BUILDING_IDS.includes('bannerhall'));
  });

  it('needs Banner Hall level 1', () => {
    const c = checkTrain(rich(0), 'chieftain', 1, 0, S1);
    assert.ok(!c.ok && c.reason === 'requirements_not_met');
    assert.ok(checkTrain(rich(1), 'chieftain', 1, 0, S1).ok);
  });

  it('trains 6 h per unit at level 1, faster per Banner Hall level, divided by speed', () => {
    assert.equal(trainTimeMs('chieftain', rich(1), S1), 6 * HOUR);
    assert.equal(trainTimeMs('chieftain', rich(3), S1), Math.round(21600 * TRAIN_TIME_FACTOR * TRAIN_TIME_FACTOR * 1000));
    assert.equal(trainTimeMs('chieftain', rich(1), S10), 0.6 * HOUR);
  });

  it('allows one batch of at most 3 per village', () => {
    const v = rich();
    const four = checkTrain(v, 'chieftain', CHIEFTAIN_MAX_BATCH + 1, 0, S1);
    assert.ok(!four.ok && four.reason === 'invalid_input');
    const queued = applyTrain(v, 'chieftain', 2, 0, S1);
    assert.equal(queued.trainQueues.bannerhall.length, 1);
    assert.equal(queued.trainQueues.barracks.length, 0);
    const second = checkTrain(queued, 'chieftain', 1, 0, S1);
    assert.ok(!second.ok && second.reason === 'queue_full');
  });

  it('finishes one by one in the Banner Hall queue and takes population (but eats no food) from the moment it is queued', () => {
    const queued = applyTrain(rich(), 'chieftain', 2, 0, S1);
    assert.equal(populationUsage(queued).troops, 16);
    assert.equal(settleVillage(queued, 6 * HOUR - 1, S1).troops.chieftain, 0);
    assert.equal(settleVillage(queued, 6 * HOUR, S1).troops.chieftain, 1);
    const done = settleVillage(queued, 12 * HOUR, S1);
    assert.equal(done.troops.chieftain, 2);
    assert.equal(done.trainQueues.bannerhall.length, 0);
    // once the batch is done a new one can be queued
    assert.ok(checkTrain(done, 'chieftain', 1, 12 * HOUR, S1).ok);
  });

  it('old saved states without the Banner Hall queue or Chieftain count load fine', () => {
    const old = village();
    const raw = JSON.parse(JSON.stringify(old)) as VillageState;
    delete (raw.trainQueues as Partial<VillageState['trainQueues']>).bannerhall;
    delete (raw.troops as Partial<VillageState['troops']>).chieftain;
    delete (raw.away as Partial<VillageState['away']>).chieftain;
    const n = normalizeVillage(raw);
    assert.deepEqual(n.trainQueues.bannerhall, []);
    assert.equal(n.troops.chieftain, 0);
    assert.equal(n.away.chieftain, 0);
    assert.equal(settleVillage(raw, HOUR, S1).troops.chieftain, 0);
  });
});

describe('Chieftain Renown price', () => {
  it('villageRenownPrice = base x 1.6^(villages + outstanding - 1), rounded', () => {
    assert.equal(villageRenownPrice(1, 0), RENOWN_VILLAGE_BASE);
    assert.equal(villageRenownPrice(1, 0), 1000, 'the 2nd village costs 1,000 since 2026-11-05');
    assert.equal(villageRenownPrice(1, 1), 1600);
    assert.equal(villageRenownPrice(2, 0), 1600);
    assert.equal(villageRenownPrice(1, 2), 2560);
    assert.equal(villageRenownPrice(3, 1), 4096);
    assert.equal(villageRenownPrice(3, 1), villageRenownCost(4));
  });

  it('each outstanding Chieftain raises the price strictly', () => {
    let last = 0;
    for (let out = 0; out < 6; out++) {
      const p = villageRenownPrice(2, out);
      assert.ok(p > last);
      last = p;
    }
  });

  it('ignores nonsense input', () => {
    assert.equal(villageRenownPrice(0, -3), RENOWN_VILLAGE_BASE);
    assert.equal(villageRenownPrice(NaN, NaN), RENOWN_VILLAGE_BASE);
  });

  it('a dead Chieftain gives back half of what he reserved (rounded down)', () => {
    assert.equal(chieftainRefund(500), 250);
    assert.equal(chieftainRefund(801), 400);
    assert.equal(chieftainRefund(-5), 0);
  });
});

describe('Chieftain in armies and missions', () => {
  it('makes the army slow: speed 5 beats raiders at 6', () => {
    assert.equal(armySpeed(units({ raider: 10, chieftain: 1 })), 5);
    const a = flatTravelTimeMs({ x: 0, y: 0 }, { x: 10, y: 0 }, units({ raider: 10 }), S1);
    const b = flatTravelTimeMs({ x: 0, y: 0 }, { x: 10, y: 0 }, units({ raider: 10, chieftain: 1 }), S1);
    assert.equal(b, 2 * HOUR);
    assert.ok(b > a);
  });

  it('may go on an attack alone (he will die) or with escort, never more than 3', () => {
    assert.ok(checkMission('attack', units({ chieftain: 1 })).ok);
    assert.ok(checkMission('attack', units({ raider: 20, chieftain: 3 })).ok);
    const many = checkMission('attack', units({ raider: 20, chieftain: 4 }));
    assert.ok(!many.ok && many.reason === 'invalid_input');
  });

  it('cannot scout, support or occupy', () => {
    for (const m of ['scout', 'support', 'occupy'] as const) {
      const c = checkMission(m, units({ chieftain: 1, ...(m === 'scout' ? { pathfinder: 1 } : { pikeman: 5 }) }));
      assert.ok(!c.ok && c.reason === 'invalid_input', m);
    }
  });

  it('found needs exactly one Chieftain, escort optional', () => {
    assert.ok(checkMission('found', units({ chieftain: 1 })).ok);
    assert.ok(checkMission('found', units({ chieftain: 1, pikeman: 30, raider: 5 })).ok);
    for (const army of [units({ pikeman: 5 }), units({ chieftain: 2 }), units({ chieftain: 2, pikeman: 5 })]) {
      const c = checkMission('found', army);
      assert.ok(!c.ok && c.reason === 'invalid_input');
    }
    const none = checkMission('found', units({}));
    assert.ok(!none.ok && none.reason === 'no_troops');
  });

  it('occupy takes any own troops except Chieftains', () => {
    assert.ok(checkMission('occupy', units({ pikeman: 100, pathfinder: 2 })).ok);
  });
});
