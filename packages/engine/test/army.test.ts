import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BATTLE_LUCK,
  GameError,
  applyAttackerLosses,
  applyBattleToDefender,
  applyReturn,
  applySend,
  armySpeed,
  checkSend,
  createNpcVillage,
  distance,
  emptyResources,
  mulberry32,
  resolveBattle,
  storageCap,
  travelTimeMs,
  waterFillLoot,
  applyTrain,
} from '../src/index.ts';
import type { BattleResult, Units, VillageState } from '../src/index.ts';
import { HOUR, S1, S10, near, units, village } from './helpers.ts';

const ORIGIN = { x: 0, y: 0 };

describe('travel', () => {
  it('army speed is the slowest unit present', () => {
    assert.equal(armySpeed(units({})), 0);
    assert.equal(armySpeed(units({ raider: 5, outrider: 5 })), 6);
    assert.equal(armySpeed(units({ knight: 1, outrider: 9 })), 10);
    assert.equal(armySpeed(units({ pikeman: 0, outrider: 5 })), 14);
    assert.equal(armySpeed(units({ guard: 1, raider: 100, knight: 3 })), 5);
  });

  it('travel time is ceil(distance / speed) in ms, using the slowest unit and world speed', () => {
    const target = { x: 3, y: 4 }; // distance 5
    assert.equal(distance(ORIGIN, target), 5);
    assert.equal(travelTimeMs(ORIGIN, target, units({ raider: 10 }), S1), 3_000_000); // 5 / 6 h
    assert.equal(travelTimeMs(ORIGIN, target, units({ outrider: 10 }), S1), 1_285_715); // 5 / 14 h, rounded up
    assert.equal(travelTimeMs(ORIGIN, target, units({ raider: 1, outrider: 10 }), S1), 3_000_000); // mixed: raiders set the pace
    assert.equal(travelTimeMs(ORIGIN, target, units({ raider: 1, outrider: 10 }), S10), 300_000);
    assert.equal(travelTimeMs(ORIGIN, target, units({ knight: 1, outrider: 10 }), S1), 1_800_000);
    assert.equal(travelTimeMs(ORIGIN, ORIGIN, units({ raider: 1 }), S1), 0);
    assert.equal(travelTimeMs(ORIGIN, target, units({}), S1), Infinity);
  });

  it('is symmetric and grows with distance', () => {
    const a = { x: -10, y: 7 };
    const b = { x: 25, y: -3 };
    const army = units({ guard: 4 });
    assert.equal(travelTimeMs(a, b, army, S1), travelTimeMs(b, a, army, S1));
    assert.ok(travelTimeMs(a, b, army, S1) > travelTimeMs(a, { x: -9, y: 7 }, army, S1));
  });
});

describe('checkSend / applySend', () => {
  const home = (): VillageState => village({ troops: { raider: 10, pikeman: 5, outrider: 2 } });

  it('normalises a partial army to full Units', () => {
    const c = checkSend(home(), { raider: 4, pikeman: 0 });
    assert.ok(c.ok);
    if (c.ok) assert.deepEqual(c.units, units({ raider: 4 }));
  });

  it('refuses empty, unaffordable and malformed armies', () => {
    const reason = (u: unknown): string | undefined => {
      const c = checkSend(home(), u as Partial<Units>);
      return c.ok ? undefined : c.reason;
    };
    assert.equal(reason({}), 'no_troops');
    assert.equal(reason({ raider: 0 }), 'no_troops');
    assert.equal(reason({ raider: 11 }), 'not_enough_troops');
    assert.equal(reason({ knight: 1 }), 'not_enough_troops');
    assert.equal(reason({ raider: -1 }), 'invalid_input');
    assert.equal(reason({ raider: 1.5 }), 'invalid_input');
    assert.equal(reason({ raider: '3' }), 'invalid_input');
    assert.equal(reason({ raider: Number.NaN }), 'invalid_input');
    assert.equal(reason({ raider: 1e12 }), 'invalid_input');
    assert.equal(reason({ dragon: 1 }), 'invalid_input');
    assert.equal(reason({ constructor: 1 }), 'invalid_input');
    assert.equal(reason(JSON.parse('{"__proto__": 1}')), 'invalid_input');
    assert.equal(reason(null), 'invalid_input');
    assert.equal(reason([1, 2]), 'invalid_input');
    assert.equal(reason('raider'), 'invalid_input');
  });

  it('applySend moves units from troops to away', () => {
    const out = applySend(home(), { raider: 4, outrider: 2 }, 0, S1);
    assert.equal(out.troops.raider, 6);
    assert.equal(out.troops.outrider, 0);
    assert.equal(out.away.raider, 4);
    assert.equal(out.away.outrider, 2);
    assert.equal(out.troops.pikeman, 5);
  });

  it('applySend throws GameError with the check reason', () => {
    const run = (u: Partial<Units>): unknown => {
      try {
        applySend(home(), u, 0, S1);
      } catch (e) {
        return e;
      }
      return undefined;
    };
    const none = run({}) as GameError;
    assert.ok(none instanceof GameError && none.code === 'no_troops');
    assert.equal((run({ raider: 99 }) as GameError).code, 'not_enough_troops');
    assert.equal((run({ raider: -3 }) as GameError).code, 'invalid_input');
  });

  it('applySend settles first so freshly trained units can be sent', () => {
    const base = village({ buildings: { barracks: 1 }, resources: { wood: 1000, food: 1000, iron: 1000 } });
    const training = applyTrain(base, 'pikeman', 2, 0, S1);
    assert.equal(checkSend(training, { pikeman: 1 }).ok, false);
    const out = applySend(training, { pikeman: 1 }, 270_000, S1);
    assert.equal(out.away.pikeman, 1);
    assert.equal(out.troops.pikeman, 0);
    assert.equal(out.lastUpdate, 270_000);
  });
});

describe('resolveBattle', () => {
  const defenderOf = (over: Parameters<typeof village>[0]): VillageState => village(over);

  it('is deterministic for a seed and luck comes from mulberry32', () => {
    const input = { attackerUnits: units({ raider: 50, outrider: 10 }), defender: defenderOf({ troops: { pikeman: 20 }, buildings: { wall: 2 } }), seed: 7 };
    const a = resolveBattle(input);
    assert.deepEqual(resolveBattle(input), a);
    assert.equal(a.luck, mulberry32(7)() * 2 * BATTLE_LUCK - BATTLE_LUCK);
    assert.ok(a.luck >= -BATTLE_LUCK && a.luck < BATTLE_LUCK);
    assert.notEqual(resolveBattle({ ...input, seed: 8 }).luck, a.luck);
    for (let seed = 0; seed < 200; seed++) {
      const luck = resolveBattle({ ...input, seed }).luck;
      assert.ok(luck >= -BATTLE_LUCK && luck < BATTLE_LUCK);
    }
  });

  it('weighs defenders against the infantry/cavalry mix of the attack, plus wall', () => {
    const defender = defenderOf({ troops: { pikeman: 20, guard: 10 }, buildings: { wall: 2 } });
    const mixed = resolveBattle({ attackerUnits: units({ raider: 50, outrider: 10 }), defender, seed: 3 });
    const si = 2000 / 2600;
    const sc = 1 - si;
    const dUnits = 20 * (15 * si + 45 * sc) + 10 * (45 * si + 25 * sc);
    assert.ok(near(mixed.defensePower, (dUnits + 20 + 15 * 2) * (1 + 0.05 * 2), 1e-9));
    assert.ok(near(mixed.attackPower, 2600 * (1 + mixed.luck), 1e-9));

    const infantryOnly = resolveBattle({ attackerUnits: units({ raider: 10 }), defender, seed: 3 });
    assert.ok(near(infantryOnly.defensePower, (20 * 15 + 10 * 45 + 20 + 30) * 1.1, 1e-9));
    const cavalryOnly = resolveBattle({ attackerUnits: units({ outrider: 10 }), defender, seed: 3 });
    assert.ok(near(cavalryOnly.defensePower, (20 * 45 + 10 * 25 + 20 + 30) * 1.1, 1e-9));
  });

  it('attacker wins: loses (D/A)^1.5 of each unit, every defender dies', () => {
    const attackerUnits = units({ raider: 100, outrider: 0 });
    const defender = defenderOf({ troops: { pikeman: 100 }, resources: { wood: 500, food: 500, iron: 500, gold: 0 } });
    const r = resolveBattle({ attackerUnits, defender, seed: 11 });
    assert.ok(r.attackerWon);
    assert.ok(near(r.defensePower, 100 * 15 + 20, 1e-9));
    const expectedLoss = Math.round(100 * Math.pow(r.defensePower / r.attackPower, 1.5));
    assert.ok(expectedLoss > 10 && expectedLoss < 40);
    assert.equal(r.attackerLosses.raider, expectedLoss);
    assert.equal(r.attackerSurvivors.raider, 100 - expectedLoss);
    assert.deepEqual(r.defenderLosses, defender.troops);
    assert.deepEqual(r.defenderUnits, defender.troops);
    assert.ok(r.loot.wood > 0);
    // Survivors carry 30 each; capacity 30 * survivors split over wood/food/iron (500 stock each).
    const capacity = 30 * r.attackerSurvivors.raider;
    assert.equal(r.loot.wood + r.loot.food + r.loot.iron + r.loot.gold, Math.min(capacity, 1500));
  });

  it('defender wins: loses (A/D)^1.5 of each unit, every attacker dies, no loot', () => {
    const attackerUnits = units({ raider: 20 });
    const defender = defenderOf({ troops: { guard: 20 }, resources: { wood: 900, food: 900, iron: 900, gold: 900 } });
    const r = resolveBattle({ attackerUnits, defender, seed: 5 });
    assert.ok(!r.attackerWon);
    assert.deepEqual(r.attackerLosses, attackerUnits);
    assert.deepEqual(r.attackerSurvivors, units({}));
    assert.equal(r.defenderLosses.guard, Math.round(20 * Math.pow(r.attackPower / r.defensePower, 1.5)));
    assert.ok(r.defenderLosses.guard > 0 && r.defenderLosses.guard < 20);
    assert.deepEqual(r.loot, emptyResources());
  });

  it('an empty attack loses to even an empty village (wall militia)', () => {
    const r = resolveBattle({ attackerUnits: units({}), defender: defenderOf({}), seed: 1 });
    assert.ok(!r.attackerWon);
    assert.equal(r.attackPower, 0);
    assert.ok(r.defensePower > 0);
    assert.deepEqual(r.loot, emptyResources());
  });

  it('the wall raises defense', () => {
    const attackerUnits = units({ raider: 30 });
    const bare = resolveBattle({ attackerUnits, defender: defenderOf({ troops: { pikeman: 40 } }), seed: 2 });
    const walled = resolveBattle({ attackerUnits, defender: defenderOf({ troops: { pikeman: 40 }, buildings: { wall: 10 } }), seed: 2 });
    assert.ok(walled.defensePower > bare.defensePower * 1.5);
  });

  it('loot is split evenly (water-filling) among resources with stock', () => {
    // 20 raiders: attack 720-880 vs defense 20 -> no losses, capacity 600.
    const defender = defenderOf({ resources: { wood: 1000, food: 500, iron: 100, gold: 0 } });
    const r = resolveBattle({ attackerUnits: units({ raider: 20 }), defender, seed: 4 });
    assert.ok(r.attackerWon);
    assert.equal(r.attackerSurvivors.raider, 20);
    assert.deepEqual(r.loot, { wood: 250, food: 250, iron: 100, gold: 0 });
  });

  it('the vault protects its amount of each resource and loot is whole numbers', () => {
    const defender = defenderOf({
      buildings: { vault: 1 }, // hides 120 of each
      resources: { wood: 1000.7, food: 100, iron: 500, gold: 130 },
    });
    const r = resolveBattle({ attackerUnits: units({ raider: 200 }), defender, seed: 4 });
    assert.ok(r.attackerWon);
    assert.deepEqual(r.loot, { wood: 880, food: 0, iron: 380, gold: 10 });
    const after = applyBattleToDefender(defender, r);
    assert.ok(near(after.resources.wood, 120.7));
    assert.equal(after.resources.food, 100);
    assert.equal(after.resources.iron, 120);
    assert.equal(after.resources.gold, 120);
  });

  it('loot never exceeds carrying capacity', () => {
    const defender = defenderOf({ resources: { wood: 1000, food: 1000, iron: 1000, gold: 1000 } });
    const r = resolveBattle({ attackerUnits: units({ raider: 20 }), defender, seed: 4 });
    assert.deepEqual(r.loot, { wood: 150, food: 150, iron: 150, gold: 150 });
  });

  it('loot is always full: min(survivors carry, lootable stock), the same for every raid (owner 2026-11-05)', () => {
    const rich = defenderOf({ resources: { wood: 1000, food: 1000, iron: 1000, gold: 1000 } });
    const total = (r: BattleResult): number => r.loot.wood + r.loot.food + r.loot.iron + r.loot.gold;
    assert.equal(total(resolveBattle({ attackerUnits: units({ raider: 20 }), defender: rich, seed: 4 })), 600);
    // Mixed army: each unit type carries its own amount.
    const mixed = resolveBattle({ attackerUnits: units({ raider: 10, outrider: 10 }), defender: rich, seed: 4 });
    assert.equal(total(mixed), Math.floor(mixed.attackerSurvivors.raider * 30 + mixed.attackerSurvivors.outrider * 70));
    // A poor village gives only what it has.
    const poor = defenderOf({ resources: { wood: 10, food: 0, iron: 5, gold: 0 } });
    assert.deepEqual(resolveBattle({ attackerUnits: units({ raider: 20 }), defender: poor, seed: 4 }).loot, { wood: 10, food: 0, iron: 5, gold: 0 });
    // Raiding the same village again changes nothing about the rule: same army, same stock, same load.
    const again = resolveBattle({ attackerUnits: units({ raider: 20 }), defender: rich, seed: 4 });
    assert.deepEqual(again.loot, { wood: 150, food: 150, iron: 150, gold: 150 });
  });

  it('noLoot (Strike attempts, relief, sites) takes nothing and changes nothing about the fight', () => {
    const defender = defenderOf({ resources: { wood: 1000, food: 1000, iron: 1000, gold: 1000 } });
    const a = resolveBattle({ attackerUnits: units({ raider: 20 }), defender, seed: 4, noLoot: true });
    const b = resolveBattle({ attackerUnits: units({ raider: 20 }), defender, seed: 4 });
    assert.deepEqual(a.loot, emptyResources());
    assert.equal(a.attackerWon, b.attackerWon);
    assert.deepEqual(a.attackerLosses, b.attackerLosses);
  });
});

describe('waterFillLoot', () => {
  it('splits evenly, redistributes what small stocks cannot take, and hands out remainders in order', () => {
    const stock = { wood: 1000, food: 1000, iron: 1000, gold: 1000 };
    assert.deepEqual(waterFillLoot(45, stock), { wood: 12, food: 11, iron: 11, gold: 11 });
    assert.deepEqual(waterFillLoot(2, stock), { wood: 1, food: 1, iron: 0, gold: 0 });
    assert.deepEqual(waterFillLoot(0, stock), emptyResources());
    assert.deepEqual(waterFillLoot(600, { wood: 1000, food: 500, iron: 100, gold: 0 }), { wood: 250, food: 250, iron: 100, gold: 0 });
    assert.deepEqual(waterFillLoot(10_000, { wood: 5, food: 0, iron: 7, gold: 1 }), { wood: 5, food: 0, iron: 7, gold: 1 });
    assert.deepEqual(waterFillLoot(100, emptyResources()), emptyResources());
  });
});

describe('applying battle results', () => {
  const result = (over: Partial<BattleResult>): BattleResult => ({
    attackerWon: true,
    luck: 0,
    attackPower: 0,
    defensePower: 0,
    attackerLosses: units({}),
    attackerSurvivors: units({}),
    defenderUnits: units({}),
    defenderLosses: units({}),
    supportLosses: [],
    loot: emptyResources(),
    wallDuring: 0,
    ...over,
  });

  it('applyBattleToDefender removes losses and loot, never below zero', () => {
    const d = village({ troops: { pikeman: 10, guard: 2 }, resources: { wood: 100, food: 50, iron: 10, gold: 5 } });
    const out = applyBattleToDefender(
      d,
      result({ defenderLosses: units({ pikeman: 4, guard: 5 }), loot: { wood: 30, food: 60, iron: 0, gold: 5 } }),
    );
    assert.equal(out.troops.pikeman, 6);
    assert.equal(out.troops.guard, 0);
    assert.deepEqual(out.resources, { wood: 70, food: 0, iron: 10, gold: 0 });
  });

  it('applyAttackerLosses reduces away only', () => {
    const o = village({ troops: { raider: 3 }, away: { raider: 10, outrider: 4 } });
    const out = applyAttackerLosses(o, units({ raider: 4, outrider: 9 }));
    assert.equal(out.away.raider, 6);
    assert.equal(out.away.outrider, 0);
    assert.equal(out.troops.raider, 3);
  });

  it('applyReturn settles, brings survivors home and adds loot clamped to the cap', () => {
    const o = village({ troops: { raider: 3 }, away: { raider: 7 }, resources: { wood: 900, food: 100, iron: 100, gold: 1500 } });
    const out = applyReturn(o, units({ raider: 7 }), { wood: 500, food: 200, iron: 0, gold: 40 }, HOUR, S1);
    assert.equal(out.lastUpdate, HOUR);
    assert.equal(out.away.raider, 0);
    assert.equal(out.troops.raider, 10);
    assert.equal(storageCap(out), 1000);
    assert.equal(out.resources.wood, 1000); // 930 produced + 500 loot, clamped
    assert.ok(out.resources.food > 100 + 200 - 1e-6 && out.resources.food < 1000); // production, plus loot
    assert.equal(out.resources.gold, 1500); // above the cap already: left alone
  });

  it('a full raid round trip keeps units and loot consistent', () => {
    const npc = createNpcVillage(2, 0);
    const raiders = units({ raider: 40 });
    const origin = applySend(village({ troops: { raider: 40 } }), raiders, 0, S1);
    assert.equal(origin.away.raider, 40);
    const arrive = travelTimeMs(ORIGIN, { x: 6, y: 8 }, raiders, S1);
    assert.equal(arrive, Math.ceil((10 * HOUR) / 6));
    const r = resolveBattle({ attackerUnits: raiders, defender: npc, seed: 99 });
    const afterBattle = applyAttackerLosses(origin, r.attackerLosses);
    assert.equal(afterBattle.away.raider, r.attackerSurvivors.raider);
    const defenderAfter = applyBattleToDefender(npc, r);
    for (const id of ['wood', 'food', 'iron', 'gold'] as const) {
      assert.ok(defenderAfter.resources[id] >= 0);
      assert.ok(near(defenderAfter.resources[id], npc.resources[id] - r.loot[id]));
    }
    const home = applyReturn(afterBattle, r.attackerSurvivors, r.loot, 2 * arrive, S1);
    assert.equal(home.troops.raider, r.attackerSurvivors.raider);
    assert.equal(home.away.raider, 0);
  });
});

