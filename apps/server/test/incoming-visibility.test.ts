// Pins who can see an incoming attack today (no game logic changes): the target sees it with the units hidden and the attacker's
// village; a stranger sees nothing; a tribe-mate sees it only as a tribe alert (Watchtower fields absent at level 0); scouts never show.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TribeAlertsResponse } from '@clanfire/engine';
import { ok } from './helpers.ts';
import { giveTroops, sendOk, stateOf, village, world, type P } from './warfare-helpers.ts';

const alerts = async (p: P): Promise<TribeAlertsResponse> => {
  const res = await p.c.get('/api/tribe/alerts');
  ok(res);
  return res.json<TribeAlertsResponse>();
};

test('incoming attack: the target sees it (units hidden, attacker village shown); a stranger sees nothing; a tribe-mate sees an alert without Watchtower fields', async () => {
  const { app, alice, amy, bob, bea, lou } = await world();
  giveTroops(app, alice, { raider: 6, outrider: 2 });
  const home = await village(alice);
  const target = await village(bob);
  const { movement } = await sendOk(alice, bob, 'attack', { raider: 6, outrider: 2 });

  // The target (bob): an incoming attack, units null, origin = the attacker's village.
  const mine = (await stateOf(bob)).movements;
  assert.equal(mine.length, 1);
  const m = mine[0];
  assert.ok(m);
  assert.equal(m.id, movement.id);
  assert.deepEqual([m.kind, m.direction, m.units], ['attack', 'incoming', null]);
  assert.equal(m.origin.villageId, home.id);
  assert.equal(m.origin.ownerName, 'alice');
  assert.equal(m.target.villageId, target.id);
  assert.equal(m.arriveAt, movement.arriveAt);
  assert.equal(JSON.stringify(m).includes('raider'), false, 'no unit names in the incoming movement');

  // A third player (not the target, not in the tribe) sees nothing about it: no movement, no alert, no badge.
  const stranger = await stateOf(lou);
  assert.deepEqual(stranger.movements, []);
  assert.equal(stranger.tribeAlerts, 0);
  assert.equal(JSON.stringify(stranger.movements).includes(String(movement.id)), false);
  // Neither does the attacker's own tribe-mate (not a target's tribe): no movement of the attacker, no alert.
  assert.deepEqual((await stateOf(amy)).movements, []);
  assert.equal((await stateOf(amy)).tribeAlerts, 0);

  // The target's tribe-mate (bea): not in her movements, but on the tribe alert list, Watchtower level 0 so no band / unit / size.
  assert.deepEqual((await stateOf(bea)).movements, []);
  const list = await alerts(bea);
  assert.equal(list.watchtowerLevel, 0);
  assert.equal(list.alerts.length, 1);
  const a = list.alerts[0];
  assert.ok(a);
  assert.equal(a.movementId, movement.id);
  assert.equal(a.attacker.villageId, home.id);
  assert.equal(a.target.villageId, target.id);
  assert.equal(a.attackerTribeTag, 'ALPHA');
  for (const key of ['sizeBand', 'slowestUnit', 'sizeAbout']) assert.equal(key in a, false, `${key} absent at Watchtower 0`);
  assert.equal(JSON.stringify(list).includes('raider'), false);
  assert.equal((await stateOf(bea)).tribeAlerts, 1);
  // Bob (the target) sees the same alert on the tribe list.
  assert.equal((await alerts(bob)).alerts[0]?.movementId, movement.id);
  await app.close();
});

test('scouts never show as incoming: not to the target, not to his tribe, not to a stranger', async () => {
  const { app, alice, bob, bea, lou } = await world();
  giveTroops(app, alice, { pathfinder: 6 });
  const scout = await sendOk(alice, bob, 'scout', { pathfinder: 6 });
  for (const p of [bob, bea, lou]) {
    const s = await stateOf(p);
    assert.deepEqual(s.movements, [], `${p.name} sees no movement`);
    assert.equal(s.tribeAlerts, 0);
  }
  assert.deepEqual((await alerts(bea)).alerts, []);
  assert.deepEqual((await alerts(bob)).alerts, []);
  // Only the sender sees it, as outgoing.
  const own = (await stateOf(alice)).movements;
  assert.deepEqual(own.map((x) => [x.id, x.kind, x.direction]), [[scout.movement.id, 'scout', 'outgoing']]);
  await app.close();
});
