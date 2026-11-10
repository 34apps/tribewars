// War Chest (docs/GAME_DESIGN.md 18.2, BALANCE 12.3): POST /api/villages/:id/chest and the Chieftain gold ledger.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WAR_CHEST_BASE, chestChieftainPrice, chieftainRefund, villagePoints, type CancelResponse, type ChestDepositResponse, type SendResponse } from '@clanfire/engine';
import { HOUR, errorOf, makeApp, ok, type Client } from './helpers.ts';
import { giveTroops, sendOk, unprotect } from './warfare-helpers.ts';
import { assertLedgerSane, chestOf, fillChest, homeOf, ledger, player, runTo, strongHome, villagesOf, freeTileNear } from './village-helpers.ts';
import { newPlayer } from './tribe-helpers.ts';
import { setVillage } from './renown-helpers.ts';

const deposit = (c: Client, vid: number, body: unknown) => c.post(`/api/villages/${vid}/chest`, body);
const train = (c: Client, vid: number, count: number) => c.post(`/api/villages/${vid}/train`, { unit: 'chieftain', count });

async function rich(gold = 5000) {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  setVillage(app, p.id, { levels: { storehouse: 20 }, resources: { gold } });
  const vid = (await p.c.village()).id;
  return { app, clock, p, vid };
}

test('deposit: the village loses the gold, the chest gains it, the answer and the state show it', async () => {
  const { app, p, vid } = await rich();
  const before = (await p.c.village()).state.resources;
  const res = await deposit(p.c, vid, { gold: 1200 });
  ok(res);
  const body = res.json<ChestDepositResponse>();
  assert.equal(body.village.state.resources.gold, before.gold - 1200);
  assert.deepEqual(body.chest, { gold: 1200, reserved: 0, chieftainPrice: WAR_CHEST_BASE });
  assert.equal(body.village.state.resources.wood, before.wood, 'only gold moves');
  ok(await deposit(p.c, vid, { gold: 300 }));
  const st = await p.c.state();
  assert.deepEqual(st.chest, { gold: 1500, reserved: 0, chieftainPrice: WAR_CHEST_BASE });
  assert.equal(chestOf(app, p).gold, 1500);
  await app.close();
});

test('deposit: another player\'s village is 403, an unknown one 404, bad bodies are 400 and nothing moves', async () => {
  const { app, p, vid } = await rich();
  const bob = await newPlayer(app, 'bob');
  errorOf(await deposit(bob.c, vid, { gold: 10 }), 403, 'forbidden');
  errorOf(await deposit(p.c, 99999, { gold: 10 }), 404, 'not_found');
  for (const bad of [{ gold: 0 }, { gold: -5 }, { gold: 2.5 }, { gold: '10' }, {}, { gold: 10, extra: 1 }, { gold: null }, { gold: 1e12 }]) {
    errorOf(await deposit(p.c, vid, bad), 400, 'invalid_input');
  }
  assert.equal(chestOf(app, p).gold, 0);
  assert.equal(chestOf(app, bob).gold, 0);
  await app.close();
});

test('deposit: more than the village holds is 409 not_enough_resources; a cold village is 409 requirements_not_met', async () => {
  const { app, p, vid } = await rich(500);
  errorOf(await deposit(p.c, vid, { gold: 501 }), 409, 'not_enough_resources');
  assert.equal(chestOf(app, p).gold, 0);
  const v = homeOf(app, p);
  const cold = { ...v.state, hearth: { status: 'out' as const, claimBy: p.id + 99, outAt: Date.now(), holdMs: HOUR, runningSince: null, underSince: null } };
  app.ctx.store.saveVillage(v.id, cold, villagePoints(cold));
  errorOf(await deposit(p.c, vid, { gold: 10 }), 409, 'requirements_not_met');
  assert.equal(chestOf(app, p).gold, 0);
  await app.close();
});

test('train: a short chest refuses the order (409) and nothing is paid; a batch of 2 reserves 2,000 + 3,200', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'alice');
  const vid = strongHome(app, clock, p, {});
  app.ctx.store.addRenown(p.id, 5000);
  fillChest(app, p, chestChieftainPrice(1, 0) + chestChieftainPrice(1, 1) - 1);
  const before = await p.c.state();
  const renown0 = ledger(app, p);
  errorOf(await train(p.c, vid, 2), 409, 'not_enough_resources');
  const same = await p.c.state();
  assert.deepEqual(same.chest, before.chest);
  assert.deepEqual(ledger(app, p), renown0, 'Renown untouched');
  assert.deepEqual(same.villages[0]?.state.resources, before.villages[0]?.state.resources, 'resources untouched');
  assert.equal(same.villages[0]?.state.trainQueues.bannerhall.length, 0);

  fillChest(app, p, 1);
  ok(await train(p.c, vid, 2));
  const after = await p.c.state();
  assert.equal(after.chest?.reserved, 5200);
  assert.equal(after.chest?.gold, 0);
  assert.equal(after.chest?.chieftainPrice, 5120, 'the third Chieftain');
  assert.equal(after.villages[0]?.state.resources.gold, before.villages[0]?.state.resources.gold, 'the Chieftain costs the village no gold');
  assertLedgerSane(app, p);
  await app.close();
});

test('cancel: a queued batch gives the chest gold back in full', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'alice');
  const vid = strongHome(app, clock, p, {});
  app.ctx.store.addRenown(p.id, 5000);
  fillChest(app, p, 10_000);
  ok(await train(p.c, vid, 2));
  assert.deepEqual(chestOf(app, p), { gold: 10_000 - 5200, reserved: 5200 });
  ok(await p.c.post(`/api/villages/${vid}/cancel-train`, { building: 'bannerhall', index: 0 }));
  assert.deepEqual(chestOf(app, p), { gold: 10_000, reserved: 0 });
  await app.close();
});

test('death: a Chieftain who dies gives half his share back to the chest', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'alice');
  const vid = strongHome(app, clock, p, { raider: 1 });
  app.ctx.store.addRenown(p.id, 5000);
  fillChest(app, p, 10_000);
  ok(await train(p.c, vid, 2));
  clock.set(clock.now() + 48 * HOUR);
  await p.c.state(); // the batch is trained
  assert.equal((await p.c.state()).villages[0]?.state.troops.chieftain, 2);
  const target = app.ctx.store.getVillage(app.ctx.store.abandonedVillageIds()[0] as number);
  assert.ok(target);
  const { movement } = await sendOk(p, target, 'attack', { chieftain: 1, raider: 1 });
  const base = chestOf(app, p);
  clock.set(movement.arriveAt);
  await p.c.state();
  const share = base.reserved / 2;
  const now = chestOf(app, p);
  assert.equal(now.reserved, base.reserved - share, 'his share left the reserve');
  assert.equal(now.gold, base.gold + chieftainRefund(share), 'half of it came back');
  await app.close();
});

test('used up: a Chieftain who founds a village releases his share; the gold stays spent', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['founder'] });
  const p = await player(app, 'founder');
  const homeId = strongHome(app, clock, p, { pikeman: 40, chieftain: 1 });
  app.ctx.store.addRenown(p.id, 1000);
  app.ctx.store.reserveRenown(p.id, 500);
  fillChest(app, p, 3000);
  app.ctx.store.reserveChest(p.id, 2000);
  const tile = freeTileNear(app, p);
  const res = await p.c.post(`/api/villages/${homeId}/send`, { x: tile.x, y: tile.y, units: { pikeman: 40, chieftain: 1 }, mission: 'found', travelSeconds: 60 });
  ok(res, 201);
  runTo(app, clock, res.json<SendResponse>().movement.arriveAt);
  assert.equal(villagesOf(app, p).length, 2);
  assert.deepEqual(chestOf(app, p), { gold: 1000, reserved: 0 });
  await app.close();
});

test('kept: raids cannot touch the chest, and it survives losing the last village', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['claimer'] });
  const store = app.ctx.store;
  const victim = await player(app, 'victim');
  const lost = villagesOf(app, victim)[0]!;
  fillChest(app, victim, 4000);
  giveTroops(app, victim, { pikeman: 1 });

  // A raid with real loot.
  const raider = await player(app, 'raider');
  strongHome(app, clock, raider, { raider: 300 });
  const { movement: raid } = await sendOk(raider, lost, 'attack', { raider: 300 });
  runTo(app, clock, raid.arriveAt);
  assert.equal(chestOf(app, victim).gold, 4000, 'a raid never touches the chest');

  // A Strike takes the last village.
  const claimer = await player(app, 'claimer');
  const home = strongHome(app, clock, claimer, { raider: 400, chieftain: 1 });
  store.addRenown(claimer.id, 1000);
  store.reserveRenown(claimer.id, 500);
  fillChest(app, claimer, 3000);
  store.reserveChest(claimer.id, 2000);
  const res = await claimer.c.post(`/api/villages/${home}/send`, { x: lost.x, y: lost.y, units: { raider: 400, chieftain: 1 }, mission: 'attack', travelSeconds: 60 });
  ok(res, 201);
  runTo(app, clock, res.json<SendResponse>().movement.arriveAt);
  const end = (await (await claimer.c.get(`/api/map?x=${lost.x}&y=${lost.y}&w=1&h=1`)).json<{ villages: Array<{ hearth?: { endsAt: number } }> }>()).villages[0]?.hearth?.endsAt ?? 0;
  runTo(app, clock, end);
  assert.equal(store.villagesOfPlayer(victim.id).length, 0);
  assert.equal(chestOf(app, victim).gold, 4000, 'kept with no village');
  assert.deepEqual(chestOf(app, claimer), { gold: 1000, reserved: 0 }, 'the taker\'s Chieftain was used up');
  const st = await victim.c.state(); // restart village
  assert.equal(st.villages.length, 1);
  assert.equal(st.chest?.gold, 4000, 'kept after the restart');
  unprotect(app, victim);
  await app.close();
});

test('state: the chest is part of /api/state and the price follows villages and Chieftains', async () => {
  const { app, p } = await rich();
  const st = await p.c.state();
  assert.deepEqual(st.chest, { gold: 0, reserved: 0, chieftainPrice: chestChieftainPrice(1, 0) });
  await app.close();
});
