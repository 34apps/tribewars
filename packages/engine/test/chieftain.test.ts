import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHIEFTAIN_MAX_BATCH,
  RENOWN_VILLAGE_BASE,
  WAR_CHEST_BASE,
  TRAIN_TIME_FACTOR,
  TRAINING_BUILDING_IDS,
  UNITS,
  UNIT_IDS,
  applyTrain,
  armySpeed,
  checkMission,
  checkTrain,
  CHIEFTAIN_DEPOSIT_SHARE,
  chestVillageCost,
  chieftainDepositChest,
  chieftainDepositRenown,
  strikeRemainder,
  chieftainRefund,
  flatTravelTimeMs,
  normalizeVillage,
  populationUsage,
  settleVillage,
  trainTimeMs,
  villageRenownCost,
} from '../src/index.ts';
import type { VillageState } from '../src/index.ts';
import { HOUR, S1, S10, units, village } from './helpers.ts';

const rich = (bannerhall = 1): VillageState =>
  village({ buildings: { bannerhall, farm: 10 }, resources: { wood: 40000, food: 40000, iron: 40000, gold: 1000 } });

describe('Chieftain unit', () => {
  it('has the design numbers', () => {
    const c = UNITS.chieftain;
    assert.deepEqual([c.attack, c.defenseInfantry, c.defenseCavalry, c.speed, c.carry], [0, 10, 10, 2.5, 0]);
    assert.deepEqual(c.cost, { wood: 6000, food: 4500, iron: 7500, gold: 0 });
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

describe('Chieftain Renown price (pay for the village, not for each Chieftain, 2026-11-18)', () => {
  it('villageRenownCost = base x 1.6^(villages - 1), rounded', () => {
    assert.equal(villageRenownCost(1), RENOWN_VILLAGE_BASE);
    assert.equal(villageRenownCost(1), 1300, 'the 2nd village costs 1,300 since 2026-11-11 (was 1,000)');
    assert.equal(villageRenownCost(2), 2080);
    assert.equal(villageRenownCost(3), 3328);
    assert.equal(villageRenownCost(0), RENOWN_VILLAGE_BASE);
    assert.equal(villageRenownCost(NaN), RENOWN_VILLAGE_BASE);
  });

  it('chestVillageCost = 2,000 x 1.6^(villages - 1), rounded', () => {
    assert.equal(WAR_CHEST_BASE, 2000);
    assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => chestVillageCost(n)), [2000, 3200, 5120, 8192, 13107, 20972]);
    assert.equal(chestVillageCost(0), WAR_CHEST_BASE);
    assert.equal(chestVillageCost(NaN), WAR_CHEST_BASE);
  });

  it('a Chieftain reserves only a deposit: CHIEFTAIN_DEPOSIT_SHARE of the village price, Renown and chest gold', () => {
    assert.equal(CHIEFTAIN_DEPOSIT_SHARE, 0.25);
    assert.equal(chieftainDepositRenown(1), 325);
    assert.equal(chieftainDepositChest(1), 500);
    assert.equal(chieftainDepositRenown(2), Math.round(villageRenownCost(2) * 0.25));
    assert.equal(chieftainDepositChest(3), Math.round(chestVillageCost(3) * 0.25));
    assert.equal(chieftainDepositRenown(NaN), 325);
  });

  it('the deposit is the same for every Chieftain: it depends on villages owned only, never on Chieftains held', () => {
    // the old villageRenownPrice(villages, outstanding) grew x1.6 per Chieftain held; there is no such argument any more
    assert.equal(chieftainDepositRenown.length, 2);
    assert.ok(chieftainDepositRenown(3) > chieftainDepositRenown(2), 'only owning more villages raises it');
  });

  it('strikeRemainder = village price - one deposit, once per village however many Chieftains it needs', () => {
    assert.deepEqual(strikeRemainder(1), { renown: 1300 - 325, gold: 2000 - 500 });
    assert.deepEqual(strikeRemainder(2), { renown: 2080 - 520, gold: 3200 - 800 });
    // deposit + remainder = the village price, exactly
    for (const owned of [1, 2, 3, 4]) {
      const r = strikeRemainder(owned);
      assert.equal(chieftainDepositRenown(owned) + r.renown, villageRenownCost(owned));
      assert.equal(chieftainDepositChest(owned) + r.gold, chestVillageCost(owned));
    }
  });

  it('strikeRemainder uses the deposits the Chieftains really hold, never below 0', () => {
    assert.deepEqual(strikeRemainder(1, undefined, { renown: 400, gold: 600 }), { renown: 900, gold: 1400 });
    assert.deepEqual(strikeRemainder(1, undefined, { renown: 5000, gold: 9000 }), { renown: 0, gold: 0 });
  });

  it('a dead Chieftain gives back half of what he reserved (rounded down)', () => {
    assert.equal(chieftainRefund(500), 250);
    assert.equal(chieftainRefund(801), 400);
    assert.equal(chieftainRefund(-5), 0);
  });
});

describe('Chieftain in armies and missions', () => {
  it('makes the army slow: speed 2.5, the slowest unit in the game, beats raiders at 6', () => {
    assert.equal(armySpeed(units({ raider: 10, chieftain: 1 })), 2.5);
    const a = flatTravelTimeMs({ x: 0, y: 0 }, { x: 10, y: 0 }, units({ raider: 10 }), S1);
    const b = flatTravelTimeMs({ x: 0, y: 0 }, { x: 10, y: 0 }, units({ raider: 10, chieftain: 1 }), S1);
    assert.equal(b, 4 * HOUR);
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
