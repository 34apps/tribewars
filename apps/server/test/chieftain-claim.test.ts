// Pay for the village, not for each Chieftain (owner 2026-11-18, docs/GAME_DESIGN.md 18.2): a Chieftain reserves a deposit when trained;
// sending an order that can gain a village reserves the rest of the village price once (a claim); gaining the village spends both, an order
// that fails or a chain that runs out gives the rest back in full. Walking times are fixed (sandbox accounts), so nothing waits on real time.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUILDING_IDS,
  STRIKE_CHAIN_WINDOW_HOURS,
  chieftainsNeeded,
  villagePoints,
  villageRenownCost,
  type SendResponse,
  type Units,
  type VillageState,
} from '@clanfire/engine';
import { errorOf, makeApp, ok } from './helpers.ts';
import type { Clock } from './helpers.ts';
import { assertLedgerSane, chestOf, clearedTarget, freeTileNear, homeOf, ledger, player, runTo, strongHome, villagesOf, type App, type P } from './village-helpers.ts';
import { garrisonAbandoned } from './helpers.ts';
import { HOLD_HOURS_ABANDONED } from '@clanfire/engine';

const SPEED = 10;
const WINDOW_S = (STRIKE_CHAIN_WINDOW_HOURS * 3600) / SPEED;
const HOLD_MS = (HOLD_HOURS_ABANDONED * 3_600_000) / SPEED;
const DEPOSIT = 325; // a quarter of 1,300
const DEPOSIT_GOLD = 500; // a quarter of 2,000
const REST = 1300 - DEPOSIT; // 975
const REST_GOLD = 2000 - DEPOSIT_GOLD; // 1,500

async function go(p: P, vid: number, to: { x: number; y: number }, units: Partial<Units>, mission: 'attack' | 'found' = 'attack', travelSeconds = 60) {
  const res = await p.c.post(`/api/villages/${vid}/send`, { x: to.x, y: to.y, units, mission, travelSeconds, returnSeconds: 10_000 });
  return res;
}
const goOk = async (...a: Parameters<typeof go>) => {
  const res = await go(...a);
  ok(res, 201);
  return res.json<SendResponse>().movement;
};

/** Chieftains with a deposit each (as if trained), `free` Renown and chest gold left to pay the rest of the price with. */
function withChieftains(app: App, p: P, n: number, free: { renown: number; gold: number }): void {
  const s = app.ctx.store;
  s.addRenown(p.id, n * DEPOSIT + free.renown);
  s.reserveRenown(p.id, n * DEPOSIT);
  s.depositChest(p.id, n * DEPOSIT_GOLD + free.gold);
  s.reserveChest(p.id, n * DEPOSIT_GOLD);
}

async function abandonedSetup(n = 1, free = { renown: 10_000, gold: 10_000 }) {
  const { app, clock } = await makeApp({ sandboxUsers: ['claimer'] });
  const p = await player(app, 'claimer');
  const homeId = strongHome(app, clock, p, { raider: 300, chieftain: n });
  withChieftains(app, p, n, free);
  const target = clearedTarget(app, homeOf(app, p));
  return { app, clock, p, homeId, target };
}

test('send: a Strike reserves the rest of the village price (Renown and chest gold) once; the state shows it as held', async () => {
  const { app, p, homeId, target } = await abandonedSetup();
  const before = { ...ledger(app, p), chest: chestOf(app, p) };
  await goOk(p, homeId, target, { raider: 300, chieftain: 1 });
  const after = { ...ledger(app, p), chest: chestOf(app, p) };
  assert.equal(after.spent - before.spent, REST, 'the village price minus the Chieftain\'s deposit');
  assert.equal(after.reserved, before.reserved, 'his deposit is untouched');
  assert.equal(before.chest.gold - after.chest.gold, REST_GOLD);
  const st = await p.c.state();
  assert.equal(st.renown.held, REST);
  assert.equal(st.chest?.held, REST_GOLD);
  assert.equal(st.renown.balance, before.total - after.spent, 'the balance dropped by the rest of the price');
  assertLedgerSane(app, p);
  await app.close();
});

test('send: short of Renown or chest gold is refused in plain words and nothing is paid, nothing leaves', async () => {
  const { app, p, homeId, target } = await abandonedSetup(1, { renown: REST - 1, gold: 0 });
  const l0 = ledger(app, p);
  const refused = await go(p, homeId, target, { raider: 300, chieftain: 1 });
  errorOf(refused, 409, 'not_enough_resources');
  assert.match(refused.json<{ message: string }>().message, /^You need 1 more Renown to send this Strike\.$/);
  assert.deepEqual(ledger(app, p), l0, 'nothing reserved');
  assert.equal(homeOf(app, p).state.troops.chieftain, 1, 'the troops did not leave');
  assert.equal(app.ctx.store.claimsHeld(p.id).renown, 0);

  app.ctx.store.addRenown(p.id, 1);
  const noGold = await go(p, homeId, target, { raider: 300, chieftain: 1 });
  errorOf(noGold, 409, 'not_enough_resources');
  assert.match(noGold.json<{ message: string }>().message, /^You need 1,500 more War Chest gold to send this Strike\.$/);
  assert.deepEqual(ledger(app, p), { ...l0, total: l0.total + 1 }, 'still nothing reserved');
  assertLedgerSane(app, p);
  await app.close();
});

test('gain: the village is paid exactly once (deposit + rest = the village price) and the claim is spent', async () => {
  const { app, clock, p, homeId, target } = await abandonedSetup();
  const chest0 = chestOf(app, p);
  const start = ledger(app, p);
  const m = await goOk(p, homeId, target, { raider: 300, chieftain: 1 });
  runTo(app, clock, m.arriveAt + HOLD_MS);
  assert.equal(app.ctx.store.getVillage(target.id)?.ownerId, p.id, 'taken');
  const end = ledger(app, p);
  assert.equal(end.reserved, 0, 'his deposit left the reservation');
  assert.equal(end.spent - (start.spent - DEPOSIT), villageRenownCost(1), 'one village price in all');
  assert.equal(end.spent, villageRenownCost(1), 'the only Renown spent is the village price');
  assert.equal(app.ctx.store.claimsHeld(p.id).renown, 0);
  assert.equal(app.ctx.store.claimsOfPlayer(p.id).length, 0);
  assert.equal(chest0.gold + chest0.reserved - (chestOf(app, p).gold + chestOf(app, p).reserved), 2000, 'the chest paid one village price of gold');
  assertLedgerSane(app, p);
  // The next village costs more (x1.6 per village owned), the deposit follows.
  const st = await p.c.state();
  assert.equal(st.renown.nextVillageCost, 2080);
  assert.equal(st.renown.chieftainPrice, 520);
  await app.close();
});

test('fail: a Strike that loses all its Chieftains gives the rest back in full and half the deposit back', async () => {
  const { app, clock, p, homeId, target } = await abandonedSetup();
  garrisonAbandoned(app, target.id, { pikeman: 80 });
  const start = ledger(app, p);
  const m = await goOk(p, homeId, target, { raider: 1, chieftain: 1 });
  assert.equal(app.ctx.store.claimsHeld(p.id).renown, REST);
  runTo(app, clock, m.arriveAt);
  const end = ledger(app, p);
  assert.equal(app.ctx.store.claimsHeld(p.id).renown, 0, 'released');
  assert.equal(end.spent, start.spent - Math.floor(DEPOSIT / 2), 'the rest came back in full; half of his deposit too');
  assert.equal(end.reserved, 0);
  assert.equal(chestOf(app, p).gold, 10_000 + DEPOSIT_GOLD / 2, 'the chest got the rest and half of his deposit back');
  assertLedgerSane(app, p);
  await app.close();
});

test('fail: a claim that fails to hold gives the rest back; his deposit stays with the Chieftain who walks home', async () => {
  const { app, clock, p, homeId, target } = await abandonedSetup();
  const start = ledger(app, p);
  const m = await goOk(p, homeId, target, { raider: 100, chieftain: 1 }); // 108 population is under the hold minimum
  runTo(app, clock, m.arriveAt);
  assert.equal(app.ctx.store.claimsHeld(p.id).renown, REST, 'the hold is running (paused): the claim lives');
  runTo(app, clock, m.arriveAt + (2 * 3_600_000) / SPEED); // HOLD_FAIL_HOURS
  assert.equal(app.ctx.store.getVillage(target.id)?.ownerId, null, 'never taken');
  assert.equal(app.ctx.store.claimsHeld(p.id).renown, 0, 'released when the claim ended');
  assert.deepEqual(ledger(app, p), start, 'back to the deposit only');
  assertLedgerSane(app, p);
  await app.close();
});

test('cancel: a queued batch gives its deposits back in full (nothing else was reserved yet)', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'alice');
  const vid = strongHome(app, clock, p, {});
  app.ctx.store.addRenown(p.id, 5000);
  app.ctx.store.depositChest(p.id, 10_000);
  const base = ledger(app, p);
  ok(await p.c.post(`/api/villages/${vid}/train`, { unit: 'chieftain', count: 3 }));
  assert.equal(ledger(app, p).reserved, 3 * DEPOSIT);
  ok(await p.c.post(`/api/villages/${vid}/cancel-train`, { building: 'bannerhall', index: 0 }));
  assert.deepEqual(ledger(app, p), base);
  assert.equal(chestOf(app, p).gold, 10_000);
  assertLedgerSane(app, p);
  await app.close();
});

test('found: the rest of the price is reserved at sending, spent when the village is founded, released when the tile is taken', async () => {
  for (const taken of [false, true]) {
    const { app, clock } = await makeApp({ sandboxUsers: ['founder'] });
    const p = await player(app, 'founder');
    const homeId = strongHome(app, clock, p, { pikeman: 10, chieftain: 1 });
    withChieftains(app, p, 1, { renown: 5000, gold: 5000 });
    const tile = freeTileNear(app, p);
    const start = ledger(app, p);
    const m = await goOk(p, homeId, tile, { pikeman: 10, chieftain: 1 }, 'found');
    assert.equal(app.ctx.store.claimsHeld(p.id).renown, REST);
    assert.equal(ledger(app, p).spent, start.spent + REST);
    if (taken) app.ctx.store.insertVillage(p.id, 'Squatter', tile.x, tile.y, 0, (await import('@clanfire/engine')).createPlayerVillage(clock.now())); // the tile is gone when he arrives
    runTo(app, clock, m.arriveAt);
    if (taken) {
      assert.equal(app.ctx.store.claimsHeld(p.id).renown, 0, 'nothing was founded: released');
      assert.deepEqual(ledger(app, p), start, 'back to the deposit only');
    } else {
      assert.equal(villagesOf(app, p).length, 2);
      assert.equal(ledger(app, p).spent, villageRenownCost(1), 'one village price spent');
      assert.equal(ledger(app, p).reserved, 0);
    }
    assertLedgerSane(app, p);
    await app.close();
  }
});

// ---- chain ----------------------------------------------------------------------------------------------------------

function sizedVictim(app: App, clock: Clock, p: P, need: number) {
  const store = app.ctx.store;
  const id = strongHome(app, clock, p, {});
  const full = store.getVillage(id)!.state;
  for (let f = 1; f > 0; f -= 0.02) {
    const st: VillageState = structuredClone(full);
    for (const b of BUILDING_IDS) st.buildings[b] = Math.floor(full.buildings[b] * f);
    if (chieftainsNeeded(false, villagePoints(st)) === need) {
      store.saveVillage(id, st, villagePoints(st));
      return store.getVillage(id)!;
    }
  }
  throw new Error(`no size with need ${need}`);
}

async function chainSetup(need: number, free = { renown: 10_000, gold: 10_000 }) {
  const { app, clock } = await makeApp({ sandboxUsers: ['claimer'] });
  const claimer = await player(app, 'claimer');
  const victim = await player(app, 'victim');
  const target = sizedVictim(app, clock, victim, need);
  const home = strongHome(app, clock, claimer, { raider: 9000, chieftain: need });
  withChieftains(app, claimer, need, free);
  return { app, clock, claimer, target, home };
}

test('chain: the first Strike reserves the rest, the follow-up of the open chain reserves nothing more; the village is paid once', async () => {
  const { app, clock, claimer, target, home } = await chainSetup(2);
  const store = app.ctx.store;
  const m1 = await goOk(claimer, home, target, { raider: 3000, chieftain: 1 }, 'attack', 60);
  const afterFirst = { ...ledger(app, claimer), chest: chestOf(app, claimer) };
  assert.equal(store.claimsHeld(claimer.id).renown, REST);
  const m2 = await goOk(claimer, home, target, { raider: 3000, chieftain: 1 }, 'attack', 60 + 300);
  assert.deepEqual({ ...ledger(app, claimer), chest: chestOf(app, claimer) }, afterFirst, 'the second order reserved nothing: the first covered the village');
  assert.equal(store.claimsOfPlayer(claimer.id).length, 1);

  runTo(app, clock, m1.arriveAt);
  assert.equal(store.claimsHeld(claimer.id).renown, REST, 'banked into a chain: the rest stays reserved');
  runTo(app, clock, m2.arriveAt);
  assert.ok(store.getVillage(target.id)?.state.hearth, 'chain complete: hearth out');
  assert.equal(store.claimsHeld(claimer.id).renown, REST, 'the hold keeps the claim alive');
  assertLedgerSane(app, claimer);
  runTo(app, clock, m2.arriveAt + (8 * 3_600_000) / SPEED + 1000);
  assert.equal(store.getVillage(target.id)?.ownerId, claimer.id, 'taken');
  // Two Chieftains went in, one was used up: his deposit + the rest = one village price; the other keeps his deposit.
  assert.equal(ledger(app, claimer).spent, DEPOSIT + REST + DEPOSIT);
  assert.equal(ledger(app, claimer).reserved, DEPOSIT);
  assert.equal(store.claimsHeld(claimer.id).renown, 0);
  assertLedgerSane(app, claimer);
  await app.close();
});

test('chain: when the window runs out before the rest arrives, the reservation comes back in full (also with nobody looking)', async () => {
  const { app, clock, claimer, target, home } = await chainSetup(2);
  const store = app.ctx.store;
  const start = ledger(app, claimer);
  const m1 = await goOk(claimer, home, target, { raider: 3000, chieftain: 1 }, 'attack', 60);
  runTo(app, clock, m1.arriveAt);
  assert.equal(store.claimsHeld(claimer.id).renown, REST);
  assert.equal(store.strikeChainOf(target.id, claimer.id).length, 1, 'banked');
  // Inside the window the claim lives; after it the chain no longer counts.
  clock.set(m1.arriveAt + WINDOW_S * 1000 - 1000);
  app.ctx.game.runCaretaker(clock.now());
  assert.equal(store.claimsHeld(claimer.id).renown, REST, 'still inside the window');
  clock.set(m1.arriveAt + WINDOW_S * 1000 + 1000);
  app.ctx.game.runCaretaker(clock.now()); // the caretaker's pass releases it though nobody opened the game
  assert.equal(store.claimsHeld(claimer.id).renown, 0, 'the chain ran out: released');
  assert.deepEqual(ledger(app, claimer), start, 'only his deposit is left reserved');
  assertLedgerSane(app, claimer);
  await app.close();
});

test('chain: opening the game after the window also releases it (state read), and the balance can pay for the next order at once', async () => {
  const { app, clock, claimer, target, home } = await chainSetup(2, { renown: REST, gold: REST_GOLD }); // exactly one rest in the balance
  const store = app.ctx.store;
  const m1 = await goOk(claimer, home, target, { raider: 3000, chieftain: 1 }, 'attack', 60);
  runTo(app, clock, m1.arriveAt);
  clock.set(m1.arriveAt + WINDOW_S * 1000 + 1000);
  const st = await claimer.c.state();
  assert.equal(st.renown.held, 0);
  assert.equal(st.renown.balance, REST, 'the whole rest is back in the balance');
  assert.equal(store.claimsOfPlayer(claimer.id).length, 0);
  await app.close();
});

test('two sends to the same village before either arrives share one claim', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['claimer'] });
  const p = await player(app, 'claimer');
  const homeId = strongHome(app, clock, p, { raider: 600, chieftain: 2 });
  withChieftains(app, p, 2, { renown: 5000, gold: 5000 });
  const a = clearedTarget(app, homeOf(app, p));
  await goOk(p, homeId, a, { raider: 200, chieftain: 1 });
  const held1 = app.ctx.store.claimsHeld(p.id).renown;
  assert.equal(held1, 1300 - DEPOSIT);
  await goOk(p, homeId, a, { raider: 200, chieftain: 1 });
  assert.equal(app.ctx.store.claimsHeld(p.id).renown, held1, 'same village: no second claim');
  assertLedgerSane(app, p);
  await app.close();
});

test('cancel: calling a Strike back within two minutes gives the rest of the price back at once', async () => {
  const { app, p, homeId, target } = await abandonedSetup();
  const start = ledger(app, p);
  const m = await goOk(p, homeId, target, { raider: 300, chieftain: 1 });
  assert.equal(app.ctx.store.claimsHeld(p.id).renown, REST);
  ok(await p.c.post(`/api/movements/${m.id}/cancel`, {}), 201);
  assert.equal(app.ctx.store.claimsHeld(p.id).renown, 0);
  assert.deepEqual(ledger(app, p), start);
  assert.equal(chestOf(app, p).gold, 10_000);
  assertLedgerSane(app, p);
  await app.close();
});
