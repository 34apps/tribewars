// One report per attack: Pathfinders riding inside an attack scout first (the same duel), and the result goes into the battle reports
// (`BattleReportData.scouting`) instead of a second, scout report. Scouting marches keep their own scout report.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keenMultiplier, resolveScouting } from '@clanfire/engine';
import { giveKeen, giveTroops, latestReport, reports, sendOk, village, world } from './warfare-helpers.ts';

test('an attack with Pathfinders gives exactly one report per side; the attacker\'s carries the scouting and its intel', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, bob, { pikeman: 4, pathfinder: 2 });
  giveTroops(app, alice, { raider: 40, pathfinder: 9 });
  giveKeen(app, alice, 2);
  const expected = resolveScouting({ scouts: 9, defenderScouts: 2, scoutMultiplier: keenMultiplier({ pathfinder: { might: 0, bulwark: 0, keen: 2 } }) });
  assert.equal(expected.success, true);
  const { movement } = await sendOk(alice, bob, 'attack', { raider: 40, pathfinder: 9 });
  clock.set(movement.arriveAt);

  const mine = await reports(alice);
  assert.equal(mine.length, 1, 'one report for the attacker');
  assert.deepEqual([mine[0]?.type, mine[0]?.side], ['battle', 'attack']);
  const b = (await latestReport(alice)).battle;
  assert.ok(b?.scouting);
  assert.equal(b.attackerUnits.pathfinder, 0, 'the army list does not count the scouts');
  assert.deepEqual([b.scouting.sent, b.scouting.lost, b.scouting.success, b.scouting.defenderScouts], [9, expected.scoutLosses, true, 2]);
  assert.ok(b.scouting.intel, 'intel on success');
  assert.equal(mine[0]?.digest?.again?.units.pathfinder, 9, 'raid again sends the Pathfinders too');

  const theirs = await reports(bob);
  assert.equal(theirs.length, 1, 'one report for the defender');
  const d = (await latestReport(bob)).battle;
  assert.ok(d?.scouting);
  assert.deepEqual([d.scouting.sent, d.scouting.lost, d.scouting.success, d.scouting.intel], [9, expected.scoutLosses, true, null]);
  await app.close();
});

test('failed scouts inside an attack: the attacker sees them caught in the one battle report', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, bob, { pikeman: 2, pathfinder: 30 });
  giveTroops(app, alice, { raider: 60, pathfinder: 3 });
  const { movement } = await sendOk(alice, bob, 'attack', { raider: 60, pathfinder: 3 });
  clock.set(movement.arriveAt);
  assert.equal((await reports(alice)).length, 1);
  const b = (await latestReport(alice)).battle;
  assert.deepEqual([b?.scouting?.success, b?.scouting?.lost, b?.scouting?.intel], [false, 3, null]);
  assert.equal((await village(alice)).state.away.pathfinder, 0);
  await app.close();
});

test('the troops hint and the Firecart picker read the intel of the merged report', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, bob, { pikeman: 6 });
  giveTroops(app, alice, { raider: 1, pathfinder: 5 });
  giveKeen(app, alice, 5);
  const target = await village(bob);
  const { movement } = await sendOk(alice, bob, 'attack', { raider: 1, pathfinder: 5 });
  clock.set(movement.arriveAt);
  // The lone Raider fell: the battle shows nothing of the defence, but the scouts saw it.
  const battle = (await latestReport(alice)).battle;
  assert.equal(battle?.defenderUnits, null);
  const hint = (await (await alice.c.get(`/api/intel/${target.id}`)).json()) as { source: string | null; troops: { pikeman: number } | null };
  assert.equal(hint.source, 'scout');
  assert.equal(hint.troops?.pikeman, 6);
  const scouted = (await (await alice.c.get(`/api/scouted/${target.id}`)).json()) as { buildings: unknown };
  assert.ok(scouted.buildings, 'building levels from the merged report');
  await app.close();
});

test('a scouting march (Pathfinders only) still writes its own scout report', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, alice, { pathfinder: 4 });
  const { movement } = await sendOk(alice, bob, 'scout', { pathfinder: 4 });
  clock.set(movement.arriveAt);
  const list = await reports(alice);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.type, 'scout');
  assert.equal((await latestReport(alice)).battle, null);
  await app.close();
});
