import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BUILDINGS,
  BUILDING_IDS,
  CHIEFTAIN_RENOWN_REFUND_SHARE,
  FEAST_COST,
  FEAST_DAILY_PER_LEVEL,
  FEAST_RENOWN,
  GameError,
  RENOWN_BUILD_EXP,
  RENOWN_BUILD_SCALE,
  RENOWN_MIN_BATTLE_VALUE,
  RENOWN_PAIR_CAP,
  RENOWN_PER_KILL_VALUE,
  RENOWN_PER_LOOT_VALUE,
  RENOWN_SMALL_FLOOR,
  RENOWN_VILLAGE_BASE,
  RENOWN_VILLAGE_GROWTH,
  UNITS,
  applyBuild,
  applyFeast,
  battleRenown,
  battleValueShares,
  buildingRenown,
  checkBuild,
  checkFeast,
  chieftainRefund,
  collectBuildRenown,
  createNpcVillage,
  createPlayerVillage,
  feastAllowance,
  feastWindowMs,
  makeRenownInfo,
  markRenownPaid,
  normalizeVillage,
  pairRenown,
  pairRenownTotal,
  rawRenown,
  renownPairWindowMs,
  resourceValue,
  settleVillage,
  sizeFactor,
  troopValue,
  villagePoints,
  villageRenownCost,
} from '../src/index.ts';
import type { BattleResult, BuildingLevels, Resources, VillageState } from '../src/index.ts';
import { HOUR, S1, S10, deepFreeze, near, units, village } from './helpers.ts';

const expectGameError = (fn: () => unknown, code: string): void => {
  assert.throws(fn, (e: unknown) => e instanceof GameError && e.code === code);
};
const res = (wood = 0, food = 0, iron = 0, gold = 0): Resources => ({ wood, food, iron, gold });

/** A village able to hold the Feast cost (Storehouse 11 holds 8594 of each). */
const feastVillage = (bannerhall: number, stock = 6000): VillageState =>
  village({ buildings: { bannerhall, storehouse: 11 }, resources: res(stock, stock, stock, 0) });

describe('Banner Hall building', () => {
  it('is defined with the designed requirements', () => {
    const def = BUILDINGS.bannerhall;
    assert.equal(def.maxLevel, 4);
    assert.equal(def.startLevel, 0);
    assert.deepEqual(def.requires, { hall: 7, drillyard: 2, market: 2, storehouse: 6 });
    assert.ok(BUILDING_IDS.includes('bannerhall'));
  });

  it('can be started once the requirements and a big enough Storehouse are there', () => {
    const base = { hall: 7, drillyard: 2, market: 2, farm: 15, storehouse: 6 };
    const rich = res(2800, 2800, 2800, 200);
    assert.ok(checkBuild(village({ buildings: base, resources: rich }), 'bannerhall', 0, S1).ok);
    // A Storehouse that cannot hold the cost gives a clear message, not a silent dead end.
    const small = checkBuild(village({ buildings: { ...base, storehouse: 4 }, resources: res(9000, 9000, 9000, 400) }), 'bannerhall', 0, S1);
    assert.ok(!small.ok && (small.reason === 'exceeds_storage' || small.reason === 'requirements_not_met'));
    const missing = checkBuild(village({ buildings: { ...base, market: 1 }, resources: rich }), 'bannerhall', 0, S1);
    assert.ok(!missing.ok && missing.reason === 'requirements_not_met');
  });

  it('adds village points', () => {
    const a = village();
    const b = village({ buildings: { bannerhall: 1 } });
    assert.ok(villagePoints(b) > villagePoints(a));
  });
});

describe('cost of a new village', () => {
  it('is BASE * 1.6^(owned - 1), rounded', () => {
    assert.equal(villageRenownCost(1), RENOWN_VILLAGE_BASE);
    assert.equal(villageRenownCost(2), Math.round(RENOWN_VILLAGE_BASE * RENOWN_VILLAGE_GROWTH));
    assert.equal(villageRenownCost(3), Math.round(RENOWN_VILLAGE_BASE * RENOWN_VILLAGE_GROWTH ** 2));
    assert.equal(villageRenownCost(5), Math.round(RENOWN_VILLAGE_BASE * RENOWN_VILLAGE_GROWTH ** 4));
    assert.equal(villageRenownCost(1), 500);
    assert.equal(villageRenownCost(2), 800);
    assert.equal(villageRenownCost(3), 1280);
    assert.equal(villageRenownCost(5), 3277);
  });

  it('treats nonsense counts as one village', () => {
    assert.equal(villageRenownCost(0), RENOWN_VILLAGE_BASE);
    assert.equal(villageRenownCost(Number.NaN), RENOWN_VILLAGE_BASE);
  });

  it('gives back the refund share of a Chieftain cost, rounded down', () => {
    assert.equal(chieftainRefund(480), Math.floor(480 * CHIEFTAIN_RENOWN_REFUND_SHARE));
    assert.equal(chieftainRefund(481), 240);
    assert.equal(chieftainRefund(-5), 0);
  });

  it('shows floored numbers in RenownInfo', () => {
    assert.deepEqual(makeRenownInfo(100.9, 40.2, 2), { total: 100, spent: 40, balance: 60, nextVillageCost: 800, villages: 2 });
    assert.equal(makeRenownInfo(10, 10, 1).balance, 0);
  });
});

describe('Renown from buildings', () => {
  it('pays round(SCALE * level^EXP) for one level', () => {
    assert.equal(buildingRenown('hall', 0), 0);
    assert.equal(buildingRenown('hall', 1), 1);
    assert.equal(buildingRenown('hall', 2), Math.max(1, Math.round(RENOWN_BUILD_SCALE * 2 ** RENOWN_BUILD_EXP)));
    assert.equal(buildingRenown('wall', 10), Math.max(1, Math.round(RENOWN_BUILD_SCALE * 10 ** RENOWN_BUILD_EXP)));
  });

  it('start levels pay nothing; every level above pays once', () => {
    const v = createPlayerVillage(0);
    assert.equal(collectBuildRenown(v).renown, 0);
    const built = village({ buildings: { hall: 3 } });
    const first = collectBuildRenown(built);
    assert.equal(first.renown, buildingRenown('hall', 2) + buildingRenown('hall', 3));
    const second = collectBuildRenown(first.state);
    assert.equal(second.renown, 0);
  });

  it('pays partial progress: only the new levels', () => {
    const a = collectBuildRenown(village({ buildings: { hall: 2 } }));
    assert.equal(a.renown, buildingRenown('hall', 2));
    const b = collectBuildRenown({ ...a.state, buildings: { ...a.state.buildings, hall: 4 } });
    assert.equal(b.renown, buildingRenown('hall', 3) + buildingRenown('hall', 4));
  });

  it('never pays a level twice, also when the building was reset (takeover)', () => {
    const a = collectBuildRenown(village({ buildings: { wall: 5 } }));
    assert.ok(a.renown > 0);
    const reset = { ...a.state, buildings: { ...a.state.buildings, wall: 0 } };
    assert.equal(collectBuildRenown(reset).renown, 0);
    const rebuilt = collectBuildRenown({ ...reset, buildings: { ...reset.buildings, wall: 5 } });
    assert.equal(rebuilt.renown, 0);
    const higher = collectBuildRenown({ ...reset, buildings: { ...reset.buildings, wall: 6 } });
    assert.equal(higher.renown, buildingRenown('wall', 6));
  });

  it('pays a finished build job (after settling) and does not touch the input', () => {
    const v = deepFreeze(applyBuild(village(), 'hall', 0, S1));
    assert.equal(collectBuildRenown(v).renown, 0); // not finished yet
    const done = settleVillage(v, 10_000_000, S1);
    assert.equal(done.buildings.hall, 2);
    const out = collectBuildRenown(done);
    assert.equal(out.renown, buildingRenown('hall', 2));
    assert.equal(done.renownPaid?.hall, 1);
    assert.equal(out.state.renownPaid?.hall, 2);
  });

  it('markRenownPaid pays nothing and later levels still pay', () => {
    const v = markRenownPaid(village({ buildings: { hall: 6, barracks: 3 } }));
    assert.equal(collectBuildRenown(v).renown, 0);
    const up = collectBuildRenown({ ...v, buildings: { ...v.buildings, hall: 7 } });
    assert.equal(up.renown, buildingRenown('hall', 7));
  });

  it('abandoned villages pay nothing, and a village that was one starts clean', () => {
    const npc = createNpcVillage(5, 0);
    assert.equal(collectBuildRenown(npc).renown, 0);
    const captured = markRenownPaid(npc);
    delete captured.npc;
    assert.equal(collectBuildRenown(captured).renown, 0);
  });

  it('old saved states without renownPaid default to the start levels', () => {
    const saved = JSON.parse(JSON.stringify(village({ buildings: { hall: 3, market: 2 } }))) as VillageState;
    delete saved.renownPaid;
    delete (saved.buildings as Partial<BuildingLevels>).bannerhall;
    const v = normalizeVillage(saved);
    assert.equal(v.buildings.bannerhall, 0);
    for (const b of BUILDING_IDS) assert.equal(v.renownPaid?.[b], BUILDINGS[b].startLevel);
    const expected = buildingRenown('hall', 2) + buildingRenown('hall', 3) + buildingRenown('market', 1) + buildingRenown('market', 2);
    assert.equal(collectBuildRenown(v).renown, expected);
  });

  it('keys missing from a partial renownPaid count as the start level', () => {
    const saved = JSON.parse(JSON.stringify(village({ buildings: { hall: 3 } }))) as VillageState;
    saved.renownPaid = { hall: 3 } as BuildingLevels;
    const v = normalizeVillage(saved);
    assert.equal(v.renownPaid?.hall, 3);
    assert.equal(v.renownPaid?.lumber, BUILDINGS.lumber.startLevel);
    assert.equal(collectBuildRenown(v).renown, 0);
  });
});

describe('Feast', () => {
  it('needs a Banner Hall', () => {
    const v = feastVillage(0);
    const c = checkFeast(v, 1, 0, S1);
    assert.ok(!c.ok && c.reason === 'requirements_not_met');
    expectGameError(() => applyFeast(v, 1, 0, S1), 'requirements_not_met');
    assert.equal(feastAllowance(v, 0, S1).max, 0);
  });

  it('costs FEAST_COST per Feast and gives FEAST_RENOWN', () => {
    const v = deepFreeze(feastVillage(1));
    const c = checkFeast(v, 2, 0, S1);
    assert.ok(c.ok);
    if (c.ok) {
      assert.deepEqual(c.cost, res(FEAST_COST.wood * 2, FEAST_COST.food * 2, FEAST_COST.iron * 2, FEAST_COST.gold * 2));
      assert.equal(c.renown, FEAST_RENOWN * 2);
    }
    const out = applyFeast(v, 2, 0, S1);
    assert.equal(out.renown, FEAST_RENOWN * 2);
    assert.equal(out.state.resources.wood, 6000 - FEAST_COST.wood * 2);
    assert.equal(out.state.resources.iron, 6000 - FEAST_COST.iron * 2);
    assert.equal(out.state.resources.gold, 0);
    assert.deepEqual(out.state.feast, { windowStart: 0, count: 2 });
    assert.equal(v.resources.wood, 6000); // input untouched
  });

  it('refuses when resources are short', () => {
    const v = feastVillage(2, 500);
    expectGameError(() => applyFeast(v, 1, 0, S1), 'not_enough_resources');
  });

  it('refuses bad counts', () => {
    const v = feastVillage(1);
    for (const bad of [0, -1, 1.5, Number.NaN, '2' as unknown as number]) expectGameError(() => applyFeast(v, bad, 0, S1), 'invalid_input');
  });

  it('caps Feasts per window at FEAST_DAILY_PER_LEVEL * Banner Hall level', () => {
    let v = feastVillage(2);
    const max = FEAST_DAILY_PER_LEVEL * 2;
    assert.equal(feastAllowance(v, 0, S1).left, max);
    v = applyFeast(v, max - 1, 0, S1).state;
    assert.deepEqual(feastAllowance(v, 0, S1), { max, used: max - 1, left: 1, windowEnd: 24 * HOUR });
    expectGameError(() => applyFeast(v, 2, HOUR, S1), 'queue_full');
    v = applyFeast(v, 1, HOUR, S1).state;
    assert.equal(feastAllowance(v, HOUR, S1).left, 0);
    const c = checkFeast(v, 1, HOUR, S1);
    assert.ok(!c.ok && c.reason === 'queue_full');
  });

  it('starts the window at the first Feast and resets after it ends', () => {
    let v = feastVillage(1);
    v = applyFeast(v, 3, 2 * HOUR, S1).state;
    assert.equal(feastAllowance(v, 3 * HOUR, S1).windowEnd, 26 * HOUR);
    expectGameError(() => applyFeast(v, 1, 25 * HOUR, S1), 'queue_full');
    // Just after the window: a new one starts at this Feast.
    const next = applyFeast(v, 1, 26 * HOUR, S1).state;
    assert.deepEqual(next.feast, { windowStart: 26 * HOUR, count: 1 });
    assert.equal(feastAllowance(next, 26 * HOUR, S1).left, 2);
  });

  it('a Banner Hall level finished meanwhile counts (settles first)', () => {
    const v = feastVillage(1);
    v.buildQueue.push({ building: 'bannerhall', targetLevel: 2, startAt: 0, finishAt: HOUR });
    assert.equal(feastAllowance(v, 0, S1).max, FEAST_DAILY_PER_LEVEL);
    assert.equal(feastAllowance(v, 2 * HOUR, S1).max, FEAST_DAILY_PER_LEVEL * 2);
  });

  it('the window is shorter on a fast world', () => {
    assert.equal(feastWindowMs(S1), 24 * HOUR);
    assert.equal(feastWindowMs(S10), 8_640_000);
    let v = feastVillage(1);
    v = applyFeast(v, 3, 0, S10).state;
    expectGameError(() => applyFeast(v, 1, 2 * HOUR, S10), 'queue_full');
    const again = applyFeast(v, 1, 8_640_000, S10);
    assert.deepEqual(again.state.feast, { windowStart: 8_640_000, count: 1 });
  });

  it('abandoned villages cannot feast', () => {
    const npc = createNpcVillage(3, 0);
    npc.buildings.bannerhall = 1;
    expectGameError(() => applyFeast(npc, 1, 0, S1), 'invalid_input');
  });
});

describe('pair window maths', () => {
  it('slope is about 1 for small amounts and the total never passes the cap', () => {
    assert.ok(near(pairRenown(0, 0.01), 0.01, 1e-4));
    assert.ok(pairRenown(0, 1) > 0.97 && pairRenown(0, 1) < 1);
    assert.ok(pairRenownTotal(1e9) <= RENOWN_PAIR_CAP);
    assert.ok(pairRenownTotal(1e9) > RENOWN_PAIR_CAP - 1e-9);
    assert.ok(pairRenown(0, 1e9) <= RENOWN_PAIR_CAP);
    assert.equal(pairRenown(0, 0), 0);
    assert.equal(pairRenown(5, -3), 0);
  });

  it('pays less the more the pair has already earned', () => {
    assert.ok(pairRenown(20, 10) < pairRenown(0, 10));
    assert.ok(pairRenown(100, 10) < pairRenown(20, 10));
  });

  it('is path independent: one big battle pays what many small ones pay', () => {
    let prev = 0;
    let sum = 0;
    for (let i = 0; i < 100; i++) {
      sum += pairRenown(prev, 0.3);
      prev += 0.3;
    }
    assert.ok(near(sum, pairRenown(0, 30), 1e-9));
    assert.ok(near(sum, pairRenownTotal(30), 1e-9));
    // Different splits agree too.
    const a = pairRenown(0, 12) + pairRenown(12, 7) + pairRenown(19, 40);
    assert.ok(near(a, pairRenown(0, 59), 1e-9));
  });

  it('the window lasts RENOWN_PAIR_WINDOW_HOURS divided by speed', () => {
    assert.equal(renownPairWindowMs(S1), 24 * HOUR);
    assert.equal(renownPairWindowMs(S10), 8_640_000);
  });
});

describe('sizeFactor', () => {
  it('is 1 when the opponent has at least half of your points', () => {
    assert.equal(sizeFactor(500, 1000), 1);
    assert.equal(sizeFactor(5000, 1000), 1);
  });
  it('falls with the square of the ratio and stops at the floor', () => {
    assert.ok(near(sizeFactor(250, 1000), 0.25));
    assert.equal(sizeFactor(100, 1000), RENOWN_SMALL_FLOOR);
    assert.equal(sizeFactor(0, 1000), RENOWN_SMALL_FLOOR);
  });
  it('own points 0 means no reduction', () => {
    assert.equal(sizeFactor(10, 0), 1);
  });
});

/** A hand-made battle result: attackers are infantry raiders. */
function result(over: Partial<BattleResult> = {}): BattleResult {
  return {
    attackerWon: true,
    luck: 0,
    attackPower: 1,
    defensePower: 1,
    attackerLosses: units({}),
    attackerSurvivors: units({ raider: 10 }),
    defenderUnits: units({}),
    defenderLosses: units({}),
    supportLosses: [],
    loot: res(),
    wallDuring: 0,
    ...over,
  };
}

describe('value', () => {
  it('counts gold ten times and troops by their cost', () => {
    assert.equal(resourceValue(res(1, 2, 3, 4)), 1 + 2 + 3 + 40);
    const pike = UNITS.pikeman.cost;
    assert.equal(troopValue(units({ pikeman: 3 })), 3 * (pike.wood + pike.food + pike.iron + 10 * pike.gold));
    assert.equal(troopValue(units({})), 0);
  });
});

describe('battle value shares', () => {
  it('attacker: loot value plus defender and support losses', () => {
    const r = result({
      loot: res(300, 300, 300, 0),
      defenderLosses: units({ pikeman: 10 }),
      supportLosses: [units({ guard: 5 })],
    });
    const [att] = battleValueShares(r, { support: [units({ guard: 5 })] });
    assert.equal(att?.side, 'attacker');
    assert.equal(att?.lootValue, 900);
    assert.equal(att?.killValue, troopValue(units({ pikeman: 10 })) + troopValue(units({ guard: 5 })));
    assert.equal(att?.value, att!.lootValue + att!.killValue);
    // raw Renown uses the two rates
    assert.ok(near(rawRenown(att!), 900 * RENOWN_PER_LOOT_VALUE + att!.killValue * RENOWN_PER_KILL_VALUE));
  });

  it('defender side: attacker losses split by defence strength, sums to the whole', () => {
    const r = result({ attackerLosses: units({ raider: 10 }), attackerSurvivors: units({}), defenderUnits: units({ pikeman: 10 }) });
    const shares = battleValueShares(r, { support: [units({ guard: 10 })] });
    assert.deepEqual(
      shares.map((s) => s.side),
      ['attacker', 'defender', 'support'],
    );
    const whole = troopValue(units({ raider: 10 }));
    const [, own, sup] = shares;
    // Infantry attack: pikeman 15 * 10 = 150 vs guard 45 * 10 = 450 -> 25% / 75%.
    assert.ok(near(own!.value, whole * 0.25));
    assert.ok(near(sup!.value, whole * 0.75));
    assert.equal(sup?.index, 0);
    assert.ok(near(own!.value + sup!.value, whole));
    assert.equal(own!.lootValue, 0);
  });

  it('several support contingents each get their share; all of it adds up', () => {
    const r = result({
      attackerLosses: units({ raider: 7, outrider: 3 }),
      attackerSurvivors: units({ raider: 3 }),
      defenderUnits: units({ pikeman: 4 }),
    });
    const support = [units({ guard: 3 }), units({ pikeman: 9, knight: 1 }), units({})];
    const shares = battleValueShares(r, { support });
    const defending = shares.filter((s) => s.side !== 'attacker');
    assert.equal(defending.length, 4);
    const sum = defending.reduce((a, s) => a + s.value, 0);
    assert.ok(near(sum, troopValue(units({ raider: 7, outrider: 3 }))));
    assert.equal(shares[4]?.value, 0); // the empty third contingent earns nothing
  });

  it('the village owner gets everything when nobody else defended', () => {
    const r = result({ attackerLosses: units({ raider: 4 }), attackerSurvivors: units({}) });
    const [, own] = battleValueShares(r);
    assert.equal(own?.value, troopValue(units({ raider: 4 })));
  });
});

describe('battleRenown', () => {
  const party = { eligible: true, points: 1000 };
  const base = {
    result: result({ loot: res(300, 300, 300, 0), defenderLosses: units({ pikeman: 10 }), attackerLosses: units({ raider: 2 }) }),
    attacker: party,
    defender: party,
    pairValue: () => 0,
  };

  it('pays loot and kills at their rates through the pair window', () => {
    const awards = battleRenown(base);
    const att = awards[0]!;
    const raw = 900 * RENOWN_PER_LOOT_VALUE + troopValue(units({ pikeman: 10 })) * RENOWN_PER_KILL_VALUE;
    assert.ok(near(att.counted, raw));
    assert.ok(near(att.renown, pairRenown(0, raw)));
    assert.equal(att.skipped, undefined);
    const def = awards[1]!;
    assert.ok(near(def.counted, troopValue(units({ raider: 2 })) * RENOWN_PER_KILL_VALUE));
  });

  it('uses the pair history of each earner', () => {
    const fresh = battleRenown(base)[0]!;
    const seen = battleRenown({ ...base, pairValue: (e) => (e.side === 'attacker' ? 25 : 0) });
    assert.ok(seen[0]!.renown < fresh.renown);
    assert.ok(near(seen[1]!.renown, battleRenown(base)[1]!.renown));
  });

  it('skips forbidden pairs and computer-run villages', () => {
    const awards = battleRenown({ ...base, defender: { eligible: false, points: 1000 } });
    assert.equal(awards[1]?.skipped, 'forbidden');
    assert.equal(awards[1]?.renown, 0);
    assert.equal(awards[1]?.counted, 0);
    assert.equal(awards[0]?.skipped, undefined);
    const none = battleRenown({ ...base, attacker: { eligible: false, points: 1000 } });
    assert.equal(none[0]?.skipped, 'forbidden');
  });

  it('pays nothing and counts nothing under the minimum value', () => {
    const poke = result({ defenderLosses: units({ pikeman: 2 }) }); // 210 < minimum
    assert.ok(troopValue(units({ pikeman: 2 })) < RENOWN_MIN_BATTLE_VALUE);
    const att = battleRenown({ ...base, result: poke })[0]!;
    assert.equal(att.skipped, 'min_value');
    assert.equal(att.renown, 0);
    assert.equal(att.counted, 0);
    // The minimum looks at resource value, not Renown: exactly the minimum pays.
    const edge = battleRenown({ ...base, result: result({ loot: res(RENOWN_MIN_BATTLE_VALUE, 0, 0, 0) }) })[0]!;
    assert.equal(edge.skipped, undefined);
    assert.ok(edge.renown > 0);
  });

  it('multiplies by the size factor after the pair window', () => {
    const tiny = battleRenown({ ...base, defender: { eligible: true, points: 50 } })[0]!;
    const normal = battleRenown(base)[0]!;
    assert.ok(near(tiny.renown, normal.renown * RENOWN_SMALL_FLOOR));
    assert.equal(tiny.counted, normal.counted); // the window still counts the full raw Renown
    // The defender is hitting-back "up": the attacker is the opponent there, with 50 points against 1000.
    const def = battleRenown({ ...base, attacker: { eligible: true, points: 50 } })[1]!;
    assert.ok(near(def.renown, battleRenown(base)[1]!.renown * RENOWN_SMALL_FLOOR));
  });

  it('splits defence credit to support owners with their own eligibility', () => {
    const r = result({ attackerLosses: units({ raider: 10 }), attackerSurvivors: units({}), defenderUnits: units({ pikeman: 10 }) });
    const awards = battleRenown({
      result: r,
      context: { support: [units({ guard: 10 })] },
      attacker: party,
      defender: party,
      support: [{ eligible: false, points: 1000 }],
      pairValue: () => 0,
    });
    assert.equal(awards[2]?.side, 'support');
    assert.equal(awards[2]?.skipped, 'forbidden');
    assert.ok(awards[1]!.renown > 0);
  });

  it('a lost raid with no loot and no kills earns nothing', () => {
    const awards = battleRenown({ ...base, result: result({ attackerWon: false, attackerLosses: units({ raider: 10 }), attackerSurvivors: units({}) }) });
    assert.equal(awards[0]?.value, 0);
    assert.equal(awards[0]?.skipped, 'min_value');
  });
});
