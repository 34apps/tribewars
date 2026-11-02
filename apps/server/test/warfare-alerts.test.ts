// Tribe alerts: incoming attacks on any member's village, and the Tribe-tab badge (GAME_DESIGN.md section 12).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TribeAlertsResponse } from '@clanfire/engine';
import { Client, errorOf, ok } from './helpers.ts';
import { newPlayer } from './tribe-helpers.ts';
import { giveTroops, movementsOf, sendOk, stateOf, unprotect, village, world, type P } from './warfare-helpers.ts';

const alerts = async (p: P): Promise<TribeAlertsResponse['alerts']> => {
  const res = await p.c.get('/api/tribe/alerts');
  ok(res);
  return res.json<TribeAlertsResponse>().alerts;
};

test('alerts list every incoming attack on any member, soonest first, with attacker and tribe tag; the badge counts them', async () => {
  const { app, clock, alice, amy, bob, bea, lou } = await world();
  giveTroops(app, alice, { raider: 5 });
  giveTroops(app, lou, { raider: 5 });
  giveTroops(app, amy, { raider: 5 });

  const none = await stateOf(bob);
  assert.equal(none.tribeAlerts, 0);
  assert.deepEqual(await alerts(bob), []);

  // alice (tribe ALPHA) hits bea; lou (no tribe) hits bob; amy (ALPHA) hits bob.
  const a = await sendOk(alice, bea, 'attack', { raider: 5 });
  clock.advance(1000);
  const l = await sendOk(lou, bob, 'attack', { raider: 5 });
  clock.advance(1000);
  const m = await sendOk(amy, bob, 'attack', { raider: 5 });

  const expectedOrder = [a, l, m].map((x) => x.movement).sort((x, y) => x.arriveAt - y.arriveAt || x.id - y.id);
  for (const viewer of [bob, bea]) {
    const list = await alerts(viewer);
    assert.deepEqual(list.map((x) => x.movementId), expectedOrder.map((x) => x.id), 'soonest first, for every member alike');
    assert.equal((await stateOf(viewer)).tribeAlerts, 3);
  }
  const list = await alerts(bob);
  const byId = Object.fromEntries(list.map((x) => [x.movementId, x]));
  const forA = byId[a.movement.id];
  assert.ok(forA);
  assert.deepEqual([forA.attacker.ownerName, forA.attackerTribeTag, forA.target.ownerName, forA.departAt, forA.arriveAt], ['alice', 'ALPHA', 'bea', a.movement.departAt, a.movement.arriveAt]);
  assert.deepEqual([forA.attacker.villageId, forA.target.villageId], [(await village(alice)).id, (await village(bea)).id]);
  const forL = byId[l.movement.id];
  assert.deepEqual([forL?.attacker.ownerName, forL?.attackerTribeTag, forL?.target.ownerName], ['lou', null, 'bob']);
  assert.deepEqual([byId[m.movement.id]?.attackerTribeTag, byId[m.movement.id]?.target.ownerName], ['ALPHA', 'bob']);
  assert.equal(typeof forA.attacker.x, 'number');
  assert.equal(JSON.stringify(list).includes('raider'), false, 'no troop information');

  // The other tribe's members see only their own: the three attackers are not targets.
  assert.deepEqual(await alerts(alice), []);
  assert.equal((await stateOf(alice)).tribeAlerts, 0);
  assert.equal((await stateOf(lou)).tribeAlerts, 0, 'tribeless');

  // Individual incoming views are unchanged: bob sees his own two attacks, units hidden.
  const mine = await movementsOf(bob);
  assert.deepEqual(mine.map((x) => [x.kind, x.direction, x.units]), [['attack', 'incoming', null], ['attack', 'incoming', null]]);

  // Once an attack has arrived it is no longer an alert.
  const first = expectedOrder[0];
  assert.ok(first);
  clock.set(first.arriveAt);
  const stillComing = expectedOrder.filter((x) => x.arriveAt > first.arriveAt).length;
  assert.equal((await alerts(bob)).length, stillComing);
  assert.equal((await stateOf(bea)).tribeAlerts, stillComing);
  clock.set((expectedOrder[2]?.arriveAt ?? 0) + 1);
  assert.deepEqual(await alerts(bob), []);
  assert.equal((await stateOf(bob)).tribeAlerts, 0);
  await app.close();
});

test('scouts and support are not alerts: not in the list, not in the badge, and a scout is invisible even to its target', async () => {
  const { app, clock, alice, bob, bea } = await world();
  giveTroops(app, alice, { pathfinder: 4, raider: 3 });
  giveTroops(app, bea, { pikeman: 5 });
  const bobVillage = await village(bob);

  await sendOk(alice, bob, 'scout', { pathfinder: 4 });
  const support = await sendOk(bea, bob, 'support', { pikeman: 5 });
  const sBob = await stateOf(bob);
  assert.equal(sBob.tribeAlerts, 0);
  assert.deepEqual(await alerts(bob), []);
  assert.deepEqual(await alerts(bea), []);
  // Bob's movements: the incoming support, with units; the scout is nowhere.
  assert.deepEqual(sBob.movements.map((x) => [x.kind, x.direction, x.units?.pikeman ?? null]), [['support', 'incoming', 5]]);
  assert.equal(sBob.movements[0]?.id, support.movement.id);
  // Bea sees her own outgoing support only.
  assert.deepEqual((await movementsOf(bea)).map((x) => [x.kind, x.direction]), [['support', 'outgoing']]);

  // An attack among them counts exactly once.
  const atk = await sendOk(alice, bob, 'attack', { raider: 3 });
  assert.equal((await stateOf(bob)).tribeAlerts, 1);
  assert.equal((await alerts(bea))[0]?.movementId, atk.movement.id);
  assert.equal((await alerts(bea))[0]?.target.villageId, bobVillage.id);

  // Returning troops (of an attacker) are not alerts either.
  clock.set(atk.movement.arriveAt);
  assert.equal((await stateOf(bob)).tribeAlerts, 0);
  assert.deepEqual(await alerts(bob), []);
  assert.equal((await movementsOf(alice)).some((x) => x.kind === 'return'), true);
  await app.close();
});

test('alerts are for members only; leaving the tribe resets the badge; the route needs a session', async () => {
  const { app, clock, alice, bob, bea, lou } = await world();
  giveTroops(app, alice, { raider: 5 });
  errorOf(await lou.c.get('/api/tribe/alerts'), 409, 'not_in_tribe');
  errorOf(await new Client(app, '10.77.0.2').get('/api/tribe/alerts'), 401, 'unauthorized');

  const { movement } = await sendOk(alice, bea, 'attack', { raider: 5 });
  assert.equal((await stateOf(bea)).tribeAlerts, 1);
  assert.equal((await stateOf(bob)).tribeAlerts, 1);
  // A member who leaves is no longer part of it...
  ok(await bea.c.post('/api/tribe/leave'));
  assert.equal((await stateOf(bob)).tribeAlerts, 0, 'the village left the tribe');
  assert.equal((await stateOf(bea)).tribeAlerts, 0, 'tribeless');
  errorOf(await bea.c.get('/api/tribe/alerts'), 409, 'not_in_tribe');
  // ...and a newcomer's village counts from the moment they join.
  const joiner = await newPlayer(app, 'joiner');
  unprotect(app, joiner);
  ok(await joiner.c.post(`/api/tribes/${bob.tribeId}/join`));
  assert.equal((await stateOf(joiner)).tribeAlerts, 0);
  giveTroops(app, alice, { raider: 5 });
  await sendOk(alice, joiner, 'attack', { raider: 5 });
  assert.equal((await alerts(bob)).length, 1);
  assert.equal((await stateOf(joiner)).tribeAlerts, 1);
  clock.set(movement.arriveAt + 3_600_000);
  assert.equal((await stateOf(joiner)).tribeAlerts, 0);
  await app.close();
});

test('an attack on a member by someone who then joins the target\'s tribe is called off, and its alert goes with it', async () => {
  const { app, clock, alice, bea } = await world();
  giveTroops(app, bea, { raider: 5 });
  giveTroops(app, alice, { pikeman: 1 });
  const { movement } = await sendOk(bea, alice, 'attack', { raider: 5 });
  assert.equal((await stateOf(alice)).tribeAlerts, 1);
  // bea cannot be in two tribes: she leaves BRAVO and joins ALPHA, so alice is now a tribe-mate and the attack is called off.
  ok(await bea.c.post('/api/tribe/leave'));
  ok(await bea.c.post(`/api/tribes/${alice.tribeId}/join`));
  clock.set(movement.arriveAt);
  assert.equal((await stateOf(alice)).tribeAlerts, 0);
  assert.equal((await stateOf(alice)).unreadReports, 0, 'no battle took place');
  await app.close();
});
