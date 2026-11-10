// Chieftain training and the Renown reserved for each Chieftain (docs/GAME_DESIGN.md 18.2, step 2).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHIEFTAIN_RENOWN_REFUND_SHARE, UNITS, type CancelResponse, type OwnVillageDto } from '@clanfire/engine';
import { errorOf, makeApp, ok, type Client } from './helpers.ts';
import { sendOk } from './warfare-helpers.ts';
import { assertLedgerSane, clearedTarget, fillChest, homeOf, ledger, player, reserveFor, strongHome } from './village-helpers.ts';

const train = (c: Client, vid: number, count: number) => c.post(`/api/villages/${vid}/train`, { unit: 'chieftain', count });

test('training a Chieftain reserves Renown together with the resources, and the price rises with each Chieftain', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'alice');
  const vid = strongHome(app, clock, p, {});
  app.ctx.store.addRenown(p.id, 2000);
  fillChest(app, p, 100_000);
  const before = await p.c.state();
  assert.equal(before.renown.chieftainPrice, 1000, 'first Chieftain costs the base village price');
  assert.equal(before.renown.chieftains, 0);
  assert.equal(before.renown.reserved, 0);

  ok(await train(p.c, vid, 1));
  const after = await p.c.state();
  assert.equal(after.renown.reserved, 1000);
  assert.equal(after.renown.spent, before.renown.spent + 1000, 'the reservation is part of spent');
  assert.equal(after.renown.balance, before.renown.balance - 1000);
  assert.equal(after.renown.total, before.renown.total, 'nothing earned or lost');
  assert.equal(after.renown.chieftains, 1);
  assert.equal(after.renown.chieftainPrice, 1600, 'the next one costs what the village after this one would');
  const wood0 = before.villages[0]?.state.resources.wood ?? 0;
  assert.ok((after.villages[0]?.state.resources.wood ?? 0) <= wood0 - UNITS.chieftain.cost.wood + 1, 'the resources were paid too');
  assert.equal(after.villages[0]?.state.trainQueues.bannerhall.length, 1);
  assertLedgerSane(app, p);
  await app.close();
});

test('a batch of two prices each Chieftain separately; a short balance refuses the whole order and pays nothing', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'alice');
  const vid = strongHome(app, clock, p, {});
  app.ctx.store.addRenown(p.id, 2599); // one short of 1000 + 1600
  fillChest(app, p, 100_000);
  const state0 = await p.c.state();
  const res = await train(p.c, vid, 2);
  errorOf(res, 409, 'not_enough_resources');
  const same = await p.c.state();
  assert.equal(same.renown.spent, state0.renown.spent);
  assert.equal(same.renown.reserved, 0);
  assert.equal(same.villages[0]?.state.trainQueues.bannerhall.length, 0, 'nothing queued');
  assert.deepEqual(same.villages[0]?.state.resources, state0.villages[0]?.state.resources, 'no resources paid');

  app.ctx.store.addRenown(p.id, 1);
  ok(await train(p.c, vid, 2));
  const after = await p.c.state();
  assert.equal(after.renown.reserved, 2600);
  assert.equal(after.renown.chieftains, 2);
  assert.equal(after.renown.chieftainPrice, 2560, 'the third village price');
  // One batch at a time per village.
  errorOf(await train(p.c, vid, 1),409, 'queue_full');
  await app.close();
});

test('training needs the Banner Hall, and only the owner can train or cancel in a village', async () => {
  const { app, clock } = await makeApp();
  const alice = await player(app, 'alice');
  const bob = await player(app, 'bob');
  app.ctx.store.addRenown(alice.id, 4000);
  fillChest(app, alice, 100_000);
  const plainId = homeOf(app, alice).id;
  errorOf(await train(alice.c, plainId, 1),409, 'requirements_not_met');
  assert.equal(ledger(app, alice).reserved, 0);

  const vid = strongHome(app, clock, alice, {});
  errorOf(await train(bob.c, vid, 1),403, 'forbidden');
  ok(await train(alice.c, vid, 1));
  errorOf(await bob.c.post(`/api/villages/${vid}/cancel-train`, { building: 'bannerhall', index: 0 }), 403, 'forbidden');
  errorOf(await alice.c.post(`/api/villages/${vid}/cancel-train`, { building: 'castle', index: 0 }), 400, 'invalid_input');
  assert.equal(ledger(app, alice).reserved, 1000, 'a stranger cannot touch the reservation');
  await app.close();
});

test('cancelling a queued Chieftain batch gives the resources (80%) and the Renown back in full', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'alice');
  const vid = strongHome(app, clock, p, {});
  app.ctx.store.addRenown(p.id, 4000);
  fillChest(app, p, 100_000);
  const base = ledger(app, p);
  ok(await train(p.c, vid, 2));
  assert.equal(ledger(app, p).reserved, 2600);

  const res = await p.c.post(`/api/villages/${vid}/cancel-train`, { building: 'bannerhall', index: 0 });
  ok(res);
  const body = res.json<CancelResponse>();
  assert.equal(body.renownRefund, 2600);
  assert.equal(body.refund.wood, Math.floor((UNITS.chieftain.cost.wood * 2 * 80) / 100));
  assert.equal(body.village.state.trainQueues.bannerhall.length, 0);
  const l = ledger(app, p);
  assert.equal(l.reserved, 0);
  assert.equal(l.spent, base.spent, 'spent is back to what it was');
  assertLedgerSane(app, p);
  errorOf(await p.c.post(`/api/villages/${vid}/cancel-train`, { building: 'bannerhall', index: 0 }), 400, 'invalid_input');
  await app.close();
});

test('a Chieftain who dies in battle gives back half his average reservation; spent never goes negative', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'alice');
  const vid = strongHome(app, clock, p, { chieftain: 2, raider: 1 });
  reserveFor(app, p, 2, 500); // two Chieftains, 500 each
  const home = homeOf(app, p);
  // The garrison is still there: a Chieftain with one raider cannot win.
  const target = app.ctx.store.getVillage(app.ctx.store.abandonedVillageIds()[0] as number);
  assert.ok(target);
  const { movement } = await sendOk(p, target, 'attack', { chieftain: 1, raider: 1 });
  const base = ledger(app, p);
  clock.set(movement.arriveAt);
  await p.c.state(); // the arrival is processed by the request

  const l = ledger(app, p);
  const share = base.reserved / 2;
  assert.equal(l.reserved, base.reserved - share, 'his share left the reservation');
  assert.equal(l.spent, base.spent - Math.floor(share * CHIEFTAIN_RENOWN_REFUND_SHARE), 'half of it came back');
  assertLedgerSane(app, p);
  const st = await p.c.state();
  assert.equal(st.renown.chieftains, 1, 'one Chieftain is left at home');
  assert.equal(st.villages.find((v) => v.id === vid)?.state.away.chieftain, 0);
  assert.equal(home.id, vid);

  // The clamp: releasing more than is there never goes below zero.
  app.ctx.store.releaseRenown(p.id, 1e9, 1e9);
  const z = ledger(app, p);
  assert.equal(z.reserved, 0);
  assert.equal(z.spent, 0);
  await app.close();
});

test('Chieftains cannot be trained in a stranger\'s village or an unknown one; the invalid unit counts are refused', async () => {
  const { app, clock } = await makeApp();
  const alice = await player(app, 'alice');
  const bob = await player(app, 'bob');
  const mine = strongHome(app, clock, alice, {});
  const bobVillage = strongHome(app, clock, bob, {});
  app.ctx.store.addRenown(alice.id, 5000);
  errorOf(await train(alice.c, bobVillage, 1),403, 'forbidden');
  errorOf(await train(alice.c, 99999, 1),404, 'not_found');
  errorOf(await train(alice.c, mine, 0),400, 'invalid_input');
  errorOf(await train(alice.c, mine, -1),400, 'invalid_input');
  errorOf(await train(alice.c, mine, 4),400, 'invalid_input'); // CHIEFTAIN_MAX_BATCH is 3
  assert.equal(ledger(app, alice).reserved, 0);
  await app.close();
});

test('the state shows the price and the ledger; a lit village has no hearth info', async () => {
  const { app, clock } = await makeApp();
  const alice = await player(app, 'alice');
  strongHome(app, clock, alice, {});
  const st = await alice.c.state();
  assert.equal(typeof st.renown.chieftainPrice, 'number');
  assert.equal(typeof st.renown.reserved, 'number');
  const village = st.villages[0] as OwnVillageDto;
  assert.equal(village.hearth, undefined);
  assert.ok(clearedTarget(app, homeOf(app, alice)), 'the world has an abandoned village to take');
  await app.close();
});
