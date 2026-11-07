import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PROJECT_BASE_COST_PER_RESOURCE,
  PROJECT_BUILD_HOURS_PER_LEVEL,
  PROJECT_COST_GROWTH,
  ROADS_SPEED_BONUS,
  TRIBE_STORE_LOOT_SHARE,
  WARD_DEFENCE_BONUS,
  WATCHTOWER_ROUND_TO,
  applyRoads,
  emptyResources,
  projectBuildMs,
  projectCost,
  projectEffect,
  resolveBattle,
  roadsMultiplier,
  splitLoot,
  storeLootable,
  wardMultiplier,
  watchtowerInfo,
} from '../src/index.ts';
import { HOUR, S1, S10, defenderWith, units } from './helpers.ts';

const res = (wood: number, food = wood, iron = wood, gold = wood) => ({ wood, food, iron, gold });

describe('tribe projects: cost and time', () => {
  it('cost grows by level, the same for each resource; time is level x hours / speed', () => {
    assert.deepEqual(projectCost(1), res(PROJECT_BASE_COST_PER_RESOURCE));
    assert.equal(projectCost(2).wood, Math.round(PROJECT_BASE_COST_PER_RESOURCE * PROJECT_COST_GROWTH));
    assert.equal(projectCost(3).gold, Math.round(PROJECT_BASE_COST_PER_RESOURCE * PROJECT_COST_GROWTH ** 2));
    assert.equal(projectBuildMs(1, S1), PROJECT_BUILD_HOURS_PER_LEVEL * HOUR);
    assert.equal(projectBuildMs(3, S1), 3 * PROJECT_BUILD_HOURS_PER_LEVEL * HOUR);
    assert.equal(projectBuildMs(2, S10), (2 * PROJECT_BUILD_HOURS_PER_LEVEL * HOUR) / 10);
  });

  it('effects: roads and wards from the tables, the watchtower is its level, 0 at level 0', () => {
    assert.equal(projectEffect('roads', 0), 0);
    assert.equal(projectEffect('roads', 2), ROADS_SPEED_BONUS[1]);
    assert.equal(projectEffect('wards', 3), WARD_DEFENCE_BONUS[2]);
    assert.equal(projectEffect('watchtower', 2), 2);
  });
});

describe('roads and wards', () => {
  it('roads shorten a time by the level bonus, rounded up; level 0 changes nothing', () => {
    assert.equal(roadsMultiplier(0), 1);
    assert.equal(applyRoads(1001, 0), 1001);
    assert.equal(applyRoads(1001, 1), Math.ceil(1001 * (1 - ROADS_SPEED_BONUS[0])));
    assert.equal(applyRoads(1000, 3), Math.ceil(1000 * (1 - ROADS_SPEED_BONUS[2])));
    assert.equal(applyRoads(1, 3), 1, 'never zero');
  });

  it('wards add the level bonus to the defence factor; capped at the last level', () => {
    assert.equal(wardMultiplier(0), 1);
    assert.equal(wardMultiplier(2), 1 + WARD_DEFENCE_BONUS[1]);
    assert.equal(wardMultiplier(9), 1 + WARD_DEFENCE_BONUS[2]);
  });

  it('a defence multiplier raises defence power in a battle, and only then', () => {
    const base = { attackerUnits: units({ raider: 50 }), defender: defenderWith({ troops: { pikeman: 40 } }), seed: 7 };
    const plain = resolveBattle(base);
    const warded = resolveBattle({ ...base, defenceMultiplier: 1.08 });
    assert.ok(Math.abs(warded.defensePower / plain.defensePower - 1.08) < 1e-9);
    assert.equal(warded.attackPower, plain.attackPower);
  });
});

describe('watchtower info', () => {
  it('level 0 shows nothing; level 1 a band; level 2 the slowest unit; level 3 an about-number', () => {
    const army = units({ raider: 150, logram: 10 }); // 150 + 30 = 180 population
    assert.deepEqual(watchtowerInfo(army, 0), {});
    assert.deepEqual(watchtowerInfo(army, 1), { sizeBand: 'small' });
    assert.deepEqual(watchtowerInfo(army, 2), { sizeBand: 'small', slowestUnit: 'logram' });
    assert.deepEqual(watchtowerInfo(army, 3), { sizeBand: 'small', slowestUnit: 'logram', sizeAbout: 200 });
  });

  it('bands follow the population: medium, large, huge', () => {
    assert.equal(watchtowerInfo(units({ raider: 200 }), 1).sizeBand, 'medium');
    assert.equal(watchtowerInfo(units({ raider: 999 }), 1).sizeBand, 'medium');
    assert.equal(watchtowerInfo(units({ raider: 1000 }), 1).sizeBand, 'large');
    assert.equal(watchtowerInfo(units({ raider: 4000 }), 1).sizeBand, 'huge');
  });

  it('about-number is at least one step, rounded to WATCHTOWER_ROUND_TO', () => {
    assert.equal(watchtowerInfo(units({ raider: 3 }), 3).sizeAbout, WATCHTOWER_ROUND_TO);
    assert.equal(watchtowerInfo(units({ raider: 1234 }), 3).sizeAbout, 1200);
  });

  it('Chieftains are never counted or named', () => {
    assert.deepEqual(watchtowerInfo(units({ raider: 150, chieftain: 5 }), 3), watchtowerInfo(units({ raider: 150 }), 3));
    assert.deepEqual(watchtowerInfo(units({ chieftain: 3 }), 3), { sizeBand: 'small' });
  });
});

describe('store raid loot', () => {
  it('a fifth of each store resource, rounded down', () => {
    assert.deepEqual(storeLootable(res(1004, 5, 0, 4)), res(Math.floor(1004 * TRIBE_STORE_LOOT_SHARE), 1, 0, 0));
  });

  it('the split adds up exactly, follows what each side offered and never exceeds a pool', () => {
    const { fromVillage, fromStore } = splitLoot(res(150), res(200), res(200));
    assert.deepEqual(fromStore, res(75));
    assert.deepEqual(fromVillage, res(75));
    for (const [loot, v, s] of [
      [7, 3, 100],
      [101, 1, 100],
      [5, 0, 50],
      [5, 50, 0],
      [0, 10, 10],
      [999, 10, 10],
    ] as const) {
      const r = splitLoot(res(loot), res(v), res(s));
      assert.equal(r.fromVillage.wood + r.fromStore.wood, Math.min(loot, v + s), `${loot}/${v}/${s}`);
      assert.ok(r.fromVillage.wood >= 0 && r.fromStore.wood >= 0);
      assert.ok(r.fromVillage.wood <= v && r.fromStore.wood <= s);
    }
    assert.deepEqual(splitLoot(emptyResources(), res(5), res(5)).fromStore, emptyResources());
  });

  it('resolveBattle can loot beyond the village stock with extraLootable', () => {
    const defender = defenderWith({ resources: res(100), buildings: { vault: 0 } });
    const base = { attackerUnits: units({ raider: 400 }), defender, seed: 3 };
    const plain = resolveBattle(base);
    const more = resolveBattle({ ...base, extraLootable: res(50) });
    assert.ok(plain.attackerWon);
    assert.ok(more.loot.wood > plain.loot.wood);
    assert.equal(more.loot.wood, Math.floor(defender.resources.wood) + 50);
  });
});
