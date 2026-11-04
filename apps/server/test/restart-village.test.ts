// A player who loses the last village starts again (docs/GAME_DESIGN.md 18.2, step 2), and the player-village Strike path that
// step 4 will open (switched on here through GameService.strikePlayers). Plus the anti-abuse rules for Strikes on players.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RESTART_EDGE_BAND,
  restartEdgeRadius,
  restartProtectionMs,
  type GameStateResponse,
  type MapResponse,
  type SendResponse,
} from '@clanfire/engine';
import { PASSWORD, Client, errorOf, makeApp, ok } from './helpers.ts';
import { formPact, newLeader, newPlayer } from './tribe-helpers.ts';
import { giveTroops, unprotect, world } from './warfare-helpers.ts';
import { ledger, player, reserveFor, runTo, strongHome, villageReports, villagesOf } from './village-helpers.ts';

test('the whole player path: strike, hold, taken; the loser restarts protected with account, tribe and Renown kept', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['claimer'] });
  app.ctx.game.strikePlayers = true; // step 4 switches this on for everybody
  const store = app.ctx.store;
  const victim = await newLeader(app, 'victim', 'Victims', 'VIC', 'open');
  unprotect(app, victim);
  giveTroops(app, victim, { pikeman: 20 });
  store.addRenown(victim.id, 777);
  const lostVillage = villagesOf(app, victim)[0]!;
  const claimer = await player(app, 'claimer');
  const home = strongHome(app, clock, claimer, { raider: 400, chieftain: 1 });
  reserveFor(app, claimer, 1, 500);

  const res = await claimer.c.post(`/api/villages/${home}/send`, { x: lostVillage.x, y: lostVillage.y, units: { raider: 400, chieftain: 1 }, mission: 'attack', travelSeconds: 60 });
  ok(res, 201);
  const { movement } = res.json<SendResponse>();
  runTo(app, clock, movement.arriveAt);

  // The victim's hearth is out: they see who holds it and with how many; their own village is still theirs.
  const seen = (await victim.c.state()).villages.find((v) => v.id === lostVillage.id);
  assert.equal(seen?.hearth?.claimBy, 'claimer');
  assert.ok((seen?.hearth?.occupierPopulation ?? 0) >= 150);
  assert.equal(store.getVillage(lostVillage.id)?.ownerId, victim.id);
  const row = store.stationedAt(lostVillage.id)[0];
  assert.ok(row);
  errorOf(await victim.c.post(`/api/stationed/${row.id}/send-back`), 400, 'invalid_target'); // the owner cannot dismiss occupiers
  const map = (await (await claimer.c.get(`/api/map?x=${lostVillage.x}&y=${lostVillage.y}&w=1&h=1`)).json<MapResponse>()).villages[0];
  assert.equal(map?.hearth?.claimBy, 'claimer');
  assert.equal(map?.protected, false, 'a cold village is not safe');
  assert.equal(map?.hearth?.occupierPopulation, undefined, 'the occupiers\' strength is not on the map');
  assert.ok((await villageReports(victim)).some((r) => r.village.kind === 'hearth_out' && r.village.claimBy === 'claimer'));

  // The clock ends: the village changes owner, the victim has no village until their next request.
  runTo(app, clock, map?.hearth?.endsAt ?? 0);
  assert.equal(store.getVillage(lostVillage.id)?.ownerId, claimer.id);
  assert.equal(store.villagesOfPlayer(victim.id).length, 0, 'the last village was taken');
  assert.equal(ledger(app, claimer).reserved, 0);
  const totalBefore = ledger(app, victim).total;

  const st = await victim.c.state(); // the next authenticated request
  assert.equal(st.villages.length, 1, 'a fresh starting village');
  const fresh = st.villages[0]!;
  assert.notEqual(fresh.id, lostVillage.id);
  assert.notDeepEqual([fresh.x, fresh.y], [lostVillage.x, lostVillage.y]);
  assert.equal(st.player.protectedUntil, clock.now() + restartProtectionMs(app.ctx.settings), 'restart protection');
  assert.equal(st.player.tribe?.tag, 'VIC', 'the tribe is kept');
  assert.equal(ledger(app, victim).total, totalBefore, 'Renown is kept');
  assert.equal(st.player.username, 'victim');
  assert.equal((await victim.c.state()).villages.length, 1, 'only once');
  const kinds = (await villageReports(victim)).map((r) => r.village.kind).sort();
  assert.deepEqual(kinds, ['hearth_out', 'lost']);

  // Protected: the same attacker cannot hunt them again at once.
  errorOf(await claimer.c.post(`/api/villages/${home}/send`, { x: fresh.x, y: fresh.y, units: { raider: 10 }, mission: 'attack' }), 409, 'target_protected');
  // And the taken village is locked against a new Strike.
  const taken = store.getVillage(lostVillage.id);
  assert.ok((taken?.state.lockUntil ?? 0) > clock.now());
  await app.close();
});

test('restart placement in an expanding world: the outer edge with its own ring of abandoned villages', async () => {
  const { app } = await makeApp({ world: { seed: 7, radius: 120, layout: 'expanding', npcDensity: 0 } });
  const store = app.ctx.store;
  const s = app.ctx.settings;
  const settlers = [];
  for (let i = 0; i < 5; i++) settlers.push(await newPlayer(app, `settler${i}`));
  const loser = settlers[0]!;
  const winner = settlers[1]!;
  const lost = villagesOf(app, loser)[0]!;
  store.setVillageOwner(lost.id, winner.id, 'Taken'); // the last village is gone (a Strike will do this in step 4)
  assert.equal(store.villagesOfPlayer(loser.id).length, 0);

  const abandonedBefore = store.abandonedVillageIds().length;
  const count = store.playerVillageCount();
  app.ctx.auth.ensureStartingVillage(store.getPlayer(loser.id)!);
  const mine = store.villagesOfPlayer(loser.id);
  assert.equal(mine.length, 1);
  const v = mine[0]!;
  assert.ok(Math.hypot(v.x, v.y) >= restartEdgeRadius(s, count) - RESTART_EDGE_BAND - 3, `at the outer edge, got ${v.x},${v.y}`);
  assert.ok(store.abandonedVillageIds().length > abandonedBefore, 'a ring of abandoned villages comes with the new village');
  assert.ok((store.getPlayer(loser.id)?.protectedUntil ?? 0) > 0);
  app.ctx.auth.ensureStartingVillage(store.getPlayer(loser.id)!);
  assert.equal(store.villagesOfPlayer(loser.id).length, 1, 'no second village for one who has one');
  await app.close();
});

test('the loss shows up as a new village at the very next authenticated request (scattered world)', async () => {
  const { app, clock } = await makeApp();
  const store = app.ctx.store;
  const loser = await newPlayer(app, 'loser');
  const winner = await newPlayer(app, 'winner');
  const lost = villagesOf(app, loser)[0]!;
  store.setVillageOwner(lost.id, winner.id, 'Taken');
  const st = (await loser.c.get('/api/state')).json<GameStateResponse>();
  assert.equal(st.villages.length, 1);
  const v = st.villages[0]!;
  assert.ok(!store.villagesOfPlayer(winner.id).some((x) => x.id === v.id));
  assert.equal(st.player.protectedUntil, clock.now() + restartProtectionMs(app.ctx.settings));
  await app.close();
});

test('no Strike on same-IP accounts, tribe-mates or allies, even with the player path switched on', async () => {
  const { app, clock, alice, amy, bob } = await world();
  app.ctx.game.strikePlayers = true;
  const reg = async (name: string, ip: string) => {
    const c = new Client(app, ip);
    ok(await c.post('/api/auth/register', { username: name, password: PASSWORD }), 201);
    return { c, id: (await c.state()).player.id, name };
  };
  // Same connection.
  const twinA = await reg('twin_a', '10.77.0.1');
  const twinB = await reg('twin_b', '10.77.0.1');
  unprotect(app, twinA, twinB);
  const homeA = strongHome(app, clock, twinA, { raider: 200, chieftain: 1 });
  const vb = villagesOf(app, twinB)[0]!;
  errorOf(await twinA.c.post(`/api/villages/${homeA}/send`, { x: vb.x, y: vb.y, units: { raider: 200, chieftain: 1 }, mission: 'attack' }), 400, 'invalid_target');

  // Own tribe, and an ally.
  const homeAlice = strongHome(app, clock, alice, { raider: 200, chieftain: 1 });
  const va = villagesOf(app, amy)[0]!;
  errorOf(await alice.c.post(`/api/villages/${homeAlice}/send`, { x: va.x, y: va.y, units: { raider: 200, chieftain: 1 }, mission: 'attack' }), 400, 'invalid_target');
  await formPact(alice, 'BRAVO', bob, 'ally');
  const vbob = villagesOf(app, bob)[0]!;
  errorOf(await alice.c.post(`/api/villages/${homeAlice}/send`, { x: vbob.x, y: vbob.y, units: { raider: 200, chieftain: 1 }, mission: 'attack' }), 409, 'target_protected');
  assert.equal(villagesOf(app, alice).length, 1);
  await app.close();
});
