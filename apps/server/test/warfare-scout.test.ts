// Scouting missions: resolution, reports, intel, stealth (GAME_DESIGN.md section 12).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDING_IDS, RESOURCE_IDS, UNIT_IDS, keenMultiplier, resolveScouting, settleVillage, travelTimeMs } from '@clanfire/engine';
import { setBuilding } from './tribe-helpers.ts';
import { formPact, myTribe, newPlayer } from './tribe-helpers.ts';
import { ok, weakestAbandoned } from './helpers.ts';
import {
  giveKeen,
  giveTroops,
  latestReport,
  movementsOf,
  reports,
  sendOk,
  stateOf,
  stationSupport,
  unprotect,
  units,
  village,
  world,
} from './warfare-helpers.ts';

test('scouting a village with no Pathfinders succeeds untouched; the intel is exact; the target never knows', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, bob, { pikeman: 10, guard: 3 });
  setBuilding(app, bob.id, 'wall', 2);
  giveTroops(app, alice, { pathfinder: 5 });
  giveKeen(app, alice, 5); // full intel needs Keen 5 (section 15)
  const bobVillage = await village(bob);
  const home = await village(alice);

  const { movement } = await sendOk(alice, bob, 'scout', { pathfinder: 5 });
  // Stealth: while the scouts march, the target sees nothing -- no movement, no report, no alert.
  clock.set(movement.arriveAt - 1);
  const flying = await stateOf(bob);
  assert.deepEqual(flying.movements, []);
  assert.equal(flying.unreadReports, 0);
  assert.equal(flying.tribeAlerts, 0);
  assert.equal(JSON.stringify(flying).includes('scout'), false);

  clock.set(movement.arriveAt);
  const stored = app.ctx.store.getVillage(bobVillage.id);
  assert.ok(stored);
  const settled = settleVillage(stored.state, movement.arriveAt, app.ctx.settings);

  // The target: still nothing -- no Pathfinder spotted them.
  const after = await stateOf(bob);
  assert.equal(after.unreadReports, 0);
  assert.deepEqual(await reports(bob), []);
  assert.deepEqual(after.movements, []);
  assert.deepEqual(after.villages[0]?.state.troops, { ...units({}), pikeman: 10, guard: 3 }, 'nobody was hurt');

  // The sender: a scout report with the intel, no losses (nothing defended).
  const summary = (await reports(alice))[0];
  assert.deepEqual([summary?.type, summary?.side, summary?.won, summary?.read, summary?.createdAt, summary?.outcome], ['scout', 'attack', true, false, movement.arriveAt, 'battle']);
  assert.equal(summary?.title, `Scouting ${bobVillage.name} (${bobVillage.x}|${bobVillage.y})`);
  const full = await latestReport(alice);
  assert.equal(full.read, true);
  assert.deepEqual([full.battle, full.support], [null, null]);
  const s = full.scout;
  assert.ok(s);
  assert.deepEqual([s.success, s.scoutsSent, s.scoutsLost, s.defenderScouts, s.defenderScoutsLost], [true, 5, 0, 0, 0]);
  assert.deepEqual([s.scout.villageId, s.scout.ownerName, s.target.villageId, s.target.ownerName], [home.id, 'alice', bobVillage.id, 'bob']);
  assert.ok(s.intel);
  for (const r of RESOURCE_IDS) assert.equal(s.intel.resources[r], Math.floor(settled.resources[r]), `${r} is the floored stock at arrival`);
  assert.deepEqual(Object.keys(s.intel.buildings ?? {}).sort(), [...BUILDING_IDS].sort());
  assert.deepEqual(s.intel.buildings, settled.buildings);
  assert.equal(s.intel.wallLevel, 2);
  assert.deepEqual(Object.keys(s.intel.troops ?? {}).sort(), [...UNIT_IDS].sort());
  assert.deepEqual(s.intel.troops, { ...units({}), pikeman: 10, guard: 3 });

  // All five scouts walk home.
  const ret = (await movementsOf(alice))[0];
  assert.ok(ret);
  assert.deepEqual([ret.kind, ret.direction, ret.origin.villageId, ret.target.villageId, ret.departAt], ['return', 'outgoing', bobVillage.id, home.id, movement.arriveAt]);
  assert.equal(ret.units?.pathfinder, 5);
  assert.equal(ret.arriveAt - ret.departAt, travelTimeMs(bobVillage, home, ret.units ?? units({}), app.ctx.settings));
  assert.equal((await village(alice)).state.away.pathfinder, 5);
  clock.set(ret.arriveAt);
  const back = await village(alice);
  assert.deepEqual([back.state.troops.pathfinder, back.state.away.pathfinder], [5, 0]);
  assert.deepEqual(await movementsOf(alice), []);
  await app.close();
});

test('scouts that outnumber the defending Pathfinders get through but lose some; the defender is told, and the defenders lose none', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, bob, { pathfinder: 3, raider: 2 });
  giveTroops(app, alice, { pathfinder: 7 });
  giveKeen(app, alice, 2); // exact troops
  const expected = resolveScouting({ scouts: 7, defenderScouts: 3, scoutMultiplier: keenMultiplier({ pathfinder: { might: 0, bulwark: 0, keen: 2 } }) });
  assert.equal(expected.success, true);
  assert.ok(expected.scoutLosses > 0 && expected.scoutLosses < 7, 'some, not all, scouts are lost');

  const { movement } = await sendOk(alice, bob, 'scout', { pathfinder: 7 });
  clock.set(movement.arriveAt);

  const mine = (await latestReport(alice)).scout;
  assert.ok(mine);
  assert.deepEqual([mine.success, mine.scoutsSent, mine.scoutsLost, mine.defenderScouts, mine.defenderScoutsLost], [true, 7, expected.scoutLosses, 3, 0]);
  assert.ok(mine.intel, 'the sender sees the defending Pathfinders and the intel');
  assert.deepEqual([mine.intel.troops?.pathfinder, mine.intel.troops?.raider], [3, 2]);
  // The survivors return; the dead leave the sender's away count straight away.
  const survivors = 7 - expected.scoutLosses;
  assert.equal((await movementsOf(alice))[0]?.units?.pathfinder, survivors);
  assert.equal((await village(alice)).state.away.pathfinder, survivors);

  // The defender spotted them: a report, but no intel in it.
  const theirs = await latestReport(bob);
  assert.deepEqual([theirs.type, theirs.side, theirs.won, theirs.read], ['scout', 'defense', false, true]);
  assert.equal(theirs.title, `Enemy scouts from ${(await village(alice)).name} (${(await village(alice)).x}|${(await village(alice)).y})`);
  assert.ok(theirs.scout);
  assert.deepEqual(
    [theirs.scout.success, theirs.scout.scoutsSent, theirs.scout.scoutsLost, theirs.scout.defenderScouts, theirs.scout.defenderScoutsLost, theirs.scout.intel],
    [true, 7, expected.scoutLosses, 3, 0, null],
  );
  assert.equal(theirs.scout.scout.ownerName, 'alice');
  assert.equal((await village(bob)).state.troops.pathfinder, 3, 'the defenders lost none');
  await app.close();
});

test('failed scouting: every scout is caught, the sender learns nothing, the defender loses own Pathfinders first', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, bob, { pathfinder: 6, pikeman: 4 });
  giveTroops(app, alice, { pathfinder: 3 });
  const expected = resolveScouting({ scouts: 3, defenderScouts: 6 });
  assert.equal(expected.success, false);
  assert.ok(expected.defenderScoutLosses > 0);

  const { movement } = await sendOk(alice, bob, 'scout', { pathfinder: 3 });
  clock.set(movement.arriveAt);

  const mine = await latestReport(alice);
  assert.deepEqual([mine.type, mine.side, mine.won], ['scout', 'attack', false]);
  assert.ok(mine.scout);
  assert.deepEqual([mine.scout.success, mine.scout.scoutsSent, mine.scout.scoutsLost], [false, 3, 3]);
  assert.equal(mine.scout.defenderScouts, null, 'a failed scout does not learn how many defenders there were');
  assert.equal(mine.scout.intel, null);
  assert.equal(JSON.stringify(mine).includes('pikeman":4'), false, 'nothing about the troops leaks');
  assert.deepEqual(await movementsOf(alice), [], 'nobody comes back');
  const home = (await village(alice)).state;
  assert.deepEqual([home.troops.pathfinder, home.away.pathfinder], [0, 0]);

  const theirs = await latestReport(bob);
  assert.deepEqual([theirs.type, theirs.side, theirs.won], ['scout', 'defense', true]);
  assert.ok(theirs.scout);
  assert.deepEqual(
    [theirs.scout.success, theirs.scout.scoutsSent, theirs.scout.scoutsLost, theirs.scout.defenderScouts, theirs.scout.defenderScoutsLost, theirs.scout.intel],
    [false, 3, 3, 6, expected.defenderScoutLosses, null],
  );
  assert.equal((await village(bob)).state.troops.pathfinder, 6 - expected.defenderScoutLosses);
  assert.equal((await village(bob)).state.troops.pikeman, 4);
  await app.close();
});

test('a tie fails: the scouts must strictly outnumber the defenders', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, bob, { pathfinder: 4 });
  giveTroops(app, alice, { pathfinder: 4 });
  const { movement } = await sendOk(alice, bob, 'scout', { pathfinder: 4 });
  clock.set(movement.arriveAt);
  const s = (await latestReport(alice)).scout;
  assert.equal(s?.success, false);
  assert.equal(s?.intel, null);
  await app.close();
});

test('stationed support Pathfinders defend too; losses come off the village\'s own first, then the contingents in proportion', async () => {
  const { app, clock, alice, bob, bea } = await world();
  const carol = await newPlayer(app, 'carol');
  ok(await carol.c.post(`/api/tribes/${bob.tribeId}/join`));
  unprotect(app, carol);
  giveTroops(app, bob, { pathfinder: 1 });
  // Two contingents: bea's 4 and carol's 4 Pathfinders (plus some spearmen of bea's that must not be hurt).
  await stationSupport(app, clock, bea, bob, { pathfinder: 4, pikeman: 5 });
  await stationSupport(app, clock, carol, bob, { pathfinder: 4 });
  giveTroops(app, alice, { pathfinder: 8 });
  const defenders = 1 + 4 + 4;
  const expected = resolveScouting({ scouts: 8, defenderScouts: defenders });
  assert.equal(expected.success, false, '8 against 9 fails');
  assert.ok(expected.defenderScoutLosses > 1, 'more than the single own Pathfinder die');
  const loss = expected.defenderScoutLosses;
  const beaAway = (await village(bea)).state.away.pathfinder;
  const carolAway = (await village(carol)).state.away.pathfinder;
  assert.deepEqual([beaAway, carolAway], [4, 4]);

  const { movement } = await sendOk(alice, bob, 'scout', { pathfinder: 8 });
  clock.set(movement.arriveAt);

  // Own Pathfinder first (all of it), the remainder split as evenly as whole units allow; a tie goes to the older contingent.
  const rest = loss - 1;
  const first = Math.ceil(rest / 2);
  const second = Math.floor(rest / 2);
  assert.equal((await village(bob)).state.troops.pathfinder, 0);
  const here = (await stateOf(bob)).stationed.here;
  const byOwner = Object.fromEntries(here.map((e) => [e.home.ownerName, e.units]));
  assert.equal(byOwner.bea?.pathfinder, 4 - first);
  assert.equal(byOwner.carol?.pathfinder, 4 - second);
  assert.equal(byOwner.bea?.pikeman, 5, 'only Pathfinders die in a scouting fight');
  // The dead also leave their owners' away counts; their other troops are still away.
  assert.equal((await village(bea)).state.away.pathfinder, 4 - first);
  assert.equal((await village(carol)).state.away.pathfinder, 4 - second);
  assert.equal((await village(bea)).state.away.pikeman, 5);

  // The host's owner hears of it: the defending total includes the support's Pathfinders. Support owners get no report.
  const theirs = (await latestReport(bob)).scout;
  assert.deepEqual([theirs?.defenderScouts, theirs?.defenderScoutsLost], [defenders, loss]);
  assert.deepEqual(await reports(bea), []);
  assert.deepEqual(await reports(carol), []);
  await app.close();
});

test('Pathfinders stationed as support alone are enough to spot scouts, and the intel counts support troops at home', async () => {
  const { app, clock, alice, bob, bea } = await world();
  giveTroops(app, bob, { pikeman: 5 });
  await stationSupport(app, clock, bea, bob, { pathfinder: 2, guard: 4 });
  giveTroops(app, alice, { pathfinder: 6 });
  giveKeen(app, alice, 2);
  const { movement } = await sendOk(alice, bob, 'scout', { pathfinder: 6 });
  clock.set(movement.arriveAt);

  const mine = (await latestReport(alice)).scout;
  assert.ok(mine?.success && mine.intel);
  assert.equal(mine.defenderScouts, 2);
  assert.deepEqual([mine.intel.troops?.pikeman, mine.intel.troops?.guard, mine.intel.troops?.pathfinder], [5, 4, 2]);
  const theirs = (await latestReport(bob)).scout;
  assert.deepEqual([theirs?.defenderScouts, theirs?.success], [2, true]);
  // Bea's troops are still stationed, nobody died.
  assert.deepEqual((await stateOf(bob)).stationed.here.map((e) => e.units.pathfinder), [2]);
  await app.close();
});

test('scouting an abandoned village: intel from its garrison, nobody else gets a report', async () => {
  const { app, clock, alice } = await world();
  giveTroops(app, alice, { pathfinder: 2 });
  giveKeen(app, alice, 5);
  const npc = await weakestAbandoned(alice.c, 12);
  const { movement } = await sendOk(alice, npc, 'scout', { pathfinder: 2 });
  clock.set(movement.arriveAt);
  const s = (await latestReport(alice)).scout;
  assert.ok(s?.success && s.intel);
  assert.equal(s.target.ownerName, null);
  assert.equal(s.scoutsLost, 0);
  const garrison = app.ctx.store.getVillage(npc.id)?.state.troops;
  assert.deepEqual(s.intel.troops, garrison);
  assert.ok((s.intel.troops?.pikeman ?? 0) > 0, 'a real garrison');
  assert.equal(s.intel.wallLevel, app.ctx.store.getVillage(npc.id)?.state.buildings.wall);
  await app.close();
});

for (const kind of ['ally', 'nap'] as const) {
  test(`scouts turn back silently when ${kind === 'ally' ? 'an alliance' : 'a NAP'} forms while they march`, async () => {
    const { app, clock, alice, bob } = await world();
    giveTroops(app, bob, { pathfinder: 1 });
    giveTroops(app, alice, { pathfinder: 5 });
    const bobVillage = await village(bob);
    const home = await village(alice);
    const { movement } = await sendOk(alice, bob, 'scout', { pathfinder: 5 });
    await formPact(bob, 'ALPHA', alice, kind);
    clock.set(movement.arriveAt);

    assert.deepEqual(await reports(alice), [], 'no report for the sender');
    assert.deepEqual(await reports(bob), [], 'and none for the target, although it had a Pathfinder');
    assert.equal((await stateOf(bob)).villages[0]?.state.troops.pathfinder, 1);
    const ret = (await movementsOf(alice))[0];
    assert.ok(ret);
    assert.deepEqual([ret.kind, ret.origin.villageId, ret.target.villageId, ret.units?.pathfinder, ret.departAt], ['return', bobVillage.id, home.id, 5, movement.arriveAt]);
    clock.set(ret.arriveAt);
    const back = (await village(alice)).state;
    assert.deepEqual([back.troops.pathfinder, back.away.pathfinder], [5, 0]);
    await app.close();
  });
}

test('scouts also turn back when the target joined the sender\'s tribe in the meantime', async () => {
  const { app, clock, alice, lou } = await world();
  giveTroops(app, alice, { pathfinder: 2 });
  const { movement } = await sendOk(alice, lou, 'scout', { pathfinder: 2 });
  ok(await lou.c.post(`/api/tribes/${alice.tribeId}/join`));
  assert.equal((await myTribe(lou)).tribe?.id, alice.tribeId);
  clock.set(movement.arriveAt);
  assert.deepEqual(await reports(alice), []);
  assert.equal((await movementsOf(alice))[0]?.kind, 'return');
  await app.close();
});

test('a pact still serving its notice protects on arrival only until it ends: scouts then do their job', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, alice, { pathfinder: 3 });
  const { movement } = await sendOk(alice, bob, 'scout', { pathfinder: 3 });
  await formPact(alice, 'BRAVO', bob, 'ally');
  const rel = (await myTribe(alice)).tribe?.relations[0];
  ok(await alice.c.post(`/api/tribe/diplomacy/relations/${rel?.id}/cancel`));
  app.ctx.store.db.prepare('UPDATE tribe_relations SET ends_at = ? WHERE id = ?').run(movement.arriveAt, rel?.id ?? 0);
  clock.set(movement.arriveAt);
  const s = (await latestReport(alice)).scout;
  assert.equal(s?.success, true, 'the notice was over by arrival');
  await app.close();
});
