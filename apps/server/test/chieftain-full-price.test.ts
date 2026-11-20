// Whatever it takes to send a Chieftain is asked before recruiting him (owner 2026-11-20, docs/GAME_DESIGN.md 18.2): the whole village price is
// paid when a Chieftain is TRAINED (each one pays one village price, in order) and stays paid: a Chieftain who dies or is cancelled leaves
// his payment BANKED for the next one (nothing is paid twice). Sending costs nothing more. A take spends exactly the bottom slot price.
// Walking times are fixed (sandbox accounts), so nothing waits on real time.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOLD_HOURS_ABANDONED, abandonIdleMs, chieftainBatchPrice, villageRenownCost, type CancelResponse, type SendResponse, type Units } from '@clanfire/engine';
import { HOUR, errorOf, makeApp, ok, garrisonAbandoned } from './helpers.ts';
import { assertLedgerSane, chestOf, clearedTarget, fillChest, freeTileNear, homeOf, ledger, player, runTo, strongHome, villagesOf, type P } from './village-helpers.ts';

const SPEED = 10;
const HOLD_MS = (HOLD_HOURS_ABANDONED * 3_600_000) / SPEED;
const train = (p: P, vid: number, count: number) => p.c.post(`/api/villages/${vid}/train`, { unit: 'chieftain', count });
const go = (p: P, vid: number, to: { x: number; y: number }, units: Partial<Units>, mission: 'attack' | 'found' = 'attack') =>
  p.c.post(`/api/villages/${vid}/send`, { x: to.x, y: to.y, units, mission, travelSeconds: 60, returnSeconds: 10_000 });
const goOk = async (...a: Parameters<typeof go>) => {
  const res = await go(...a);
  ok(res, 201);
  return res.json<SendResponse>().movement;
};

test('prices escalate with the Chieftains held: 1,300 / 2,080 / 3,328 Renown and 2,000 / 3,200 / 5,120 gold at one village', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'alice');
  const vid = strongHome(app, clock, p, {});
  app.ctx.store.addRenown(p.id, 50_000);
  fillChest(app, p, 100_000);
  const st0 = await p.c.state();
  assert.deepEqual(st0.renown.chieftainPrices, [1300, 2080, 3328]);
  assert.deepEqual(st0.chest?.chieftainPrices, [2000, 3200, 5120]);
  assert.equal(st0.renown.chieftainPrice, 1300);
  assert.equal(st0.chest?.chieftainPrice, 2000);
  assert.equal(st0.renown.chieftainsHeld, 0);
  assert.equal(st0.renown.held, 0);
  assert.equal(st0.chest?.held, 0);

  ok(await train(p, vid, 1));
  const st1 = await p.c.state();
  assert.equal(st1.renown.chieftainsHeld, 1);
  assert.deepEqual(st1.renown.chieftainPrices, [2080, 3328, villageRenownCost(4)], 'the next one pays the village after that');
  assert.equal(st1.renown.chieftainPrice, 2080);
  assert.deepEqual(st1.chest?.chieftainPrices?.slice(0, 2), [3200, 5120]);
  assert.equal(st1.renown.reserved, 1300);
  assert.equal(chestOf(app, p).reserved, 2000);
  await app.close();
});

test('train reserves the full batch price (Renown and gold) in one go; count 3 pays the three slots', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'alice');
  const vid = strongHome(app, clock, p, {});
  app.ctx.store.addRenown(p.id, 20_000);
  fillChest(app, p, 30_000);
  const base = ledger(app, p);
  const price = chieftainBatchPrice(1, 0, 3);
  assert.deepEqual(price, { renown: 6708, gold: 10_320 });
  ok(await train(p, vid, 3));
  const l = ledger(app, p);
  assert.equal(l.reserved, 6708);
  assert.equal(l.spent, base.spent + 6708);
  assert.deepEqual(chestOf(app, p), { gold: 30_000 - 10_320, reserved: 10_320 });
  assertLedgerSane(app, p);
  await app.close();
});

test('train refused with plain words when Renown or gold is short, nothing is paid', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'alice');
  const vid = strongHome(app, clock, p, {});
  app.ctx.store.addRenown(p.id, 1299);
  fillChest(app, p, 1999);
  const l0 = ledger(app, p);
  const c0 = chestOf(app, p);
  const short = await train(p, vid, 1);
  errorOf(short, 409, 'not_enough_resources');
  assert.equal(short.json<{ message: string }>().message, 'A Chieftain costs 1,300 Renown + 2,000 War Chest gold (your 2nd village). You need 1 more Renown.');
  app.ctx.store.addRenown(p.id, 1);
  const noGold = await train(p, vid, 1);
  errorOf(noGold, 409, 'not_enough_resources');
  assert.equal(noGold.json<{ message: string }>().message, 'A Chieftain costs 1,300 Renown + 2,000 War Chest gold (your 2nd village). You need 1 more War Chest gold.');
  assert.deepEqual(ledger(app, p), { ...l0, total: l0.total + 1 });
  assert.deepEqual(chestOf(app, p), c0);
  assert.equal(homeOf(app, p).state.trainQueues.bannerhall.length, 0, 'nothing queued');

  app.ctx.store.addRenown(p.id, 20_000);
  fillChest(app, p, 30_000);
  const batch = await train(p, vid, 3);
  ok(batch);
  assert.equal(homeOf(app, p).state.trainQueues.bannerhall[0]?.count, 3);
  await app.close();
});

test('a batch message says how many: "3 Chieftains cost ..."', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'alice');
  const vid = strongHome(app, clock, p, {});
  app.ctx.store.addRenown(p.id, 6000);
  fillChest(app, p, 30_000);
  const res = await train(p, vid, 3);
  errorOf(res, 409, 'not_enough_resources');
  assert.equal(res.json<{ message: string }>().message, '3 Chieftains cost 6,708 Renown + 10,320 War Chest gold. You need 708 more Renown.');
  await app.close();
});

test('cancel keeps the Renown and gold in the pool, banked; the retrain costs resources only', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'alice');
  const vid = strongHome(app, clock, p, {});
  app.ctx.store.addRenown(p.id, 20_000);
  fillChest(app, p, 30_000);
  const base = ledger(app, p);
  ok(await train(p, vid, 3));
  const res = await p.c.post(`/api/villages/${vid}/cancel-train`, { building: 'bannerhall', index: 0 });
  ok(res);
  assert.equal(res.json<CancelResponse>().renownRefund, undefined, 'no Renown comes back');
  const l = ledger(app, p);
  assert.equal(l.reserved, 6708, 'the pool is unchanged');
  assert.equal(l.spent, base.spent + 6708);
  assert.deepEqual(chestOf(app, p), { gold: 30_000 - 10_320, reserved: 10_320 });
  const st = await p.c.state();
  assert.equal(st.renown.banked, 6708);
  assert.equal(st.chest?.banked, 10_320);
  assert.equal(st.renown.chieftainPrice, 0, 'one Chieftain is fully covered by the bank');
  assert.equal(st.chest?.chieftainPrice, 0);
  assert.deepEqual(st.renown.chieftainPrices, [1300, 2080, 3328], 'the full slot prices are still shown');
  assertLedgerSane(app, p);

  // The retrain of all three costs nothing more in Renown or gold.
  ok(await train(p, vid, 3));
  assert.equal(ledger(app, p).spent, base.spent + 6708);
  assert.equal(ledger(app, p).reserved, 6708);
  assert.deepEqual(chestOf(app, p), { gold: 30_000 - 10_320, reserved: 10_320 });
  const after = await p.c.state();
  assert.equal(after.renown.banked, 0);
  await app.close();
});

test('the banked sentence appears and a short balance is refused with nothing paid', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'alice');
  const vid = strongHome(app, clock, p, {});
  app.ctx.store.addRenown(p.id, 1300);
  fillChest(app, p, 2000);
  ok(await train(p, vid, 1));
  ok(await p.c.post(`/api/villages/${vid}/cancel-train`, { building: 'bannerhall', index: 0 }));
  // Pool 1,300 / 2,000, balance 0. Two Chieftains: full 1,300 + 2,080, banked 1,300 -> 2,080 more Renown due; gold 5,200 - 2,000 = 3,200.
  const l0 = ledger(app, p);
  const c0 = chestOf(app, p);
  const res = await train(p, vid, 2);
  errorOf(res, 409, 'not_enough_resources');
  assert.equal(
    res.json<{ message: string }>().message,
    '2 Chieftains cost 3,380 Renown + 5,200 War Chest gold. 1,300 Renown and 2,000 War Chest gold is banked from earlier Chieftains. You need 2,080 more Renown.',
  );
  assert.deepEqual(ledger(app, p), l0);
  assert.deepEqual(chestOf(app, p), c0);
  assert.equal(homeOf(app, p).state.trainQueues.bannerhall.length, 0);
  // One Chieftain is covered by the bank and trains with a zero balance.
  ok(await train(p, vid, 1));
  assert.deepEqual(ledger(app, p), l0);
  await app.close();
});

test('banked appears in GET /api/state (floored) and chieftainPrice is the due amount for one', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'alice');
  strongHome(app, clock, p, {});
  app.ctx.store.addRenown(p.id, 5000);
  app.ctx.store.reserveRenown(p.id, 500.9);
  fillChest(app, p, 3000);
  app.ctx.store.reserveChest(p.id, 700);
  const st = await p.c.state();
  assert.equal(st.renown.banked, 500);
  assert.equal(st.chest?.banked, 700);
  assert.equal(st.renown.chieftainPrice, 800, '1,300 minus 500.9 banked, due is the exact remainder');
  assert.equal(st.chest?.chieftainPrice, 1300);
  await app.close();
});

async function sender(extra: Partial<Units> = {}) {
  const { app, clock } = await makeApp({ sandboxUsers: ['claimer'] });
  const p = await player(app, 'claimer');
  const homeId = strongHome(app, clock, p, { raider: 300, chieftain: 1, ...extra });
  return { app, clock, p, homeId };
}

test('a Strike is sent with a zero balance and reserves nothing', async () => {
  const { app, p, homeId } = await sender();
  const target = clearedTarget(app, homeOf(app, p));
  const l0 = ledger(app, p);
  const c0 = chestOf(app, p);
  assert.ok(l0.total - l0.spent < villageRenownCost(1), 'the balance could not have paid anything');
  assert.equal(c0.gold, 0);
  await goOk(p, homeId, target, { raider: 300, chieftain: 1 });
  assert.deepEqual(ledger(app, p), l0);
  assert.deepEqual(chestOf(app, p), c0);
  assertLedgerSane(app, p);
  await app.close();
});

test('a Found order is sent with a zero balance and reserves nothing', async () => {
  const { app, p, homeId } = await sender({ pikeman: 10 });
  const tile = freeTileNear(app, p);
  const l0 = ledger(app, p);
  const c0 = chestOf(app, p);
  await goOk(p, homeId, tile, { pikeman: 10, chieftain: 1 }, 'found');
  assert.deepEqual(ledger(app, p), l0);
  assert.deepEqual(chestOf(app, p), c0);
  await app.close();
});

test('a take spends exactly the bottom slot price; the spares keep theirs', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['claimer'] });
  const p = await player(app, 'claimer');
  const homeId = strongHome(app, clock, p, { raider: 300, chieftain: 2 });
  app.ctx.store.addRenown(p.id, 5000);
  app.ctx.store.reserveRenown(p.id, 3380); // two Chieftains paid 1,300 + 2,080
  fillChest(app, p, 5200);
  app.ctx.store.reserveChest(p.id, 5200);
  const target = clearedTarget(app, homeOf(app, p));
  const start = ledger(app, p);
  const m = await goOk(p, homeId, target, { raider: 300, chieftain: 1 });
  assert.deepEqual(ledger(app, p), start, 'sending changed nothing');
  runTo(app, clock, m.arriveAt + HOLD_MS);
  assert.equal(app.ctx.store.getVillage(target.id)?.ownerId, p.id, 'taken');
  const end = ledger(app, p);
  assert.equal(end.reserved, 2080, 'the price of the first slot (1,300) left the pool, the spare keeps his 2,080');
  assert.equal(end.spent, start.spent, 'the village price stays spent for good');
  assert.equal(chestOf(app, p).reserved, 3200, 'gold: 2,000 spent, the spare keeps 3,200');
  const st = await p.c.state();
  assert.equal(st.renown.banked, 0);
  assert.equal(st.chest?.banked, 0);
  assertLedgerSane(app, p);
  await app.close();
});

test('a founded village spends the bottom slot price too', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['founder'] });
  const p = await player(app, 'founder');
  const homeId = strongHome(app, clock, p, { pikeman: 10, chieftain: 1 });
  app.ctx.store.addRenown(p.id, 1300);
  app.ctx.store.reserveRenown(p.id, 1300);
  const tile = freeTileNear(app, p);
  const start = ledger(app, p);
  const m = await goOk(p, homeId, tile, { pikeman: 10, chieftain: 1 }, 'found');
  runTo(app, clock, m.arriveAt);
  assert.equal(villagesOf(app, p).length, 2);
  assert.equal(ledger(app, p).reserved, 0);
  assert.equal(ledger(app, p).spent, start.spent, 'still spent: the price was paid at training');
  assertLedgerSane(app, p);
  await app.close();
});

test('a Chieftain who dies in battle changes nothing in the pool; the next Chieftain costs no Renown or gold', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['claimer'] });
  const p = await player(app, 'claimer');
  const homeId = strongHome(app, clock, p, { raider: 1, chieftain: 2 });
  app.ctx.store.addRenown(p.id, 3380);
  app.ctx.store.reserveRenown(p.id, 3380);
  fillChest(app, p, 5200);
  app.ctx.store.reserveChest(p.id, 5200);
  const target = app.ctx.store.getVillage(app.ctx.store.abandonedVillageIds()[0] as number)!;
  garrisonAbandoned(app, target.id, { pikeman: 50 }); // a Chieftain with one raider cannot win
  const start = ledger(app, p);
  const c0 = chestOf(app, p);
  const m = await goOk(p, homeId, target, { raider: 1, chieftain: 1 });
  runTo(app, clock, m.arriveAt);
  assert.equal(homeOf(app, p).state.troops.chieftain + homeOf(app, p).state.away.chieftain, 1, 'one Chieftain died');
  assert.deepEqual(ledger(app, p), start, 'the pool and everything else are unchanged');
  assert.deepEqual(chestOf(app, p), c0);
  const st = await p.c.state();
  assert.equal(st.renown.banked, 2080, 'his payment is banked (pool 3,380 - the one living Chieftain 1,300)');
  assert.equal(st.chest?.banked, 3200);
  assert.equal(st.renown.chieftainPrice, 0, 'the next Chieftain costs no Renown');
  assert.equal(st.chest?.chieftainPrice, 0, 'and no gold');
  assertLedgerSane(app, p);
  await app.close();
});

test('losing a village leaves the pool unchanged', async () => {
  const { app, clock } = await makeApp();
  const idle = await player(app, 'idle_one');
  const other = await player(app, 'other_one');
  const idleVid = strongHome(app, clock, idle, { chieftain: 2 });
  app.ctx.store.addRenown(idle.id, 3380);
  app.ctx.store.reserveRenown(idle.id, 3380);
  fillChest(app, idle, 5200);
  app.ctx.store.reserveChest(idle.id, 5200);
  const l0 = ledger(app, idle);
  const c0 = chestOf(app, idle);
  clock.advance(abandonIdleMs(app.ctx.settings) + HOUR);
  await other.c.state();
  app.ctx.game.runCaretaker(clock.now());
  assert.equal(app.ctx.store.getVillage(idleVid)?.ownerId ?? null, null, 'the village was abandoned');
  assert.deepEqual(ledger(app, idle), l0);
  assert.deepEqual(chestOf(app, idle), c0);
  await app.close();
});
