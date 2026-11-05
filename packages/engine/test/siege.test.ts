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
  WALL_BASE_DEFENSE,
  WALL_BONUS_PER_LEVEL,
  WALL_DEFENSE_PER_LEVEL,
  applyBattleToDefender,
  applySiegeHits,
  checkMission,
  emptyUnits,
  hasChosenSiege,
  hasSiegeUnits,
  normalizeUnits,
  resolveBattle,
  resolveSiege,
  resolveSiegeDuring,
  siegeFloor,
  siegeLostSurvivors,
  siegePointsNeeded,
} from '../src/index.ts';
import type { BuildingId, BuildingLevels, UnitId } from '../src/index.ts';
import { deepFreeze, units, village } from './helpers.ts';

const RAM = UNITS.logram.siege!;
const SLING = UNITS.boulder.siege!;

/** All buildings at 0 except the ones given. */
function levels(over: Partial<BuildingLevels> = {}): BuildingLevels {
  const out = {} as BuildingLevels;
  for (const b of BUILDING_IDS) out[b] = 0;
  return Object.assign(out, over);
}

/** Smallest whole number of units whose points reach `points` (with a little float slack). */
function unitsFor(unit: UnitId, points: number): number {
  return Math.ceil(points / UNITS[unit].siege!.power - 1e-9) + 1;
}

/** Points needed to drop a building from `level` by `n` levels. */
function costOf(level: number, n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += siegePointsNeeded(level - i);
  return sum;
}

describe('siege helpers', () => {
  it('level cost is base + perLevel * L', () => {
    for (const l of [1, 2, 5, 10, 20]) assert.equal(siegePointsNeeded(l), SIEGE_BASE_POINTS + SIEGE_POINTS_PER_LEVEL * l);
    assert.ok(siegePointsNeeded(10) > siegePointsNeeded(9));
  });

  it('floor is 0 for normal buildings and the configured floor for the hall', () => {
    for (const b of BUILDING_IDS) assert.equal(siegeFloor(b), SIEGE_MIN_LEVEL[b] ?? 0);
    assert.equal(siegeFloor('wall'), 0);
    assert.equal(siegeFloor('hall'), 1);
    // Owner 2026-11-05: Farm and Storehouse never drop below 1 either (a village always keeps room and a store).
    assert.equal(siegeFloor('farm'), 1);
    assert.equal(siegeFloor('storehouse'), 1);
  });

  it('hasSiegeUnits / hasChosenSiege', () => {
    assert.equal(hasSiegeUnits(units({ raider: 5 })), false);
    assert.equal(hasSiegeUnits({}), false);
    assert.equal(hasSiegeUnits(units({ logram: 1 })), true);
    assert.equal(hasSiegeUnits(units({ boulder: 1, raider: 3 })), true);
    assert.equal(hasChosenSiege(units({ logram: 4 })), false);
    assert.equal(hasChosenSiege(units({ boulder: 1 })), true);
    assert.equal(hasChosenSiege(units({ boulder: 0, raider: 9 })), false);
  });
});

describe('resolveSiege: Log Ram', () => {
  it('always hits the Wall, ignoring the chosen building', () => {
    const b = levels({ wall: 10, barracks: 10 });
    const hits = resolveSiege(units({ logram: 500 }), b, 'barracks', 7);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.unit, 'logram');
    assert.equal(hits[0]!.building, 'wall');
    assert.equal(hits[0]!.random, undefined);
  });

  it('points are survivors * power and drop levels at base + perLevel * L each', () => {
    const wall = 6;
    const need = costOf(wall, 2);
    const count = Math.ceil(need / RAM.power);
    const hits = resolveSiege(units({ logram: count }), levels({ wall }), null, 1);
    assert.deepEqual(hits, [{ unit: 'logram', building: 'wall', from: wall, to: wall - 2 }]);
  });

  it('exact threshold: one point short drops nothing, exactly enough drops one level', () => {
    const wall = 4;
    const need = siegePointsNeeded(wall);
    const exact = need / RAM.power;
    assert.ok(Number.isInteger(exact), 'ram power divides the cost for this wall level');
    const short = resolveSiege(units({ logram: exact - 1 }), levels({ wall }), null, 1);
    assert.equal(short[0]!.from, wall);
    assert.equal(short[0]!.to, wall);
    const hit = resolveSiege(units({ logram: exact }), levels({ wall }), null, 1);
    assert.equal(hit[0]!.to, wall - 1);
  });

  it('stops at maxLevels however many rams survive', () => {
    const hits = resolveSiege(units({ logram: 100_000 }), levels({ wall: 20 }), null, 1);
    assert.equal(hits[0]!.from, 20);
    assert.equal(hits[0]!.to, 20 - RAM.maxLevels);
  });

  it('stops when the points run out (no carry-over to a level it cannot pay)', () => {
    const wall = 10;
    const count = Math.ceil(costOf(wall, 2) / RAM.power) + Math.floor(siegePointsNeeded(wall - 2) / RAM.power) - 1;
    const hits = resolveSiege(units({ logram: count }), levels({ wall }), null, 1);
    // Enough for two levels with fewer than the third level's cost left over: exactly two drop (when maxLevels allows).
    assert.equal(hits[0]!.to, wall - Math.min(2, RAM.maxLevels));
  });

  it('does not go below floor 0 on the Wall', () => {
    const hits = resolveSiege(units({ logram: 100_000 }), levels({ wall: 1 }), null, 1);
    assert.equal(hits[0]!.from, 1);
    assert.equal(hits[0]!.to, 0);
  });

  it('a Wall already at 0 is a miss (from === to)', () => {
    const hits = resolveSiege(units({ logram: 100_000 }), levels({ wall: 0, barracks: 5 }), null, 1);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.building, 'wall');
    assert.equal(hits[0]!.from, 0);
    assert.equal(hits[0]!.to, 0);
  });
});

describe('resolveSiege: Boulder Sling', () => {
  it('hits the chosen building, floor 0 for normal buildings', () => {
    const hits = resolveSiege(units({ boulder: 100_000 }), levels({ market: 2, wall: 9 }), 'market', 3);
    assert.deepEqual(hits, [{ unit: 'boulder', building: 'market', from: 2, to: 0 }]);
  });

  it('stops at maxLevels', () => {
    const hits = resolveSiege(units({ boulder: 100_000 }), levels({ barracks: 15 }), 'barracks', 3);
    assert.equal(hits[0]!.to, 15 - SLING.maxLevels);
  });

  it('Farm and Storehouse never drop below 1, and at 1 they are a miss (like the Town Hall)', () => {
    for (const b of ['farm', 'storehouse'] as const) {
      const a = resolveSiege(units({ boulder: 100_000 }), levels({ [b]: 6 }), b, 3);
      assert.equal(a[0]!.to, Math.max(1, 6 - SLING.maxLevels));
      const low = resolveSiege(units({ boulder: 100_000 }), levels({ [b]: 2 }), b, 3);
      assert.equal(low[0]!.to, 1);
      const miss = resolveSiege(units({ boulder: 100_000 }), levels({ [b]: 1 }), b, 3);
      assert.deepEqual([miss[0]!.from, miss[0]!.to], [1, 1]);
      for (let seed = 0; seed < 20; seed++) {
        const r = resolveBattle({ attackerUnits: units({ boulder: 100_000 }), defender: village({ buildings: { wall: 0, [b]: 2 }, troops: { pikeman: 100 } }), seed, siegeTarget: b });
        assert.ok(applyBattleToDefender(village({ buildings: { wall: 0, [b]: 2 }, troops: { pikeman: 100 } }), r).buildings[b] >= 1);
      }
    }
  });

  it('a pick at level 0 is a miss', () => {
    const hits = resolveSiege(units({ boulder: 100_000 }), levels({ wall: 9 }), 'market', 3);
    assert.deepEqual(hits, [{ unit: 'boulder', building: 'market', from: 0, to: 0 }]);
  });

  it('the hall never drops below 1, and a hall at 1 is a miss', () => {
    const a = resolveSiege(units({ boulder: 100_000 }), levels({ hall: 5 }), 'hall', 3);
    assert.equal(a[0]!.to, Math.max(siegeFloor('hall'), 5 - SLING.maxLevels));
    const big = resolveSiege(units({ boulder: 100_000 }), levels({ hall: 2 }), 'hall', 3);
    assert.equal(big[0]!.to, 1);
    const miss = resolveSiege(units({ boulder: 100_000 }), levels({ hall: 1 }), 'hall', 3);
    assert.equal(miss[0]!.from, 1);
    assert.equal(miss[0]!.to, 1);
  });

  it('too few slings for even one level is a miss', () => {
    const hits = resolveSiege(units({ boulder: 1 }), levels({ mine: 10 }), 'mine', 3);
    assert.equal(hits[0]!.from, 10);
    assert.equal(hits[0]!.to, 10);
  });
});

describe('resolveSiege: random pick', () => {
  const village1 = levels({ hall: 5, lumber: 3, farm: 4, mine: 2, wall: 6, barracks: 1 });

  it('is deterministic for the same seed, with or without an invalid chosen id', () => {
    for (const seed of [1, 2, 99, 123456]) {
      const a = resolveSiege(units({ boulder: 50 }), village1, null, seed);
      assert.deepEqual(resolveSiege(units({ boulder: 50 }), village1, null, seed), a);
      assert.deepEqual(resolveSiege(units({ boulder: 50 }), village1, undefined, seed), a);
      assert.deepEqual(resolveSiege(units({ boulder: 50 }), village1, 'nonsense' as unknown as BuildingId, seed), a);
      assert.equal(a[0]!.random, true);
    }
  });

  it('varies over seeds and only picks buildings above their floor', () => {
    const seen = new Set<BuildingId>();
    for (let seed = 0; seed < 300; seed++) {
      const hits = resolveSiege(units({ boulder: 50 }), village1, null, seed);
      assert.equal(hits.length, 1);
      const h = hits[0]!;
      seen.add(h.building);
      assert.ok(h.from > siegeFloor(h.building), `${h.building} was picked at ${h.from}`);
    }
    assert.ok(seen.size > 1, 'more than one building is picked over seeds');
    for (const b of BUILDING_IDS) {
      if (levels(village1)[b] <= siegeFloor(b)) assert.ok(!seen.has(b), `${b} is at its floor and must never be picked`);
    }
    // barracks is at 1 (> floor 0) so it is allowed; the hall at 5 too; others at 0 never
    assert.ok(seen.has('barracks') || seen.size > 1);
  });

  it('never picks the hall when it is at its floor of 1', () => {
    const b = levels({ hall: 1, farm: 2 });
    for (let seed = 0; seed < 100; seed++) {
      const h = resolveSiege(units({ boulder: 50 }), b, null, seed)[0]!;
      assert.equal(h.building, 'farm');
    }
  });

  it('no building above its floor means no hit at all', () => {
    assert.deepEqual(resolveSiege(units({ boulder: 50 }), levels({ hall: 1 }), null, 5), []);
    assert.deepEqual(resolveSiege(units({ boulder: 50 }), levels(), null, 5), []);
  });
});

describe('resolveSiege: both kinds, survivors, purity', () => {
  it('Log Ram acts first, then Boulder Sling on the evolving levels (sling on the Wall sees the lowered Wall)', () => {
    const wall = 10;
    const rams = Math.ceil(siegePointsNeeded(wall) / RAM.power); // exactly one level
    const slings = unitsFor('boulder', costOf(wall - 1, SLING.maxLevels));
    const hits = resolveSiege(units({ logram: rams, boulder: slings }), levels({ wall }), 'wall', 11);
    assert.equal(hits.length, 2);
    assert.equal(hits[0]!.unit, 'logram');
    assert.equal(hits[1]!.unit, 'boulder');
    assert.equal(hits[0]!.from, wall);
    assert.equal(hits[0]!.to, wall - 1);
    assert.equal(hits[1]!.building, 'wall');
    assert.equal(hits[1]!.from, hits[0]!.to);
    assert.equal(hits[1]!.to, hits[0]!.to - SLING.maxLevels);
  });

  it('a random sling pick sees the levels left by the rams', () => {
    // Only the wall is above its floor; the rams flatten it, so the sling has nothing left to pick.
    const hits = resolveSiege(units({ logram: 100_000, boulder: 50 }), levels({ wall: 1 }), null, 4);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.unit, 'logram');
    assert.equal(hits[0]!.to, 0);
  });

  it('no survivors means no hits', () => {
    assert.deepEqual(resolveSiege(emptyUnits(), levels({ wall: 10, market: 5 }), 'market', 1), []);
    assert.deepEqual(resolveSiege(units({ raider: 500, knight: 20 }), levels({ wall: 10 }), 'wall', 1), []);
    assert.deepEqual(resolveSiege({}, levels({ wall: 10 }), null, 1), []);
  });

  it('never mutates its input levels or survivors', () => {
    const b = deepFreeze(levels({ wall: 10, market: 5, barracks: 7 }));
    const s = deepFreeze(units({ logram: 200, boulder: 200 }));
    const hits = resolveSiege(s, b, 'market', 5);
    assert.equal(hits.length, 2);
    assert.deepEqual(b, levels({ wall: 10, market: 5, barracks: 7 }));
    const rnd = resolveSiege(s, b, null, 5);
    assert.equal(rnd.length, 2);
  });

  it('hits only ever lower levels (to <= from) and respect each kind cap', () => {
    for (let seed = 0; seed < 50; seed++) {
      const hits = resolveSiege(units({ logram: seed * 3, boulder: seed * 5 }), levels({ wall: 8, market: 6, farm: 9, hall: 4 }), null, seed);
      for (const h of hits) {
        assert.ok(h.to <= h.from);
        assert.ok(h.from - h.to <= UNITS[h.unit].siege!.maxLevels);
        assert.ok(h.to >= siegeFloor(h.building));
      }
    }
  });
});

// Hand-computed examples with the numbers at the time of writing (base 6, +2 per level, Log Ram power 1 / max 3,
// Boulder Sling power 0.8 / max 2). They only hold while those numbers stay; the derived tests above hold regardless.
describe('resolveSiege: hand-computed (base 6, 2 per level, ram 1 x3, sling 0.8 x2)', () => {
  const current = SIEGE_BASE_POINTS === 6 && SIEGE_POINTS_PER_LEVEL === 2 && RAM.power === 1 && RAM.maxLevels === 3 && SLING.power === 0.8 && SLING.maxLevels === 2;
  const opts = { skip: current ? false : 'siege numbers were tuned; hand examples no longer apply' };

  it('Wall 10 costs 26, 24, 22: 60 rams drop two levels (50), 10 points are lost', opts, () => {
    assert.deepEqual(resolveSiege(units({ logram: 60 }), levels({ wall: 10 }), null, 1), [{ unit: 'logram', building: 'wall', from: 10, to: 8 }]);
    assert.equal(resolveSiege(units({ logram: 25 }), levels({ wall: 10 }), null, 1)[0]!.to, 10); // 25 < 26
    assert.equal(resolveSiege(units({ logram: 26 }), levels({ wall: 10 }), null, 1)[0]!.to, 9); // exactly 26
    assert.equal(resolveSiege(units({ logram: 72 }), levels({ wall: 10 }), null, 1)[0]!.to, 7); // 26+24+22 = 72
    assert.equal(resolveSiege(units({ logram: 500 }), levels({ wall: 10 }), null, 1)[0]!.to, 7); // capped at 3 levels
  });

  it('Wall 3 costs 12, 10, 8: 15 rams drop one level (12), 3 points are lost', opts, () => {
    assert.deepEqual(resolveSiege(units({ logram: 15 }), levels({ wall: 3 }), null, 1), [{ unit: 'logram', building: 'wall', from: 3, to: 2 }]);
  });

  it('25 slings = 20 points; Mine 5 costs 16: one level (4 points left, level 4 costs 14)', opts, () => {
    assert.deepEqual(resolveSiege(units({ boulder: 25 }), levels({ mine: 5 }), 'mine', 1), [{ unit: 'boulder', building: 'mine', from: 5, to: 4 }]);
  });

  it('Hall 2 with 100 slings (80 points): costs 10 then stops at the floor of 1', opts, () => {
    assert.deepEqual(resolveSiege(units({ boulder: 100 }), levels({ hall: 2 }), 'hall', 1), [{ unit: 'boulder', building: 'hall', from: 2, to: 1 }]);
  });
});

describe('siege during the battle and on a loss (helpers)', () => {
  it('resolveSiegeDuring: rams fire SIEGE_DURING_SHARE of their points at the Wall; others and unsent kinds do not', () => {
    const wall = 10;
    const full = Math.ceil(costOf(wall, 2) / RAM.power);
    const half = resolveSiegeDuring(units({ logram: full }), wall);
    assert.ok(half.wall > wall - 2, 'half the points do not drop two levels');
    const twice = resolveSiegeDuring(units({ logram: Math.ceil(full / SIEGE_DURING_SHARE) }), wall);
    assert.equal(twice.wall, wall - 2);
    assert.equal(twice.dropped.logram, 2);
    assert.equal(twice.from.logram, wall);
    assert.deepEqual(resolveSiegeDuring(units({ boulder: 5000, raider: 100 }), wall), { wall, dropped: {}, from: {} });
    assert.equal(resolveSiegeDuring(units({ logram: 1e6 }), 0).wall, 0);
  });

  it('resolveSiege with `sent`: the hit runs from the pre-battle level; the maxLevels cap is shared; no survivors still shows the during hit', () => {
    const b = levels({ wall: 12 });
    const dur = resolveSiegeDuring(units({ logram: 300 }), 12);
    assert.ok(dur.dropped.logram! >= 1);
    const none = resolveSiege(emptyUnits(), b, null, 1, units({ logram: 300 }));
    assert.deepEqual(none, [{ unit: 'logram', building: 'wall', from: 12, to: dur.wall }]);
    const all = resolveSiege(units({ logram: 300 }), b, null, 1, units({ logram: 300 }));
    assert.equal(all[0]!.from, 12);
    assert.equal(all[0]!.to, 12 - RAM.maxLevels);
  });

  it('siegeLostSurvivors: floor(count * ratio * SIEGE_LOST_SHARE) for siege kinds only', () => {
    const s = siegeLostSurvivors(units({ logram: 101, boulder: 40, raider: 500 }), 0.5);
    assert.equal(s.logram, Math.floor(101 * 0.5 * SIEGE_LOST_SHARE));
    assert.equal(s.boulder, Math.floor(40 * 0.5 * SIEGE_LOST_SHARE));
    assert.equal(s.raider, 0);
    assert.equal(siegeLostSurvivors(units({ logram: 10 }), 0).logram, 0);
    assert.equal(siegeLostSurvivors(units({ logram: 10 }), 7).logram, Math.floor(10 * SIEGE_LOST_SHARE)); // ratio is clamped to 1
  });
});

describe('applySiegeHits', () => {
  it('lowers levels and aims queued upgrades of that building lower by the same amount', () => {
    const v = village({ buildings: { wall: 8, barracks: 6, farm: 5 } });
    v.buildQueue.push(
      { building: 'wall', targetLevel: 9, startAt: 0, finishAt: 1000 },
      { building: 'wall', targetLevel: 10, startAt: 1000, finishAt: 2000 },
      { building: 'barracks', targetLevel: 7, startAt: 2000, finishAt: 3000 },
    );
    const paid = JSON.stringify(v.renownPaid);
    const farm = v.buildings.farm;
    applySiegeHits(v, [{ unit: 'logram', building: 'wall', from: 8, to: 6 }]);
    assert.equal(v.buildings.wall, 6);
    assert.equal(v.buildQueue[0]!.targetLevel, 7);
    assert.equal(v.buildQueue[1]!.targetLevel, 8);
    assert.equal(v.buildQueue[2]!.targetLevel, 7); // other building untouched
    assert.equal(v.buildings.barracks, 6);
    assert.equal(v.buildings.farm, farm);
    assert.equal(JSON.stringify(v.renownPaid), paid);
  });

  it('a queued job always stays above the current level', () => {
    const v = village({ buildings: { wall: 8 } });
    v.buildQueue.push({ building: 'wall', targetLevel: 9, startAt: 0, finishAt: 1000 });
    applySiegeHits(v, [{ unit: 'logram', building: 'wall', from: 8, to: 3 }]);
    assert.equal(v.buildings.wall, 3);
    assert.ok(v.buildQueue[0]!.targetLevel > v.buildings.wall);
  });

  it('never goes below the floor (hall stays at 1, others reach 0)', () => {
    const v = village({ buildings: { hall: 3, market: 2 } });
    applySiegeHits(v, [
      { unit: 'boulder', building: 'hall', from: 3, to: 0 },
      { unit: 'boulder', building: 'market', from: 2, to: 0 },
    ]);
    assert.equal(v.buildings.hall, siegeFloor('hall'));
    assert.equal(v.buildings.market, 0);
  });

  it('misses and an empty hit list change nothing', () => {
    const v = village({ buildings: { wall: 4 } });
    v.buildQueue.push({ building: 'wall', targetLevel: 5, startAt: 0, finishAt: 1000 });
    const before = JSON.stringify(v);
    applySiegeHits(v, []);
    applySiegeHits(v, [{ unit: 'logram', building: 'wall', from: 4, to: 4 }]);
    assert.equal(JSON.stringify(v), before);
  });

  it('a hit from a higher level than the village now has only lowers by what is left to drop', () => {
    const v = village({ buildings: { wall: 5 } });
    applySiegeHits(v, [{ unit: 'logram', building: 'wall', from: 7, to: 4 }]);
    assert.equal(v.buildings.wall, 4); // min(7, 5) - 4 = 1 level -> 5 - 1 = 4
  });
});

describe('resolveBattle with siege', () => {
  const wallDefence = (wall: number): number => (WALL_BASE_DEFENSE + WALL_DEFENSE_PER_LEVEL * wall) * (1 + WALL_BONUS_PER_LEVEL * wall);
  const target = (over: Partial<BuildingLevels> = {}) => village({ buildings: { wall: 10, hall: 3, market: 4, ...over }, troops: emptyUnits() });

  it('a hopeless lost attack does nothing to buildings (3 rams: no points, no survivors counted)', () => {
    const d = target();
    const lost = resolveBattle({ attackerUnits: units({ logram: 3 }), defender: d, seed: 5, siegeTarget: 'market' });
    assert.equal(lost.attackerWon, false);
    assert.ok(lost.siege!.every((h) => h.from === h.to));
    assert.deepEqual(applyBattleToDefender(d, lost).buildings, d.buildings);
  });

  it('a won attack lowers buildings through applyBattleToDefender, without mutating its input', () => {
    const d = target();
    const frozen = deepFreeze(structuredClone(d));
    const won = resolveBattle({ attackerUnits: units({ raider: 400, logram: 300, boulder: 300 }), defender: frozen, seed: 5, siegeTarget: 'market' });
    assert.equal(won.attackerWon, true);
    assert.ok(won.siege!.length >= 2);
    const after = applyBattleToDefender(frozen, won);
    assert.ok(after.buildings.wall < d.buildings.wall);
    assert.ok(after.buildings.market < d.buildings.market);
    assert.equal(after.buildings.hall, d.buildings.hall);
    assert.deepEqual(frozen, d);
  });

  it('the Wall the rams leave counts in the same battle: defensePower uses wallDuring, the report keeps both ends', () => {
    const d = target({ wall: 10 });
    const plain = resolveBattle({ attackerUnits: units({ raider: 600 }), defender: d, seed: 8 });
    const rams = resolveBattle({ attackerUnits: units({ raider: 600, logram: 200 }), defender: d, seed: 8 });
    assert.equal(plain.wallDuring, 10);
    assert.ok(Math.abs(plain.defensePower - wallDefence(10)) < 1e-9);
    assert.ok(rams.wallDuring < 10);
    assert.ok(Math.abs(rams.defensePower - wallDefence(rams.wallDuring)) < 1e-9);
    assert.ok(rams.defensePower < plain.defensePower);
    assert.equal(rams.attackerWon, true);
    // The Wall line runs from the pre-battle level to the level after both steps, never above what the defence used.
    const wallHit = rams.siege!.find((h) => h.building === 'wall')!;
    assert.equal(wallHit.from, 10);
    assert.ok(wallHit.to <= rams.wallDuring && wallHit.to < wallHit.from);
    // The next battle against the lowered village meets the lowered Wall.
    const after = applyBattleToDefender(d, rams);
    assert.equal(after.buildings.wall, wallHit.to);
    const next = resolveBattle({ attackerUnits: units({ raider: 600 }), defender: after, seed: 8 });
    assert.ok(next.defensePower < rams.defensePower + 1e-9);
    assert.ok(Math.abs(next.defensePower - wallDefence(after.buildings.wall)) < 1e-9);
  });

  it('rams help win: the same attack power against the same village wins more easily with the during hit', () => {
    // Same attack power: 10 raiders (40 each) are replaced by 100 rams (4 each) -> equal attackRaw, equal luck for the seed.
    const d = target({ wall: 6 });
    const a = resolveBattle({ attackerUnits: units({ raider: 20 }), defender: d, seed: 21 });
    const b = resolveBattle({ attackerUnits: units({ logram: 20 * (UNITS.raider.attack / UNITS.logram.attack) }), defender: d, seed: 21 });
    assert.ok(Math.abs(a.attackPower - b.attackPower) < 1e-9);
    assert.equal(a.wallDuring, 6);
    assert.ok(b.wallDuring < 6);
    assert.ok(b.defensePower < a.defensePower);
  });

  it('a close LOSS still lowers the Wall: during hit plus a share of the rams as after-survivors; every unit still dies; no loot', () => {
    const d = village({ buildings: { wall: 10, hall: 3 }, troops: { pikeman: 400, guard: 200 }, resources: { wood: 5000, food: 5000, iron: 5000, gold: 500 } });
    const army = units({ raider: 100, logram: 200 });
    let lossCase: ReturnType<typeof resolveBattle> | null = null;
    let sentArmy = army;
    for (let raiders = 100; raiders < 3000 && !lossCase; raiders += 10) {
      const a = units({ raider: raiders, logram: 200 });
      const r = resolveBattle({ attackerUnits: a, defender: d, seed: 7 });
      if (!r.attackerWon && r.attackPower / r.defensePower > 0.8) {
        lossCase = r;
        sentArmy = a;
      }
    }
    assert.ok(lossCase, 'a close loss exists');
    const r = lossCase!;
    assert.equal(r.attackerWon, false);
    assert.deepEqual(r.attackerLosses, sentArmy);
    assert.deepEqual(r.attackerSurvivors, units({}));
    assert.deepEqual(r.loot, { wood: 0, food: 0, iron: 0, gold: 0 });
    const hit = r.siege!.find((h) => h.unit === 'logram')!;
    assert.equal(hit.from, 10);
    assert.ok(hit.to < 10, 'the Wall went down');
    assert.ok(r.wallDuring <= 10 && hit.to <= r.wallDuring);
    // applyBattleToDefender applies the hit on a loss.
    assert.equal(applyBattleToDefender(d, r).buildings.wall, hit.to);
  });

  it('a lost attack counts floor(count * (A/D)^exp * SIEGE_LOST_SHARE) of each siege kind for the after step (slings too)', () => {
    const d = village({ buildings: { wall: 0, market: 8, hall: 3 }, troops: { pikeman: 300 } });
    const army = units({ boulder: 400 });
    const r = resolveBattle({ attackerUnits: army, defender: d, seed: 4, siegeTarget: 'market' });
    if (r.attackerWon) return; // not the case with these numbers; guard keeps the test honest if tuned
    const ratio = Math.pow(r.attackPower / r.defensePower, BATTLE_LOSS_EXPONENT);
    const counted = Math.floor(400 * ratio * SIEGE_LOST_SHARE);
    assert.deepEqual(r.siege, resolveSiege(units({ boulder: counted }), d.buildings, 'market', 4, army));
  });

  it('the cap on levels is shared by the during and after steps (rams never drop more than maxLevels in all)', () => {
    const d = target({ wall: 20 });
    const r = resolveBattle({ attackerUnits: units({ raider: 100_000, logram: 100_000 }), defender: d, seed: 3 });
    assert.equal(r.attackerWon, true);
    const hit = r.siege!.find((h) => h.building === 'wall')!;
    assert.equal(hit.from, 20);
    assert.equal(hit.to, 20 - RAM.maxLevels);
    assert.ok(r.wallDuring >= hit.to && r.wallDuring < 20);
  });

  it('the Town Hall never drops below 1 even on a loss', () => {
    const d = village({ buildings: { wall: 0, hall: 2 }, troops: { pikeman: 100 } });
    for (let seed = 0; seed < 20; seed++) {
      const r = resolveBattle({ attackerUnits: units({ boulder: 100_000 }), defender: d, seed, siegeTarget: 'hall' });
      assert.ok(applyBattleToDefender(d, r).buildings.hall >= 1);
    }
  });

  it('survivors, not the sent count, drive the damage', () => {
    const d = target({ wall: 10 });
    // Find a close win in which the rams suffer real losses but some survive.
    let found: ReturnType<typeof resolveBattle> | null = null;
    let sent = 0;
    for (let raiders = 1; raiders < 1500 && !found; raiders++) {
      const r = resolveBattle({ attackerUnits: units({ raider: raiders, logram: 100 }), defender: d, seed: 33 });
      if (r.attackerWon && r.attackerLosses.logram > 0 && r.attackerSurvivors.logram > 0) {
        found = r;
        sent = 100;
      }
    }
    assert.ok(found, 'a close win with ram losses exists');
    const r = found!;
    assert.ok(r.attackerSurvivors.logram < sent);
    const sentArmy = units({ raider: r.attackerLosses.raider + r.attackerSurvivors.raider, logram: sent });
    assert.deepEqual(r.siege, resolveSiege(r.attackerSurvivors, d.buildings, undefined, 33, sentArmy));
    // The survivors' points are what counts after the battle: counting all sent rams would never drop fewer levels.
    const fromSurvivors = r.siege![0]!;
    const fromSent = resolveSiege(units({ logram: sent }), d.buildings, undefined, 33, sentArmy)[0]!;
    assert.ok(fromSurvivors.from - fromSurvivors.to <= fromSent.from - fromSent.to);
  });

  it('a won battle with no siege units sent has no hits', () => {
    const r = resolveBattle({ attackerUnits: units({ raider: 600 }), defender: target(), seed: 1 });
    assert.equal(r.attackerWon, true);
    assert.deepEqual(r.siege, []);
  });

  it('passes siegeTarget through to the sling hit', () => {
    const d = target({ market: 4, hall: 3 });
    const input = { attackerUnits: units({ raider: 600, boulder: 200 }), defender: d, seed: 2 };
    const market = resolveBattle({ ...input, siegeTarget: 'market' });
    const hall = resolveBattle({ ...input, siegeTarget: 'hall' });
    assert.equal(market.siege![0]!.building, 'market');
    assert.equal(hall.siege![0]!.building, 'hall');
    assert.equal(market.siege![0]!.random, undefined);
    const none = resolveBattle(input);
    assert.equal(none.siege![0]!.random, true);
  });

  it('is deterministic for equal input', () => {
    const d = target();
    const input = { attackerUnits: units({ raider: 500, logram: 100, boulder: 100 }), defender: d, seed: 77, siegeTarget: null };
    assert.deepEqual(resolveBattle(input), resolveBattle(input));
  });

  it('keeps the renown paid levels untouched', () => {
    const d = target();
    const paid = structuredClone(d.renownPaid);
    const r = resolveBattle({ attackerUnits: units({ raider: 600, logram: 200 }), defender: d, seed: 1 });
    const after = applyBattleToDefender(d, r);
    assert.deepEqual(after.renownPaid, paid);
  });
});

describe('checkMission with siege units', () => {
  const siegeArmies = [units({ logram: 2 }), units({ boulder: 2 }), units({ logram: 1, boulder: 1 }), units({ logram: 2, raider: 5 })];

  it('refuses them for scout, support, found and occupy', () => {
    for (const mission of ['scout', 'support', 'found', 'occupy'] as const) {
      for (const army of siegeArmies) {
        const r = checkMission(mission, { ...army, ...(mission === 'found' ? { chieftain: 1 } : {}) });
        assert.equal(r.ok, false, `${mission} with ${JSON.stringify(army)}`);
      }
    }
  });

  it('allows them on an attack, alone or with other units', () => {
    assert.equal(checkMission('attack', units({ logram: 3 })).ok, true);
    assert.equal(checkMission('attack', units({ boulder: 3 })).ok, true);
    assert.equal(checkMission('attack', units({ logram: 3, boulder: 3, raider: 10, knight: 2 })).ok, true);
  });
});

describe('siege unit config', () => {
  const siegeIds = UNIT_IDS.filter((id) => UNITS[id].siege !== undefined);

  it('exactly the two siege units define siege', () => {
    assert.deepEqual([...siegeIds].sort(), ['boulder', 'logram']);
    assert.equal(UNITS.logram.siege!.target, 'wall');
    assert.equal(UNITS.boulder.siege!.target, 'chosen');
  });

  it('both train in the barracks, need research and barracks 5 / 8', () => {
    for (const id of ['logram', 'boulder'] as const) {
      assert.equal(UNITS[id].building, 'barracks');
      assert.ok(UNITS[id].research, `${id} needs research`);
    }
    assert.equal(UNITS.logram.requires?.barracks, 5);
    assert.equal(UNITS.boulder.requires?.barracks, 8);
  });

  it('are slower than every other unit and weaker in attack than a raider', () => {
    for (const id of siegeIds) {
      for (const other of UNIT_IDS) {
        if (siegeIds.includes(other)) continue;
        assert.ok(UNITS[id].speed < UNITS[other].speed, `${id} (${UNITS[id].speed}) slower than ${other} (${UNITS[other].speed})`);
      }
      assert.ok(UNITS[id].attack < UNITS.raider.attack);
    }
  });

  it('normalizeUnits and emptyUnits include them', () => {
    const e = emptyUnits();
    assert.equal(e.logram, 0);
    assert.equal(e.boulder, 0);
    const n = normalizeUnits({ logram: 3 });
    assert.equal(n.logram, 3);
    assert.equal(n.boulder, 0);
    assert.deepEqual(Object.keys(e).sort(), [...UNIT_IDS].sort());
  });
});
