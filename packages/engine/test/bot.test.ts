import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOT_BUILD_WEIGHTS,
  BUILDING_IDS,
  botBuildChoice,
  botIdleMs,
  botStepMs,
  buildingPop,
  checkBuild,
  isOwnerIdle,
  mulberry32,
  populationCap,
  populationUsage,
  type BuildingId,
} from '../src/index.ts';
import { HOUR, S1, S10, deepFreeze, village } from './helpers.ts';

const RICH = { wood: 50000, food: 50000, iron: 50000, gold: 1000 };

describe('caretaker bot choice', () => {
  it('picks only builds the player could queue right now', () => {
    const v = village({ resources: RICH, buildings: { storehouse: 10, farm: 5 } });
    for (let seed = 1; seed <= 100; seed++) {
      const b = botBuildChoice(v, 0, S1, mulberry32(seed));
      assert.ok(b, 'something is affordable');
      assert.equal(checkBuild(v, b, 0, S1).ok, true, `${b} is a legal build`);
    }
  });

  it('is deterministic for a seed and varies across seeds', () => {
    const v = deepFreeze(village({ resources: RICH, buildings: { storehouse: 10, farm: 5 } }));
    const run = (seed: number) => botBuildChoice(v, 0, S1, mulberry32(seed));
    assert.equal(run(7), run(7));
    const seen = new Set<BuildingId | null>();
    for (let seed = 1; seed <= 100; seed++) seen.add(run(seed));
    assert.ok(seen.size > 3, 'different seeds pick different buildings');
  });

  it('never picks troop buildings or the Drillyard (weight 0) and prefers the economy', () => {
    const v = village({ resources: RICH, buildings: { storehouse: 10, farm: 10, hall: 5, barracks: 1 } });
    const counts = new Map<BuildingId, number>();
    for (let seed = 1; seed <= 400; seed++) {
      const b = botBuildChoice(v, 0, S1, mulberry32(seed));
      if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    for (const id of BUILDING_IDS) if (BOT_BUILD_WEIGHTS[id] === 0) assert.equal(counts.get(id) ?? 0, 0, `${id} never chosen`);
    assert.ok((counts.get('lumber') ?? 0) > (counts.get('market') ?? 0), 'weights show');
  });

  it('returns null when nothing is affordable', () => {
    const v = village({ resources: { wood: 0, food: 0, iron: 0, gold: 0 } });
    assert.equal(botBuildChoice(v, 0, S1, mulberry32(1)), null);
  });

  it('returns null when the build queue is full', () => {
    const v = village({ resources: RICH });
    const queued = { ...v, buildQueue: [
      { building: 'lumber' as const, targetLevel: 2, startAt: 0, finishAt: 10 * HOUR },
      { building: 'mine' as const, targetLevel: 2, startAt: 10 * HOUR, finishAt: 20 * HOUR },
    ] };
    assert.equal(botBuildChoice(queued, 0, S1, mulberry32(1)), null);
  });

  it('respects the population cap: with no room only pop-free upgrades remain', () => {
    const v = village({ resources: RICH, buildings: { storehouse: 10 }, troops: { pikeman: 100000 } });
    assert.ok(populationUsage(v).total >= populationCap(v), 'village is over its cap');
    for (let seed = 1; seed <= 60; seed++) {
      const b = botBuildChoice(v, 0, S1, mulberry32(seed));
      if (b === null) continue;
      assert.equal(buildingPop(b, v.buildings[b] + 1) - buildingPop(b, v.buildings[b]), 0, `${b} costs no population`);
    }
  });

  it('does not mutate its input and reads settled resources (production while away counts)', () => {
    const v = deepFreeze(village({ resources: { wood: 0, food: 0, iron: 0, gold: 0 }, buildings: { storehouse: 5 } }));
    assert.equal(botBuildChoice(v, 0, S1, mulberry32(1)), null);
    assert.notEqual(botBuildChoice(v, 24 * HOUR, S1, mulberry32(1)), null);
  });
});

describe('caretaker timing', () => {
  it('idle threshold and step scale with world speed', () => {
    assert.equal(botIdleMs(S1), 3 * 24 * HOUR);
    assert.equal(botIdleMs(S10), (3 * 24 * HOUR) / 10);
    assert.ok(botStepMs(S10) < botStepMs(S1));
    assert.equal(isOwnerIdle(0, botIdleMs(S1) - 1, S1), false);
    assert.equal(isOwnerIdle(0, botIdleMs(S1), S1), true);
  });
});
