// The Flames shop in account export and deletion. Fast: injected clock, fake payment gateway.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCOUNT_DELETE_CONFIRM, type AccountDeletionInfoDto, type AccountExportDto } from '@clanfire/engine';
import { createShopAccountDataHooks } from '../src/shop/account-data-hooks.ts';
import { PASSWORD, errorOf, ok } from './helpers.ts';
import { buy, checkoutBody, makeShopApp, newRequestId, player, shopWorld, spendBody } from './shop-helpers.ts';

const hooks = createShopAccountDataHooks();
const count = (db: import('node:sqlite').DatabaseSync, table: string, id: number): number => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`).get(id) as { n: number }).n);

test('shop data: info, export, deletion keeps the records the law requires and drops the rest', async () => {
  const env = await makeShopApp({ hooks });
  shopWorld(env, 'w1');
  const c = await player(env, 'payer1');
  const pid = await buy(env, c, 'p1100', 2500);
  ok(await c.post('/lobby/api/shop/spend', spendBody('premium30', 'w1', newRequestId())));
  const db = env.app.ctx.store.db;
  db.prepare("INSERT INTO account_items (account_id, item_id, at) VALUES (1, 'look_x', 1)").run();
  const bal = env.app.ctx.shop.shop.balance(1);
  assert.ok(bal > 0);

  assert.equal((await c.get('/lobby/api/account/deletion-info')).json<AccountDeletionInfoDto>().flames, bal);

  const exp = (await c.get('/lobby/api/account/export')).json<AccountExportDto>();
  const x = exp.extra as Record<string, any>;
  assert.equal(x.flames.balance, bal);
  assert.deepEqual(x.flames.ledger.map((r: { reason: string }) => r.reason), ['purchase', 'spend']);
  assert.equal(x.purchases.length, 1);
  assert.equal(x.purchases[0].receiptNo, `CF-${String(pid).padStart(6, '0')}`);
  assert.equal(x.purchases[0].status, 'paid');
  assert.ok('vatCents' in x.purchases[0] && 'vatRateBp' in x.purchases[0] && 'vatCountry' in x.purchases[0]);
  assert.equal(x.consents[0].kind, 'withdrawal_waiver');
  assert.ok(x.loginHistory.length >= 1);
  assert.equal(x.worldPremium[0].worldId, 'w1');
  assert.equal(x.looks[0].itemId, 'look_x');
  const json = JSON.stringify(x);
  for (const secret of ['cs_test_', 'pi_', 'checkoutSessionId', 'paymentIntentId', 'evidence']) assert.ok(!json.includes(secret), secret);

  const before = { p: count(db, 'purchases', 1), co: count(db, 'consents', 1), l: count(db, 'flames_ledger', 1), lh: count(db, 'login_history', 1) };
  assert.ok(before.lh >= 1);
  ok(await c.post('/lobby/api/account/delete', { password: PASSWORD, confirm: ACCOUNT_DELETE_CONFIRM }), 204);
  assert.deepEqual({ p: count(db, 'purchases', 1), co: count(db, 'consents', 1), l: count(db, 'flames_ledger', 1), lh: count(db, 'login_history', 1) }, before);
  assert.equal(count(db, 'world_premium', 1), 0);
  assert.equal(count(db, 'account_items', 1), 0);
  assert.notEqual(env.app.ctx.store.getAccount(1)?.deletedAt, null);
  assert.equal(env.app.ctx.shop.shop.balance(1), bal, 'the balance is left as it is');

  // a tombstone cannot sign in, check out or spend
  errorOf(await c.post('/lobby/api/auth/login', { username: 'payer1', password: PASSWORD }), 401, 'unauthorized');
  errorOf(await c.post('/lobby/api/shop/checkout', checkoutBody('p100')), 401, 'unauthorized');
  errorOf(await c.post('/lobby/api/shop/spend', spendBody('premium30', 'w1', newRequestId())), 401, 'unauthorized');

  // the purge still works on kept history (payer: 2 years)
  const store = env.app.ctx.store;
  store.recordLoginHistory(1, env.clock.t - 800 * 86_400_000, '1.1.1.1', 'x', 'login');
  store.purgeLoginHistory(env.clock.t);
  assert.equal(count(db, 'login_history', 1), before.lh);
});

test('shop data: an account that never paid loses its login history on deletion', async () => {
  const env = await makeShopApp({ hooks });
  const c = await player(env, 'free1');
  const db = env.app.ctx.store.db;
  assert.ok(count(db, 'login_history', 1) >= 1);
  ok(await c.post('/lobby/api/account/delete', { password: PASSWORD, confirm: ACCOUNT_DELETE_CONFIRM }), 204);
  assert.equal(count(db, 'login_history', 1), 0);
});
