// Siege (docs/GAME_DESIGN.md 18.9): the Log Ram hits only the Wall (during the battle and again after a win, max 3 levels per step); the
// Firecart burns buildings after the battle: the one the sender picked (the Wall too, after the rams, no during step), else a random one but the Wall (max 2 levels). Pure and deterministic.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BATTLE_LOSS_EXPONENT,
  BUILDING_IDS,
  SIEGE_BASE_POINTS,
  SIEGE_DURING_SHARE,
  SIEGE_EXTRA_POINTS,
  SIEGE_LOST_SHARE,
  SIEGE_MIN_LEVEL,
  SIEGE_POINTS_PER_LEVEL,
  UNITS,
  UNIT_IDS,
  applyBattleToDefender,
  applySiegeHits,
  checkMission,
  emptyUnits,
  hasBuildingSiegeUnits,
  hasSiegeUnits,
  resolveBattle,
  randomSiegeCandidates,
  resolveSiege,
  resolveSiegeDuring,
  siegeFloor,
  siegeLostSurvivors,
  siegePointsNeeded,
} from '../src/index.ts';
import type { BuildingLevels } from '../src/index.ts';
import { deepFreeze, units, village } from './helpers.ts';

const CART = UNITS.firecart.siege!;
const RAM = UNITS.logram.siege!;

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

describe('the two siege units', () => {
  it('Log Ram and Firecart are the siege units; the Boulder Sling is gone', () => {
    assert.deepEqual(UNIT_IDS.filter((u) => UNITS[u].siege !== undefined), ['logram', 'firecart']);
    assert.ok(!(UNIT_IDS as readonly string[]).includes('boulder'));
  });

  it('the Log Ram: Wall only, trains at the Wrightyard 1 after Drillyard 2, cheaper than the Firecart and about 3x its old Wall power', () => {
    const r = UNITS.logram;
    assert.deepEqual([r.attack, r.defenseInfantry, r.defenseCavalry, r.speed, r.carry], [3, 5, 4, 3, 0]);
    assert.equal(r.building, 'wrightyard');
    assert.deepEqual(r.requires, { wrightyard: 1 });
    assert.equal(r.research?.drillyard, 2);
    assert.equal(r.cost.gold, 0);
    assert.equal(RAM.hits, 'wall');
    assert.equal(RAM.maxLevels, 3);
    assert.ok(RAM.power >= 3 * 2, 'at least 3x the Firecart\'s power of 2 before this change');
    const value = (c: { wood: number; food: number; iron: number; gold: number }) => c.wood + c.food + c.iron + 10 * c.gold;
    assert.ok(value(r.cost) < value(UNITS.firecart.cost));
  });

  it('the Firecart: buildings only, needs Wrightyard 4 and Drillyard 3', () => {
    const f = UNITS.firecart;
    assert.deepEqual([f.attack, f.defenseInfantry, f.defenseCavalry, f.speed, f.carry], [5, 100, 80, 3, 0]);
    assert.equal(f.building, 'wrightyard');
    assert.deepEqual(f.requires, { wrightyard: 4 });
    assert.equal(f.research?.drillyard, 3);
    assert.equal(f.trainTimeSec, 1400);
    assert.equal(CART.maxLevels, 2);
    assert.equal(CART.hits, 'buildings');
  });
});

describe('siege helpers', () => {
  it('level cost is base + perLevel * L', () => {
    for (const l of [1, 2, 5, 10, 25]) assert.equal(siegePointsNeeded(l), SIEGE_BASE_POINTS + SIEGE_POINTS_PER_LEVEL * l);
  });

  it('some buildings are sturdier: the Banner Hall costs extra points per level, every other building none', () => {
    assert.deepEqual(Object.keys(SIEGE_EXTRA_POINTS), ['bannerhall']);
    const extra = SIEGE_EXTRA_POINTS.bannerhall!;
    assert.ok(extra > 0);
    for (const l of [1, 4]) assert.equal(siegePointsNeeded(l, 'bannerhall'), siegePointsNeeded(l) + extra);
    assert.equal(siegePointsNeeded(4, 'market'), siegePointsNeeded(4));
    // one point short drops nothing, exactly enough drops one level
    const need = siegePointsNeeded(3, 'bannerhall');
    const carts = Math.ceil(need / CART.power);
    assert.equal(resolveSiege(units({ firecart: carts - 1 }), levels({ bannerhall: 3 }), 'bannerhall')[0]!.to, 3);
    assert.equal(resolveSiege(units({ firecart: carts }), levels({ bannerhall: 3 }), 'bannerhall')[0]!.to, 2);
  });

  it('the floor is 1 for the Hall, Farm, Longhouse and Storehouse and 0 for the rest', () => {
    for (const b of BUILDING_IDS) assert.equal(siegeFloor(b), SIEGE_MIN_LEVEL[b] ?? 0);
    for (const b of ['hall', 'farm', 'longhouse', 'storehouse'] as const) assert.equal(siegeFloor(b), 1, b);
    assert.equal(siegeFloor('wall'), 0);
    assert.equal(siegeFloor('wrightyard'), 0);
  });

  it('hasSiegeUnits and hasBuildingSiegeUnits', () => {
    assert.equal(hasSiegeUnits(units({ raider: 5 })), false);
    assert.equal(hasSiegeUnits({}), false);
    assert.equal(hasSiegeUnits(units({ firecart: 1, raider: 3 })), true);
    assert.equal(hasSiegeUnits(units({ logram: 1 })), true);
    assert.equal(hasBuildingSiegeUnits(units({ logram: 5, raider: 3 })), false);
    assert.equal(hasBuildingSiegeUnits(units({ logram: 5, firecart: 1 })), true);
  });

  it('siege units cannot scout, support or found: only attack', () => {
    for (const unit of ['firecart', 'logram'] as const) {
      assert.ok(checkMission('attack', units({ [unit]: 1, raider: 5 })).ok);
      for (const m of ['support', 'scout', 'found', 'occupy'] as const) assert.ok(!checkMission(m, units({ [unit]: 1 })).ok, `${unit} ${m}`);
    }
  });

  it('random candidates: every building but the Wall above its floor', () => {
    const c = randomSiegeCandidates(levels({ wall: 9, hall: 1, farm: 1, market: 3, barracks: 2 }));
    assert.deepEqual([...c].sort(), ['barracks', 'market']);
  });
});

describe('Log Rams: only the Wall', () => {
  it('after the battle the survivors lower the Wall, whatever the sender picked', () => {
    const b = levels({ wall: 10, barracks: 6 });
    for (const pick of [null, undefined, 'barracks' as const, 'wall' as const]) {
      const hits = resolveSiege(units({ logram: 200 }), b, pick);
      assert.equal(hits.length, 1);
      assert.equal(hits[0]!.unit, 'logram');
      assert.equal(hits[0]!.building, 'wall');
      assert.equal(hits[0]!.from, 10);
      assert.ok(hits[0]!.to < 10);
    }
  });

  it('stops at its max levels however many rams survive', () => {
    const hits = resolveSiege(units({ logram: 100_000 }), levels({ wall: 12 }), null);
    assert.deepEqual(hits, [{ unit: 'logram', building: 'wall', from: 12, to: 12 - RAM.maxLevels }]);
  });

  it('exact threshold: one point short drops nothing, exactly enough drops one level', () => {
    const lvl = [3, 4, 5, 6, 7, 8].find((l) => siegePointsNeeded(l) % RAM.power === 0)!;
    const exact = siegePointsNeeded(lvl) / RAM.power;
    assert.ok(Number.isInteger(exact));
    assert.equal(resolveSiege(units({ logram: exact - 1 }), levels({ wall: lvl }), null)[0]!.to, lvl);
    assert.equal(resolveSiege(units({ logram: exact }), levels({ wall: lvl }), null)[0]!.to, lvl - 1);
  });

  it('during: sent rams fire SIEGE_DURING_SHARE of their points at the Wall, max levels', () => {
    const wall = 10;
    const full = Math.ceil(costOf(wall, RAM.maxLevels) / RAM.power);
    const half = resolveSiegeDuring(units({ logram: full }), wall);
    assert.ok(half.wall > wall - RAM.maxLevels, 'half the points do not drop all levels');
    const twice = resolveSiegeDuring(units({ logram: Math.ceil(full / SIEGE_DURING_SHARE) }), wall);
    assert.equal(twice.wall, wall - RAM.maxLevels);
    assert.equal(twice.dropped.logram, RAM.maxLevels);
    assert.equal(twice.from.logram, wall);
    assert.equal(resolveSiegeDuring(units({ logram: 1e6 }), wall).wall, wall - RAM.maxLevels);
    assert.deepEqual(resolveSiegeDuring(units({ raider: 100 }), wall), { wall, dropped: {}, from: {} });
    assert.equal(resolveSiegeDuring(units({ logram: 1e6 }), 0).wall, 0);
  });

  it('Firecarts never fire during the battle', () => {
    assert.deepEqual(resolveSiegeDuring(units({ firecart: 1e6 }), 12), { wall: 12, dropped: {}, from: {} });
  });

  it('each step has its own levels: one Wall hit from before to after both steps', () => {
    const sent = units({ logram: 100_000 });
    const hits = resolveSiege(sent, levels({ wall: 14 }), null, sent);
    assert.deepEqual(hits, [{ unit: 'logram', building: 'wall', from: 14, to: 14 - 2 * RAM.maxLevels }]);
  });

  it('no survivors still shows the during hit', () => {
    const sent = units({ logram: 300 });
    const dur = resolveSiegeDuring(sent, 12);
    assert.ok(dur.dropped.logram! >= 1);
    assert.deepEqual(resolveSiege(emptyUnits(), levels({ wall: 12 }), 'barracks', sent), [{ unit: 'logram', building: 'wall', from: 12, to: dur.wall }]);
  });
});

describe('Firecarts: buildings only', () => {
  it('burn the building the sender picked', () => {
    const b = levels({ wall: 10, barracks: 6 });
    const need = siegePointsNeeded(6);
    const hits = resolveSiege(units({ firecart: Math.ceil(need / CART.power) }), b, 'barracks');
    assert.deepEqual(hits, [{ unit: 'firecart', building: 'barracks', from: 6, to: 5 }]);
  });

  it('"any building" (no pick or a non-building) never lands on the Wall', () => {
    const b = levels({ wall: 10, barracks: 6, market: 5 });
    for (const pick of [null, undefined, 'moat' as never]) {
      for (const draw of [0, 0.4, 0.99]) {
        const hits = resolveSiege(units({ firecart: 200 }), b, pick, undefined, draw);
        assert.equal(hits.length, 1);
        assert.notEqual(hits[0]!.building, 'wall');
        assert.ok(['barracks', 'market'].includes(hits[0]!.building));
        assert.ok(hits[0]!.to < hits[0]!.from);
      }
    }
    // the draw picks among the candidates in building order
    assert.equal(resolveSiege(units({ firecart: 200 }), b, null, undefined, 0)[0]!.building, 'barracks');
    assert.equal(resolveSiege(units({ firecart: 200 }), b, null, undefined, 0.99)[0]!.building, 'market');
  });

  it('a Wall pick lowers the Wall with their own power and cap, and is not part of the during-the-battle step', () => {
    const b = levels({ wall: 12, barracks: 6 });
    const hits = resolveSiege(units({ firecart: 100_000 }), b, 'wall', units({ firecart: 100_000 }));
    assert.deepEqual(hits, [{ unit: 'firecart', building: 'wall', from: 12, to: 12 - CART.maxLevels }]);
    assert.deepEqual(resolveSiegeDuring(units({ firecart: 100_000 }), 12), { wall: 12, dropped: {}, from: {} });
    // exact points: one level of the Wall needs siegePointsNeeded(12)
    const need = siegePointsNeeded(12);
    assert.deepEqual(resolveSiege(units({ firecart: Math.ceil(need / CART.power) }), b, 'wall'), [{ unit: 'firecart', building: 'wall', from: 12, to: 11 }]);
    assert.deepEqual(resolveSiege(units({ firecart: Math.ceil(need / CART.power) - 1 }), b, 'wall'), [{ unit: 'firecart', building: 'wall', from: 12, to: 12 }]);
  });

  it('Log Rams and Firecarts on the Wall: the rams first (during and after), then the carts from the level the rams left, each with its own cap', () => {
    const sent = units({ logram: 100_000, firecart: 100_000 });
    const hits = resolveSiege(sent, levels({ wall: 14 }), 'wall', sent);
    assert.deepEqual(hits, [
      { unit: 'logram', building: 'wall', from: 14, to: 14 - 2 * RAM.maxLevels },
      { unit: 'firecart', building: 'wall', from: 14 - 2 * RAM.maxLevels, to: 14 - 2 * RAM.maxLevels - CART.maxLevels },
    ]);
    // the floor of the Wall is 0
    const low = resolveSiege(sent, levels({ wall: 7 }), 'wall', sent);
    assert.equal(low.at(-1)!.to, 0);
  });

  it('no building above its floor besides the Wall: no hit', () => {
    assert.deepEqual(resolveSiege(units({ firecart: 200 }), levels({ wall: 10, hall: 1 }), null), []);
  });

  it('with a Wall-only army and Log Rams along, Firecarts and Log Rams each do their own thing', () => {
    const sent = units({ logram: 100_000, firecart: 100_000 });
    const hits = resolveSiege(sent, levels({ wall: 14, barracks: 9 }), 'barracks', sent);
    assert.deepEqual(hits, [
      { unit: 'logram', building: 'wall', from: 14, to: 14 - 2 * RAM.maxLevels },
      { unit: 'firecart', building: 'barracks', from: 9, to: 9 - CART.maxLevels },
    ]);
  });

  it('stop at their max levels', () => {
    const hits = resolveSiege(units({ firecart: 100_000 }), levels({ market: 12 }), 'market');
    assert.deepEqual(hits, [{ unit: 'firecart', building: 'market', from: 12, to: 12 - CART.maxLevels }]);
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

  it('no siege units, no hits', () => {
    assert.deepEqual(resolveSiege(units({ raider: 100 }), levels({ wall: 5 }), 'market'), []);
  });

  it('siegeLostSurvivors: floor(count * ratio * SIEGE_LOST_SHARE) of each siege kind only', () => {
    const s = siegeLostSurvivors(units({ firecart: 101, logram: 40, raider: 500 }), 0.5);
    assert.equal(s.firecart, Math.floor(101 * 0.5 * SIEGE_LOST_SHARE));
    assert.equal(s.logram, Math.floor(40 * 0.5 * SIEGE_LOST_SHARE));
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
    applySiegeHits(v, [{ unit: 'logram', building: 'wall', from: 8, to: 6 }]);
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
    applySiegeHits(v, [{ unit: 'logram', building: 'wall', from: 4, to: 4 }]);
    assert.equal(JSON.stringify(v), before);
  });
});

describe('resolveBattle with siege units', () => {
  const target = (over: Partial<BuildingLevels> = {}) => village({ buildings: { wall: 10, hall: 3, market: 4, ...over }, troops: emptyUnits() });

  it('Log Rams batter the Wall in the battle (it counts) and again after; Firecarts burn the picked building; the input is not mutated', () => {
    const d = target();
    const frozen = deepFreeze(structuredClone(d));
    const won = resolveBattle({ attackerUnits: units({ raider: 400, logram: 300, firecart: 300 }), defender: frozen, seed: 5, siegeTarget: 'market' });
    assert.equal(won.attackerWon, true);
    assert.ok(won.wallDuring < 10, 'the Wall was lowered before the defence was counted');
    const wall = won.siege!.find((h) => h.building === 'wall')!;
    const market = won.siege!.find((h) => h.building === 'market')!;
    assert.equal(wall.unit, 'logram');
    assert.equal(wall.from, 10);
    assert.equal(wall.to, 10 - 2 * RAM.maxLevels < 0 ? 0 : 10 - 2 * RAM.maxLevels);
    assert.ok(wall.to < won.wallDuring, 'the defence only met the during-the-battle drop');
    assert.equal(market.unit, 'firecart');
    assert.equal(market.to, 4 - CART.maxLevels);
    const after = applyBattleToDefender(frozen, won);
    assert.equal(after.buildings.wall, wall.to);
    assert.equal(after.buildings.market, 2);
  });

  it('Firecarts picking the Wall after a win: the Wall counted in full in the battle, then drops after it', () => {
    const d = target();
    const won = resolveBattle({ attackerUnits: units({ raider: 400, firecart: 300 }), defender: d, seed: 5, siegeTarget: 'wall' });
    assert.equal(won.attackerWon, true);
    assert.equal(won.wallDuring, 10, 'no during-the-battle step for Firecarts');
    assert.deepEqual(won.siege, [{ unit: 'firecart', building: 'wall', from: 10, to: 10 - CART.maxLevels }]);
    assert.equal(applyBattleToDefender(d, won).buildings.wall, 10 - CART.maxLevels);
  });

  it('Firecarts alone: the Wall counts in full, and a random building burns when nothing was picked', () => {
    const won = resolveBattle({ attackerUnits: units({ raider: 400, firecart: 300 }), defender: target({ barracks: 5 }), seed: 5 });
    assert.equal(won.attackerWon, true);
    assert.equal(won.wallDuring, 10);
    assert.equal(won.siege!.length, 1);
    assert.equal(won.siege![0]!.unit, 'firecart');
    assert.notEqual(won.siege![0]!.building, 'wall');
    assert.ok(won.siege![0]!.to < won.siege![0]!.from);
  });

  it('the random pick follows the seed: same seed same building, and over many seeds several buildings come up', () => {
    const d = target({ barracks: 5 });
    const run = (seed: number) => resolveBattle({ attackerUnits: units({ raider: 400, firecart: 300 }), defender: d, seed }).siege![0]!.building;
    assert.equal(run(11), run(11));
    const seen = new Set(Array.from({ length: 40 }, (_, i) => run(i + 1)));
    assert.ok(seen.size >= 3 && !seen.has('wall'), [...seen].join(','));
  });

  it('the seed still gives the same luck as before the random draw existed', () => {
    const a = resolveBattle({ attackerUnits: units({ raider: 400 }), defender: target(), seed: 5 });
    const b = resolveBattle({ attackerUnits: units({ raider: 400, firecart: 300 }), defender: target(), seed: 5 });
    assert.equal(a.luck, b.luck);
  });

  it('a hopeless lost attack does nothing to buildings (3 rams: no points, no survivors counted)', () => {
    const d = target();
    const lost = resolveBattle({ attackerUnits: units({ logram: 3, firecart: 3 }), defender: d, seed: 5, siegeTarget: 'market' });
    assert.equal(lost.attackerWon, false);
    assert.deepEqual(applyBattleToDefender(d, lost).buildings, d.buildings);
  });

  it('a close lost attack still counts a share of its siege units', () => {
    const d = village({ buildings: { wall: 10, market: 6 }, troops: units({ pikeman: 400 }) });
    const lost = resolveBattle({ attackerUnits: units({ raider: 150, logram: 200, firecart: 200 }), defender: d, seed: 3, siegeTarget: 'market', fixedLuck: 0 });
    assert.equal(lost.attackerWon, false);
    const ratio = Math.min(1, lost.attackPower / lost.defensePower);
    assert.ok(Math.pow(ratio, BATTLE_LOSS_EXPONENT) > 0);
    assert.ok(lost.siege!.some((h) => h.unit === 'logram' && h.building === 'wall' && h.to < h.from));
    assert.ok(lost.siege!.some((h) => h.unit === 'firecart' && h.building === 'market' && h.to < h.from));
  });

  it('same inputs, same result', () => {
    const input = { attackerUnits: units({ raider: 400, logram: 100, firecart: 120 }), defender: target(), seed: 9, siegeTarget: 'market' as const };
    assert.deepEqual(resolveBattle(input), resolveBattle(input));
  });
});
