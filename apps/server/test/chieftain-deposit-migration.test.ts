// One-time step when this version first runs on a world (meta flag chieftain_deposit_applied, schema v31): Chieftains trained under the old
// rule (each reserved the price of one more village, growing x1.6 per Chieftain held) get the difference to the flat deposit back.
// Chieftains that are away keep what they reserved (their order was sent under the old rule).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyUnits, settleVillage, villagePoints } from '@clanfire/engine';
import { makeApp } from './helpers.ts';
import { assertLedgerSane, chestOf, ledger, player, strongHome } from './village-helpers.ts';

const OLD_RENOWN = [1300, 2080, 3328]; // villageRenownPrice(1, 0..2) under the old rule
const OLD_GOLD = [2000, 3200, 5120];
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

async function oldWorld(home: number, away: number) {
  const { app, clock } = await makeApp();
  const p = await player(app, 'owner');
  const vid = strongHome(app, clock, p, { chieftain: home });
  const store = app.ctx.store;
  if (away > 0) {
    const v = store.getVillage(vid)!;
    const st = settleVillage(v.state, clock.now(), app.ctx.settings);
    st.away = { ...emptyUnits(), chieftain: away };
    store.saveVillage(vid, st, villagePoints(st));
  }
  const n = home + away;
  store.addRenown(p.id, 20_000);
  store.reserveRenown(p.id, sum(OLD_RENOWN.slice(0, n)));
  store.depositChest(p.id, 30_000);
  store.reserveChest(p.id, sum(OLD_GOLD.slice(0, n)));
  store.setMeta('chieftain_deposit_applied', ''); // as on a world that has not run this version yet
  return { app, p };
}

test('migration: Chieftains at home get the difference to the flat deposit back (Renown and gold), once', async () => {
  const { app, p } = await oldWorld(3, 0);
  const store = app.ctx.store;
  const before = { ...ledger(app, p), chest: chestOf(app, p) };
  const done = app.ctx.game.migrateChieftainDeposits();
  assert.equal(done.length, 1);
  assert.equal(done[0]?.username, 'owner');
  const l = ledger(app, p);
  const c = chestOf(app, p);
  assert.equal(l.reserved, 3 * 325, 'three deposits of 325 are what is left reserved');
  assert.equal(c.reserved, 3 * 500);
  assert.equal(before.reserved - l.reserved, done[0]?.renown, 'the log says what came back');
  assert.equal(l.spent, before.spent - (before.reserved - l.reserved), 'spent went down by the same: it is back in the balance');
  assert.equal(c.gold, before.chest.gold + (before.chest.reserved - c.reserved));
  assert.equal(l.total, before.total, 'nothing earned or lost');
  assertLedgerSane(app, p);
  assert.equal(store.getMeta('chieftain_deposit_applied'), '1');
  // Once: a second run changes nothing.
  assert.deepEqual(app.ctx.game.migrateChieftainDeposits(), []);
  assert.deepEqual(ledger(app, p), l);
  await app.close();
});

test('migration: a Chieftain that is away keeps his old reservation (his order was sent under the old rule)', async () => {
  const { app, p } = await oldWorld(2, 1);
  const total = sum(OLD_RENOWN);
  const avg = total / 3;
  app.ctx.game.migrateChieftainDeposits();
  const l = ledger(app, p);
  assert.ok(Math.abs(l.reserved - (2 * 325 + avg)) < 1e-6, `2 deposits + the away one's average (${avg}); got ${l.reserved}`);
  assertLedgerSane(app, p);
  await app.close();
});

test('migration: a fresh world and a player with nothing reserved only set the flag', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'fresh');
  strongHome(app, clock, p, { chieftain: 2 });
  app.ctx.store.setMeta('chieftain_deposit_applied', '');
  const before = ledger(app, p);
  assert.deepEqual(app.ctx.game.migrateChieftainDeposits(), []);
  assert.deepEqual(ledger(app, p), before);
  assert.equal(app.ctx.store.getMeta('chieftain_deposit_applied'), '1');
  await app.close();
});

test('migration: an old reservation already below the new deposit is never topped up', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'small');
  strongHome(app, clock, p, { chieftain: 2 });
  app.ctx.store.addRenown(p.id, 1000);
  app.ctx.store.reserveRenown(p.id, 200); // 100 each: under the 325 deposit
  app.ctx.store.setMeta('chieftain_deposit_applied', '');
  assert.deepEqual(app.ctx.game.migrateChieftainDeposits(), []);
  assert.equal(ledger(app, p).reserved, 200);
  await app.close();
});
