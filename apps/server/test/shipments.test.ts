// Resource shipments (GAME_DESIGN.md section 13).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SHIPMENT_BASE_CAPACITY,
  SHIPMENT_CAPACITY_PER_MARKET_LEVEL,
  SHIPMENT_MAX_IN_TRANSIT,
  settleVillage,
  shipmentTravelMs,
  storageCap,
  type Resources,
  type SendShipmentResponse,
} from '@clanfire/engine';
import { errorOf, ok } from './helpers.ts';
import { count, setBuilding } from './tribe-helpers.ts';
import { movementsOf, stateOf, village, world, type App, type P } from './warfare-helpers.ts';

/** Put exact stock into a player's village (and stop the clock inside it from adding more at once). */
function setStock(app: App, p: P, res: Partial<Resources>): void {
  const store = app.ctx.store;
  const v = store.villagesOfPlayer(p.id)[0];
  assert.ok(v);
  Object.assign(v.state.resources, res);
  if (v.state.buildings.market < 1) v.state.buildings.market = 1; // shipments need a Market; tests that check the gate reset it
  store.saveVillage(v.id, v.state, v.points);
}

async function ship(from: P, to: P | { x: number; y: number }, resources: object) {
  const home = await village(from);
  const dest = 'c' in to ? await village(to) : to;
  return from.c.post(`/api/villages/${home.id}/ship`, { x: dest.x, y: dest.y, resources });
}

async function shipOk(from: P, to: P, resources: Partial<Resources>): Promise<SendShipmentResponse> {
  const res = await ship(from, to, resources);
  ok(res, 201);
  return res.json<SendShipmentResponse>();
}

test('shipment to a tribe-mate: leaves the sender at once, shows to both, arrives after the travel time', async () => {
  const { app, clock, alice, amy } = await world();
  setStock(app, alice, { wood: 400, food: 400, iron: 400, gold: 50 });
  const before = (await village(amy)).state.resources.wood;
  const { movement, village: after } = await shipOk(alice, amy, { wood: 100, gold: 20 });
  assert.equal(movement.kind, 'shipment');
  assert.deepEqual([movement.resources?.wood, movement.resources?.gold], [100, 20]);
  const a = await village(alice);
  assert.equal(Math.floor(after.state.resources.wood), Math.floor(a.state.resources.wood));
  assert.ok(a.state.resources.wood < 320, 'wood left the village (production in a few ms is tiny)');
  assert.ok(a.state.resources.gold < 31);

  const to = await village(amy);
  assert.equal(movement.arriveAt - movement.departAt, shipmentTravelMs(a, to, app.ctx.settings));
  clock.set(movement.arriveAt - 1);
  const incoming = (await movementsOf(amy))[0];
  assert.ok(incoming);
  assert.deepEqual([incoming.kind, incoming.direction, incoming.resources?.wood], ['shipment', 'incoming', 100]);
  assert.equal((await movementsOf(alice))[0]?.direction, 'outgoing');

  clock.set(movement.arriveAt);
  assert.deepEqual(await movementsOf(amy), []);
  const got = (await village(amy)).state.resources;
  assert.ok(got.wood >= before + 100, 'the wood arrived');
  assert.equal(count(app, 'movements'), 0);
});

test('shipment checks: stock, capacity, input, target', async () => {
  const { app, alice, amy, bob, lou } = await world();
  setStock(app, alice, { wood: 300, food: 10, iron: 10, gold: 10 });
  errorOf(await ship(alice, amy, { wood: 5000 }), 409, 'not_enough_resources');
  errorOf(await ship(alice, amy, {}), 400, 'invalid_input');
  errorOf(await ship(alice, amy, { wood: 0 }), 400, 'invalid_input');
  errorOf(await ship(alice, amy, { wood: -5 }), 400, 'invalid_input');
  errorOf(await ship(alice, amy, { wood: 1.5 }), 400, 'invalid_input');
  errorOf(await ship(alice, amy, { stone: 5 }), 400, 'invalid_input');

  // Over the carrier capacity (base + per Market level), even though the stock is there.
  setBuilding(app, alice.id, 'market', 2);
  const cap = SHIPMENT_BASE_CAPACITY + SHIPMENT_CAPACITY_PER_MARKET_LEVEL * 2;
  setStock(app, alice, { wood: cap, food: 100 });
  errorOf(await ship(alice, amy, { wood: cap, food: 50 }), 400, 'invalid_input');
  ok(await ship(alice, amy, { wood: cap }), 201);

  // Any village is fine (neutral, enemy, abandoned); not an empty tile or the same village.
  setStock(app, alice, { wood: 200 });
  ok(await ship(alice, bob, { wood: 10 }), 201);
  ok(await ship(alice, lou, { wood: 10 }), 201);
  errorOf(await ship(alice, await village(alice), { wood: 10 }), 400, 'invalid_target');
  errorOf(await ship(alice, { x: 99_999, y: 99_999 }, { wood: 10 }), 400, 'invalid_target');
  const abandoned = app.ctx.store.db.prepare('SELECT x, y FROM villages WHERE owner_id IS NULL LIMIT 1').get() as { x: number; y: number } | undefined;
  if (abandoned) ok(await ship(alice, abandoned, { wood: 10 }), 201);
  // Someone else's village is not mine to send from.
  const bobHome = await village(bob);
  errorOf(await alice.c.post(`/api/villages/${bobHome.id}/ship`, { x: 1, y: 1, resources: { wood: 1 } }), 403, 'forbidden');
});

test('sending needs a Market in the sending village; receiving does not', async () => {
  const { app, alice, amy } = await world();
  setStock(app, alice, { wood: 100 });
  setBuilding(app, alice.id, 'market', 0);
  errorOf(await ship(alice, amy, { wood: 10 }), 409, 'requirements_not_met');
  // amy has no Market and still receives.
  setBuilding(app, alice.id, 'market', 1);
  setBuilding(app, amy.id, 'market', 0);
  ok(await ship(alice, amy, { wood: 10 }), 201);
  // amy cannot send either.
  setStock(app, amy, { wood: 100 });
  setBuilding(app, amy.id, 'market', 0);
  errorOf(await ship(amy, alice, { wood: 10 }), 409, 'requirements_not_met');
});

test('accounts that share a connection cannot send each other resources', async () => {
  const { app, alice, amy } = await world();
  setStock(app, alice, { wood: 100 });
  app.ctx.store.shareAnIp = () => true;
  errorOf(await ship(alice, amy, { wood: 10 }), 400, 'invalid_target');
});

test('at most SHIPMENT_MAX_IN_TRANSIT shipments on the road per village', async () => {
  const { app, clock, alice, amy } = await world();
  setStock(app, alice, { wood: 500 });
  const sent: SendShipmentResponse[] = [];
  for (let i = 0; i < SHIPMENT_MAX_IN_TRANSIT; i++) sent.push(await shipOk(alice, amy, { wood: 10 }));
  errorOf(await ship(alice, amy, { wood: 10 }), 409, 'queue_full');
  clock.set(Math.max(...sent.map((s) => s.movement.arriveAt)));
  ok(await ship(alice, amy, { wood: 10 }), 201);
});

test('arrival is capped at the storehouse; the overflow is lost', async () => {
  const { app, clock, alice, amy } = await world();
  const cap = storageCap(app.ctx.store.villagesOfPlayer(amy.id)[0]!.state);
  setStock(app, amy, { wood: cap - 30, iron: 0 });
  setStock(app, alice, { wood: 400, iron: 100 });
  const { movement } = await shipOk(alice, amy, { wood: 200, iron: 100 });
  clock.set(movement.arriveAt);
  assert.deepEqual(await movementsOf(amy), [], 'delivered');
  const v = app.ctx.store.villagesOfPlayer(amy.id)[0]!;
  const settled = settleVillage(v.state, movement.arriveAt, app.ctx.settings);
  assert.equal(Math.round(settled.resources.wood), cap, 'capped, not cap + 170');
  assert.ok(settled.resources.iron >= 100, 'under the cap the full amount arrives');
});

test('target abandoned in transit: the cargo is still delivered to the abandoned village', async () => {
  const { app, clock, alice, amy } = await world();
  setStock(app, alice, { wood: 400, food: 0, iron: 0, gold: 0 });
  const { movement } = await shipOk(alice, amy, { wood: 300 });
  const targetId = app.ctx.store.villagesOfPlayer(amy.id)[0]!.id;
  const before = settleVillage(app.ctx.store.getVillage(targetId)!.state, movement.arriveAt, app.ctx.settings).resources.wood;

  app.ctx.store.db.prepare('UPDATE villages SET owner_id = NULL WHERE owner_id = ?').run(amy.id);
  clock.set(movement.arriveAt);
  assert.deepEqual(await movementsOf(alice), [], 'delivered, not turned round');
  const after = settleVillage(app.ctx.store.getVillage(targetId)!.state, movement.arriveAt, app.ctx.settings).resources.wood;
  assert.ok(after > before + 1, 'the abandoned village received the wood');
});
