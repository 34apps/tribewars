import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyAttackerLosses,
  applyBattleToDefender,
  applyBuild,
  applyReturn,
  applySend,
  applyTrain,
  checkBuild,
  checkMission,
  checkSend,
  cloneVillage,
  checkTrain,
  createNpcVillage,
  normalizeUnits,
  normalizeVillage,
  productionPerHour,
  resolveBattle,
  resolveScouting,
  settleVillage,
  trainTimeMs,
  villagePoints,
} from '../src/index.ts';
import { HOUR, S1, deepFreeze, units, village } from './helpers.ts';

// Every input is deep-frozen: any mutation throws a TypeError in strict mode (ES modules).
describe('inputs are never mutated', () => {
  const base = () => {
    const v = village({ buildings: { barracks: 1, storehouse: 5 }, troops: { raider: 10, pikeman: 4 }, away: { raider: 5 } });
    const withQueues = applyTrain(applyBuild(v, 'lumber', 0, S1), 'pikeman', 3, 0, S1);
    return deepFreeze(withQueues);
  };

  it('village actions and settlement', () => {
    const v = base();
    const snapshot = structuredClone(v);
    for (const t of [0, 1000, 90_000, 5 * HOUR]) {
      settleVillage(v, t, S1);
      checkBuild(v, 'farm', t, S1);
      checkTrain(v, 'pikeman', 2, t, S1);
      trainTimeMs('pikeman', v, S1);
      productionPerHour(v, S1);
      villagePoints(v);
    }
    applyBuild(v, 'farm', 200_000, S1);
    applyTrain(v, 'pikeman', 2, 200_000, S1);
    applySend(v, { raider: 2 }, 200_000, S1);
    checkSend(v, deepFreeze({ raider: 2 }));
    applyReturn(v, deepFreeze(units({ raider: 2 })), deepFreeze({ wood: 5, food: 5, iron: 5, gold: 5 }), 3 * HOUR, S1);
    applyAttackerLosses(v, deepFreeze(units({ raider: 2 })));
    assert.deepEqual(v, snapshot);
  });

  it('battle and its effects', () => {
    const npc = deepFreeze(createNpcVillage(3, 0));
    const attackers = deepFreeze(units({ raider: 60, outrider: 5 }));
    const result = deepFreeze(resolveBattle({ attackerUnits: attackers, defender: npc, seed: 42 }));
    applyBattleToDefender(npc, result);
    settleVillage(npc, 100 * HOUR, S1);
    assert.deepEqual(npc, createNpcVillage(3, 0));
  });

  it('battle with support contingents', () => {
    const host = deepFreeze(village({ troops: { pikeman: 10 }, buildings: { wall: 3 } }));
    const support = deepFreeze([units({ pikeman: 20 }), units({ guard: 5, pathfinder: 1 })]);
    const attackers = deepFreeze(units({ raider: 40 }));
    const result = resolveBattle({ attackerUnits: attackers, defender: host, support, seed: 3 });
    deepFreeze(result);
    applyBattleToDefender(host, result);
    for (const losses of result.supportLosses) applyAttackerLosses(village({ away: { pikeman: 20, guard: 5 } }), losses);
    assert.notEqual(result.supportLosses[0], support[0]);
    assert.equal(support[0]?.pikeman, 20);
  });

  it('scouting, missions and normalisation', () => {
    const input = deepFreeze({ scouts: 5, defenderScouts: 2 });
    assert.deepEqual(resolveScouting(input), resolveScouting(input));
    checkMission('scout', deepFreeze(units({ pathfinder: 2 })));
    checkMission('attack', deepFreeze(units({ raider: 2 })));
    const v = base();
    const snapshot = structuredClone(v);
    normalizeVillage(v);
    cloneVillage(v);
    normalizeUnits(v.troops);
    assert.deepEqual(v, snapshot);
  });

  it('returned states are fresh objects', () => {
    const v = base();
    const out = settleVillage(v, 0, S1);
    assert.notEqual(out, v);
    assert.notEqual(out.resources, v.resources);
    assert.notEqual(out.buildQueue, v.buildQueue);
    assert.notEqual(out.trainQueues.barracks, v.trainQueues.barracks);
    const next = applySend(v, { raider: 1 }, 10, S1);
    assert.notEqual(next.troops, v.troops);
  });
});
