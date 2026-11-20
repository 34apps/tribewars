// One-time step when this version first runs on a world (meta flag chieftain_full_price_applied, schema v36, owner 2026-11-20): every open claim
// (the rest of a village price reserved by a sent Strike under the 2026-11-18 rule) is folded into the player's Chieftain reservations.
// Already trained Chieftains keep what they paid; nothing more is charged.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCHEMA_VERSION } from '../src/db.ts';
import { makeApp } from './helpers.ts';
import { assertLedgerSane, chestOf, ledger, player, strongHome } from './village-helpers.ts';

test('schema version is 36 for this rule', () => {
  assert.ok(SCHEMA_VERSION >= 36);
});

test('migration: open claims are folded into the reservations (Renown and gold), the rows go, per-player log, balance unchanged', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'owner');
  const other = await player(app, 'bystander');
  strongHome(app, clock, p, { chieftain: 1 });
  const store = app.ctx.store;
  store.addRenown(p.id, 5000);
  store.reserveRenown(p.id, 325); // a deposit paid at training
  store.depositChest(p.id, 5000);
  store.reserveChest(p.id, 500);
  store.insertClaim(p.id, { villageId: 1 }, 975, 1500, clock.now()); // the rest of the price, reserved at sending
  store.setMeta('chieftain_full_price_applied', '');
  const before = { ...ledger(app, p), chest: chestOf(app, p) };
  const otherBefore = ledger(app, other);
  assert.equal(store.claimsHeld(p.id).renown, 975);

  const done = app.ctx.game.migrateChieftainFullPrice();
  assert.deepEqual(done, [{ playerId: p.id, username: 'owner', renown: 975, gold: 1500 }]);
  const l = ledger(app, p);
  const c = chestOf(app, p);
  assert.equal(l.reserved, 325 + 975, 'the claim joined the pool');
  assert.equal(c.reserved, 500 + 1500);
  assert.equal(l.spent, before.spent, 'it was already out of the balance: nothing more is charged');
  assert.equal(c.gold, before.chest.gold, 'and out of the chest');
  assert.equal(store.claimsHeld(p.id).renown, 0);
  assert.equal(store.claimsHeld(p.id).gold, 0);
  assert.deepEqual(store.allClaimPlayerIds(), []);
  assert.deepEqual(ledger(app, other), otherBefore, 'nobody else is touched');
  assertLedgerSane(app, p);
  assert.equal(store.getMeta('chieftain_full_price_applied'), '1');

  // Once: a second run changes nothing, even with a new claim row.
  store.insertClaim(p.id, { villageId: 2 }, 10, 10, clock.now());
  assert.deepEqual(app.ctx.game.migrateChieftainFullPrice(), []);
  assert.equal(ledger(app, p).reserved, l.reserved);
  await app.close();
});

test('migration: a fresh world only sets the flag', async () => {
  const { app, clock } = await makeApp();
  const p = await player(app, 'fresh');
  strongHome(app, clock, p, { chieftain: 2 });
  app.ctx.store.setMeta('chieftain_full_price_applied', '');
  const before = ledger(app, p);
  assert.deepEqual(app.ctx.game.migrateChieftainFullPrice(), []);
  assert.deepEqual(ledger(app, p), before);
  assert.equal(app.ctx.store.getMeta('chieftain_full_price_applied'), '1');
  await app.close();
});
