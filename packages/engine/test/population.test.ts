import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyBuild,
  buildingPop,
  checkBuild,
  checkTrain,
  popCapForLevel,
  populationCap,
  populationUsage,
} from '../src/index.ts';
import { S1, village } from './helpers.ts';

const RICH = { wood: 50000, food: 50000, iron: 50000, gold: 1000 };
const LEVELS = { barracks: 1, storehouse: 10, farm: 19 };

describe('population', () => {
  it('building population grows with level, the Farm takes none, the cap grows with the Farm', () => {
    assert.equal(buildingPop('hall', 0), 0);
    assert.ok(buildingPop('hall', 5) > buildingPop('hall', 1));
    assert.equal(buildingPop('farm', 10), 0);
    assert.ok(popCapForLevel(5) > popCapForLevel(1));
    assert.ok(popCapForLevel(1) > popCapForLevel(0));
  });

  it('counts buildings (including queued levels) and troops at home and away', () => {
    const base = village({ buildings: LEVELS, resources: RICH });
    const before = populationUsage(base);
    const queued = applyBuild(base, 'lumber', 0, S1);
    const lumber = base.buildings.lumber;
    assert.equal(populationUsage(queued).buildings, before.buildings + (buildingPop('lumber', lumber + 1) - buildingPop('lumber', lumber)));
    const withTroops = village({ buildings: LEVELS, troops: { pikeman: 10 }, away: { outrider: 2 }, resources: RICH });
    assert.equal(populationUsage(withTroops).troops, 10 + 2 * 3);
  });

  it('refuses training and building that would go over the cap, but never the Farm', () => {
    const probe = village({ buildings: LEVELS, resources: RICH });
    const room = populationCap(probe) - populationUsage(probe).total;
    const full = village({ buildings: LEVELS, troops: { pikeman: room }, resources: RICH });
    assert.equal(populationUsage(full).total, populationCap(full));
    const t = checkTrain(full, 'pikeman', 1, 0, S1);
    assert.ok(!t.ok && t.reason === 'population_full');
    const b = checkBuild(full, 'lumber', 0, S1);
    assert.ok(!b.ok && b.reason === 'population_full');
    assert.ok(checkBuild(full, 'farm', 0, S1).ok);

    const almost = village({ buildings: LEVELS, troops: { pikeman: room - 1 }, resources: RICH });
    const fits = checkTrain(almost, 'pikeman', 1, 0, S1);
    assert.ok(fits.ok || fits.reason !== 'population_full');
    const over = checkTrain(almost, 'pikeman', 2, 0, S1);
    assert.ok(!over.ok && over.reason === 'population_full');
  });
});
