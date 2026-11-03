import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DRILLYARD_POINTS_PER_LEVEL,
  GameError,
  RANK_BONUS,
  RANK_MAX,
  UNITS,
  applyRank,
  applyResearch,
  applyRespec,
  applyTrain,
  checkRank,
  checkResearch,
  checkTrain,
  normalizeVillage,
  pointsSpent,
  pointsTotal,
  resolveBattle,
  settleVillage,
} from '../src/index.ts';
import type { Units, VillageRanks } from '../src/index.ts';
import { HOUR, S1, S10, defenderWith, units, village } from './helpers.ts';

const rich = { wood: 1e6, food: 1e6, iron: 1e6, gold: 1e6 };
const base = { hall: 10, barracks: 5, stables: 5, storehouse: 20, farm: 20, drillyard: 10 };
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
    normalizeVillage(village({ buildings: base, resources: rich, troops: { raider: 1, pikeman: 1, guard: 1, outrider: 1, knight: 1, pathfinder: 1 } }));

  it('points: 3 per Drillyard level, rank r costs r', () => {
    let v = researched();
    assert.equal(pointsTotal(v), 10 * DRILLYARD_POINTS_PER_LEVEL);
    v = applyRank(v, 'raider', 'might', 0, S1);
    v = applyRank(v, 'raider', 'might', 0, S1);
    assert.equal(v.ranks?.raider?.might, 2);
    assert.equal(pointsSpent(v), 3);
  });

  it('maxing everything is impossible', () => {
    let v = researched();
    const tracks = [
      ['raider', 'might'], ['raider', 'bulwark'], ['pikeman', 'might'],
      ['pikeman', 'bulwark'], ['knight', 'might'], ['pathfinder', 'keen'],
    ] as const;
    for (const [u, t] of tracks) {
      for (let i = 0; i < RANK_MAX; i++) {
        if (!checkRank(v, u, t, 0, S1).ok) break;
        v = applyRank(v, u, t, 0, S1);
      }
    }
    assert.ok(pointsSpent(v) <= pointsTotal(v));
    const open = tracks.filter(([u, t]) => (v.ranks?.[u]?.[t] ?? 0) < RANK_MAX);
    assert.ok(open.length > 0);
    const last = open[0];
    if (last) expectGameError(() => applyRank(v, last[0], last[1], 0, S1), 'requirements_not_met');
  });

  it('rules: Keen only pathfinder, Might not pathfinder, unresearched refused', () => {
    const v = researched();
    assert.equal(checkRank(v, 'raider', 'keen', 0, S1).ok, false);
    assert.equal(checkRank(v, 'pathfinder', 'might', 0, S1).ok, false);
    assert.equal(checkRank(v, 'pathfinder', 'keen', 0, S1).ok, true);
    const fresh = village({ buildings: base, resources: rich });
    assert.equal(checkRank(fresh, 'guard', 'bulwark', 0, S1).ok, false);
    assert.equal(checkRank(fresh, 'raider', 'nonsense', 0, S1).ok, false);
  });

  it('respec refunds the points and costs no gold', () => {
    let v = researched();
    v = applyRank(applyRank(v, 'raider', 'might', 0, S1), 'raider', 'might', 0, S1);
    const gold = v.resources.gold;
    const r = applyRespec(v, 'raider', 'might', 0, S1);
    assert.equal(pointsSpent(r), 0);
    assert.equal(r.resources.gold, gold);
    expectGameError(() => applyRespec(r, 'raider', 'might', 0, S1), 'invalid_input');
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
    const half = 50 * 15; // infantry attackers: pikeman defence 15 each, per source
    assert.ok(Math.abs(own.defensePower - plain.defensePower - half * 0.25) < 1e-6);
    assert.ok(Math.abs(sup.defensePower - own.defensePower) < 1e-6);
  });
});
