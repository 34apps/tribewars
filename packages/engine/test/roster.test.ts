// The troop roster (originality piece 5): own stat lines, the Elk Rider as the only rider, the Ember Guard on foot at the Barracks.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UNITS, POP_PER_UNIT, RANKABLE_UNITS, applyRank, checkRank, rankOf, checkResearch, UNIT_TERRAIN_FAMILY, applyTrain, armySpeed, checkTrain, normalizeVillage, resolveBattle } from '../src/index.ts';
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
      ['hearthwarden', '18/48/52', 11, 20, 2],
      ['knight', '160/50/40', 9, 20, 3],
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

  it('the Elk Rider, the Hearthwarden, the Ember Guard and the Pathfinder are riders (owner 2026-11-20); the Ember Guard walks the mounted terrain row', () => {
    assert.deepEqual((Object.keys(UNITS) as UnitId[]).filter((u) => UNITS[u].unitClass === 'cavalry'), ['outrider', 'hearthwarden', 'knight', 'pathfinder']);
    assert.equal(UNIT_TERRAIN_FAMILY.hearthwarden, 'mounted');
    assert.equal(UNITS.knight.unitClass, 'cavalry');
    assert.equal(UNIT_TERRAIN_FAMILY.knight, 'mounted');
    assert.equal(UNIT_TERRAIN_FAMILY.pathfinder, 'pathfinder');
    assert.equal(armySpeed(units({ knight: 1, raider: 5 })), 6);
    assert.equal(armySpeed(units({ knight: 2, hearthwarden: 5 })), 9);
  });

  it('the Ember Guard is trained at the Stables (8, Town Hall 8) and researched at Drillyard 6; the Elk Rider stays at the Stables 1 / Drillyard 3', () => {
    assert.equal(UNITS.knight.building, 'stables');
    assert.deepEqual(UNITS.knight.requires, { stables: 8, hall: 8 });
    assert.equal(UNITS.pathfinder.building, 'stables');
    assert.deepEqual(UNITS.pathfinder.requires, { stables: 1 });
    assert.deepEqual(UNITS.hearthwarden.cost, { wood: 42, food: 62, iron: 76, gold: 0 });
    assert.equal(UNITS.knight.research?.drillyard, 6);
    assert.ok(UNITS.knight.cost.gold > 0, 'a gold elite');
    assert.equal(UNITS.outrider.building, 'stables');
    assert.deepEqual(UNITS.outrider.requires, { stables: 1 });
    assert.equal(UNITS.outrider.research?.drillyard, 3);
    assert.equal(UNITS.knight.trainTimeSec, 1100);
    assert.equal(UNITS.outrider.trainTimeSec, 620);
  });

  it('training: Stables 8 + Town Hall 8 + research; one of them missing refuses', () => {
    const ok = withResearch(village({ buildings: { barracks: 5, hall: 8, stables: 8 }, resources: rich }), true);
    const queued = applyTrain(ok, 'knight', 2, 0, S1);
    assert.equal(queued.trainQueues.stables[0]?.unit, 'knight');
    assert.deepEqual(queued.trainQueues.barracks, []);
    assert.equal(queued.trainQueues.stables[0]?.perUnitMs, Math.round(UNITS.knight.trainTimeSec * 0.94 ** 7 * 1000));
    const refuse = (b: Partial<Record<'barracks' | 'hall' | 'stables', number>>, researched = true) =>
      checkTrain(withResearch(village({ buildings: b, resources: rich }), researched), 'knight', 1, 0, S1);
    assert.ok(!refuse({ stables: 7, hall: 8, barracks: 18 }).ok, 'Stables 7');
    assert.ok(!refuse({ stables: 8, hall: 7 }).ok, 'Town Hall 7');
    assert.ok(!refuse({ stables: 8, hall: 8 }, false).ok, 'not researched');
    assert.ok(!refuse({ barracks: 18, hall: 25 }).ok, 'Barracks alone never trains it');
  });

  it('Knights in saved villages are Ember Guards 1:1, and their research counts', () => {
    const v = normalizeVillage(village({ buildings: { barracks: 8, hall: 8 }, troops: { knight: 7 }, away: { knight: 2 } }));
    assert.equal(v.troops.knight, 7);
    assert.equal(v.away.knight, 2);
    assert.ok(v.researched?.includes('knight'));
  });

  it('an Ember Guard fights as a rider: it counts as cavalry against the defence mix', () => {
    const def = { troops: units({ pikeman: 10 }), buildings: village({}).buildings, resources: village({}).resources } as never;
    const r = resolveBattle({ attackerUnits: units({ knight: 10 }), defender: def, seed: 1 });
    assert.equal(r.attackPower > 0, true);
    assert.equal(Math.round(r.defensePower - 20), 10 * 40 + 0, 'pikemen use their defence vs riders (40), not vs foot (14), when the attack is all mounted');
  });

  it('the Hearthwarden: a Stables 4 rider, researched at Drillyard 4, ranked, fast but not better in defence than the foot defenders', () => {
    const h = UNITS.hearthwarden;
    assert.equal(h.name, 'Hearthwarden');
    assert.equal(h.building, 'stables');
    assert.deepEqual(h.requires, { stables: 4 });
    assert.equal(h.research?.drillyard, 4);
    assert.ok(RANKABLE_UNITS.includes('hearthwarden'));
    assert.ok(h.speed > UNITS.pikeman.speed && h.speed < UNITS.outrider.speed);
    const pop = POP_PER_UNIT.hearthwarden;
    const per = (u: UnitId, vs: 'defenseInfantry' | 'defenseCavalry'): [number, number] => {
      const cost = UNITS[u].cost;
      const value = cost.wood + cost.food + cost.iron + cost.gold * 8;
      return [UNITS[u][vs] / value, UNITS[u][vs] / POP_PER_UNIT[u]];
    };
    assert.ok(per('hearthwarden', 'defenseCavalry')[0] < per('pikeman', 'defenseCavalry')[0], 'vs riders per resource');
    assert.ok(per('hearthwarden', 'defenseCavalry')[1] < per('pikeman', 'defenseCavalry')[1] * 1 && pop === 2, 'vs riders per population');
    assert.ok(per('hearthwarden', 'defenseInfantry')[0] < per('guard', 'defenseInfantry')[0], 'vs foot per resource');
    assert.ok(per('hearthwarden', 'defenseInfantry')[1] < per('guard', 'defenseInfantry')[1], 'vs foot per population');
  });

  it('the Hearthwarden trains at the Stables from level 4 only, and only once researched', () => {
    const at = (stables: number, researched = true) =>
      checkTrain({ ...village({ buildings: { stables, drillyard: 4 }, resources: rich }), researched: researched ? ['hearthwarden'] : [] }, 'hearthwarden', 1, 0, S1);
    assert.ok(at(4).ok);
    assert.ok(!at(3).ok, 'Stables 3');
    assert.ok(!at(4, false).ok, 'not researched');
    const q = applyTrain({ ...village({ buildings: { stables: 4, drillyard: 4 }, resources: rich }), researched: ['hearthwarden'] }, 'hearthwarden', 2, 0, S1);
    assert.equal(q.trainQueues.stables[0]?.unit, 'hearthwarden');
    assert.deepEqual(q.trainQueues.barracks, []);
    assert.ok(!checkTrain({ ...village({ buildings: { barracks: 20, stables: 3 }, resources: rich }), researched: ['hearthwarden'] }, 'hearthwarden', 1, 0, S1).ok, 'Barracks never trains it');
  });

  it('the Hearthwarden research needs Drillyard 4 and then its rank tracks open', () => {
    const base = { stables: 4, drillyard: 4 };
    assert.ok(!checkResearch(village({ buildings: { ...base, drillyard: 3 }, resources: rich }), 'hearthwarden', 0, S1).ok);
    assert.ok(checkResearch(village({ buildings: base, resources: rich }), 'hearthwarden', 0, S1).ok);
    const v = normalizeVillage(village({ buildings: base, resources: rich, troops: { hearthwarden: 1 } }));
    assert.ok(v.researched?.includes('hearthwarden'), 'old saves with the unit count as researched');
    assert.ok(RANKABLE_UNITS.includes('hearthwarden'));
    assert.ok(!checkRank(v, 'hearthwarden', 'might', 0, S1).ok, 'a defender has no Might track');
    const b = applyRank(v, 'hearthwarden', 'bulwark', 0, S1);
    assert.equal(b.ranks?.hearthwarden?.bulwark, 1);
    assert.equal(rankOf(b.ranks, 'hearthwarden', 'might'), 0);
  });

  it('old saved rows without the Hearthwarden or the Log Ram read as 0', () => {
    const old = { pikeman: 3, guard: 0, raider: 1, outrider: 2, knight: 0, pathfinder: 0, chieftain: 0, firecart: 0 };
    const v = normalizeVillage({ ...village({}), troops: old as never, away: old as never });
    assert.equal(v.troops.hearthwarden, 0);
    assert.equal(v.away.hearthwarden, 0);
    assert.equal(v.troops.logram, 0);
    assert.equal(v.away.logram, 0);
    assert.equal(v.troops.outrider, 2);
  });
});
