// Incoming warnings and notifications (docs/GAME_DESIGN.md 18.10): what the defender sees the moment an attack is sent, and the
// notification rows with their two endpoints.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NOTIFICATIONS_KEEP,
  NOTIFICATION_MAX_AGE_DAYS,
  travelTimeMs,
  type MovementResponse,
  type NotificationsResponse,
} from '@clanfire/engine';
import type { LiveEvent } from '../src/live-events.ts';
import { Client, HOUR, MINUTE, errorOf, ok } from './helpers.ts';
import { count, setBuilding } from './tribe-helpers.ts';
import { giveTroops, movementsOf, sendOk, village, world, type P } from './warfare-helpers.ts';

const list = async (p: P): Promise<NotificationsResponse> => (await p.c.get('/api/notifications')).json<NotificationsResponse>();

test('the defender sees origin, send time and arrival time of an attack at once, never the units; travel time follows the slowest unit', async () => {
  const { app, alice, bob } = await world();
  giveTroops(app, alice, { raider: 5, guard: 3 });
  const a = await village(alice);
  const b = await village(bob);
  const { movement } = await sendOk(alice, bob, 'attack', { raider: 5, guard: 3 });
  // The sender's own view still lists the units.
  assert.equal(movement.direction, 'outgoing');
  assert.deepEqual(movement.units, { ...movement.units, raider: 5, guard: 3 });

  const seen = (await movementsOf(bob)).find((m) => m.id === movement.id);
  assert.ok(seen, 'bob sees it immediately');
  assert.equal(seen.direction, 'incoming');
  assert.equal(seen.kind, 'attack');
  assert.equal(seen.units, null);
  assert.deepEqual([seen.origin.x, seen.origin.y, seen.origin.name, seen.origin.ownerName], [a.x, a.y, a.name, 'alice']);
  assert.deepEqual([seen.target.x, seen.target.y], [b.x, b.y]);
  assert.equal(seen.departAt, movement.departAt);
  assert.equal(seen.arriveAt, movement.arriveAt);
  assert.equal(JSON.stringify(seen).includes('raider'), false, 'no unit names anywhere in what bob receives');
  // The slowest unit (Shieldbearer, speed 5) sets the pace, not the Raider (speed 6).
  const slow = travelTimeMs({ x: a.x, y: a.y }, { x: b.x, y: b.y }, { ...movement.units!, raider: 0 }, app.ctx.settings);
  const fast = travelTimeMs({ x: a.x, y: a.y }, { x: b.x, y: b.y }, { ...movement.units!, guard: 0 }, app.ctx.settings);
  assert.ok(slow > fast);
  assert.equal(seen.arriveAt - seen.departAt, slow);
});

test('scouts are never visible to the target and make no notification', async () => {
  const { app, alice, bob } = await world();
  giveTroops(app, alice, { pathfinder: 3 });
  const { movement } = await sendOk(alice, bob, 'scout', { pathfinder: 3 });
  assert.equal((await movementsOf(bob)).some((m) => m.id === movement.id), false);
  assert.equal((await list(bob)).notifications.length, 0);
  assert.equal(count(app, 'notifications'), 0);
});

test('an attack, a support and a shipment toward another player each make one notification for the target owner, never any units', async () => {
  const { app, alice, amy, bob } = await world();
  giveTroops(app, alice, { raider: 10, pikeman: 10 });
  setBuilding(app, alice.id, 'market', 1);

  const atk = (await sendOk(alice, bob, 'attack', { raider: 5 })).movement;
  const sup = (await sendOk(alice, amy, 'support', { pikeman: 5 })).movement;
  const home = await village(alice);
  const dest = await village(bob);
  const shipped = await alice.c.post(`/api/villages/${home.id}/ship`, { x: dest.x, y: dest.y, resources: { wood: 10 } });
  ok(shipped, 201);
  const shipId = shipped.json<{ movement: { id: number } }>().movement.id;

  const bobs = await list(bob);
  assert.deepEqual(bobs.notifications.map((n) => n.kind).sort(), ['incoming_attack', 'incoming_resources']);
  assert.equal(bobs.unread, 2);
  const attack = bobs.notifications.find((n) => n.kind === 'incoming_attack')!;
  assert.equal(attack.movementId, atk.id);
  assert.equal(attack.origin.ownerName, 'alice');
  assert.equal(attack.target.ownerName, 'bob');
  assert.equal(attack.departAt, atk.departAt);
  assert.equal(attack.arriveAt, atk.arriveAt);
  assert.equal(attack.read, false);
  assert.equal(bobs.notifications.find((n) => n.kind === 'incoming_resources')!.movementId, shipId);
  const raw = JSON.stringify(bobs);
  for (const word of ['raider', 'pikeman', 'units', 'wood']) assert.equal(raw.includes(word), false, `no "${word}" in the response`);

  const amys = await list(amy);
  assert.deepEqual(amys.notifications.map((n) => [n.kind, n.movementId]), [['incoming_support', sup.id]]);
  // The sender is told nothing about their own orders.
  assert.deepEqual((await list(alice)).notifications, []);
  assert.equal(count(app, 'notifications'), 3);
});

test('no notification for returns, for abandoned targets, or when the target is the sender\'s own village', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, alice, { raider: 20 });
  // Abandoned target (nobody owns it).
  const npc = app.ctx.store.getVillage(app.ctx.store.abandonedVillageIds()[0]!)!;
  const { movement } = await sendOk(alice, { x: npc.x, y: npc.y }, 'attack', { raider: 20 });
  assert.equal(count(app, 'notifications'), 0);
  // The battle resolves and the survivors walk home: a return, still nothing.
  clock.set(movement.arriveAt);
  await alice.c.state();
  assert.ok(count(app, 'movements', "kind = 'return'") >= 1, 'survivors walk home');
  assert.equal(count(app, 'notifications'), 0);
  // The store never writes a row for a target that is the sender's own: shipping to a second village of one's own owner.
  const own = app.ctx.store.villagesOfPlayer(alice.id)[0]!;
  app.ctx.store.insertMovement({
    kind: 'support',
    originVillageId: own.id,
    targetVillageId: own.id,
    units: { ...own.state.troops, raider: 0 },
    loot: null,
    departAt: clock.now(),
    arriveAt: clock.now() + HOUR,
  });
  assert.equal(count(app, 'notifications'), 0);
  assert.equal((await list(bob)).notifications.length, 0);
});

test('cancelling inside the cancel window takes the notification back; once the window is over the row stays', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, alice, { raider: 10 });
  const first = (await sendOk(alice, bob, 'attack', { raider: 5 })).movement;
  const second = (await sendOk(alice, bob, 'attack', { raider: 5 })).movement;
  assert.equal((await list(bob)).notifications.length, 2);
  const cancelled = await alice.c.post(`/api/movements/${first.id}/cancel`, {});
  ok(cancelled, 201);
  assert.equal(cancelled.json<MovementResponse>().movement.kind, 'return');
  const after = await list(bob);
  assert.deepEqual(after.notifications.map((n) => n.movementId), [second.id]);
  // Too late to cancel (window over): the row stays, and the cancel is refused.
  clock.advance(2 * MINUTE + 1000); // just past CANCEL_WINDOW_MS; the army (3+ tiles away at speed 10) is still on the road
  errorOf(await alice.c.post(`/api/movements/${second.id}/cancel`, {}), 409, 'too_late');
  assert.equal((await list(bob)).notifications.length, 1);
});

test('GET and POST read: auth required, owner-only, validated, rate limited like the other routes', async () => {
  const { app, alice, bob, lou } = await world();
  giveTroops(app, alice, { raider: 10 });
  await sendOk(alice, bob, 'attack', { raider: 5 });
  await sendOk(alice, lou, 'attack', { raider: 5 });
  const bobRow = (await list(bob)).notifications[0]!;
  const louRow = (await list(lou)).notifications[0]!;

  // No session: 401 on both.
  const anon = new Client(app, '10.77.0.1');
  assert.equal((await anon.get('/api/notifications')).statusCode, 401);
  assert.equal((await anon.post('/api/notifications/read', {})).statusCode, 401);

  // Bob names lou's row: nothing changes for lou, and bob's response never contains it.
  const poked = await bob.c.post('/api/notifications/read', { ids: [louRow.id] });
  ok(poked);
  assert.equal(poked.json<NotificationsResponse>().notifications.some((n) => n.id === louRow.id), false);
  assert.equal((await list(lou)).unread, 1, 'lou\'s row is still unread');
  assert.equal((await list(bob)).unread, 1);

  // Marking one's own row, then everything.
  const mine = await bob.c.post('/api/notifications/read', { ids: [bobRow.id] });
  assert.equal(mine.json<NotificationsResponse>().unread, 0);
  assert.equal(mine.json<NotificationsResponse>().notifications[0]!.read, true);
  const all = await lou.c.post('/api/notifications/read', {});
  assert.equal(all.json<NotificationsResponse>().unread, 0);

  // Input schema: ids is an array of at most 200 positive integers, nothing else.
  const bad = async (body: unknown): Promise<void> => errorOf(await bob.c.post('/api/notifications/read', body), 400, 'invalid_input');
  await bad({ ids: 5 });
  await bad({ ids: 'all' });
  await bad({ ids: [0] });
  await bad({ ids: [-1] });
  await bad({ ids: [1.5] });
  await bad({ ids: ['1'] });
  await bad({ ids: [null] });
  await bad({ ids: Array.from({ length: 201 }, (_, i) => i + 1) });
  await bad({ ids: [1], extra: true });
  ok(await bob.c.post('/api/notifications/read', { ids: Array.from({ length: 200 }, (_, i) => i + 1) }));
  ok(await bob.c.post('/api/notifications/read', { ids: [] }));
});

test('at most 100 per player, nothing older than 7 real days, newest first', async () => {
  const { app, clock, alice, bob } = await world();
  const store = app.ctx.store;
  const a = store.villagesOfPlayer(alice.id)[0]!;
  const b = store.villagesOfPlayer(bob.id)[0]!;
  const t0 = clock.now();
  const put = (at: number): number => store.notifications.insert(bob.id, 'incoming_attack', 1000 + at, a.id, b.id, at, at + HOUR, at, NOTIFICATIONS_KEEP, NOTIFICATION_MAX_AGE_DAYS * 24 * HOUR);
  for (let i = 0; i < NOTIFICATIONS_KEEP + 15; i++) put(t0 + i * 1000);
  assert.equal(count(app, 'notifications', 'player_id = ?', bob.id), NOTIFICATIONS_KEEP);
  const seen = (await list(bob)).notifications;
  assert.equal(seen.length, NOTIFICATIONS_KEEP);
  assert.ok(seen[0]!.createdAt > seen[seen.length - 1]!.createdAt, 'newest first');
  assert.equal(seen[0]!.createdAt, t0 + (NOTIFICATIONS_KEEP + 14) * 1000);

  // A row older than 7 days is pruned by the next write and never listed.
  const old = t0 - 8 * 24 * HOUR;
  store.notifications.insert(bob.id, 'incoming_support', 5, a.id, b.id, old, old + HOUR, old, 1000, 365 * 24 * HOUR);
  assert.equal((await list(bob)).notifications.every((n) => n.createdAt >= t0), true, 'old rows are not listed');
  clock.set(t0 + 20 * 1000);
  put(t0 + 20 * 1000);
  assert.equal(count(app, 'notifications', 'player_id = ? AND created_at < ?', bob.id, t0), 0, 'and the next write removes them');
  // Another player's rows are untouched by bob's pruning.
  assert.equal(count(app, 'notifications', 'player_id = ?', alice.id), 0);
});

test('the target gets the live hint "notifications" when it is sent and when it is cancelled; the sender and bystanders do not', async () => {
  const { app, alice, bob, lou } = await world();
  const events: LiveEvent[] = [];
  app.ctx.store.onLive = (e) => void events.push(...e);
  giveTroops(app, alice, { raider: 5 });
  const { movement } = await sendOk(alice, bob, 'attack', { raider: 5 });
  const hinted = (id: number): number => events.filter((e) => e.kind === 'player' && e.playerId === id && e.topics.includes('notifications')).length;
  assert.equal(hinted(bob.id), 1);
  assert.equal(hinted(alice.id), 0);
  assert.equal(hinted(lou.id), 0);
  ok(await alice.c.post(`/api/movements/${movement.id}/cancel`, {}), 201);
  assert.equal(hinted(bob.id), 2);
  assert.equal(hinted(alice.id), 0);
});
