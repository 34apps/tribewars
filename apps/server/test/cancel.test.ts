// Cancelling a movement within CANCEL_WINDOW_MS, and the shipment reports (GAME_DESIGN.md section 13).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANCEL_WINDOW_MS, type MovementResponse, type Resources } from '@clanfire/engine';
import { errorOf, ok } from './helpers.ts';
import { giveTroops, latestReport, movementsOf, report, reports, sendOk, stateOf, village, world, type App, type P } from './warfare-helpers.ts';

function setStock(app: App, p: P, res: Partial<Resources>): void {
  const v = app.ctx.store.villagesOfPlayer(p.id)[0]!;
  Object.assign(v.state.resources, res);
  if (v.state.buildings.market < 1) v.state.buildings.market = 1; // shipments need a Market
  app.ctx.store.saveVillage(v.id, v.state, v.points);
}

const cancel = (p: P, id: number) => p.c.post(`/api/movements/${id}/cancel`, {});

async function shipTo(from: P, to: P, resources: Partial<Resources>) {
  const home = await village(from);
  const dest = await village(to);
  const res = await from.c.post(`/api/villages/${home.id}/ship`, { x: dest.x, y: dest.y, resources });
  ok(res, 201);
  return res.json<{ movement: { id: number; departAt: number; arriveAt: number } }>().movement;
}

test('cancel an attack after 30 s: troops come back in 30 s, nothing looted, own list shows the return', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, alice, { raider: 5 });
  const sent = (await sendOk(alice, bob, 'attack', { raider: 5 })).movement;
  assert.ok(sent.cancellableUntil !== null && sent.cancellableUntil === sent.departAt + CANCEL_WINDOW_MS);
  clock.advance(30_000);
  const res = await cancel(alice, sent.id);
  ok(res, 201);
  const back = res.json<MovementResponse>().movement;
  assert.equal(back.kind, 'return');
  assert.equal(back.arriveAt - back.departAt, 30_000);
  assert.equal(back.cancellableUntil, null);
  assert.equal(back.units?.raider, 5);
  const list = await movementsOf(alice);
  assert.deepEqual(list.map((m) => m.kind), ['return']);
  assert.deepEqual(await movementsOf(bob), [], 'the target no longer sees an attack');
  clock.advance(30_000);
  assert.deepEqual(await movementsOf(alice), []);
  assert.equal((await village(alice)).state.troops.raider, 5);
  assert.equal((await reports(bob)).length, 0, 'no battle took place');
});

test('cancel is refused after the window, for a return, twice, and for other players', async () => {
  const { app, clock, alice, amy, bob } = await world();
  giveTroops(app, alice, { raider: 6 });
  const far = (await sendOk(alice, bob, 'attack', { raider: 2 })).movement;
  const second = (await sendOk(alice, bob, 'attack', { raider: 2 })).movement;
  const third = (await sendOk(alice, bob, 'attack', { raider: 2 })).movement;
  assert.ok(far.arriveAt - far.departAt > CANCEL_WINDOW_MS + 1000, 'test world distance is long enough');

  errorOf(await cancel(bob, second.id), 404, 'not_found');
  errorOf(await cancel(amy, second.id), 404, 'not_found');
  errorOf(await cancel(alice, 999_999), 404, 'not_found');

  const back = (await cancel(alice, second.id)).json<MovementResponse>().movement;
  errorOf(await cancel(alice, second.id), 404, 'not_found');
  errorOf(await cancel(alice, back.id), 400, 'invalid_target');

  clock.advance(CANCEL_WINDOW_MS + 1);
  errorOf(await cancel(alice, far.id), 409, 'too_late');
  const listed = (await movementsOf(alice)).find((m) => m.id === third.id);
  assert.equal(listed?.cancellableUntil, null);
});

test('cancel a shipment: cargo returns in the elapsed time and the stock is restored; no report', async () => {
  const { app, clock, alice, amy } = await world();
  setStock(app, alice, { wood: 400, food: 0, iron: 0, gold: 0 });
  const m = await shipTo(alice, amy, { wood: 100 });
  clock.advance(45_000);
  const res = await cancel(alice, m.id);
  ok(res, 201);
  const back = res.json<MovementResponse>().movement;
  assert.equal(back.kind, 'return');
  assert.equal(back.arriveAt - back.departAt, 45_000);
  assert.equal(back.loot?.wood, 100);
  assert.deepEqual(await movementsOf(amy), []);
  clock.advance(45_000);
  assert.deepEqual(await movementsOf(alice), []);
  assert.ok((await village(alice)).state.resources.wood >= 399, 'the cargo is home again');
  assert.equal((await reports(amy)).length, 0);
});

test('a cancel right away still takes one second to come back', async () => {
  const { app, alice, bob } = await world();
  giveTroops(app, alice, { raider: 1 });
  const sent = (await sendOk(alice, bob, 'attack', { raider: 1 })).movement;
  const back = (await cancel(alice, sent.id)).json<MovementResponse>().movement;
  assert.equal(back.arriveAt - back.departAt, 1000);
});

test('shipment reports: sender and receiver both get one, with stored and lost amounts', async () => {
  const { app, clock, alice, amy } = await world();
  setStock(app, alice, { wood: 400, food: 0, iron: 0, gold: 0 });
  const m = await shipTo(alice, amy, { wood: 100 });
  clock.set(m.arriveAt);
  await stateOf(alice);
  const mine = await latestReport(alice);
  assert.equal(mine.type, 'shipment');
  assert.equal(mine.side, 'shipment');
  assert.equal(mine.shipment?.role, 'sent');
  assert.equal(mine.shipment?.resources.wood, 100);
  const theirs = await latestReport(amy);
  assert.equal(theirs.shipment?.role, 'received');
  assert.equal(theirs.shipment?.stored.wood + theirs.shipment!.lost.wood, 100);
  assert.equal((await report(amy, theirs.id)).shipment?.to.ownerName, 'amy');
});

test('a shipment to a full storehouse reports the lost part', async () => {
  const { app, clock, alice, amy } = await world();
  const cap = Math.floor(app.ctx.store.villagesOfPlayer(amy.id)[0]!.state.resources.wood);
  setStock(app, alice, { wood: 400 });
  const v = app.ctx.store.villagesOfPlayer(amy.id)[0]!;
  v.state.resources.wood = 10_000_000;
  app.ctx.store.saveVillage(v.id, v.state, v.points);
  void cap;
  const m = await shipTo(alice, amy, { wood: 100 });
  clock.set(m.arriveAt);
  await stateOf(alice);
  const r = (await latestReport(amy)).shipment!;
  assert.equal(r.stored.wood, 0);
  assert.equal(r.lost.wood, 100);
});

test('troops stationed in a village that is attacked: their owner gets a "your troops were attacked" report', async () => {
  const { app, clock, alice, amy, bob } = await world();
  giveTroops(app, bob, { raider: 20 });
  giveTroops(app, amy, { raider: 3 });
  const { stationSupport } = await import('./warfare-helpers.ts');
  await stationSupport(app, clock, amy, alice, { raider: 3 });
  const atk = (await sendOk(bob, alice, 'attack', { raider: 5 })).movement;
  clock.set(atk.arriveAt);
  await stateOf(bob);
  const stationed = (await reports(amy)).find((r) => r.side === 'support');
  assert.ok(stationed, 'amy was told');
  assert.match(stationed.title, /Your troops at .* were attacked/);
  assert.ok((await reports(alice)).some((r) => r.side === 'defense'));
  assert.ok((await reports(bob)).some((r) => r.side === 'attack'));
});
