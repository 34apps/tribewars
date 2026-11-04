import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MISSIONS,
  SCOUT_DEFENSE_FACTOR,
  SCOUT_LOSS_EXPONENT,
  UNIT_IDS,
  applyAttackerLosses,
  applyBattleToDefender,
  applyReturn,
  applySend,
  applyTrain,
  checkMission,
  checkSend,
  cloneVillage,
  createNpcVillage,
  isSupportAllowed,
  netProductionPerHour,
  normalizeUnits,
  normalizeVillage,
  resolveBattle,
  resolveScouting,
  settleVillage,
  upkeepPerHour,
} from '../src/index.ts';
import type { BattleResult, Mission, PlayerRelation, Units, VillageState } from '../src/index.ts';
import { HOUR, S1, deepFreeze, near, units, village } from './helpers.ts';

/** A saved state from before the Pathfinder existed: no `pathfinder` key anywhere, one building missing. */
function oldSave(v: VillageState): VillageState {
  const copy = JSON.parse(JSON.stringify(v)) as VillageState;
  delete (copy.troops as Partial<Units>).pathfinder;
  delete (copy.away as Partial<Units>).pathfinder;
  return copy;
}

const allKeys = (u: Units): boolean => UNIT_IDS.every((id) => Number.isFinite(u[id]));

describe('normalizeUnits', () => {
  it('fills missing keys with 0 and keeps counts', () => {
    assert.deepEqual(normalizeUnits(undefined), units({}));
    assert.deepEqual(normalizeUnits({}), units({}));
    assert.deepEqual(normalizeUnits({ raider: 7, pathfinder: 2 }), units({ raider: 7, pathfinder: 2 }));
    const old = { pikeman: 1, guard: 2, raider: 3, outrider: 4, knight: 5 } as Units; // saved before Pathfinders
    assert.deepEqual(normalizeUnits(old), units({ pikeman: 1, guard: 2, raider: 3, outrider: 4, knight: 5, pathfinder: 0, chieftain: 0 }));
  });

  it('turns non-finite and non-numeric values into 0 and drops unknown keys', () => {
    const dirty = { pikeman: Number.NaN, guard: Infinity, raider: -Infinity, outrider: '5', knight: null, pathfinder: 3, dragon: 9 };
    assert.deepEqual(normalizeUnits(dirty as unknown as Partial<Units>), units({ pathfinder: 3 }));
    assert.deepEqual(normalizeUnits(null as unknown as undefined), units({}));
    assert.deepEqual(Object.keys(normalizeUnits({ knight: 1 })), [...UNIT_IDS]);
  });

  it('returns a fresh object and does not mutate its input', () => {
    const input = deepFreeze({ raider: 4 });
    const out = normalizeUnits(input);
    assert.notEqual(out, input);
    assert.deepEqual(input, { raider: 4 });
    const full = deepFreeze(units({ raider: 4 }));
    assert.notEqual(normalizeUnits(full), full);
  });
});

describe('normalizeVillage / old saved states', () => {
  const modern = (): VillageState =>
    village({
      buildings: { barracks: 3, storehouse: 10 },
      resources: { wood: 3000, food: 3000, iron: 3000, gold: 500 },
      troops: { pikeman: 12, raider: 6 },
      away: { raider: 4 },
    });

  it('fills unit keys, missing queues and missing buildings, without sharing structure', () => {
    const old = oldSave(modern());
    delete (old.trainQueues as Partial<VillageState['trainQueues']>).stables;
    delete (old.buildings as Partial<VillageState['buildings']>).vault;
    deepFreeze(old);
    const out = normalizeVillage(old);
    assert.deepEqual(out.troops, units({ pikeman: 12, raider: 6 }));
    assert.deepEqual(out.away, units({ raider: 4 }));
    assert.deepEqual(out.trainQueues, { barracks: [], stables: [], bannerhall: [] });
    assert.equal(out.buildings.vault, 0);
    assert.equal(out.buildings.barracks, 3);
    assert.notEqual(out.troops, old.troops);
    assert.notEqual(out.buildings, old.buildings);
    assert.notEqual(out.trainQueues.barracks, old.trainQueues.barracks);
  });

  it('is the identity on a current state (and keeps npc info and queues)', () => {
    const v = applyTrain(modern(), 'pikeman', 3, 0, S1);
    assert.deepEqual(normalizeVillage(v), v);
    const npc = createNpcVillage(2, 100);
    assert.deepEqual(normalizeVillage(npc), npc);
    assert.deepEqual(cloneVillage(oldSave(v)), v);
  });

  it('settleVillage accepts an old state and matches the current one', () => {
    const current = applyTrain(modern(), 'pikeman', 5, 0, S1);
    const old = deepFreeze(oldSave(current));
    for (const t of [0, 90_000, 3 * HOUR]) {
      const fromOld = settleVillage(old, t, S1);
      assert.deepEqual(fromOld, settleVillage(current, t, S1));
      assert.equal(fromOld.troops.pathfinder, 0);
      assert.equal(fromOld.away.pathfinder, 0);
      assert.ok(Number.isFinite(fromOld.resources.food));
    }
  });

  it('upkeep and net production are finite for an old state', () => {
    const old = oldSave(modern());
    assert.equal(upkeepPerHour(old, S1), upkeepPerHour(modern(), S1));
    assert.ok(Object.values(netProductionPerHour(old, S1)).every(Number.isFinite));
  });

  it('can train and then use Pathfinders on an old state', () => {
    const base = village({
      buildings: { barracks: 2, storehouse: 10 },
      resources: { wood: 3000, food: 3000, iron: 3000, gold: 0 },
    });
    const old = deepFreeze(oldSave(base));
    const queued = applyTrain(old, 'pathfinder', 4, 0, S1);
    assert.equal(queued.trainQueues.barracks[0]?.unit, 'pathfinder');
    const later = settleVillage(queued, 10 * HOUR, S1);
    assert.equal(later.troops.pathfinder, 4);
    const sent = applySend(later, { pathfinder: 3 }, 10 * HOUR, S1);
    assert.equal(sent.troops.pathfinder, 1);
    assert.equal(sent.away.pathfinder, 3);
  });

  it('checkSend does not let an old state send Pathfinders it never had', () => {
    const old = oldSave(village({ troops: { raider: 5 } }));
    const c = checkSend(old, { pathfinder: 1 });
    assert.ok(!c.ok && c.reason === 'not_enough_troops');
    assert.ok(checkSend(old, { raider: 5 }).ok);
  });

  it('battle accepts old states and loose unit maps on every side', () => {
    const defender = oldSave(village({ troops: { pikeman: 20 }, buildings: { wall: 1 } }));
    const attackers = { raider: 30 } as Units;
    const support = [{ guard: 5 } as Units];
    const r = resolveBattle({ attackerUnits: attackers, defender, support, seed: 9 });
    assert.ok(Number.isFinite(r.attackPower) && Number.isFinite(r.defensePower));
    for (const u of [r.attackerLosses, r.attackerSurvivors, r.defenderUnits, r.defenderLosses, ...r.supportLosses]) {
      assert.ok(allKeys(u));
    }
    // Same result as with full Units.
    const full = resolveBattle({ attackerUnits: units({ raider: 30 }), defender: village({ troops: { pikeman: 20 }, buildings: { wall: 1 } }), support: [units({ guard: 5 })], seed: 9 });
    assert.deepEqual(r, full);
  });

  it('apply* helpers accept old states and old report data', () => {
    const origin = oldSave(village({ away: { raider: 6 } }));
    const loose = { raider: 2 } as Units;
    assert.deepEqual(applyAttackerLosses(origin, loose).away, units({ raider: 4 }));
    const home = applyReturn(origin, loose, { wood: 1, food: 1, iron: 1, gold: 1 }, HOUR, S1);
    assert.equal(home.away.raider, 4);
    assert.equal(home.troops.raider, 2);
    assert.ok(allKeys(home.troops) && allKeys(home.away));
    const defender = oldSave(village({ troops: { pikeman: 9 } }));
    const result = { defenderLosses: { pikeman: 4 }, loot: { wood: 0, food: 0, iron: 0, gold: 0 } } as unknown as BattleResult;
    assert.deepEqual(applyBattleToDefender(defender, result).troops, units({ pikeman: 5 }));
  });
});

describe('resolveBattle with support', () => {
  // 100 raiders: 4000 attack, all infantry. Pikemen defend 15 vs infantry, guards 45.
  const host = (troops: Partial<Units> = {}, wall = 0): VillageState =>
    village({ troops, buildings: { wall }, resources: { wood: 800, food: 800, iron: 800, gold: 0 } });
  const lossRatio = (r: BattleResult): number =>
    Math.pow(r.attackerWon ? r.defensePower / r.attackPower : r.attackPower / r.defensePower, 1.5);

  it('support: [] and no support behave exactly like before', () => {
    const base = { attackerUnits: units({ raider: 30 }), defender: host({ pikeman: 40 }), seed: 21 };
    const without = resolveBattle(base);
    assert.deepEqual(without.supportLosses, []);
    assert.deepEqual(resolveBattle({ ...base, support: [] }), without);
  });

  it('adds contingents to the defense exactly like home troops', () => {
    const attackerUnits = units({ raider: 30 });
    const alone = resolveBattle({ attackerUnits, defender: host({ pikeman: 80 }), seed: 2 });
    const split = resolveBattle({ attackerUnits, defender: host({ pikeman: 30 }), support: [units({ pikeman: 50 })], seed: 2 });
    assert.ok(near(alone.defensePower, 80 * 15 + 20, 1e-9));
    assert.equal(split.defensePower, alone.defensePower);
    assert.equal(split.attackPower, alone.attackPower);
    // defenderUnits stays the village's own troops.
    assert.deepEqual(split.defenderUnits, units({ pikeman: 30 }));
  });

  it('weighs support against the attack mix and applies the wall to it', () => {
    const mixed = units({ raider: 50, outrider: 10 }); // 2000 infantry + 600 cavalry
    const si = 2000 / 2600;
    const sc = 1 - si;
    const r = resolveBattle({
      attackerUnits: mixed,
      defender: host({ pikeman: 10 }, 2),
      support: [units({ guard: 8, pathfinder: 3 }), units({ pikeman: 5, knight: 1 })],
      seed: 4,
    });
    const perUnit = (inf: number, cav: number): number => inf * si + cav * sc;
    const dUnits =
      (10 + 5) * perUnit(15, 45) + 8 * perUnit(45, 25) + 3 * perUnit(2, 1) + 1 * perUnit(70, 50);
    assert.ok(near(r.defensePower, (dUnits + 20 + 15 * 2) * 1.1, 1e-9));
  });

  it('one contingent, defender wins: every group loses round(count * (A/D)^1.5)', () => {
    const contingent = units({ pikeman: 50, guard: 10 });
    const r = resolveBattle({ attackerUnits: units({ raider: 30 }), defender: host({ pikeman: 30 }), support: [contingent], seed: 6 });
    assert.ok(!r.attackerWon);
    const ratio = lossRatio(r);
    assert.ok(ratio > 0.1 && ratio < 1);
    assert.equal(r.supportLosses.length, 1);
    assert.equal(r.supportLosses[0]?.pikeman, Math.round(50 * ratio));
    assert.equal(r.supportLosses[0]?.guard, Math.round(10 * ratio));
    assert.equal(r.supportLosses[0]?.raider, 0);
    assert.equal(r.defenderLosses.pikeman, Math.round(30 * ratio));
    assert.deepEqual(r.attackerLosses, units({ raider: 30 }));
    assert.deepEqual(r.attackerSurvivors, units({}));
    assert.deepEqual(r.loot, { wood: 0, food: 0, iron: 0, gold: 0 });
  });

  it('two contingents: losses are split per contingent, in input order', () => {
    const a = units({ pikeman: 40 });
    const b = units({ pikeman: 10, guard: 20, pathfinder: 4 });
    const r = resolveBattle({ attackerUnits: units({ raider: 35 }), defender: host({ pikeman: 20 }), support: [a, b], seed: 12 });
    assert.ok(!r.attackerWon);
    const ratio = lossRatio(r);
    assert.equal(r.supportLosses.length, 2);
    for (const id of UNIT_IDS) {
      assert.equal(r.supportLosses[0]?.[id], Math.min(a[id], Math.round(a[id] * ratio)), `a.${id}`);
      assert.equal(r.supportLosses[1]?.[id], Math.min(b[id], Math.round(b[id] * ratio)), `b.${id}`);
    }
    // Swapping the order swaps the entries, nothing else.
    const swapped = resolveBattle({ attackerUnits: units({ raider: 35 }), defender: host({ pikeman: 20 }), support: [b, a], seed: 12 });
    assert.deepEqual(swapped.supportLosses, [r.supportLosses[1], r.supportLosses[0]]);
    assert.equal(swapped.defensePower, r.defensePower);
  });

  it('losses never exceed what a contingent has, and an empty contingent stays in place', () => {
    const r = resolveBattle({
      attackerUnits: units({ raider: 30 }),
      defender: host({ pikeman: 30 }),
      support: [units({}), units({ pikeman: 1 }), units({ guard: 25 })],
      seed: 3,
    });
    assert.equal(r.supportLosses.length, 3);
    assert.deepEqual(r.supportLosses[0], units({}));
    for (const [i, c] of [units({}), units({ pikeman: 1 }), units({ guard: 25 })].entries()) {
      for (const id of UNIT_IDS) assert.ok((r.supportLosses[i]?.[id] ?? -1) >= 0 && (r.supportLosses[i]?.[id] ?? 99) <= c[id]);
    }
  });

  it('attacker wins: home troops and all support die, loot comes from the host only', () => {
    const support = [units({ pikeman: 10 }), units({ guard: 5, pathfinder: 2 })];
    const r = resolveBattle({
      attackerUnits: units({ raider: 100 }),
      defender: host({ pikeman: 10 }),
      support,
      seed: 8,
    });
    assert.ok(r.attackerWon);
    assert.deepEqual(r.defenderLosses, units({ pikeman: 10 }));
    assert.deepEqual(r.supportLosses, support);
    assert.notEqual(r.supportLosses[0], support[0]); // fresh objects
    assert.equal(r.attackerLosses.raider, Math.round(100 * lossRatio(r)));
    // Capacity 30 * survivors over wood/food/iron (800 each at the host); support carries nothing.
    const total = r.loot.wood + r.loot.food + r.loot.iron + r.loot.gold;
    assert.equal(total, Math.min(30 * r.attackerSurvivors.raider, 2400));
    assert.ok(total > 0);
  });

  it('turns an otherwise winning attack into a defeat once support arrives', () => {
    const attackerUnits = units({ raider: 40 }); // 1600 +-10%
    const lone = resolveBattle({ attackerUnits, defender: host({ pikeman: 20 }), seed: 5 }); // D = 320
    assert.ok(lone.attackerWon);
    const backed = resolveBattle({ attackerUnits, defender: host({ pikeman: 20 }), support: [units({ guard: 40 })], seed: 5 }); // D = 2120
    assert.ok(!backed.attackerWon);
    assert.ok(backed.supportLosses[0] !== undefined && backed.supportLosses[0].guard > 0);
  });

  it('does not touch the host village; the owner side uses applyAttackerLosses on the home village', () => {
    const defender = host({ pikeman: 30 });
    const r = resolveBattle({ attackerUnits: units({ raider: 30 }), defender, support: [units({ pikeman: 50 })], seed: 6 });
    const after = applyBattleToDefender(defender, r);
    assert.equal(after.troops.pikeman, 30 - r.defenderLosses.pikeman);
    const owner = village({ away: { pikeman: 50 } });
    const ownerAfter = applyAttackerLosses(owner, r.supportLosses[0] as Units);
    assert.equal(ownerAfter.away.pikeman, 50 - (r.supportLosses[0]?.pikeman ?? 0));
  });
});

describe('resolveScouting', () => {
  const lose = (defense: number, scouts: number): number => Math.round(scouts * Math.pow(defense / scouts, SCOUT_LOSS_EXPONENT));

  it('uses the configured factor and exponent (this test assumes 1 and 1.5)', () => {
    assert.equal(SCOUT_DEFENSE_FACTOR, 1);
    assert.equal(SCOUT_LOSS_EXPONENT, 1.5);
  });

  it('succeeds without losses when nobody defends', () => {
    assert.deepEqual(resolveScouting({ scouts: 1, defenderScouts: 0 }), { success: true, scoutLosses: 0, defenderScoutLosses: 0 });
    assert.deepEqual(resolveScouting({ scouts: 50, defenderScouts: 0 }), { success: true, scoutLosses: 0, defenderScoutLosses: 0 });
  });

  it('succeeds when outnumbering: sender loses round(s * (D/s)^1.5), defenders lose none', () => {
    assert.deepEqual(resolveScouting({ scouts: 10, defenderScouts: 4 }), { success: true, scoutLosses: 3, defenderScoutLosses: 0 });
    assert.deepEqual(resolveScouting({ scouts: 6, defenderScouts: 5 }), { success: true, scoutLosses: lose(5, 6), defenderScoutLosses: 0 });
    assert.equal(lose(5, 6), 5);
    // One more than the defenders still gets through, with heavy losses.
    const r = resolveScouting({ scouts: 100, defenderScouts: 99 });
    assert.ok(r.success && r.scoutLosses > 90 && r.scoutLosses <= 100);
  });

  it('fails when outnumbered: every scout is caught, defenders lose round(d * (s/D)^1.5)', () => {
    assert.deepEqual(resolveScouting({ scouts: 4, defenderScouts: 10 }), { success: false, scoutLosses: 4, defenderScoutLosses: 3 });
    assert.deepEqual(resolveScouting({ scouts: 1, defenderScouts: 10 }), { success: false, scoutLosses: 1, defenderScoutLosses: 0 });
  });

  it('an exact tie is a failure', () => {
    assert.deepEqual(resolveScouting({ scouts: 5, defenderScouts: 5 }), { success: false, scoutLosses: 5, defenderScoutLosses: 5 });
    const one = resolveScouting({ scouts: 1, defenderScouts: 1 });
    assert.ok(!one.success && one.scoutLosses === 1);
  });

  it('handles zero scouts without NaN', () => {
    assert.deepEqual(resolveScouting({ scouts: 0, defenderScouts: 0 }), { success: false, scoutLosses: 0, defenderScoutLosses: 0 });
    assert.deepEqual(resolveScouting({ scouts: 0, defenderScouts: 3 }), { success: false, scoutLosses: 0, defenderScoutLosses: 0 });
  });

  it('treats garbage counts as 0', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity, -3]) {
      const r = resolveScouting({ scouts: bad, defenderScouts: bad });
      assert.deepEqual(r, { success: false, scoutLosses: 0, defenderScoutLosses: 0 });
    }
    assert.ok(resolveScouting({ scouts: 4, defenderScouts: Number.NaN }).success);
  });

  it('is deterministic, never loses more than exists, and succeeds exactly when scouts > defenders', () => {
    for (let s = 0; s <= 30; s++) {
      for (let d = 0; d <= 30; d++) {
        const r = resolveScouting({ scouts: s, defenderScouts: d });
        assert.deepEqual(r, resolveScouting({ scouts: s, defenderScouts: d }));
        assert.equal(r.success, s > d, `${s} vs ${d}`);
        assert.ok(r.scoutLosses >= 0 && r.scoutLosses <= s);
        assert.ok(r.defenderScoutLosses >= 0 && r.defenderScoutLosses <= d);
        if (r.success) assert.equal(r.defenderScoutLosses, 0);
        else assert.equal(r.scoutLosses, s);
      }
    }
  });

  it('does not mutate its input', () => {
    const input = deepFreeze({ scouts: 7, defenderScouts: 3 });
    resolveScouting(input);
    assert.deepEqual(input, { scouts: 7, defenderScouts: 3 });
  });
});

describe('checkMission', () => {
  const armies: Record<string, Units> = {
    empty: units({}),
    pathfinders: units({ pathfinder: 3 }),
    pikemen: units({ pikeman: 5 }),
    knights: units({ knight: 1 }),
    mixed: units({ pathfinder: 2, raider: 4 }),
  };
  type Expect = 'ok' | 'no_troops' | 'invalid_input';
  const matrix: Record<Mission, Record<keyof typeof armies, Expect>> = {
    attack: { empty: 'no_troops', pathfinders: 'invalid_input', pikemen: 'ok', knights: 'ok', mixed: 'ok' },
    scout: { empty: 'no_troops', pathfinders: 'ok', pikemen: 'invalid_input', knights: 'invalid_input', mixed: 'invalid_input' },
    support: { empty: 'no_troops', pathfinders: 'ok', pikemen: 'ok', knights: 'ok', mixed: 'ok' },
    found: { empty: 'no_troops', pathfinders: 'invalid_input', pikemen: 'invalid_input', knights: 'invalid_input', mixed: 'invalid_input' },
    occupy: { empty: 'no_troops', pathfinders: 'ok', pikemen: 'ok', knights: 'ok', mixed: 'ok' },
  };

  for (const mission of MISSIONS) {
    for (const [name, army] of Object.entries(armies)) {
      const expected = matrix[mission][name] as Expect;
      it(`${mission} with ${name} -> ${expected}`, () => {
        const c = checkMission(mission, army);
        if (expected === 'ok') assert.deepEqual(c, { ok: true });
        else {
          assert.ok(!c.ok);
          if (!c.ok) {
            assert.equal(c.reason, expected);
            assert.ok(c.message.length > 0);
          }
        }
      });
    }
  }

  it('matrix covers every mission', () => {
    assert.deepEqual(Object.keys(matrix).sort(), [...MISSIONS].sort());
  });

  it('uses clear messages', () => {
    const attack = checkMission('attack', units({ pathfinder: 2 }));
    assert.ok(!attack.ok && /Pathfinders can't attack alone/.test(attack.message) && /scouting mission/.test(attack.message));
    const scout = checkMission('scout', units({ pathfinder: 1, pikeman: 1 }));
    assert.ok(!scout.ok && /Only Pathfinders/.test(scout.message));
    const none = checkMission('support', units({}));
    assert.ok(!none.ok && /at least one unit/i.test(none.message));
  });

  it('rejects unknown missions with invalid_input', () => {
    for (const bad of ['raid', '', 'ATTACK', 'constructor', undefined, null, 3]) {
      const c = checkMission(bad as unknown as Mission, units({ raider: 1 }));
      assert.ok(!c.ok && c.reason === 'invalid_input', String(bad));
    }
  });

  it('accepts old unit maps lacking the pathfinder key and does not mutate', () => {
    const old = deepFreeze({ pikeman: 3, guard: 0, raider: 0, outrider: 0, knight: 0 }) as unknown as Units;
    assert.ok(checkMission('attack', old).ok);
    assert.ok(checkMission('support', old).ok);
    assert.ok(!checkMission('scout', old).ok);
    assert.ok(!checkMission('attack', deepFreeze({ pikeman: 0 }) as unknown as Units).ok);
  });
});

describe('isSupportAllowed', () => {
  const expected: Record<PlayerRelation, boolean> = {
    self: false,
    tribe: true,
    ally: true,
    nap: false,
    enemy: false,
    neutral: false,
  };
  for (const [relation, allowed] of Object.entries(expected) as Array<[PlayerRelation, boolean]>) {
    it(`${relation} -> ${String(allowed)}`, () => {
      assert.equal(isSupportAllowed(relation), allowed);
    });
  }
  it('is false for anything unexpected', () => {
    for (const bad of ['', 'TRIBE', undefined, null, 'abandoned']) assert.equal(isSupportAllowed(bad as unknown as PlayerRelation), false);
  });
});
