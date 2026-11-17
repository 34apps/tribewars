// Siege (docs/GAME_DESIGN.md 18.9): the Firecart burns the Wall during the battle and, after a won battle, the building the sender picked
// (the Wall if none). Max 2 levels per step. Pure and deterministic.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BATTLE_LOSS_EXPONENT,
  BUILDING_IDS,
  SIEGE_BASE_POINTS,
  SIEGE_DURING_SHARE,
  SIEGE_LOST_SHARE,
  SIEGE_MIN_LEVEL,
  SIEGE_POINTS_PER_LEVEL,
  UNITS,
  UNIT_IDS,
  applyBattleToDefender,
  applySiegeHits,
  checkMission,
  emptyUnits,
  hasSiegeUnits,
  resolveBattle,
  resolveSiege,
  resolveSiegeDuring,
  siegeFloor,
  siegeLostSurvivors,
  siegePointsNeeded,
} from '../src/index.ts';
import type { BuildingLevels } from '../src/index.ts';
import { deepFreeze, units, village } from './helpers.ts';

const CART = UNITS.firecart.siege!;

function levels(over: Partial<BuildingLevels> = {}): BuildingLevels {
  const out = {} as BuildingLevels;
  for (const b of BUILDING_IDS) out[b] = 0;
  return Object.assign(out, over);
}

/** Points needed to drop a building from `level` by `n` levels. */
function costOf(level: number, n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += siegePointsNeeded(level - i);
  return sum;
}

describe('the Firecart', () => {
  it('is the only siege unit; the Log Ram and Boulder Sling are gone', () => {
    assert.deepEqual(UNIT_IDS.filter((u) => UNITS[u].siege !== undefined), ['firecart']);
    assert.ok(!(UNIT_IDS as readonly string[]).includes('logram') && !(UNIT_IDS as readonly string[]).includes('boulder'));
  });

  it('has the decided stats and trains at the Wrightyard after Drillyard 3', () => {
    const f = UNITS.firecart;
    assert.deepEqual([f.attack, f.defenseInfantry, f.defenseCavalry, f.speed, f.carry], [5, 7, 5, 3, 0]);
    assert.equal(f.building, 'wrightyard');
    assert.deepEqual(f.requires, { wrightyard: 1 });
    assert.equal(f.research?.drillyard, 3);
    assert.equal(f.trainTimeSec, 1400);
    assert.equal(CART.maxLevels, 2);
  });
});

describe('siege helpers', () => {
  it('level cost is base + perLevel * L', () => {
    for (const l of [1, 2, 5, 10, 25]) assert.equal(siegePointsNeeded(l), SIEGE_BASE_POINTS + SIEGE_POINTS_PER_LEVEL * l);
  });

  it('the floor is 1 for the Hall, Farm, Longhouse and Storehouse and 0 for the rest', () => {
    for (const b of BUILDING_IDS) assert.equal(siegeFloor(b), SIEGE_MIN_LEVEL[b] ?? 0);
    for (const b of ['hall', 'farm', 'longhouse', 'storehouse'] as const) assert.equal(siegeFloor(b), 1, b);
    assert.equal(siegeFloor('wall'), 0);
    assert.equal(siegeFloor('wrightyard'), 0);
  });

  it('hasSiegeUnits', () => {
    assert.equal(hasSiegeUnits(units({ raider: 5 })), false);
    assert.equal(hasSiegeUnits({}), false);
    assert.equal(hasSiegeUnits(units({ firecart: 1, raider: 3 })), true);
  });

  it('a Firecart cannot scout, support or found: only attack', () => {
    assert.ok(checkMission('attack', units({ firecart: 1, raider: 5 })).ok);
    for (const m of ['support', 'scout', 'found', 'occupy'] as const) assert.ok(!checkMission(m, units({ firecart: 1 })).ok, m);
  });
});

describe('resolveSiege: after the battle', () => {
  it('burns the building the sender picked', () => {
    const b = levels({ wall: 10, barracks: 6 });
    const need = siegePointsNeeded(6);
    const hits = resolveSiege(units({ firecart: Math.ceil(need / CART.power) }), b, 'barracks');
    assert.deepEqual(hits, [{ unit: 'firecart', building: 'barracks', from: 6, to: 5 }]);
  });

  it('burns the Wall when nothing was picked (or the pick is not a building)', () => {
    const b = levels({ wall: 10, barracks: 6 });
    for (const pick of [null, undefined, 'moat' as never]) {
      const hits = resolveSiege(units({ firecart: 200 }), b, pick);
      assert.equal(hits.length, 1);
      assert.equal(hits[0]!.building, 'wall');
      assert.equal(hits[0]!.from, 10);
      assert.ok(hits[0]!.to < 10);
    }
  });

  it('stops at 2 levels however many carts survive', () => {
    const hits = resolveSiege(units({ firecart: 100_000 }), levels({ market: 12 }), 'market');
    assert.deepEqual(hits, [{ unit: 'firecart', building: 'market', from: 12, to: 12 - CART.maxLevels }]);
  });

  it('exact threshold: one point short drops nothing, exactly enough drops one level', () => {
    // a level whose cost the cart power divides exactly, so "exactly enough" is a whole number of carts
    const lvl = [3, 4, 5, 6, 7, 8].find((l) => siegePointsNeeded(l) % CART.power === 0)!;
    const exact = siegePointsNeeded(lvl) / CART.power;
    assert.ok(Number.isInteger(exact));
    assert.equal(resolveSiege(units({ firecart: exact - 1 }), levels({ wall: lvl }), null)[0]!.to, lvl);
    assert.equal(resolveSiege(units({ firecart: exact }), levels({ wall: lvl }), null)[0]!.to, lvl - 1);
  });

  it('never below the floor: the Longhouse and the Farm stay at 1', () => {
    for (const b of ['longhouse', 'farm', 'hall', 'storehouse'] as const) {
      const hits = resolveSiege(units({ firecart: 5000 }), levels({ [b]: 2 }), b);
      assert.deepEqual(hits, [{ unit: 'firecart', building: b, from: 2, to: 1 }], b);
    }
  });

  it('a pick that is not there is a miss, not an error', () => {
    const hits = resolveSiege(units({ firecart: 100 }), levels({ wall: 5 }), 'market');
    assert.deepEqual(hits, [{ unit: 'firecart', building: 'market', from: 0, to: 0 }]);
  });

  it('no Firecarts, no hits', () => {
    assert.deepEqual(resolveSiege(units({ raider: 100 }), levels({ wall: 5 }), 'wall'), []);
  });
});

describe('the two steps: during the battle and after it', () => {
  it('during: sent Firecarts fire SIEGE_DURING_SHARE of their points at the Wall, max 2 levels', () => {
    const wall = 10;
    const full = Math.ceil(costOf(wall, 2) / CART.power);
    const half = resolveSiegeDuring(units({ firecart: full }), wall);
    assert.ok(half.wall > wall - 2, 'half the points do not drop two levels');
    const twice = resolveSiegeDuring(units({ firecart: Math.ceil(full / SIEGE_DURING_SHARE) }), wall);
    assert.equal(twice.wall, wall - 2);
    assert.equal(twice.dropped.firecart, 2);
    assert.equal(twice.from.firecart, wall);
    assert.equal(resolveSiegeDuring(units({ firecart: 1e6 }), wall).wall, wall - CART.maxLevels);
    assert.deepEqual(resolveSiegeDuring(units({ raider: 100 }), wall), { wall, dropped: {}, from: {} });
    assert.equal(resolveSiegeDuring(units({ firecart: 1e6 }), 0).wall, 0);
  });

  it('each step has its own 2 levels: the Wall can lose 4 in one won attack when it is the target', () => {
    const sent = units({ firecart: 100_000 });
    const hits = resolveSiege(sent, levels({ wall: 12 }), 'wall', sent);
    assert.deepEqual(hits, [{ unit: 'firecart', building: 'wall', from: 12, to: 12 - 2 * CART.maxLevels }]);
  });

  it('with another pick the Wall hit (during) and the pick (after) are two hits', () => {
    const sent = units({ firecart: 100_000 });
    const hits = resolveSiege(sent, levels({ wall: 12, barracks: 9 }), 'barracks', sent);
    assert.deepEqual(hits, [
      { unit: 'firecart', building: 'wall', from: 12, to: 12 - CART.maxLevels },
      { unit: 'firecart', building: 'barracks', from: 9, to: 9 - CART.maxLevels },
    ]);
  });

  it('default target: the Wall takes both steps', () => {
    const sent = units({ firecart: 100_000 });
    const hits = resolveSiege(sent, levels({ wall: 12, barracks: 9 }), undefined, sent);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.building, 'wall');
    assert.equal(hits[0]!.to, 12 - 2 * CART.maxLevels);
  });

  it('no survivors still shows the during hit', () => {
    const sent = units({ firecart: 300 });
    const dur = resolveSiegeDuring(sent, 12);
    assert.ok(dur.dropped.firecart! >= 1);
    assert.deepEqual(resolveSiege(emptyUnits(), levels({ wall: 12 }), 'barracks', sent), [{ unit: 'firecart', building: 'wall', from: 12, to: dur.wall }]);
  });

  it('siegeLostSurvivors: floor(count * ratio * SIEGE_LOST_SHARE) of the Firecarts only', () => {
    const s = siegeLostSurvivors(units({ firecart: 101, raider: 500 }), 0.5);
    assert.equal(s.firecart, Math.floor(101 * 0.5 * SIEGE_LOST_SHARE));
    assert.equal(s.raider, 0);
    assert.equal(siegeLostSurvivors(units({ firecart: 10 }), 0).firecart, 0);
    assert.equal(siegeLostSurvivors(units({ firecart: 10 }), 7).firecart, Math.floor(10 * SIEGE_LOST_SHARE)); // ratio is clamped to 1
  });
});

describe('applySiegeHits', () => {
  it('lowers levels and aims queued upgrades of that building lower by the same amount', () => {
    const v = village({ buildings: { wall: 8, barracks: 6 } });
    v.buildQueue.push(
      { building: 'wall', targetLevel: 9, startAt: 0, finishAt: 1000 },
      { building: 'wall', targetLevel: 10, startAt: 1000, finishAt: 2000 },
      { building: 'barracks', targetLevel: 7, startAt: 2000, finishAt: 3000 },
    );
    applySiegeHits(v, [{ unit: 'firecart', building: 'wall', from: 8, to: 6 }]);
    assert.equal(v.buildings.wall, 6);
    assert.equal(v.buildQueue[0]!.targetLevel, 7);
    assert.equal(v.buildQueue[1]!.targetLevel, 8);
    assert.equal(v.buildQueue[2]!.targetLevel, 7);
    assert.equal(v.buildings.barracks, 6);
  });

  it('never below the floor; misses and an empty list change nothing', () => {
    const v = village({ buildings: { longhouse: 3, market: 2, wall: 4 } });
    applySiegeHits(v, [
      { unit: 'firecart', building: 'longhouse', from: 3, to: 0 },
      { unit: 'firecart', building: 'market', from: 2, to: 0 },
    ]);
    assert.equal(v.buildings.longhouse, 1);
    assert.equal(v.buildings.market, 0);
    const before = JSON.stringify(v);
    applySiegeHits(v, []);
    applySiegeHits(v, [{ unit: 'firecart', building: 'wall', from: 4, to: 4 }]);
    assert.equal(JSON.stringify(v), before);
  });
});

describe('resolveBattle with Firecarts', () => {
  const target = (over: Partial<BuildingLevels> = {}) => village({ buildings: { wall: 10, hall: 3, market: 4, ...over }, troops: emptyUnits() });

  it('a won attack burns the Wall in the battle (it counts) and the picked building after, without mutating its input', () => {
    const d = target();
    const frozen = deepFreeze(structuredClone(d));
    const won = resolveBattle({ attackerUnits: units({ raider: 400, firecart: 300 }), defender: frozen, seed: 5, siegeTarget: 'market' });
    assert.equal(won.attackerWon, true);
    assert.ok(won.wallDuring < 10, 'the Wall was lowered before the defence was counted');
    const wall = won.siege!.find((h) => h.building === 'wall')!;
    const market = won.siege!.find((h) => h.building === 'market')!;
    assert.equal(wall.from, 10);
    assert.equal(wall.to, won.wallDuring);
    assert.equal(market.to, 4 - CART.maxLevels);
    const after = applyBattleToDefender(frozen, won);
    assert.equal(after.buildings.wall, won.wallDuring);
    assert.equal(after.buildings.market, 2);
  });

  it('no pick: after the battle the Wall burns again (one hit from before to after both steps)', () => {
    const won = resolveBattle({ attackerUnits: units({ raider: 400, firecart: 300 }), defender: target(), seed: 5 });
    assert.equal(won.attackerWon, true);
    assert.equal(won.siege!.length, 1);
    assert.equal(won.siege![0]!.building, 'wall');
    assert.equal(won.siege![0]!.to, 10 - 2 * CART.maxLevels);
    assert.ok(won.wallDuring > won.siege![0]!.to, 'the defence only met the during-the-battle drop');
  });

  it('a hopeless lost attack does nothing to buildings (3 carts: no points, no survivors counted)', () => {
    const d = target();
    const lost = resolveBattle({ attackerUnits: units({ firecart: 3 }), defender: d, seed: 5, siegeTarget: 'market' });
    assert.equal(lost.attackerWon, false);
    assert.deepEqual(applyBattleToDefender(d, lost).buildings, d.buildings);
  });

  it('a close lost attack still counts a share of its Firecarts', () => {
    const d = village({ buildings: { wall: 10 }, troops: units({ pikeman: 400 }) });
    const lost = resolveBattle({ attackerUnits: units({ raider: 150, firecart: 400 }), defender: d, seed: 3, siegeTarget: 'wall', fixedLuck: 0 });
    assert.equal(lost.attackerWon, false);
    const ratio = Math.min(1, lost.attackPower / lost.defensePower);
    assert.ok(Math.pow(ratio, BATTLE_LOSS_EXPONENT) > 0);
    assert.ok(lost.siege!.some((h) => h.building === 'wall' && h.to < h.from));
  });

  it('same inputs, same result', () => {
    const input = { attackerUnits: units({ raider: 400, firecart: 120 }), defender: target(), seed: 9, siegeTarget: 'market' as const };
    assert.deepEqual(resolveBattle(input), resolveBattle(input));
  });
});
