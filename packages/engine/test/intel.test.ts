import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SCOUT_APPROX_STEP, approxCount, buildScoutIntel, emptyResources, emptyUnits, keenMultiplier, resolveScouting, scoutStrength } from '../src/index.ts';
import type { BuildingLevels, VillageRanks } from '../src/index.ts';

const buildings = { wall: 4, drillyard: 2 } as unknown as BuildingLevels;
const troops = { ...emptyUnits(), pikeman: 33, guard: 4, raider: 0 };
const ranks: VillageRanks = { pikeman: { might: 0, bulwark: 2, keen: 0 } };
const intel = (keen: number) => buildScoutIntel({ keen, resources: emptyResources(), buildings, troops, ranks });

describe('scout intel tiers', () => {
  it('Keen 0 shows resources only', () => {
    const i = intel(0);
    assert.deepEqual([i.troops, i.wallLevel, i.buildings, i.ranks, i.drillyardLevel], [null, null, null, null, null]);
  });
  it('Keen 1 shows rough troop numbers', () => {
    const i = intel(1);
    assert.equal(i.troopsApprox, true);
    assert.deepEqual([i.troops?.pikeman, i.troops?.guard, i.troops?.raider], [30, SCOUT_APPROX_STEP, 0]);
    assert.equal(i.wallLevel, null);
  });
  it('Keen 2-5 add exact troops, wall, buildings, then ranks and Drillyard level', () => {
    assert.deepEqual([intel(2).troops?.pikeman, intel(2).troopsApprox, intel(2).wallLevel], [33, false, null]);
    assert.equal(intel(3).wallLevel, 4);
    assert.equal(intel(3).buildings, null);
    assert.equal(intel(4).buildings?.drillyard, 2);
    assert.equal(intel(4).ranks, null);
    assert.deepEqual([intel(5).ranks, intel(5).drillyardLevel], [ranks, 2]);
  });
  it('clamps odd Keen values', () => {
    assert.equal(intel(99).keen, 5);
    assert.equal(intel(-3).keen, 0);
    assert.equal(intel(Number.NaN).keen, 0);
  });
  it('approxCount never shows 0 for a non-empty group', () => {
    assert.deepEqual([approxCount(0), approxCount(1), approxCount(14), approxCount(15)], [0, SCOUT_APPROX_STEP, SCOUT_APPROX_STEP, 20]);
  });
});

describe('Keen in the scout duel', () => {
  const keen = (n: number): VillageRanks => ({ pathfinder: { might: 0, bulwark: 0, keen: n } });
  it('default inputs behave as before', () => {
    assert.deepEqual(resolveScouting({ scouts: 5, defenderScouts: 5 }), resolveScouting({ scouts: 5, defenderScouts: 5, scoutMultiplier: 1, defenderStrength: 5 }));
  });
  it('Keen turns an equal duel; the defender Keen turns it back', () => {
    assert.equal(resolveScouting({ scouts: 5, defenderScouts: 5 }).success, false);
    assert.equal(resolveScouting({ scouts: 5, defenderScouts: 5, scoutMultiplier: keenMultiplier(keen(1)) }).success, true);
    const defense = scoutStrength([{ count: 5, ranks: keen(2) }]);
    assert.equal(resolveScouting({ scouts: 5, defenderScouts: 5, scoutMultiplier: keenMultiplier(keen(1)), defenderStrength: defense }).success, false);
  });
  it('scout losses never exceed the scouts sent', () => {
    const r = resolveScouting({ scouts: 3, defenderScouts: 1, scoutMultiplier: 3, defenderStrength: 2.9 });
    assert.ok(r.scoutLosses <= 3);
  });
});
