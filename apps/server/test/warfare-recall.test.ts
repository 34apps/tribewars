// Bringing support troops home: recall (owner of the troops) and send-back (owner of the host village).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { travelTimeMs, type MovementResponse } from '@clanfire/engine';
import { Client, errorOf, ok } from './helpers.ts';
import { addMember } from './tribe-helpers.ts';
import { giveTroops, movementsOf, reports, sendOk, stateOf, stationSupport, units, village, world } from './warfare-helpers.ts';

test('recall some: a return movement from the host to home, the rest stays; the troops are home on arrival', async () => {
  const { app, clock, alice, amy } = await world();
  const stationed = await stationSupport(app, clock, alice, amy, { pikeman: 10, guard: 3 });
  const home = await village(alice);
  const host = await village(amy);

  clock.advance(5 * 60_000);
  const res = await alice.c.post(`/api/stationed/${stationed.id}/recall`, { units: { pikeman: 4 } });
  ok(res, 201);
  const { movement } = res.json<MovementResponse>();
  assert.deepEqual([movement.kind, movement.direction], ['return', 'outgoing']);
  assert.deepEqual([movement.origin.villageId, movement.target.villageId], [host.id, home.id], 'physically: from the host back home');
  assert.equal(movement.units?.pikeman, 4);
  assert.deepEqual(movement.loot, { wood: 0, food: 0, iron: 0, gold: 0 });
  assert.equal(movement.departAt, clock.now());
  assert.equal(movement.arriveAt - movement.departAt, travelTimeMs(host, home, units({ pikeman: 4 }), app.ctx.settings));

  // The contingent shrank; the travellers show up in the owner's movements; nothing changed in `away` yet.
  const left = (await stateOf(amy)).stationed.here[0];
  assert.deepEqual([left?.id, left?.units.pikeman, left?.units.guard, left?.arrivedAt], [stationed.id, 6, 3, stationed.arrivedAt]);
  assert.deepEqual((await stateOf(alice)).stationed.abroad, [left]);
  const mine = await movementsOf(alice);
  assert.deepEqual(mine.map((m) => [m.id, m.kind]), [[movement.id, 'return']]);
  assert.deepEqual(await movementsOf(amy), [], 'the host is not shown a departure');
  assert.equal((await village(alice)).state.away.pikeman, 10);

  clock.set(movement.arriveAt - 1);
  assert.equal((await village(alice)).state.troops.pikeman, 0);
  clock.set(movement.arriveAt);
  const back = (await village(alice)).state;
  assert.deepEqual([back.troops.pikeman, back.away.pikeman, back.away.guard], [4, 6, 3]);
  assert.deepEqual(await movementsOf(alice), []);
  assert.deepEqual([await reports(alice), await reports(amy)], [[], []], 'recalling makes no report');
  await app.close();
});

test('recall everything: no body, or no units, brings the whole contingent; the entry disappears', async () => {
  const { app, clock, alice, amy } = await world();
  const first = await stationSupport(app, clock, alice, amy, { pikeman: 10 });
  const res = await alice.c.post(`/api/stationed/${first.id}/recall`);
  ok(res, 201);
  const { movement } = res.json<MovementResponse>();
  assert.equal(movement.units?.pikeman, 10);
  assert.deepEqual((await stateOf(amy)).stationed, { here: [], abroad: [] });
  assert.deepEqual((await stateOf(alice)).stationed, { here: [], abroad: [] });
  errorOf(await alice.c.post(`/api/stationed/${first.id}/recall`), 404, 'not_found');
  clock.set(movement.arriveAt);
  const home = (await village(alice)).state;
  assert.deepEqual([home.troops.pikeman, home.away.pikeman], [10, 0]);

  // `{}` also means all of them. Recalling exactly everything with explicit units empties the entry too.
  const second = await stationSupport(app, clock, alice, amy, { pikeman: 7 });
  ok(await alice.c.post(`/api/stationed/${second.id}/recall`, {}), 201);
  assert.deepEqual((await stateOf(alice)).stationed.abroad, []);
  const third = await stationSupport(app, clock, alice, amy, { pikeman: 2, guard: 1 });
  ok(await alice.c.post(`/api/stationed/${third.id}/recall`, { units: { pikeman: 2, guard: 1 } }), 201);
  assert.deepEqual((await stateOf(alice)).stationed.abroad, []);
  await app.close();
});

test('recall input: at least one unit, no more than are stationed, valid shapes', async () => {
  const { app, clock, alice, amy } = await world();
  const entry = await stationSupport(app, clock, alice, amy, { pikeman: 10 });
  const url = `/api/stationed/${entry.id}/recall`;
  errorOf(await alice.c.post(url, { units: {} }), 400, 'no_troops');
  errorOf(await alice.c.post(url, { units: { pikeman: 0 } }), 400, 'no_troops');
  errorOf(await alice.c.post(url, { units: { pikeman: 11 } }), 409, 'not_enough_troops');
  errorOf(await alice.c.post(url, { units: { guard: 1 } }), 409, 'not_enough_troops');
  errorOf(await alice.c.post(url, { units: { pikeman: -1 } }), 400, 'invalid_input');
  errorOf(await alice.c.post(url, { units: { pikeman: 1.5 } }), 400, 'invalid_input');
  errorOf(await alice.c.post(url, { units: { wizard: 1 } }), 400, 'invalid_input');
  errorOf(await alice.c.post(url, { units: 5 }), 400, 'invalid_input');
  errorOf(await alice.c.post(url, { units: { pikeman: 1 }, all: true }), 400, 'invalid_input');
  errorOf(await alice.c.post('/api/stationed/abc/recall'), 400, 'invalid_input');
  errorOf(await alice.c.post('/api/stationed/99999/recall'), 404, 'not_found');
  assert.equal((await stateOf(alice)).stationed.abroad[0]?.units.pikeman, 10, 'refusals changed nothing');
  assert.deepEqual(await movementsOf(alice), []);
  await app.close();
});

test('send-back: the host\'s owner sends all of a contingent home; the owner of the troops sees them coming', async () => {
  const { app, clock, alice, amy } = await world();
  const entry = await stationSupport(app, clock, alice, amy, { pikeman: 10, guard: 2 });
  const home = await village(alice);
  const host = await village(amy);

  clock.advance(60_000);
  const res = await amy.c.post(`/api/stationed/${entry.id}/send-back`);
  ok(res, 201);
  const { movement } = res.json<MovementResponse>();
  assert.deepEqual([movement.kind, movement.direction], ['return', 'outgoing']);
  assert.deepEqual([movement.origin.villageId, movement.target.villageId], [host.id, home.id]);
  assert.deepEqual([movement.units?.pikeman, movement.units?.guard], [10, 2]);
  assert.equal(movement.arriveAt - movement.departAt, travelTimeMs(host, home, units({ pikeman: 10, guard: 2 }), app.ctx.settings));
  assert.deepEqual((await stateOf(amy)).stationed, { here: [], abroad: [] });
  assert.deepEqual((await stateOf(alice)).stationed, { here: [], abroad: [] });
  assert.deepEqual((await movementsOf(alice)).map((m) => [m.id, m.kind, m.direction]), [[movement.id, 'return', 'outgoing']]);
  errorOf(await amy.c.post(`/api/stationed/${entry.id}/send-back`), 404, 'not_found');

  clock.set(movement.arriveAt);
  const back = (await village(alice)).state;
  assert.deepEqual([back.troops.pikeman, back.troops.guard, back.away.pikeman, back.away.guard], [10, 2, 0, 0]);
  await app.close();
});

test('permissions: recall is for the owner of the troops, send-back for the owner of the host village; strangers see nothing', async () => {
  const { app, clock, alice, amy, bob } = await world();
  const entry = await stationSupport(app, clock, alice, amy, { pikeman: 10 });
  const recall = `/api/stationed/${entry.id}/recall`;
  const sendBack = `/api/stationed/${entry.id}/send-back`;

  // The host's owner may not recall someone else's troops; the supporter may not send their own troops back.
  errorOf(await amy.c.post(recall), 403, 'forbidden');
  errorOf(await amy.c.post(recall, { units: { pikeman: 1 } }), 403, 'forbidden');
  errorOf(await alice.c.post(sendBack), 403, 'forbidden');
  // A stranger cannot tell the entry exists.
  errorOf(await bob.c.post(recall), 404, 'not_found');
  errorOf(await bob.c.post(sendBack), 404, 'not_found');
  // Signed out.
  const anon = new Client(app, '10.77.0.1');
  errorOf(await anon.post(recall), 401, 'unauthorized');
  errorOf(await anon.post(sendBack), 401, 'unauthorized');
  // Another tribe-mate of either side is a stranger too.
  const dan = await addMember(app, alice, 'dan');
  errorOf(await dan.c.post(recall), 404, 'not_found');
  errorOf(await dan.c.post(sendBack), 404, 'not_found');

  assert.equal((await stateOf(alice)).stationed.abroad[0]?.units.pikeman, 10, 'nothing happened');
  assert.deepEqual(await movementsOf(alice), []);
  // Cross-site posts are refused like everywhere else.
  const cross = await alice.c.post(recall, undefined, { origin: 'http://evil.example' });
  errorOf(cross, 403, 'forbidden');
  await app.close();
});

test('both can still bring the troops home after the tribes fell out; a destroyed contingent can no longer be recalled', async () => {
  const { app, clock, alice, amy, bob } = await world();
  const entry = await stationSupport(app, clock, alice, amy, { pikeman: 10 });
  ok(await amy.c.post('/api/tribe/leave'));
  ok(await alice.c.post(`/api/stationed/${entry.id}/recall`, { units: { pikeman: 3 } }), 201);

  // Wipe the rest out in a battle: the entry is deleted and the id answers 404.
  giveTroops(app, bob, { raider: 60 });
  const atk = await sendOk(bob, amy, 'attack', { raider: 60 });
  clock.set(atk.movement.arriveAt);
  assert.deepEqual((await stateOf(amy)).stationed.here, []);
  errorOf(await alice.c.post(`/api/stationed/${entry.id}/recall`), 404, 'not_found');
  errorOf(await amy.c.post(`/api/stationed/${entry.id}/send-back`), 404, 'not_found');
  await app.close();
});
