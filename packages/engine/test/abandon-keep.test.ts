import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NPC_GARRISON_PER_HALL,
  NPC_TIER_WEIGHTS,
  abandonVillageKeepBuildings,
  applyBuild,
  applyTrain,
  checkStrike,
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
    resources: { wood: 99_999, food: 50, iron: 700, gold: 12 },
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

  it('the owner\'s troops are gone: the garrison is the full abandoned garrison for the Town Hall level', () => {
    const a = abandonVillageKeepBuildings(built(8), NOW, S1, 1);
    assert.equal(a.troops.pikeman, (NPC_GARRISON_PER_HALL.pikeman ?? 0) * 8);
    assert.equal(a.troops.guard, (NPC_GARRISON_PER_HALL.guard ?? 0) * 8);
    assert.equal(a.troops.raider, 0);
    assert.deepEqual(a.away, units({}));
  });

  it('keeps the stock, clamped to the storehouse; clears queues, ranks and research', () => {
    let p = built(8);
    p = applyBuild(p, 'lumber', 0, S1);
    p = applyTrain({ ...p, resources: { wood: 99_999, food: 5000, iron: 5000, gold: 12 } }, 'raider', 2, 0, S1);
    p.ranks = { raider: { might: 1, bulwark: 0, keen: 0 } };
    p.researched = ['guard'];
    p.feast = { windowStart: 0, count: 2 };
    p.protectedUntil = NOW * 2;
    const a = abandonVillageKeepBuildings({ ...p, resources: { wood: 99_999, food: 50, iron: 700, gold: 12 } }, NOW, S1, 1);
    assert.equal(a.resources.wood, storageCap(a));
    assert.ok(a.resources.iron >= 700, 'stock is kept (and it produced while the owner was away)');
    assert.deepEqual(a.buildQueue, []);
    assert.deepEqual(a.trainQueues, { barracks: [], stables: [], bannerhall: [] });
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
});
