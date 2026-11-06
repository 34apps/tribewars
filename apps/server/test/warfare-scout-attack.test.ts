// Attacks that carry Pathfinders (owner, 2026-11-06): Pathfinders alone scout; with other troops they scout first, then the
// rest fights. GAME_DESIGN.md section 12. Nothing here waits on real time or on battle luck: villages are empty or hugely
// outnumbered, so every battle outcome is certain whatever the per-database luck salt.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveScouting } from '@clanfire/engine';
import { newPlayer, formPact } from './tribe-helpers.ts';
import { giveKeen, giveTroops, latestReport, movementsOf, report, reports, sendFails, sendOk, village, world, type P } from './warfare-helpers.ts';

/** The player's newest report of a type, opened in full. */
async function reportOfType(p: P, type: 'battle' | 'scout') {
  const row = (await reports(p)).find((r) => r.type === type);
  assert.ok(row, `a ${type} report exists`);
  return report(p, row.id);
}

test('an attack with only Pathfinders scouts: a scout report with intel, no battle report, survivors walk home', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, bob, { pikeman: 4 });
  giveTroops(app, alice, { pathfinder: 5 });
  giveKeen(app, alice, 5);
  const { movement } = await sendOk(alice, bob, 'attack', { pathfinder: 5 });
  assert.equal(movement.kind, 'scout');
  clock.set(movement.arriveAt);
  const mine = await reports(alice);
  assert.deepEqual(mine.map((r) => r.type), ['scout']);
  const s = (await latestReport(alice)).scout;
  assert.ok(s?.success && s.intel);
  assert.equal(s.intel.troops?.pikeman, 4);
  assert.equal((await reports(bob)).length, 0, 'no defending Pathfinder: the target is not told');
  const ret = (await movementsOf(alice))[0];
  assert.deepEqual([ret?.kind, ret?.units?.pathfinder], ['return', 5]);
  await app.close();
});

test('a mixed attack scouts first, then fights: a scout report with intel and a battle report; Pathfinders take no battle losses', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, bob, { pikeman: 2 });
  giveTroops(app, alice, { pathfinder: 5, raider: 60 });
  giveKeen(app, alice, 5);
  const bobVillage = await village(bob);
  const { movement } = await sendOk(alice, bob, 'attack', { pathfinder: 5, raider: 60 });
  assert.equal(movement.kind, 'attack');
  clock.set(movement.arriveAt);

  const scout = (await reportOfType(alice, 'scout')).scout;
  assert.ok(scout);
  assert.deepEqual([scout.success, scout.scoutsSent, scout.scoutsLost], [true, 5, 0]);
  assert.equal(scout.intel?.troops?.pikeman, 2, 'the intel is the village as it stood on arrival, before the battle');

  const battle = (await reportOfType(alice, 'battle')).battle;
  assert.ok(battle);
  assert.equal(battle.attackerWon, true);
  assert.equal(battle.attackerUnits.pathfinder, 0, 'Pathfinders are not part of the battle');
  assert.equal(battle.attackerUnits.raider, 60);
  assert.equal(battle.attackerLosses.pathfinder, 0);
  assert.equal(battle.defenderUnits?.pikeman, 2);

  // The raiders that lived and all five Pathfinders walk home together.
  const ret = (await movementsOf(alice))[0];
  assert.equal(ret?.kind, 'return');
  assert.equal(ret?.units?.pathfinder, 5);
  assert.equal(ret?.units?.raider, 60 - battle.attackerLosses.raider);
  assert.equal(ret?.origin.villageId, bobVillage.id);
  assert.equal((await village(alice)).state.away.pathfinder, 5);
  clock.set(ret?.arriveAt ?? 0);
  assert.equal((await village(alice)).state.troops.pathfinder, 5);
  await app.close();
});

test('a mixed attack: duel losses use the Pathfinders sent, and the defending Pathfinders are spotted-reported; the army still fights', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, bob, { pathfinder: 3 });
  giveTroops(app, alice, { pathfinder: 7, raider: 60 });
  const expected = resolveScouting({ scouts: 7, defenderScouts: 3 });
  assert.equal(expected.success, true);
  const { movement } = await sendOk(alice, bob, 'attack', { pathfinder: 7, raider: 60 });
  clock.set(movement.arriveAt);
  const scout = (await reportOfType(alice, 'scout')).scout;
  assert.deepEqual([scout?.scoutsSent, scout?.scoutsLost], [7, expected.scoutLosses]);
  const ret = (await movementsOf(alice))[0];
  assert.equal(ret?.units?.pathfinder, 7 - expected.scoutLosses);
  // The defender had Pathfinders at home: spotted report and battle report, both.
  const theirs = await reports(bob);
  assert.deepEqual(theirs.map((r) => r.type).sort(), ['battle', 'scout']);
  assert.equal((await reportOfType(bob, 'scout')).scout?.intel, null, 'the target gets no intel');
  await app.close();
});

test('the fighters are wiped out but the Pathfinders walk home alone', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, bob, { pikeman: 300, guard: 100 });
  giveTroops(app, alice, { pathfinder: 4, raider: 1 });
  const { movement } = await sendOk(alice, bob, 'attack', { pathfinder: 4, raider: 1 });
  clock.set(movement.arriveAt);
  const battle = (await reportOfType(alice, 'battle')).battle;
  assert.ok(battle);
  assert.equal(battle.attackerWon, false);
  assert.equal(battle.attackerLosses.raider, 1);
  assert.equal(battle.attackerLosses.pathfinder, 0);
  const scout = (await reportOfType(alice, 'scout')).scout;
  assert.equal(scout?.success, true, 'the scouting came before the fight');
  const moves = await movementsOf(alice);
  assert.equal(moves.length, 1);
  assert.deepEqual([moves[0]?.kind, moves[0]?.units?.pathfinder, moves[0]?.units?.raider], ['return', 4, 0]);
  const home = (await village(alice)).state;
  assert.deepEqual([home.away.pathfinder, home.away.raider], [4, 0]);
  clock.set(moves[0]?.arriveAt ?? 0);
  assert.deepEqual([(await village(alice)).state.troops.pathfinder, (await village(alice)).state.away.pathfinder], [4, 0]);
  await app.close();
});

test('the defender sees a mixed attack as an incoming attack (units hidden); a Pathfinder-only one stays hidden', async () => {
  const { app, alice, bob, lou } = await world();
  giveTroops(app, alice, { pathfinder: 3, raider: 5 });
  giveTroops(app, lou, { pathfinder: 3, raider: 5 });
  await sendOk(alice, bob, 'attack', { pathfinder: 3, raider: 5 });
  await sendOk(lou, bob, 'attack', { pathfinder: 3 });
  const seen = await movementsOf(bob);
  assert.deepEqual(seen.map((m) => [m.kind, m.direction, m.units]), [['attack', 'incoming', null]]);
  await app.close();
});

test('protection and relations still apply to an attack with Pathfinders', async () => {
  const { app, alice, bob } = await world();
  giveTroops(app, alice, { pathfinder: 5, raider: 5 });
  const newbie = await newPlayer(app, 'newbie');
  // Beginner protection: refused whether the army is Pathfinders alone or mixed.
  assert.match(await sendFails(alice, newbie, 'attack', { pathfinder: 2 }, 409, 'target_protected'), /protection/);
  assert.match(await sendFails(alice, newbie, 'attack', { pathfinder: 2, raider: 2 }, 409, 'target_protected'), /protection/);
  // An ally cannot be scouted or attacked.
  await formPact(alice, 'BRAVO', bob, 'ally');
  await sendFails(alice, bob, 'attack', { pathfinder: 2 }, 409, 'target_protected');
  await sendFails(alice, bob, 'attack', { pathfinder: 2, raider: 2 }, 409, 'target_protected');
  // Your own village is no target either.
  await sendFails(alice, alice, 'attack', { pathfinder: 1 }, 400, 'invalid_target');
  assert.deepEqual(await movementsOf(alice), []);
  assert.equal((await village(alice)).state.away.pathfinder, 0);
  await app.close();
});

test('an old client that still sends the scout mission gets the same scouting march', async () => {
  const { app, alice, bob } = await world();
  giveTroops(app, alice, { pathfinder: 2 });
  const { movement } = await sendOk(alice, bob, 'scout', { pathfinder: 2 });
  assert.equal(movement.kind, 'scout');
  await app.close();
});
