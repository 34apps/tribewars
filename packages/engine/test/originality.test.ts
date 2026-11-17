// The originality pass (2026-11-11): the Longhouse takes the population room from the Farm, the Wrightyard trains the Firecart on its own
// queue, and saved worlds are migrated (Longhouse = Farm, Log Rams and Boulder Slings -> Firecarts, refunds, a free Wrightyard).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BUILDINGS,
  MAX_TRAIN_QUEUE,
  TRAINING_BUILDING_IDS,
  TRAIN_TIME_FACTOR,
  UNITS,
  applyTrain,
  buildingCost,
  buildingPop,
  checkBuild,
  checkTrain,
  convertReportBody,
  convertSiegeRanks,
  createNpcVillage,
  firecartsFor,
  migrateVillageOriginality,
  popCapForLevel,
  populationCap,
  populationUsage,
  settleVillage,
  storageCap,
  trainTimeMs,
} from '../src/index.ts';
import type { VillageState } from '../src/index.ts';
import { S1, village } from './helpers.ts';

const rich = (buildings: Partial<VillageState['buildings']> = {}, researched: VillageState['researched'] = []): VillageState => {
  const base = village({ buildings: { storehouse: 25, longhouse: 25, ...buildings } });
  const cap = storageCap(base);
  return { ...base, researched, resources: { wood: cap, food: cap, iron: cap, gold: cap } };
};

describe('Longhouse', () => {
  it('has the Farm\'s cost and time, starts at 1, needs nothing, tops out at 25 and uses no room', () => {
    const l = BUILDINGS.longhouse;
    const f = BUILDINGS.farm;
    assert.deepEqual([l.startLevel, l.maxLevel, l.requires], [1, 25, {}]);
    assert.deepEqual([l.baseCost, l.costGrowth, l.baseTimeSec, l.timeGrowth], [f.baseCost, f.costGrowth, f.baseTimeSec, f.timeGrowth]);
    assert.deepEqual(buildingCost('longhouse', 7), buildingCost('farm', 7));
    for (const level of [1, 10, 25]) assert.equal(buildingPop('longhouse', level), 0);
  });

  it('the room curve is the old Farm curve: about 12,000 at level 25', () => {
    assert.ok(popCapForLevel(25) > 11_000 && popCapForLevel(25) < 13_000, String(popCapForLevel(25)));
  });

  it('the Longhouse sets the cap and the Farm no longer does', () => {
    const base = village({ buildings: { longhouse: 5, farm: 5 } });
    assert.equal(populationCap(base), popCapForLevel(5));
    assert.equal(populationCap(village({ buildings: { longhouse: 5, farm: 20 } })), popCapForLevel(5));
    assert.equal(populationCap(village({ buildings: { longhouse: 9, farm: 1 } })), popCapForLevel(9));
  });

  it('the Farm uses population like the Lumber Camp; the Longhouse does not', () => {
    assert.equal(buildingPop('farm', 6), buildingPop('lumber', 6));
    const a = populationUsage(village({ buildings: { farm: 1 } })).buildings;
    const b = populationUsage(village({ buildings: { farm: 6 } })).buildings;
    const c = populationUsage(village({ buildings: { longhouse: 6 } })).buildings;
    assert.ok(b > a);
    assert.ok(c <= populationUsage(village({ buildings: { longhouse: 1 } })).buildings);
  });

  it('an abandoned village\'s Longhouse equals its Farm, also after the Farm grows', () => {
    for (let tier = 1; tier <= 5; tier++) {
      const v = createNpcVillage(tier, 0);
      assert.equal(v.buildings.longhouse, v.buildings.farm, `tier ${tier}`);
    }
    const v = createNpcVillage(2, 0);
    v.buildQueue.push({ building: 'farm', targetLevel: v.buildings.farm + 1, startAt: 0, finishAt: 1000 });
    const settled = settleVillage(v, 5000, { ...S1, config: undefined } as never);
    assert.equal(settled.buildings.longhouse, settled.buildings.farm);
  });
});

describe('Wrightyard', () => {
  it('is a training building with its own queue, max 12, needs Barracks 5, and costs like the Stables', () => {
    assert.ok((TRAINING_BUILDING_IDS as readonly string[]).includes('wrightyard'));
    assert.deepEqual([BUILDINGS.wrightyard.maxLevel, BUILDINGS.wrightyard.requires], [12, { barracks: 5 }]);
    assert.equal(BUILDINGS.wrightyard.costGrowth, BUILDINGS.stables.costGrowth);
    assert.deepEqual(village().trainQueues.wrightyard, []);
    const low = checkBuild(rich({ barracks: 4, hall: 10 }), 'wrightyard', 0, S1);
    assert.ok(!low.ok && low.reason === 'requirements_not_met');
    assert.ok(checkBuild(rich({ barracks: 5, hall: 10 }), 'wrightyard', 0, S1).ok);
  });

  it('the Firecart trains there (needs Wrightyard 1 and the Drillyard research), never at the Barracks', () => {
    assert.equal(UNITS.firecart.building, 'wrightyard');
    const noYard = checkTrain(rich({ barracks: 10 }, ['firecart']), 'firecart', 1, 0, S1);
    assert.ok(!noYard.ok && noYard.reason === 'requirements_not_met' && /Wrightyard/.test(noYard.message));
    const notResearched = checkTrain(rich({ barracks: 10, wrightyard: 1 }), 'firecart', 1, 0, S1);
    assert.ok(!notResearched.ok && /researched/.test(notResearched.message));
    const v = applyTrain(rich({ barracks: 10, wrightyard: 1 }, ['firecart']), 'firecart', 3, 0, S1);
    assert.equal(v.trainQueues.wrightyard.length, 1);
    assert.equal(v.trainQueues.barracks.length, 0);
    assert.equal(v.trainQueues.wrightyard[0]!.unit, 'firecart');
  });

  it('has its own queue: a full Barracks queue does not block it, and its time shrinks x0.94 per level', () => {
    let v = rich({ barracks: 10, wrightyard: 1 }, ['firecart']);
    for (let i = 0; i < MAX_TRAIN_QUEUE; i++) v = applyTrain(v, 'pikeman', 1, 0, S1);
    assert.equal(v.trainQueues.barracks.length, MAX_TRAIN_QUEUE);
    assert.ok(checkTrain(v, 'firecart', 1, 0, S1).ok);
    const l1 = trainTimeMs('firecart', rich({ wrightyard: 1 }), S1);
    const l5 = trainTimeMs('firecart', rich({ wrightyard: 5 }), S1);
    assert.equal(l5, Math.round(l1 * TRAIN_TIME_FACTOR ** 4));
    assert.equal(l1, UNITS.firecart.trainTimeSec * 1000);
  });

  it('finished Firecarts arrive in the troops', () => {
    const v = applyTrain(rich({ barracks: 10, wrightyard: 1 }, ['firecart']), 'firecart', 2, 0, S1);
    const done = settleVillage(v, 3 * UNITS.firecart.trainTimeSec * 1000, S1);
    assert.equal(done.troops.firecart, 2);
    assert.equal(done.trainQueues.wrightyard.length, 0);
  });
});

/** A village as an old world saved it: Log Rams and Boulder Slings, Farm room, no Longhouse or Wrightyard. */
function oldVillage(over: Record<string, unknown> = {}): Record<string, any> {
  const base = village({ buildings: { farm: 9, barracks: 6, storehouse: 10 }, resources: { wood: 100, food: 100, iron: 100, gold: 0 } }) as unknown as Record<string, any>;
  delete base.buildings.longhouse;
  delete base.buildings.wrightyard;
  delete base.trainQueues.wrightyard;
  base.troops = { ...base.troops, pikeman: 5, logram: 7, boulder: 4 };
  base.away = { ...base.away, logram: 2, boulder: 1 };
  return Object.assign(base, over);
}

describe('migration of a saved world', () => {
  it('Firecarts replace Log Rams and Boulder Slings by population: floor((3 rams + 2 slings) / 3)', () => {
    assert.equal(firecartsFor(7, 4), Math.floor((21 + 8) / 3));
    assert.equal(firecartsFor(0, 0), 0);
    assert.equal(firecartsFor(1, 1), 1);
    assert.equal(firecartsFor(0, 1), 0);
    const v = migrateVillageOriginality(oldVillage(), 3);
    assert.equal(v.troops.firecart, 9);
    assert.equal(v.away.firecart, 3); // the server's own sum of marching and standing troops
    assert.equal((v.troops as Record<string, unknown>).logram, undefined);
    assert.equal((v.troops as Record<string, unknown>).boulder, undefined);
    assert.equal(v.troops.pikeman, 5);
  });

  it('Longhouse = the Farm level, and a queued Farm level still finishes as a Farm', () => {
    const old = oldVillage({ buildQueue: [{ building: 'farm', targetLevel: 10, startAt: 0, finishAt: 5000 }] });
    const v = migrateVillageOriginality(old);
    assert.equal(v.buildings.longhouse, 9);
    assert.equal(v.buildQueue[0]!.building, 'farm');
    const done = settleVillage(v, 10_000, S1);
    assert.equal(done.buildings.farm, 10);
    assert.equal(done.buildings.longhouse, 9);
    assert.equal(populationCap(v), popCapForLevel(9)); // nobody loses room
  });

  it('a village with Barracks 5+ gets Wrightyard 1 free; a lower one does not', () => {
    assert.equal(migrateVillageOriginality(oldVillage()).buildings.wrightyard, 1);
    const low = oldVillage();
    low.buildings.barracks = 4;
    assert.equal(migrateVillageOriginality(low).buildings.wrightyard, 0);
    assert.deepEqual(migrateVillageOriginality(oldVillage()).trainQueues.wrightyard, []);
  });

  it('queued siege batches and siege research are refunded (capped at storage) and leave the queues', () => {
    const old = oldVillage({
      trainQueues: {
        barracks: [
          { unit: 'pikeman', count: 5, done: 0, perUnitMs: 1000, startAt: 0 },
          { unit: 'logram', count: 10, done: 4, perUnitMs: 5000, startAt: 5000 },
          { unit: 'boulder', count: 3, done: 0, perUnitMs: 5000, startAt: 35_000 },
          { unit: 'raider', count: 2, done: 0, perUnitMs: 1000, startAt: 50_000 },
        ],
        stables: [],
        bannerhall: [],
      },
      researchQueue: [
        { unit: 'logram', startAt: 0, finishAt: 1000 },
        { unit: 'boulder', startAt: 1000, finishAt: 3000 },
      ],
      researched: [],
    });
    const v = migrateVillageOriginality(old);
    assert.deepEqual(v.trainQueues.barracks.map((j) => j.unit), ['pikeman', 'raider']);
    assert.equal(v.researchQueue, undefined);
    // 6 untrained rams (95/120/100/2) + 3 slings (75/130/120/7) + both researches (400+700 / 300+500 / 500+900 / 10+40), from 100 each.
    assert.equal(v.resources.wood, 100 + 6 * 95 + 3 * 75 + 400 + 700);
    assert.equal(v.resources.food, 100 + 6 * 120 + 3 * 130 + 300 + 500);
    assert.equal(v.resources.iron, 100 + 6 * 100 + 3 * 120 + 500 + 900);
    assert.equal(v.resources.gold, 6 * 2 + 3 * 7 + 10 + 40);
    // the batch behind the removed ones never starts earlier than the unfinished rest of the one before
    assert.ok(v.trainQueues.barracks[1]!.startAt >= v.trainQueues.barracks[0]!.startAt + 5 * 1000);
  });

  it('the refund never goes above the storehouse', () => {
    const old = oldVillage({ researchQueue: [{ unit: 'boulder', startAt: 0, finishAt: 1000 }] });
    old.buildings.storehouse = 1;
    const cap = storageCap(old as VillageState);
    old.resources = { wood: 100, food: 100, iron: cap - 10, gold: 0 };
    const v = migrateVillageOriginality(old);
    assert.equal(v.resources.iron, cap);
    assert.ok(v.resources.wood <= cap);
  });

  it('researched siege counts as the Firecart researched; it is safe to run twice', () => {
    const v = migrateVillageOriginality(oldVillage({ researched: ['logram', 'guard'] }));
    assert.deepEqual([...v.researched!].sort(), ['firecart', 'guard']);
    const again = migrateVillageOriginality(v);
    assert.deepEqual(again, v);
  });

  it('a batch behind a refunded one never gets a start time before the village was last settled', () => {
    const old = oldVillage({
      lastUpdate: 1_000_000,
      trainQueues: {
        barracks: [
          { unit: 'logram', count: 10, done: 0, perUnitMs: 5000, startAt: 1000 },
          { unit: 'raider', count: 2, done: 0, perUnitMs: 1000, startAt: 51_000 },
        ],
        stables: [],
        bannerhall: [],
      },
    });
    const v = migrateVillageOriginality(old);
    assert.deepEqual(v.trainQueues.barracks.map((j) => j.unit), ['raider']);
    assert.ok(v.trainQueues.barracks[0]!.startAt >= 1_000_000, 'clamped to lastUpdate, not in the past');
  });

  it('old report bodies: unit maps and siege hits are converted, a new body is untouched, twice is the same', () => {
    const old = {
      type: 'battle',
      attackerUnits: { pikeman: 1, logram: 190, boulder: 2 },
      attackerLosses: { logram: 3 },
      defenderUnits: null,
      supportLosses: { boulder: 3 },
      siege: [{ unit: 'logram', building: 'wall', from: 20, to: 17 }, { unit: 'firecart', building: 'farm', from: 3, to: 2 }],
    };
    const once = convertReportBody(old) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(once.attackerUnits.firecart, Math.floor((3 * 190 + 2 * 2) / 3));
    assert.equal(once.attackerUnits.logram, undefined);
    assert.equal(once.attackerUnits.pikeman, 1);
    assert.equal(once.attackerLosses.firecart, 3);
    assert.equal(once.supportLosses.firecart, 2);
    assert.equal(once.defenderUnits, null);
    assert.deepEqual(once.siege.map((h: { unit: string }) => h.unit), ['firecart', 'firecart']);
    assert.deepEqual(convertReportBody(once), once);
    const scout: Record<string, any> = convertReportBody({ type: 'scout', intel: { troops: { logram: 3 } } });
    assert.equal(scout.intel.troops.firecart, 3);
  });

  it('old rank entries fold into the Firecart (higher of the two), old keys removed', () => {
    const r = convertSiegeRanks({ logram: { attack: 2, defense: 1 }, boulder: { attack: 1, defense: 3 }, pikeman: { attack: 4, defense: 4 } });
    assert.deepEqual(r.firecart, { attack: 2, defense: 3 });
    assert.equal(r.logram, undefined);
    assert.equal(r.boulder, undefined);
    assert.deepEqual(r.pikeman, { attack: 4, defense: 4 });
    assert.deepEqual(convertSiegeRanks(r), r);
  });
});
