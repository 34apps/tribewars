// Battle simulator: the three luck columns are the real engine battle with fixed luck; prefill from reports and the send form.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BATTLE_LUCK, UNITS, emptyUnits, normalizeUnits, resolveBattle } from '@clanfire/engine';
import type { BattleReportData, ReportDto, ScoutReportData, Units } from '@clanfire/engine';
import {
  SIM_LUCKS,
  battleInput,
  draftFromReport,
  draftFromSend,
  hasTroops,
  parseCount,
  simulate,
  simulateAll,
  textFromUnits,
  unitsFromText,
} from '../src/simulator.ts';
import type { SimSetup } from '../src/simulator.ts';

const units = (u: Partial<Units>): Units => normalizeUnits(u);

const setup = (over: Partial<SimSetup> = {}): SimSetup => ({
  attacker: units({ raider: 60, outrider: 10 }),
  defender: units({ pikeman: 30 }),
  support: emptyUnits(),
  wall: 3,
  defenderBulwark: 0,
  supportBulwark: 0,
  siegeTarget: null,
  targetLevel: 0,
  ...over,
});

test('the three results are the engine battle with luck -10%, 0 and +10%', () => {
  const s = setup();
  const all = simulateAll(s);
  assert.deepEqual(
    all.map((o) => o.luck),
    SIM_LUCKS.map((l) => l.luck),
  );
  assert.deepEqual([all[0]!.luck, all[2]!.luck], [-BATTLE_LUCK, BATTLE_LUCK]);
  for (const [i, l] of SIM_LUCKS.entries()) {
    const direct = resolveBattle({ ...battleInput(s, l.luck) });
    assert.deepEqual(all[i]!.result, direct);
  }
  // Better luck, more attack power, never worse for the attacker.
  assert.ok(all[0]!.result.attackPower < all[1]!.result.attackPower && all[1]!.result.attackPower < all[2]!.result.attackPower);
});

test('survivors, carry and defender survivors add up', () => {
  const o = simulate(setup({ attacker: units({ raider: 100 }), defender: units({ pikeman: 5 }), wall: 0 }), 0);
  assert.equal(o.result.attackerWon, true);
  assert.equal(o.attackerSurvivors.raider + o.result.attackerLosses.raider, 100);
  assert.equal(o.carry, o.attackerSurvivors.raider * UNITS.raider.carry);
  assert.equal(o.defenderSurvivors.pikeman, 0);
});

test('empty armies: no troops is not ready, an empty defender still meets the bare Wall', () => {
  assert.equal(hasTroops(emptyUnits()), false);
  const none = simulate(setup({ attacker: emptyUnits(), defender: emptyUnits(), wall: 0 }), 0);
  assert.equal(none.result.attackerWon, false);
  assert.ok(none.result.attackPower === 0 && none.result.defensePower > 0);
  const raid = simulate(setup({ attacker: units({ raider: 5 }), defender: emptyUnits(), wall: 0 }), 0);
  assert.equal(raid.result.attackerWon, true);
  assert.deepEqual(raid.result.defenderLosses, emptyUnits());
});

test('Wall: more levels raise the defence; Log Rams lower it (before -> after)', () => {
  const low = simulate(setup({ wall: 0 }), 0).result.defensePower;
  const high = simulate(setup({ wall: 10 }), 0).result.defensePower;
  assert.ok(high > low);
  const rams = simulate(setup({ attacker: units({ raider: 400, logram: 80 }), defender: units({ pikeman: 10 }), wall: 10 }), 0);
  assert.equal(rams.wallBefore, 10);
  assert.ok(rams.wallAfter < 10);
  assert.equal(rams.wallAfter, (rams.result.siege ?? []).filter((h) => h.building === 'wall').at(-1)!.to);
  const plain = simulate(setup({ wall: 10 }), 0);
  assert.equal(plain.wallAfter, 10);
});

test('Boulder Slings hit the picked building at the typed level', () => {
  const o = simulate(setup({ attacker: units({ raider: 300, boulder: 40 }), defender: units({ pikeman: 5 }), wall: 0, siegeTarget: 'market', targetLevel: 5 }), 0);
  const hit = (o.result.siege ?? []).find((h) => h.building === 'market');
  assert.ok(hit);
  assert.equal(hit.from, 5);
  assert.ok(hit.to < 5);
  assert.equal(battleInput(setup({ siegeTarget: 'market', targetLevel: 5 }), 0).defender.buildings.market, 5);
});

test('ranks: Might on my army and Bulwark on the defender change the powers', () => {
  const base = simulate(setup(), 0).result;
  const ranks = { raider: { might: 5, bulwark: 0, keen: 0 } };
  assert.ok(simulate(setup({ attackerRanks: ranks }), 0).result.attackPower > base.attackPower);
  assert.ok(simulate(setup({ defenderBulwark: 5 }), 0).result.defensePower > base.defensePower);
});

test('support troops fight with the village and their losses are reported', () => {
  const o = simulate(setup({ attacker: units({ raider: 200 }), defender: units({ pikeman: 5 }), support: units({ guard: 20 }), wall: 0 }), 0);
  assert.ok(o.result.defensePower > simulate(setup({ attacker: units({ raider: 200 }), defender: units({ pikeman: 5 }), wall: 0 }), 0).result.defensePower);
  assert.equal(o.supportSurvivors.guard + (o.result.supportLosses[0]?.guard ?? 0), 20);
});

test('text helpers: blank, negative, decimals and huge numbers', () => {
  assert.equal(parseCount(''), 0);
  assert.equal(parseCount('-4'), 0);
  assert.equal(parseCount('7.9'), 7);
  assert.equal(parseCount('abc'), 0);
  assert.equal(parseCount('99999999999'), 1_000_000);
  assert.deepEqual(unitsFromText(textFromUnits({ raider: 4, pikeman: 0 })), units({ raider: 4 }));
});

const battle = (over: Partial<BattleReportData> = {}): BattleReportData => ({
  outcome: 'battle',
  attacker: { villageId: 1, name: 'A', x: 0, y: 0, ownerName: 'me' },
  defender: { villageId: 2, name: 'D', x: 3, y: 4, ownerName: 'you' },
  attackerWon: true,
  luck: 0.02,
  attackPower: 500,
  defensePower: 300,
  attackerUnits: units({ raider: 80, logram: 4 }),
  attackerLosses: units({ raider: 20 }),
  defenderUnits: units({ pikeman: 25 }),
  defenderLosses: units({ pikeman: 25 }),
  supportUnits: units({ guard: 7 }),
  supportLosses: units({ guard: 7 }),
  wallLevel: 5,
  loot: { wood: 0, food: 0, iron: 0, gold: 0 } as BattleReportData['loot'],
  ...over,
});

const report = (side: ReportDto['side'], over: Partial<ReportDto>): ReportDto =>
  ({ id: 1, createdAt: 0, title: 't', side, type: 'battle', won: true, read: true, outcome: 'battle', battle: null, scout: null, support: null, shipment: null, village: null, ...over }) as ReportDto;

test('prefill from a battle report: defender, support, Wall; my army only when I attacked', () => {
  const mine = draftFromReport(report('attack', { battle: battle() }))!;
  assert.deepEqual(mine.attacker, units({ raider: 80, logram: 4 }));
  assert.deepEqual(mine.defender, units({ pikeman: 25 }));
  assert.deepEqual(mine.support, units({ guard: 7 }));
  assert.equal(mine.wall, 5);
  const theirs = draftFromReport(report('defense', { battle: battle() }))!;
  assert.equal(theirs.attacker, undefined);
  assert.deepEqual(theirs.defender, units({ pikeman: 25 }));
});

test('prefill: the Wall is the level before the rams when the report shows the hit; hidden parts stay unset', () => {
  const d = draftFromReport(
    report('attack', { battle: battle({ siege: [{ unit: 'logram', building: 'wall', from: 9, to: 6 }], wallLevel: 8 }) }),
  )!;
  assert.equal(d.wall, 9);
  const hidden = draftFromReport(report('attack', { battle: battle({ defenderUnits: null, supportUnits: null, wallLevel: null }) }))!;
  assert.equal(hidden.defender, undefined);
  assert.equal(hidden.support, undefined);
  assert.equal(hidden.wall, undefined);
  assert.ok(hidden.attacker);
});

test('prefill from a scout report: only a success shows troops and Wall; other reports give nothing', () => {
  const scout = (success: boolean, intel: ScoutReportData['intel']): ReportDto =>
    report('attack', {
      type: 'scout',
      scout: { scout: battle().attacker, target: battle().defender, success, scoutsSent: 3, scoutsLost: 0, defenderScouts: 0, defenderScoutsLost: 0, intel },
    });
  const intel = { resources: battle().loot, troops: units({ guard: 12 }), wallLevel: 4, buildings: null } as ScoutReportData['intel'];
  assert.deepEqual(draftFromReport(scout(true, intel)), { defender: units({ guard: 12 }), wall: 4 });
  assert.equal(draftFromReport(scout(false, null)), null);
  assert.equal(draftFromReport(scout(true, { ...intel!, troops: null, wallLevel: null })), null);
  assert.equal(draftFromReport(report('attack', { battle: battle({ outcome: 'called_off' }) })), null);
  assert.equal(draftFromReport(report('attack', { type: 'shipment' })), null);
});

test('prefill from the send form: my chosen troops only, defender stays empty', () => {
  const d = draftFromSend({ raider: 12 });
  assert.deepEqual(d, { attacker: { raider: 12 } });
  assert.equal(d.defender, undefined);
});
