import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NPC_TIER_WEIGHTS,
  abandonVillageKeepBuildings,
  applyBuild,
  applyTrain,
  checkStrike,
  createNpcVillage,
  normalizeVillage,
  rankOf,
  resolveBattle,
  settleVillage,
  storageCap,
  villagePoints,
} from '../src/index.ts';
import type { VillageState } from '../src/index.ts';
import { HOUR, S1, deepFreeze, units, village } from './helpers.ts';

const NOW = 100 * HOUR;
const built = (hall: number): VillageState =>
  village({
    buildings: { hall, wall: 6, farm: 8, storehouse: 4, barracks: 3, bannerhall: 2, market: 5 },
    resources: { wood: 99_999, food: 500, iron: 700, gold: 12 },
    troops: { raider: 40, pikeman: 3 },
    away: { outrider: 5 },
  });

describe('abandonVillageKeepBuildings', () => {
  it('keeps every building level and the points', () => {
    const p = built(8);
    const a = abandonVillageKeepBuildings(p, NOW, S1, 4242);
    assert.deepEqual(a.buildings, p.buildings);
    assert.equal(villagePoints(a), villagePoints(p));
  });

  it('npc tier comes from the Town Hall level, clamped 1..5; fresh growth clock and seed', () => {
    const tiers = [1, 2, 3, 4, 5, 6, 12, 20].map((h) => abandonVillageKeepBuildings(built(h), NOW, S1, 7).npc?.tier);
    assert.deepEqual(tiers, [1, 2, 3, 4, 5, NPC_TIER_WEIGHTS.length, NPC_TIER_WEIGHTS.length, NPC_TIER_WEIGHTS.length]);
    const a = abandonVillageKeepBuildings(built(3), NOW, S1, -1);
    assert.equal(a.npc?.growthSteps, 0);
    assert.equal(a.npc?.createdAt, NOW);
    assert.equal(a.npc?.growthSeed, -1 >>> 0);
  });

  it('the troops standing at home stay exactly as they are (nothing added), away units are gone, returning ones join, Chieftains are used up', () => {
    const p = built(8);
    p.troops = { ...p.troops, chieftain: 1 };
    const a = abandonVillageKeepBuildings(p, NOW, S1, 1);
    assert.equal(a.troops.raider, 40);
    assert.equal(a.troops.pikeman, 3);
    assert.equal(a.troops.guard, 0, 'nothing added');
    assert.equal(a.troops.chieftain, 0);
    assert.deepEqual(a.away, units({}));
    const back = abandonVillageKeepBuildings(p, NOW, S1, 1, { raider: 5, outrider: 2 });
    assert.equal(back.troops.raider, 45);
    assert.equal(back.troops.outrider, 2);
  });

  it('a village with no troops stays empty and keeps its Drillyard ranks; nothing refills over time', () => {
    const p = built(8);
    p.troops = units({});
    p.ranks = { raider: { might: 1, bulwark: 0, keen: 0 } };
    const a = abandonVillageKeepBuildings(p, NOW, S1, 1);
    assert.deepEqual(a.troops, units({}));
    assert.equal(rankOf(a.ranks, 'raider', 'might'), 1);
    assert.deepEqual(a.ranks, normalizeVillage(p).ranks, 'the ranks stay as they were');
    assert.deepEqual(settleVillage(a, NOW + 500 * HOUR, S1).troops, units({}));
  });

  it('keeps the stock, clamped to the storehouse; clears queues and research', () => {
    let p = built(8);
    p = applyBuild(p, 'lumber', 0, S1);
    p = applyTrain({ ...p, resources: { wood: 99_999, food: 5000, iron: 5000, gold: 12 } }, 'raider', 2, 0, S1);
    p.researched = ['guard'];
    p.feast = { windowStart: 0, count: 2 };
    p.protectedUntil = NOW * 2;
    const a = abandonVillageKeepBuildings({ ...p, resources: { wood: 99_999, food: 50, iron: 700, gold: 12 } }, NOW, S1, 1);
    assert.equal(a.resources.wood, storageCap(a));
    assert.ok(a.resources.iron >= 700, 'stock is kept (and it produced while the owner was away)');
    assert.deepEqual(a.buildQueue, []);
    assert.deepEqual(a.trainQueues, { barracks: [], stables: [], wrightyard: [], bannerhall: [] });
    assert.deepEqual([a.ranks, a.researched, a.researchQueue, a.feast, a.defenceMark, a.hearth, a.lockUntil, a.protectedUntil], new Array(8).fill(undefined));
  });

  it('builds that finish before now are counted first; renownPaid follows the levels', () => {
    let p = built(8);
    p = applyBuild(p, 'lumber', 0, S1);
    const lumber = p.buildings.lumber;
    const a = abandonVillageKeepBuildings(p, NOW, S1, 1); // the job (a few minutes) is long done by NOW
    assert.equal(a.buildings.lumber, lumber + 1);
    assert.deepEqual(a.renownPaid, a.buildings);
  });

  it('afterwards it is a normal abandoned village: grows, can be raided and struck', () => {
    const a = abandonVillageKeepBuildings(built(8), NOW, S1, 11);
    const later = settleVillage(a, NOW + 6 * HOUR, S1);
    assert.ok((later.npc?.growthSteps ?? 0) >= 1, 'it started building from its own stock');
    assert.equal(later.buildQueue.length + Object.values(later.buildings).reduce((x, y) => x + y, 0) > Object.values(a.buildings).reduce((x, y) => x + y, 0), true);
    const battle = resolveBattle({ attackerUnits: units({ raider: 500, chieftain: 1 }), defender: a, seed: 1 });
    assert.equal(battle.attackerWon, true);
    assert.ok(checkStrike(battle, battle.attackerSurvivors, { abandoned: true, points: villagePoints(a), now: NOW }).ok);
  });

  it('does not change its input', () => {
    const p = deepFreeze(built(5));
    abandonVillageKeepBuildings(p, NOW, S1, 1);
    assert.equal(p.troops.raider, 40);
  });

  it('an abandoned village has no Wall militia (a raid loses nothing at any Wall level); a village with an owner keeps it; the Wall bonus still counts for troops that stand there', () => {
    const raid = { attackerUnits: units({ raider: 5 }), seed: 3 };
    for (const wall of [0, 7, 22]) {
      const npc = createNpcVillage(5, 0);
      npc.buildings.wall = wall;
      const r = resolveBattle({ ...raid, defender: npc }, S1);
      assert.ok(r.attackerWon);
      assert.equal(r.defensePower, 0);
      assert.equal(r.attackerLosses.raider, 0, `Wall ${wall}`);
      const owned = village({ buildings: { wall }, troops: {} });
      assert.ok(resolveBattle({ ...raid, defender: owned }, S1).defensePower > 0, 'owned village: militia');
    }
    const left = abandonVillageKeepBuildings(village({ buildings: { hall: 8, wall: 10 }, troops: { pikeman: 200 } }), NOW, S1, 1);
    const plain = { ...left, buildings: { ...left.buildings, wall: 0 } };
    const behind = resolveBattle({ ...raid, defender: left }, S1).defensePower;
    const open = resolveBattle({ ...raid, defender: plain }, S1).defensePower;
    assert.ok(open > 0 && Math.abs(behind / open - 1.45) < 0.01, 'Wall 10 = +45% on the left-behind troops, and no flat militia');
  });
});
