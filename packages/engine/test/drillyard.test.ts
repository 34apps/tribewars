import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BREACH_BONUS,
  BUILDING_IDS,
  DRILLYARD_HALL_FROM,
  DRILLYARD_POINTS_PER_HALL_LEVEL,
  DRILLYARD_POINTS_PER_LEVEL,
  GameError,
  RANKABLE_UNITS,
  RANK_BONUS,
  RANK_COST,
  RANK_MAX,
  RANK_POINTS,
  RANK_TRACKS,
  RANK_TRACKS_OF,
  SIEGE_DURING_SHARE,
  UNITS,
  UNIT_IDS,
  applyBattleToDefender,
  applyRank,
  applyResearch,
  applyRespec,
  applyTrain,
  breachMultiplier,
  bulwarkMultiplier,
  checkRank,
  checkRespec,
  checkResearch,
  checkTrain,
  emptyRanks,
  hasTrack,
  keenMultiplier,
  mightMultiplier,
  normalizeVillage,
  pointsSpent,
  pointsTotal,
  rankOf,
  rankPointsUpTo,
  rankResourcesUpTo,
  resolveBattle,
  resolveSiege,
  resolveSiegeDuring,
  settleVillage,
  siegePointsNeeded,
} from '../src/index.ts';
import type { BuildingId, BuildingLevels, RankTrack, UnitId, Units, VillageRanks } from '../src/index.ts';
import { HOUR, S1, S10, defenderWith, units, village } from './helpers.ts';

const rich = { wood: 1e6, food: 1e6, iron: 1e6, gold: 1e6 };
const base = { hall: 10, barracks: 8, stables: 8, storehouse: 20, farm: 20, drillyard: 10 };
const expectGameError = (fn: () => unknown, code: string): void => {
  assert.throws(fn, (e: unknown) => e instanceof GameError && e.code === code);
};

describe('research gate', () => {
  it('guard cannot be trained until researched; free units can', () => {
    const v = village({ buildings: base, resources: rich });
    const g = checkTrain(v, 'guard', 1, 0, S1);
    assert.equal(g.ok, false);
    if (!g.ok) assert.equal(g.reason, 'requirements_not_met');
    assert.equal(checkTrain(v, 'pikeman', 1, 0, S1).ok, true);
    assert.equal(checkTrain(v, 'pathfinder', 1, 0, S1).ok, true);
  });

  it('research needs Drillyard level, pays, runs one job at a time and completes in settle', () => {
    const low = village({ buildings: { ...base, drillyard: 0 }, resources: rich });
    assert.equal(checkResearch(low, 'guard', 0, S1).ok, false);
    const v = applyResearch(village({ buildings: base, resources: rich }), 'guard', 0, S1);
    assert.equal(v.resources.wood, 1e6 - (UNITS.guard.research?.cost.wood ?? 0));
    assert.equal(v.researchQueue?.[0]?.unit, 'guard');
    expectGameError(() => applyResearch(v, 'outrider', 0, S1, 1), 'queue_full');
    const durMs = (UNITS.guard.research?.timeSec ?? 0) * 1000;
    assert.equal(checkTrain(v, 'guard', 1, durMs - 1, S1).ok, false);
    const done = settleVillage(v, durMs, S1);
    assert.equal(done.researchQueue, undefined);
    assert.deepEqual(done.researched, ['guard']);
    assert.equal(checkTrain(done, 'guard', 1, durMs, S1).ok, true);
    expectGameError(() => applyResearch(done, 'guard', durMs, S1), 'invalid_input');
  });

  it('research time is divided by world speed', () => {
    const r = checkResearch(village({ buildings: base, resources: rich }), 'guard', 0, S10);
    assert.ok(r.ok && r.timeMs === Math.round(((UNITS.guard.research?.timeSec ?? 0) / 10) * 1000));
  });

  it('old saves: units already present count as researched', () => {
    const v = village({ buildings: base, resources: rich, troops: { knight: 3 }, away: { outrider: 2 } });
    assert.deepEqual(normalizeVillage(v).researched, ['outrider', 'knight']);
    assert.equal(checkTrain(v, 'knight', 1, HOUR, S1).ok, true);
    assert.equal(checkTrain(v, 'guard', 1, 0, S1).ok, false);
    const q = applyTrain(village({ buildings: base, resources: rich, troops: { guard: 1 } }), 'guard', 2, 0, S1);
    assert.ok(q.researched?.includes('guard'));
  });
});

describe('ranks and training points', () => {
  const researched = (): ReturnType<typeof village> =>
    normalizeVillage(
      village({ buildings: base, resources: rich, troops: { raider: 1, pikeman: 1, guard: 1, outrider: 1, knight: 1, pathfinder: 1, hearthwarden: 1, logram: 1, firecart: 1 } }),
    );

  it('points: DRILLYARD_POINTS_PER_LEVEL per Drillyard level, rank r costs RANK_POINTS[r - 1]', () => {
    let v = researched();
    assert.equal(pointsTotal(v), base.drillyard * DRILLYARD_POINTS_PER_LEVEL + DRILLYARD_POINTS_PER_HALL_LEVEL * Math.max(0, base.hall - DRILLYARD_HALL_FROM));
    const first = checkRank(v, 'raider', 'might', 0, S1);
    assert.ok(first.ok && first.points === RANK_POINTS[0]);
    v = applyRank(v, 'raider', 'might', 0, S1);
    v = applyRank(v, 'raider', 'might', 0, S1);
    assert.equal(v.ranks?.raider?.might, 2);
    assert.equal(pointsSpent(v), rankPointsUpTo(2));
    assert.equal(pointsSpent(v), (RANK_POINTS[0] ?? 0) + (RANK_POINTS[1] ?? 0));
  });

  it('every rank step costs its own RANK_POINTS entry and its own RANK_COST', () => {
    let v = researched();
    for (let r = 1; r <= RANK_MAX; r++) {
      const c = checkRank(v, 'raider', 'might', 0, S1);
      assert.ok(c.ok);
      if (!c.ok) return;
      assert.equal(c.rank, r);
      assert.equal(c.points, RANK_POINTS[r - 1]);
      assert.deepEqual(c.cost, RANK_COST[r - 1]);
      const before = pointsSpent(v);
      v = applyRank(v, 'raider', 'might', 0, S1);
      assert.equal(pointsSpent(v) - before, RANK_POINTS[r - 1]);
    }
    assert.equal(pointsSpent(v), rankPointsUpTo(RANK_MAX));
    expectGameError(() => applyRank(v, 'raider', 'might', 0, S1), 'max_level');
  });

  it('rankPointsUpTo and rankResourcesUpTo add the steps and clamp to 0..RANK_MAX', () => {
    assert.equal(rankPointsUpTo(0), 0);
    assert.equal(rankPointsUpTo(-3), 0);
    let sum = 0;
    for (let r = 1; r <= RANK_MAX; r++) {
      sum += RANK_POINTS[r - 1] ?? 0;
      assert.equal(rankPointsUpTo(r), sum);
    }
    assert.equal(rankPointsUpTo(RANK_MAX + 4), sum);
    assert.deepEqual(rankResourcesUpTo(0), { wood: 0, food: 0, iron: 0, gold: 0 });
    for (const id of ['wood', 'food', 'iron', 'gold'] as const) {
      assert.equal(rankResourcesUpTo(2)[id], (RANK_COST[0]?.[id] ?? 0) + (RANK_COST[1]?.[id] ?? 0));
      assert.equal(rankResourcesUpTo(RANK_MAX + 4)[id], RANK_COST.reduce((a, c) => a + c[id], 0));
    }
  });

  it('maxing everything is impossible', () => {
    let v = researched();
    const tracks: Array<[UnitId, RankTrack]> = [];
    for (const u of RANKABLE_UNITS) for (const t of RANK_TRACKS_OF[u] ?? []) tracks.push([u, t]);
    for (const [u, t] of tracks) {
      for (let i = 0; i < RANK_MAX; i++) {
        if (!checkRank(v, u, t, 0, S1).ok) break;
        v = applyRank(v, u, t, 0, S1);
      }
    }
    assert.ok(pointsSpent(v) <= pointsTotal(v));
    const open = tracks.filter(([u, t]) => rankOf(v.ranks, u, t) < RANK_MAX);
    assert.ok(open.length > 0, 'the pool never covers every track');
    const last = open[0];
    if (last) expectGameError(() => applyRank(v, last[0], last[1], 0, S1), 'requirements_not_met');
  });

  it('a rank the pool cannot pay for is refused (not enough Training Points) while resources are plentiful', () => {
    const v = researched();
    v.buildings = { ...v.buildings, drillyard: 1 };
    let bought = 0;
    let cur = v;
    while (checkRank(cur, 'raider', 'might', 0, S1).ok && bought < RANK_MAX) {
      cur = applyRank(cur, 'raider', 'might', 0, S1);
      bought++;
    }
    assert.ok(pointsSpent(cur) <= pointsTotal(cur));
    if (bought < RANK_MAX) {
      const c = checkRank(cur, 'raider', 'might', 0, S1);
      assert.ok(!c.ok && c.reason === 'requirements_not_met');
      assert.ok(pointsTotal(cur) - pointsSpent(cur) < (RANK_POINTS[bought] ?? 0));
    }
  });

  it('the Hall term: DRILLYARD_POINTS_PER_HALL_LEVEL per Town Hall level above DRILLYARD_HALL_FROM', () => {
    const at = (hall: number, drillyard = 4): number => pointsTotal(village({ buildings: { hall, drillyard } }));
    const plain = DRILLYARD_POINTS_PER_LEVEL * 4;
    assert.equal(at(0), plain);
    assert.equal(at(DRILLYARD_HALL_FROM), plain, 'no extra up to the threshold itself');
    assert.equal(at(DRILLYARD_HALL_FROM + 3), plain + 3 * DRILLYARD_POINTS_PER_HALL_LEVEL);
    assert.equal(at(DRILLYARD_HALL_FROM + 6) - at(DRILLYARD_HALL_FROM + 5), DRILLYARD_POINTS_PER_HALL_LEVEL);
    if (DRILLYARD_POINTS_PER_HALL_LEVEL === 0) assert.equal(at(DRILLYARD_HALL_FROM + 6), plain, 'switched off: the Hall adds nothing');
    assert.equal(pointsTotal(village({ buildings: { hall: DRILLYARD_HALL_FROM + 6, drillyard: 0 } })), DRILLYARD_POINTS_PER_HALL_LEVEL * 6, 'the Hall term does not need a Drillyard');
  });

  it('Chieftain cannot be ranked at all', () => {
    const v = researched();
    v.researched = [...(v.researched ?? []), 'chieftain'];
    for (const t of RANK_TRACKS) {
      assert.equal(checkRank(v, 'chieftain', t, 0, S1).ok, false, t);
      expectGameError(() => applyRank(v, 'chieftain', t, 0, S1), 'invalid_input');
    }
    assert.equal(RANKABLE_UNITS.includes('chieftain'), false);
  });

  it('tracks per unit: a unit can only be ranked in the tracks RANK_TRACKS_OF gives it', () => {
    const v = researched();
    for (const u of RANKABLE_UNITS) {
      for (const t of RANK_TRACKS) {
        const has = RANK_TRACKS_OF[u]?.includes(t) ?? false;
        assert.equal(hasTrack(u, t), has, `${u} ${t}`);
        assert.equal(checkRank(v, u, t, 0, S1).ok, has, `${u} ${t}`);
        if (!has) expectGameError(() => applyRank(v, u, t, 0, S1), 'invalid_input');
      }
    }
  });

  it('tracks per unit: the named cases (Raider no bulwark, Pikeman no might, Keen only Pathfinder, siege only Breach)', () => {
    const v = researched();
    expectGameError(() => applyRank(v, 'raider', 'bulwark', 0, S1), 'invalid_input');
    expectGameError(() => applyRank(v, 'outrider', 'bulwark', 0, S1), 'invalid_input');
    expectGameError(() => applyRank(v, 'pikeman', 'might', 0, S1), 'invalid_input');
    expectGameError(() => applyRank(v, 'guard', 'might', 0, S1), 'invalid_input');
    expectGameError(() => applyRank(v, 'hearthwarden', 'might', 0, S1), 'invalid_input');
    expectGameError(() => applyRank(v, 'pathfinder', 'might', 0, S1), 'invalid_input');
    expectGameError(() => applyRank(v, 'pathfinder', 'bulwark', 0, S1), 'invalid_input');
    for (const u of RANKABLE_UNITS) if (u !== 'pathfinder') assert.equal(checkRank(v, u, 'keen', 0, S1).ok, false, `keen ${u}`);
    assert.equal(checkRank(v, 'pathfinder', 'keen', 0, S1).ok, true);
    assert.ok(hasTrack('knight', 'might') && hasTrack('knight', 'bulwark'), 'the Ember Guard knight does both');
    for (const u of ['logram', 'firecart'] as const) {
      assert.equal(checkRank(v, u, 'breach', 0, S1).ok, true, u);
      for (const t of ['might', 'bulwark', 'keen'] as const) {
        assert.equal(checkRank(v, u, t, 0, S1).ok, false, `${u} ${t}`);
        expectGameError(() => applyRank(v, u, t, 0, S1), 'invalid_input');
      }
    }
    for (const u of RANKABLE_UNITS) if (u !== 'logram' && u !== 'firecart') assert.equal(checkRank(v, u, 'breach', 0, S1).ok, false, `breach ${u}`);
  });

  it('every unit with siege power can be ranked in Breach (so the two stay in step)', () => {
    for (const u of UNIT_IDS) if (UNITS[u].siege) assert.ok(hasTrack(u, 'breach') && RANKABLE_UNITS.includes(u), u);
  });

  it('rules: unresearched and unknown things are refused', () => {
    const fresh = village({ buildings: base, resources: rich });
    assert.equal(checkRank(fresh, 'guard', 'bulwark', 0, S1).ok, false);
    assert.equal(checkRank(fresh, 'raider', 'nonsense', 0, S1).ok, false);
    assert.equal(checkRank(fresh, 'nonsense', 'might', 0, S1).ok, false);
    const unresearched = checkRank(fresh, 'guard', 'bulwark', 0, S1);
    assert.ok(!unresearched.ok && unresearched.reason === 'requirements_not_met');
  });

  it('respec refunds the points (rankPointsUpTo) and costs no gold', () => {
    let v = researched();
    v = applyRank(applyRank(v, 'raider', 'might', 0, S1), 'raider', 'might', 0, S1);
    const gold = v.resources.gold;
    const c = checkRespec(v, 'raider', 'might', 0, S1);
    assert.ok(c.ok && c.refund === rankPointsUpTo(2));
    const r = applyRespec(v, 'raider', 'might', 0, S1);
    assert.equal(pointsSpent(r), 0);
    assert.equal(r.resources.gold, gold);
    expectGameError(() => applyRespec(r, 'raider', 'might', 0, S1), 'invalid_input');
  });

  it('respec of a higher rank refunds every step; a Breach track resets like the others', () => {
    let v = researched();
    for (let i = 0; i < 4; i++) v = applyRank(v, 'logram', 'breach', 0, S1);
    assert.equal(pointsSpent(v), rankPointsUpTo(4));
    const c = checkRespec(v, 'logram', 'breach', 0, S1);
    assert.ok(c.ok && c.refund === rankPointsUpTo(4));
    const r = applyRespec(v, 'logram', 'breach', 0, S1);
    assert.equal(r.ranks?.logram?.breach, 0);
    assert.equal(pointsSpent(r), 0);
    assert.equal(pointsTotal(r) - pointsSpent(r), pointsTotal(v), 'the whole pool is free again');
  });

  it('a rank stored on a retired track does nothing: rankOf is 0, the multipliers are 1, it costs no points and cannot be reset', () => {
    // Old saves could hold Might on a Pikeman, Bulwark on a Raider, Keen anywhere, or Breach-less siege ranks.
    const stale: VillageRanks = {
      pikeman: { might: 3, bulwark: 0, keen: 2 },
      raider: { might: 0, bulwark: 4, keen: 0 },
      logram: { might: 2, bulwark: 2, keen: 1, breach: 0 },
    };
    assert.equal(rankOf(stale, 'pikeman', 'might'), 0);
    assert.equal(rankOf(stale, 'pikeman', 'keen'), 0);
    assert.equal(rankOf(stale, 'raider', 'bulwark'), 0);
    assert.equal(rankOf(stale, 'logram', 'might'), 0);
    assert.equal(mightMultiplier(stale, 'pikeman'), 1);
    assert.equal(bulwarkMultiplier(stale, 'raider'), 1);
    assert.equal(keenMultiplier(stale), 1);
    const v = normalizeVillage({ ...village({ buildings: base, resources: rich }), ranks: stale });
    assert.equal(pointsSpent(v), 0, 'retired ranks are not counted as spent');
    const c = checkRespec(v, 'pikeman', 'might', 0, S1);
    assert.ok(!c.ok && c.reason === 'invalid_input');
    // a live track on the same unit still counts
    const live = { ...v, ranks: { ...v.ranks, pikeman: { might: 3, bulwark: 2, keen: 0, breach: 0 } } };
    assert.equal(rankOf(live.ranks, 'pikeman', 'bulwark'), 2);
    assert.equal(pointsSpent(live), rankPointsUpTo(2));
  });

  it('rankOf clamps and ignores junk values; an unknown ranks object is rank 0', () => {
    assert.equal(rankOf(undefined, 'raider', 'might'), 0);
    assert.equal(rankOf({}, 'raider', 'might'), 0);
    assert.equal(rankOf({ raider: { might: 99, bulwark: 0, keen: 0 } }, 'raider', 'might'), RANK_MAX);
    assert.equal(rankOf({ raider: { might: -2, bulwark: 0, keen: 0 } }, 'raider', 'might'), 0);
    assert.equal(rankOf({ raider: { might: Number.NaN, bulwark: 0, keen: 0 } }, 'raider', 'might'), 0);
  });

  it('ranks saved before Breach existed (no breach key) read as rank 0 and a Breach rank can be bought on top', () => {
    const old = { logram: { might: 0, bulwark: 0, keen: 0 } } as VillageRanks; // no breach key
    assert.equal(rankOf(old, 'logram', 'breach'), 0);
    assert.equal(breachMultiplier(old, 'logram'), 1);
    const v = normalizeVillage({ ...researched(), ranks: old });
    assert.equal(v.ranks?.logram?.breach, 0, 'normalizeVillage fills the key');
    const bought = applyRank({ ...researched(), ranks: old }, 'logram', 'breach', 0, S1);
    assert.equal(bought.ranks?.logram?.breach, 1);
    assert.equal(pointsSpent(bought), rankPointsUpTo(1));
  });

  it('normalizeVillage keeps breach (and the other tracks) of a saved village and drops nothing', () => {
    const ranks: VillageRanks = { logram: { might: 0, bulwark: 0, keen: 0, breach: 3 }, firecart: { might: 0, bulwark: 0, keen: 0, breach: 5 }, raider: { might: 2, bulwark: 0, keen: 0 } };
    const v = normalizeVillage({ ...village({ buildings: base }), ranks });
    assert.equal(v.ranks?.logram?.breach, 3);
    assert.equal(v.ranks?.firecart?.breach, 5);
    assert.equal(v.ranks?.raider?.might, 2);
    assert.equal(v.ranks?.raider?.breach, 0, 'an unranked key is 0, not missing');
    assert.deepEqual(normalizeVillage(v).ranks, v.ranks, 'idempotent');
  });

  it('emptyRanks has every track at 0', () => {
    const e = emptyRanks();
    for (const t of RANK_TRACKS) assert.equal(e[t], 0, t);
  });
});

describe('Breach multiplier', () => {
  it('1 + BREACH_BONUS per rank for a siege unit; 1 for anyone without the track or without ranks', () => {
    const at = (n: number): VillageRanks => ({ logram: { might: 0, bulwark: 0, keen: 0, breach: n }, firecart: { might: 0, bulwark: 0, keen: 0, breach: n } });
    for (let n = 0; n <= RANK_MAX; n++) {
      assert.ok(Math.abs(breachMultiplier(at(n), 'logram') - (1 + BREACH_BONUS * n)) < 1e-12, `logram ${n}`);
      assert.ok(Math.abs(breachMultiplier(at(n), 'firecart') - (1 + BREACH_BONUS * n)) < 1e-12, `firecart ${n}`);
      assert.equal(breachMultiplier(at(n), 'raider'), 1, 'no Breach track, no bonus');
    }
    assert.equal(breachMultiplier(undefined, 'logram'), 1);
    assert.equal(breachMultiplier({}, 'firecart'), 1);
    assert.ok(Math.abs(breachMultiplier(at(RANK_MAX + 3), 'logram') - (1 + BREACH_BONUS * RANK_MAX)) < 1e-12, 'clamped to the top rank');
  });
});

describe('Breach in siege', () => {
  const breach = (u: 'logram' | 'firecart', n: number): VillageRanks => ({ [u]: { might: 0, bulwark: 0, keen: 0, breach: n } });
  const lv = (over: Partial<BuildingLevels> = {}): BuildingLevels => {
    const out = {} as BuildingLevels;
    for (const b of BUILDING_IDS) out[b] = 0;
    return Object.assign(out, over);
  };
  const RAM = UNITS.logram.siege!;
  const CART = UNITS.firecart.siege!;
  /** The smallest count that still drops nothing without ranks at this building level: just below a level threshold. */
  const justBelow = (power: number, level: number, building?: BuildingId): number => Math.ceil(siegePointsNeeded(level, building) / power) - 1;

  it('Log Rams just below a Wall threshold drop nothing without a rank and a level with Breach 5 (resolveSiege)', () => {
    const wall = 8;
    const n = justBelow(RAM.power, wall);
    assert.ok(n >= 1 && n * RAM.power < siegePointsNeeded(wall));
    assert.equal(resolveSiege(units({ logram: n }), lv({ wall }), null)[0]!.to, wall);
    assert.equal(resolveSiege(units({ logram: n }), lv({ wall }), null, undefined, 0, {})[0]!.to, wall, 'empty ranks = no rank');
    const ranked = resolveSiege(units({ logram: n }), lv({ wall }), null, undefined, 0, breach('logram', RANK_MAX));
    assert.ok(n * RAM.power * (1 + BREACH_BONUS * RANK_MAX) >= siegePointsNeeded(wall), 'precondition: the bonus really crosses the threshold');
    assert.equal(ranked[0]!.to, wall - 1);
  });

  it('Breach never lowers the Wall less, at any count (resolveSiege and resolveSiegeDuring), and sometimes lowers it more', () => {
    let better = 0;
    for (const wall of [3, 6, 9, 12]) {
      for (let n = 1; n <= 400; n += 3) {
        const plain = resolveSiege(units({ logram: n }), lv({ wall }), null)[0]!.to;
        const ranked = resolveSiege(units({ logram: n }), lv({ wall }), null, undefined, 0, breach('logram', RANK_MAX))[0]!.to;
        assert.ok(ranked <= plain, `wall ${wall} n ${n}`);
        if (ranked < plain) better++;
        const dPlain = resolveSiegeDuring(units({ logram: n }), wall).wall;
        const dRanked = resolveSiegeDuring(units({ logram: n }), wall, breach('logram', RANK_MAX)).wall;
        assert.ok(dRanked <= dPlain, `during wall ${wall} n ${n}`);
        if (dRanked < dPlain) better++;
      }
    }
    assert.ok(better > 0);
  });

  it('the during-the-battle step uses Breach too (just below a threshold of the during share)', () => {
    const wall = 9;
    const need = siegePointsNeeded(wall);
    const n = Math.ceil(need / (RAM.power * SIEGE_DURING_SHARE)) - 1; // one ram short of dropping a level in the during step
    assert.equal(resolveSiegeDuring(units({ logram: n }), wall).wall, wall);
    const r = resolveSiegeDuring(units({ logram: n }), wall, breach('logram', RANK_MAX));
    assert.equal(r.wall, wall - 1);
    assert.equal(r.dropped.logram, 1);
    assert.equal(r.from.logram, wall);
  });

  it('a Firecart count just below a building threshold burns it with Breach (resolveSiege)', () => {
    const level = 6;
    const n = justBelow(CART.power, level, 'barracks');
    assert.ok(n >= 1);
    assert.equal(resolveSiege(units({ firecart: n }), lv({ barracks: level }), 'barracks')[0]!.to, level);
    assert.equal(resolveSiege(units({ firecart: n }), lv({ barracks: level }), 'barracks', undefined, 0, breach('firecart', RANK_MAX))[0]!.to, level - 1);
  });

  it('Firecarts picking the Wall use Breach after the Log Rams, and Breach of one kind does not boost the other', () => {
    const wall = 8;
    const n = justBelow(CART.power, wall);
    assert.equal(resolveSiege(units({ firecart: n }), lv({ wall }), 'wall')[0]!.to, wall);
    assert.equal(resolveSiege(units({ firecart: n }), lv({ wall }), 'wall', undefined, 0, breach('firecart', RANK_MAX))[0]!.to, wall - 1);
    assert.equal(resolveSiege(units({ firecart: n }), lv({ wall }), 'wall', undefined, 0, breach('logram', RANK_MAX))[0]!.to, wall, 'Log Ram Breach does not help Firecarts');
    const m = justBelow(RAM.power, wall);
    assert.equal(resolveSiege(units({ logram: m }), lv({ wall }), null, undefined, 0, breach('firecart', RANK_MAX))[0]!.to, wall, 'Firecart Breach does not help Log Rams');
  });

  it('ranks on a retired track (Might on a Log Ram) change nothing in siege', () => {
    const wall = 8;
    const n = justBelow(RAM.power, wall);
    const stale: VillageRanks = { logram: { might: RANK_MAX, bulwark: RANK_MAX, keen: RANK_MAX } }; // and no breach key
    assert.equal(resolveSiege(units({ logram: n }), lv({ wall }), null, undefined, 0, stale)[0]!.to, wall);
    assert.equal(resolveSiegeDuring(units({ logram: n }), wall, stale).wall, resolveSiegeDuring(units({ logram: n }), wall).wall);
  });

  describe('in a whole battle (resolveBattle)', () => {
    const target = (over: Partial<BuildingLevels> = {}) => village({ buildings: { wall: 10, hall: 3, market: 4, barracks: 5, ...over }, troops: units({}) });
    const finalWall = (d: ReturnType<typeof target>, input: Parameters<typeof resolveBattle>[0]): { wall: number; won: boolean } => {
      const res = resolveBattle(input);
      return { wall: applyBattleToDefender(d, res).buildings.wall, won: res.attackerWon };
    };

    it('Log Ram Breach 5 lowers the Wall at least as far as no rank at every count, and further at some count', () => {
      const d = target();
      let better = 0;
      for (let n = 1; n <= 120; n++) {
        const attackerUnits = units({ raider: 600, logram: n });
        const plain = finalWall(d, { attackerUnits, defender: d, seed: 5 });
        const ranked = finalWall(d, { attackerUnits, defender: d, seed: 5, attackerRanks: breach('logram', RANK_MAX) });
        assert.ok(plain.won && ranked.won, `n ${n}: the attack wins either way`);
        assert.ok(ranked.wall <= plain.wall, `n ${n}`);
        if (ranked.wall < plain.wall) better++;
      }
      assert.ok(better > 0, 'there is a count where Breach makes the difference');
    });

    it('the battle shows it: a count just below the Wall threshold of the after-step only lowers the Wall with Breach', () => {
      const d = target({ wall: 10 });
      // search (no magic number): the smallest count where Breach 5 ends with a lower Wall than none
      let n = 1;
      const run = (count: number, ranks?: VillageRanks) => finalWall(d, { attackerUnits: units({ raider: 600, logram: count }), defender: d, seed: 5, ...(ranks ? { attackerRanks: ranks } : {}) }).wall;
      while (n <= 400 && run(n, breach('logram', RANK_MAX)) >= run(n)) n++;
      assert.ok(n <= 400, 'found a count');
      assert.ok(run(n, breach('logram', RANK_MAX)) < run(n));
      // the same count one ram fewer: the gap stays non-negative (never worse)
      assert.ok(run(n - 1 || 1, breach('logram', RANK_MAX)) <= run(n - 1 || 1));
    });

    it('wallDuring is lower with Breach for a count where the during step crosses a threshold', () => {
      const d = target({ wall: 10 });
      const during = (count: number, ranks?: VillageRanks): number =>
        resolveBattle({ attackerUnits: units({ raider: 600, logram: count }), defender: d, seed: 5, ...(ranks ? { attackerRanks: ranks } : {}) }).wallDuring;
      let n = 1;
      while (n <= 400 && during(n, breach('logram', RANK_MAX)) >= during(n)) n++;
      assert.ok(n <= 400, 'found a count');
      for (let k = 1; k <= 400; k++) assert.ok(during(k, breach('logram', RANK_MAX)) <= during(k), `k ${k}`);
    });

    it('Firecart Breach 5 burns the picked building at least as far as no rank, and further at some count', () => {
      const d = target({ market: 8 });
      const marketAfter = (count: number, ranks?: VillageRanks): number =>
        applyBattleToDefender(d, resolveBattle({ attackerUnits: units({ raider: 600, firecart: count }), defender: d, seed: 5, siegeTarget: 'market', ...(ranks ? { attackerRanks: ranks } : {}) })).buildings.market;
      let better = 0;
      for (let n = 1; n <= 150; n++) {
        const plain = marketAfter(n);
        const ranked = marketAfter(n, breach('firecart', RANK_MAX));
        assert.ok(ranked <= plain, `n ${n}`);
        if (ranked < plain) better++;
      }
      assert.ok(better > 0);
    });

    it('Firecart Breach on a picked Wall lowers it further, too', () => {
      const d = target({ wall: 10 });
      const wallAfter = (count: number, ranks?: VillageRanks): number =>
        applyBattleToDefender(d, resolveBattle({ attackerUnits: units({ raider: 600, firecart: count }), defender: d, seed: 5, siegeTarget: 'wall', ...(ranks ? { attackerRanks: ranks } : {}) })).buildings.wall;
      let better = 0;
      for (let n = 1; n <= 150; n++) {
        assert.ok(wallAfter(n, breach('firecart', RANK_MAX)) <= wallAfter(n), `n ${n}`);
        if (wallAfter(n, breach('firecart', RANK_MAX)) < wallAfter(n)) better++;
      }
      assert.ok(better > 0);
    });

    it('a lost attack with siege units also counts Breach, and Breach never changes who wins (siege units do not add Might)', () => {
      const d = village({ buildings: { wall: 10, market: 6 }, troops: units({ pikeman: 400 }) });
      for (const count of [40, 80, 160]) {
        const input = { attackerUnits: units({ raider: 50, logram: count, firecart: count }), defender: d, seed: 5, siegeTarget: 'market' as const };
        const plain = resolveBattle(input);
        const ranked = resolveBattle({ ...input, attackerRanks: { ...breach('logram', RANK_MAX), ...breach('firecart', RANK_MAX) } });
        assert.equal(ranked.attackerWon, plain.attackerWon, `count ${count}`);
        assert.equal(ranked.attackPower, plain.attackPower, `count ${count}`);
        assert.ok(applyBattleToDefender(d, ranked).buildings.wall <= applyBattleToDefender(d, plain).buildings.wall);
      }
    });

    it('no ranks and empty ranks give exactly the same siege result', () => {
      const d = target();
      const input = { attackerUnits: units({ raider: 600, logram: 50, firecart: 30 }), defender: d, seed: 9, siegeTarget: 'market' as const };
      assert.deepEqual(resolveBattle(input), resolveBattle({ ...input, attackerRanks: {} }));
    });
  });
});

describe('rank bonuses in battle', () => {
  const attackers: Units = units({ raider: 100 });
  const def = defenderWith({ troops: { pikeman: 50 }, buildings: { wall: 0 } });
  const bulwark5: VillageRanks = { pikeman: { might: 0, bulwark: 5, keen: 0 } };

  it("no ranks gives exactly today's result", () => {
    const a = resolveBattle({ attackerUnits: attackers, defender: def, seed: 7 });
    const b = resolveBattle({ attackerUnits: attackers, defender: def, seed: 7, attackerRanks: {}, defenderRanks: {}, supportRanks: [] });
    assert.deepEqual(a, b);
  });

  it('Might adds 5% attack per rank', () => {
    const ranks: VillageRanks = { raider: { might: 3, bulwark: 0, keen: 0 } };
    const a = resolveBattle({ attackerUnits: attackers, defender: def, seed: 7 });
    const b = resolveBattle({ attackerUnits: attackers, defender: def, seed: 7, attackerRanks: ranks });
    assert.ok(Math.abs(b.attackPower / a.attackPower - (1 + 3 * RANK_BONUS)) < 1e-9);
    assert.equal(b.defensePower, a.defensePower);
  });

  it('Bulwark adds 5% per rank to the village troops, and per contingent to support', () => {
    const support = [units({ pikeman: 50 })];
    const plain = resolveBattle({ attackerUnits: attackers, defender: def, support, seed: 7 });
    const own = resolveBattle({ attackerUnits: attackers, defender: def, support, seed: 7, defenderRanks: bulwark5 });
    const sup = resolveBattle({ attackerUnits: attackers, defender: def, support, seed: 7, supportRanks: [bulwark5] });
    const half = 50 * 14; // infantry attackers: pikeman defence 14 each, per source
    assert.ok(Math.abs(own.defensePower - plain.defensePower - half * 0.25) < 1e-6);
    assert.ok(Math.abs(sup.defensePower - own.defensePower) < 1e-6);
  });
});
