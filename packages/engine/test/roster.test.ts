// The troop roster (originality piece 5): own stat lines, the Elk Rider as the only rider, the Ember Guard on foot at the Barracks.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UNITS, POP_PER_UNIT, UNIT_TERRAIN_FAMILY, applyTrain, armySpeed, checkTrain, normalizeVillage, resolveBattle } from '../src/index.ts';
import type { UnitId, VillageState } from '../src/index.ts';
import { S1, units, village } from './helpers.ts';

const line = (u: UnitId): string => `${UNITS[u].attack}/${UNITS[u].defenseInfantry}/${UNITS[u].defenseCavalry}`;
const rich = { wood: 9000, food: 9000, iron: 9000, gold: 1000 };
/** A village with the Ember Guard researched (or not). */
const withResearch = (v: VillageState, researched: boolean): VillageState => ({ ...v, researched: researched ? ['knight'] : [] });

describe('troop roster', () => {
  it('the stat lines (attack / vs foot / vs riders), speed, carry, population', () => {
    const table: Array<[UnitId, string, number, number, number]> = [
      ['pikeman', '8/14/40', 6, 12, 1],
      ['guard', '12/42/22', 5, 10, 1],
      ['raider', '36/8/6', 6, 28, 1],
      ['pathfinder', '0/3/2', 18, 0, 1],
      ['outrider', '65/18/16', 13, 75, 2],
      ['knight', '70/60/60', 5, 20, 3],
    ];
    for (const [u, stats, speed, carry, pop] of table) {
      assert.equal(line(u), stats, u);
      assert.equal(UNITS[u].speed, speed, `${u} speed`);
      assert.equal(UNITS[u].carry, carry, `${u} carry`);
      assert.equal(POP_PER_UNIT[u], pop, `${u} population`);
    }
    assert.equal(UNITS.outrider.name, 'Elk Rider');
    assert.equal(UNITS.knight.name, 'Ember Guard');
  });

  it('the Elk Rider is the only rider; the Ember Guard is infantry and walks like infantry', () => {
    assert.deepEqual((Object.keys(UNITS) as UnitId[]).filter((u) => UNITS[u].unitClass === 'cavalry'), ['outrider']);
    assert.equal(UNITS.knight.unitClass, 'infantry');
    assert.equal(UNIT_TERRAIN_FAMILY.knight, 'foot');
    assert.equal(armySpeed(units({ knight: 1, raider: 5 })), 5);
  });

  it('the Ember Guard is trained at the Barracks (8, Town Hall 8) and researched at Drillyard 6; the Elk Rider stays at the Stables 1 / Drillyard 3', () => {
    assert.equal(UNITS.knight.building, 'barracks');
    assert.deepEqual(UNITS.knight.requires, { barracks: 8, hall: 8 });
    assert.equal(UNITS.knight.research?.drillyard, 6);
    assert.ok(UNITS.knight.cost.gold > 0, 'a gold elite');
    assert.equal(UNITS.outrider.building, 'stables');
    assert.deepEqual(UNITS.outrider.requires, { stables: 1 });
    assert.equal(UNITS.outrider.research?.drillyard, 3);
    assert.equal(UNITS.knight.trainTimeSec, 1100);
    assert.equal(UNITS.outrider.trainTimeSec, 620);
  });

  it('training: Barracks 8 + Town Hall 8 + research; one of them missing refuses', () => {
    const ok = withResearch(village({ buildings: { barracks: 8, hall: 8, stables: 5 }, resources: rich }), true);
    const queued = applyTrain(ok, 'knight', 2, 0, S1);
    assert.equal(queued.trainQueues.barracks[0]?.unit, 'knight');
    assert.deepEqual(queued.trainQueues.stables, []);
    assert.equal(queued.trainQueues.barracks[0]?.perUnitMs, Math.round(UNITS.knight.trainTimeSec * 0.94 ** 7 * 1000));
    const refuse = (b: Partial<Record<'barracks' | 'hall' | 'stables', number>>, researched = true) =>
      checkTrain(withResearch(village({ buildings: b, resources: rich }), researched), 'knight', 1, 0, S1);
    assert.ok(!refuse({ barracks: 7, hall: 8, stables: 18 }).ok, 'Barracks 7');
    assert.ok(!refuse({ barracks: 8, hall: 7 }).ok, 'Town Hall 7');
    assert.ok(!refuse({ barracks: 8, hall: 8 }, false).ok, 'not researched');
    assert.ok(!refuse({ stables: 18, hall: 25 }).ok, 'Stables alone never trains it');
  });

  it('Knights in saved villages are Ember Guards 1:1, and their research counts', () => {
    const v = normalizeVillage(village({ buildings: { barracks: 8, hall: 8 }, troops: { knight: 7 }, away: { knight: 2 } }));
    assert.equal(v.troops.knight, 7);
    assert.equal(v.away.knight, 2);
    assert.ok(v.researched?.includes('knight'));
  });

  it('an Ember Guard fights as foot: it counts as infantry against the defence mix', () => {
    const def = { troops: units({ pikeman: 10 }), buildings: village({}).buildings, resources: village({}).resources } as never;
    const r = resolveBattle({ attackerUnits: units({ knight: 10 }), defender: def, seed: 1 });
    assert.equal(r.attackPower > 0, true);
    assert.equal(Math.round(r.defensePower - 20), 10 * 14 + 0, 'pikemen use their defence vs foot (14), not vs riders (40), when the attack is all on foot');
  });
});
