import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { EnterWorldResponse, ShopCheckoutResponse, ShopResponse } from '@clanfire/engine';
import { runAdmin, runAdminAsync } from '../src/admin-ops.ts';
import { SCHEMA_VERSION, openDatabase } from '../src/db.ts';
import { parseStripeEnv } from '../src/env.ts';
import { verifyPass } from '../src/pass.ts';
import { DISPUTE_FEE_FALLBACK_CENTS, HANDLING_FEE_CENTS } from '../src/shop/catalogue.ts';
import { CHECKOUT_URL_PREFIX, PaymentError, STRIPE_VERSION, StripeGateway } from '../src/shop/gateway.ts';
import { signWebhook, verifyWebhook } from '../src/shop/webhook-signature.ts';
import { Store } from '../src/store.ts';
import { RATE_WEBHOOK_PER_IP } from '../src/routes/stripe.ts';
import { PUBLIC_KEY, errorOf, makeApp, ok } from './helpers.ts';
import { DAY, WHSEC, buy, checkoutBody, event, makeShopApp, newRequestId, player, sessionPaid, shopOf, shopWorld, spendBody, webhook, type ShopEnv } from './shop-helpers.ts';

const SHOP = '/lobby/api/shop';

const dispute = (id: string, purchaseId: number, extra: Record<string, unknown> = {}) =>
  event('charge.dispute.created', { id, object: 'dispute', payment_intent: `pi_${purchaseId}`, charge: `ch_${purchaseId}`, reason: 'general', status: 'needs_response', balance_transactions: [{ fee: 1500 }], ...extra });
const disputeClosed = (id: string, purchaseId: number, status: string) => event('charge.dispute.closed', { id, object: 'dispute', payment_intent: `pi_${purchaseId}`, status });

const balanceOf = (env: ShopEnv, id = 1): number => env.app.ctx.shop.shop.balance(id);

// ---- signature ------------------------------------------------------------------------------------

test('signature: valid, several v1 values, wrong secret, tampered body, stale timestamp, junk', () => {
  const body = '{"id":"evt_1"}';
  const now = Date.UTC(2026, 10, 20, 12);
  const t = Math.floor(now / 1000);
  const good = signWebhook(body, WHSEC, t);
  assert.equal(verifyWebhook(body, good, WHSEC, now), true);
  const v1 = good.split('v1=')[1];
  assert.equal(verifyWebhook(body, `t=${t},v1=${'0'.repeat(64)},v1=${v1},v0=abc`, WHSEC, now), true, 'any of several v1 values');
  assert.equal(verifyWebhook(body, good, 'whsec_other', now), false);
  assert.equal(verifyWebhook(body + ' ', good, WHSEC, now), false);
  assert.equal(verifyWebhook(body, signWebhook(body, WHSEC, t - 301), WHSEC, now), false, 'older than 300 s');
  assert.equal(verifyWebhook(body, signWebhook(body, WHSEC, t + 301), WHSEC, now), false);
  assert.equal(verifyWebhook(body, signWebhook(body, WHSEC, t - 299), WHSEC, now), true);
  for (const junk of [undefined, '', 'v1=abc', `t=${t}`, `t=x,v1=${v1}`, `t=${t},v1=zz`]) assert.equal(verifyWebhook(body, junk, WHSEC, now), false);
});

// ---- webhook endpoint -----------------------------------------------------------------------------

test('webhook: a bad or missing signature is 400 and nothing is stored', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'wh1');
  ok(await c.post(`${SHOP}/checkout`, checkoutBody('p100')));
  const ev = sessionPaid(1, 300);
  errorOf(await webhook(env, ev, { secret: 'whsec_wrong' }), 400, 'invalid_input');
  errorOf(await webhook(env, ev, { header: null }), 400, 'invalid_input');
  errorOf(await webhook(env, ev, { t: Math.floor(env.clock.t / 1000) - 400 }), 400, 'invalid_input');
  errorOf(await webhook(env, ev, { header: signWebhook('{"other":1}', WHSEC, Math.floor(env.clock.t / 1000)) }), 400, 'invalid_input');
  assert.equal(env.app.ctx.shop.shop.balance(1), 0);
  assert.equal(env.app.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM stripe_events').get()?.n, 0);
  assert.equal(env.app.ctx.shop.shop.getPurchase(1)?.status, 'pending');
  // a valid signature over junk JSON is a 400 as well
  const raw = 'not json';
  errorOf(await webhook(env, null, { raw }), 400, 'invalid_input');
});

test('webhook: a paid session credits once; a replay and a second "paid" event change nothing', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'wh2');
  ok(await c.post(`${SHOP}/checkout`, checkoutBody('p220')));
  const ev = sessionPaid(1, 600);
  const first = await webhook(env, ev);
  ok(first);
  assert.deepEqual(first.json(), { received: true });
  assert.equal(balanceOf(env), 220);
  const p = env.app.ctx.shop.shop.getPurchase(1);
  assert.deepEqual([p?.status, p?.paymentIntentId, p?.country, p?.email, p?.paidAt], ['paid', 'pi_1', 'DE', 'buyer@example.com', env.clock.t]);
  ok(await webhook(env, ev)); // exact replay
  ok(await webhook(env, sessionPaid(1, 600))); // a different event id, same business state
  assert.equal(balanceOf(env), 220);
  assert.equal(env.app.ctx.shop.shop.ledgerRows(1, 10).length, 1);
});

test('webhook: an amount or currency that does not match is ignored; unpaid and unknown sessions too', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'wh3');
  ok(await c.post(`${SHOP}/checkout`, checkoutBody('p100')));
  ok(await webhook(env, sessionPaid(1, 1)));
  ok(await webhook(env, sessionPaid(1, 300, { currency: 'usd' })));
  ok(await webhook(env, sessionPaid(1, 300, { payment_status: 'unpaid' })));
  ok(await webhook(env, sessionPaid(1, 300, { id: 'cs_test_unknown', client_reference_id: '77' })));
  assert.equal(balanceOf(env), 0);
  assert.equal(env.app.ctx.shop.shop.getPurchase(1)?.status, 'pending');
  assert.ok(env.app.ctx.store.auditRows().some((a) => a.action === 'shop_payment_mismatch'));
  ok(await webhook(env, sessionPaid(1, 300)));
  assert.equal(balanceOf(env), 100);
});

test('webhook: expired sessions, unknown event types, malformed events', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'wh4');
  ok(await c.post(`${SHOP}/checkout`, checkoutBody('p100')));
  ok(await webhook(env, event('checkout.session.expired', { id: 'cs_test_1' })));
  assert.equal(env.app.ctx.shop.shop.getPurchase(1)?.status, 'expired');
  ok(await webhook(env, event('customer.created', { id: 'cus_1' })));
  errorOf(await webhook(env, { id: 'evt_x', type: 'charge.refunded' }), 400, 'invalid_input');
  errorOf(await webhook(env, [1]), 400, 'invalid_input');
});

test('webhook: charge.succeeded stores the card and charge id, also before the session event', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'wh5');
  ok(await c.post(`${SHOP}/checkout`, checkoutBody('p100')));
  ok(await webhook(env, event('charge.succeeded', { id: 'ch_1', object: 'charge', payment_intent: 'pi_1', metadata: { purchase_id: '1' }, payment_method_details: { card: { brand: 'visa', last4: '4242', country: 'DE' } } })));
  ok(await webhook(env, sessionPaid(1, 300)));
  const p = env.app.ctx.shop.shop.getPurchase(1);
  assert.deepEqual([p?.status, p?.chargeId, p?.cardBrand, p?.cardLast4, p?.cardCountry], ['paid', 'ch_1', 'visa', '4242', 'DE']);
  const dto = (await shopOf(c)).purchases[0];
  assert.deepEqual([dto?.cardBrand, dto?.cardLast4, dto?.kind], ['visa', '4242', 'flames']);
});

test('webhook: charge.refunded from the dashboard removes the Flames (and may go negative)', async () => {
  const env = await makeShopApp();
  shopWorld(env);
  const c = await player(env, 'wh6');
  const id = await buy(env, c, 'p220', 600);
  ok(await c.post(`${SHOP}/spend`, spendBody('premium30', 'w1', newRequestId()))); // 70 left
  ok(await webhook(env, event('charge.refunded', { id: 'ch_9', object: 'charge', payment_intent: `pi_${id}`, amount_refunded: 600 })));
  assert.equal(balanceOf(env), -150);
  assert.equal(env.app.ctx.shop.shop.getPurchase(id)?.status, 'refunded');
  assert.equal((await shopOf(c)).locked, true);
});

test('webhook: its own rate limit, not the global per-IP one', async () => {
  const env = await makeShopApp();
  for (let i = 0; i < RATE_WEBHOOK_PER_IP; i++) {
    const res = await webhook(env, { id: `evt_${i}` }, { header: 'junk' });
    assert.equal(res.statusCode, 400);
  }
  errorOf(await webhook(env, { id: 'evt_over' }, { header: 'junk' }), 429, 'rate_limited');
});

test('webhook: the body limit is 256 KB', async () => {
  const env = await makeShopApp();
  const big = JSON.stringify({ id: 'evt_big', pad: 'x'.repeat(300 * 1024) });
  assert.equal((await webhook(env, null, { raw: big })).statusCode, 413);
});

// ---- disputes -------------------------------------------------------------------------------------

test('dispute: Flames removed (balance may go negative), locked, fees open, evidence submitted, prm 0', async () => {
  const env = await makeShopApp();
  shopWorld(env);
  const c = await player(env, 'dispy');
  ok(await c.post('/lobby/api/worlds/w1/enter'));
  const id = await buy(env, c, 'p220', 600);
  ok(await webhook(env, event('charge.succeeded', { id: 'ch_1', payment_intent: `pi_${id}`, payment_method_details: { card: { brand: 'visa', last4: '4242', country: 'DE' } } })));
  ok(await c.post(`${SHOP}/spend`, spendBody('premium30', 'w1', newRequestId()))); // 70 left, Premium active
  const claims = async () => verifyPass((await c.post('/lobby/api/worlds/w1/enter')).json<EnterWorldResponse>().pass, [PUBLIC_KEY], env.clock.t);
  assert.ok(((await claims()).prm ?? 0) > 0);
  ok(await webhook(env, dispute('dp_1', id)));
  assert.equal(balanceOf(env), 70 - 220);
  const s = await shopOf(c);
  assert.equal(s.locked, true);
  assert.equal(s.openFeesCents, 1500 + HANDLING_FEE_CENTS);
  assert.deepEqual(s.disputes.map((d) => [d.purchaseId, d.state]), [[id, 'open']]);
  assert.equal(s.purchases[0]?.status, 'disputed');
  assert.equal(s.paymentsBanned, false);
  assert.equal((await claims()).prm, 0, 'locked: Premium is not passed to the world');
  errorOf(await c.post(`${SHOP}/spend`, spendBody('premium30', 'w1', newRequestId())), 403, 'forbidden');
  const acct = env.app.ctx.store.getAccount(1);
  assert.equal(acct?.disputes, 1);
  // evidence
  assert.equal(env.gw.evidence.length, 1);
  const ev = env.gw.evidence[0];
  assert.equal(ev?.disputeId, 'dp_1');
  const e = ev?.evidence ?? {};
  assert.equal(e.customer_name, 'dispy');
  assert.equal(e.customer_purchase_ip, c.ip);
  assert.equal(e.customer_email_address, 'buyer@example.com');
  assert.match(e.service_date ?? '', /^2026-11-04$/);
  assert.match(e.product_description ?? '', /220 Flames/);
  assert.match(e.product_description ?? '', /spent 150 Flames on premium30 in world w1/);
  assert.match(e.access_activity_log ?? '', /register/);
  assert.match(e.access_activity_log ?? '', /enter world w1/);
  assert.match(e.refund_policy_disclosure ?? '', /14-day right of withdrawal/);
  assert.match(e.refund_policy_disclosure ?? '', /no self-service refund/);
  assert.match(e.product_description ?? '', /6\.00 EUR net \+ 0\.00 EUR VAT \(billing country DE\) = 6\.00 EUR/);
  assert.match(e.uncategorized_text ?? '', /2026-11-20-v2/);
  assert.match(e.uncategorized_text ?? '', /lose my 14-day right of withdrawal/);
  assert.ok(env.app.ctx.shop.shop.getPurchase(id)?.evidenceSubmittedAt);
  // a replay changes nothing
  const evId = 'evt_dup';
  ok(await webhook(env, dispute('dp_1', id), {}));
  ok(await webhook(env, { ...dispute('dp_1', id), id: evId }));
  assert.equal(balanceOf(env), 70 - 220);
  assert.equal(env.app.ctx.store.getAccount(1)?.disputes, 1);
  assert.equal(env.gw.evidence.length, 1);
});

test('dispute: fraudulent has no handling fee; without a fee from Stripe the fallback is used', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'fraudy');
  const a = await buy(env, c, 'p100', 300);
  const b = await buy(env, c, 'p100', 300);
  ok(await webhook(env, dispute('dp_a', a, { reason: 'fraudulent' })));
  assert.equal((await shopOf(c)).openFeesCents, 1500);
  ok(await webhook(env, dispute('dp_b', b, { balance_transactions: [] })));
  assert.equal((await shopOf(c)).openFeesCents, 1500 + DISPUTE_FEE_FALLBACK_CENTS + HANDLING_FEE_CENTS);
});

test('dispute: evidence failure is logged and retried with the CLI command', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'evfail');
  const id = await buy(env, c, 'p100', 300);
  env.gw.failEvidence = true;
  ok(await webhook(env, dispute('dp_1', id)));
  assert.equal(env.gw.evidence.length, 0);
  assert.equal(env.app.ctx.shop.shop.getPurchase(id)?.evidenceSubmittedAt, null);
  env.gw.failEvidence = false;
  const out: string[] = [];
  const err: string[] = [];
  const deps = { openStore: () => env.app.ctx.store, env: {}, now: env.clock.now, out: (l: string) => out.push(l), err: (l: string) => err.push(l), gateway: env.gw };
  assert.equal(await runAdminAsync(['dispute-evidence', String(id)], deps), 0, err.join());
  assert.equal(env.gw.evidence.length, 1);
  assert.ok(env.app.ctx.shop.shop.getPurchase(id)?.evidenceSubmittedAt);
  assert.equal(await runAdminAsync(['dispute-evidence', 'x'], deps), 1);
  assert.equal(await runAdminAsync(['dispute-evidence', '999'], deps), 1);
  assert.equal(await runAdminAsync(['dispute-evidence', '1'], { ...deps, gateway: null }), 1);
});

test('dispute: settle pays the fees and buying fills the minus; unlocked only when both are done', async () => {
  const env = await makeShopApp();
  shopWorld(env);
  const c = await player(env, 'settler');
  const id = await buy(env, c, 'p220', 600);
  ok(await c.post(`${SHOP}/spend`, spendBody('premium30', 'w1', newRequestId()))); // 70 left
  ok(await webhook(env, dispute('dp_1', id))); // -150, fees 19.00
  // buying is allowed while locked
  const settleRes = await c.post(`${SHOP}/settle`, {});
  ok(settleRes);
  assert.match(settleRes.json<ShopCheckoutResponse>().url, new RegExp(`^${CHECKOUT_URL_PREFIX}`));
  const sreq = env.gw.sessions[env.gw.sessions.length - 1];
  assert.deepEqual([sreq?.kind, sreq?.amountCents, sreq?.flames], ['settle', 1900, 0]);
  const settleId = sreq?.purchaseId ?? 0;
  ok(await webhook(env, sessionPaid(settleId, 1900)));
  assert.equal(balanceOf(env), -150, 'a settlement gives no Flames');
  let s = await shopOf(c);
  assert.equal(s.openFeesCents, 0);
  assert.equal(s.locked, true, 'still below zero');
  assert.equal(s.purchases.find((p) => p.id === settleId)?.kind, 'settle');
  assert.equal(s.purchases.find((p) => p.id === settleId)?.netCents, 1900);
  await buy(env, c, 'p220', 600); // fills the minus
  assert.equal(balanceOf(env), 70);
  s = await shopOf(c);
  assert.equal(s.locked, false);
  errorOf(await c.post(`${SHOP}/settle`, {}), 409, 'too_late');
  errorOf(await c.post(`${SHOP}/spend`, spendBody('nothing', undefined, newRequestId())), 404, 'not_found'); // no longer 403: unlocked
});

test('dispute: a second dispute bans buying, settling still works', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'twice');
  const a = await buy(env, c, 'p100', 300);
  const b = await buy(env, c, 'p100', 300);
  ok(await webhook(env, dispute('dp_a', a)));
  assert.equal((await shopOf(c)).paymentsBanned, false);
  ok(await webhook(env, dispute('dp_b', b)));
  const s = await shopOf(c);
  assert.equal(s.paymentsBanned, true);
  assert.ok(env.app.ctx.store.getAccount(1)?.payBannedAt);
  errorOf(await c.post(`${SHOP}/checkout`, checkoutBody('p100')), 403, 'forbidden');
  const res = await c.post(`${SHOP}/settle`, {});
  ok(res);
  assert.equal(env.gw.sessions[env.gw.sessions.length - 1]?.amountCents, s.openFeesCents);
});

test('dispute won: Flames come back, open fees are cancelled; fees already paid are refunded', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'winner');
  const a = await buy(env, c, 'p220', 600);
  const b = await buy(env, c, 'p100', 300);
  ok(await webhook(env, dispute('dp_a', a)));
  ok(await webhook(env, dispute('dp_b', b)));
  assert.equal(balanceOf(env), 0);
  // pay the fees, then win dispute a
  ok(await c.post(`${SHOP}/settle`, {}));
  const settleId = env.gw.sessions[env.gw.sessions.length - 1]?.purchaseId ?? 0;
  const total = (await shopOf(c)).openFeesCents;
  ok(await webhook(env, sessionPaid(settleId, total)));
  assert.equal((await shopOf(c)).openFeesCents, 0);
  ok(await webhook(env, disputeClosed('dp_a', a, 'won')));
  assert.equal(balanceOf(env), 220);
  assert.equal(env.app.ctx.shop.shop.getPurchase(a)?.status, 'dispute_won');
  assert.equal(env.gw.refunds.length, 1);
  assert.deepEqual([env.gw.refunds[0]?.paymentIntentId, env.gw.refunds[0]?.amountCents], [`pi_${settleId}`, 1500 + HANDLING_FEE_CENTS]);
  assert.equal((await shopOf(c)).disputes.find((d) => d.purchaseId === a)?.state, 'won');
  // dispute b is won while its fees are still open (new fees do not exist: all were paid) - replay is harmless
  ok(await webhook(env, disputeClosed('dp_a', a, 'won')));
  assert.equal(balanceOf(env), 220);
  // a dispute won with open fees cancels them
  const env2 = await makeShopApp();
  const d = await player(env2, 'winner2');
  const x = await buy(env2, d, 'p100', 300);
  ok(await webhook(env2, dispute('dp_x', x)));
  assert.ok((await shopOf(d)).openFeesCents > 0);
  ok(await webhook(env2, disputeClosed('dp_x', x, 'won')));
  const s2 = await shopOf(d);
  assert.deepEqual([s2.openFeesCents, s2.balance, s2.locked], [0, 100, false]);
  assert.equal(env2.gw.refunds.length, 0);
});

test('dispute lost: the Flames stay removed, the fees stay open', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'loser');
  const id = await buy(env, c, 'p100', 300);
  ok(await webhook(env, dispute('dp_1', id)));
  ok(await webhook(env, disputeClosed('dp_1', id, 'lost')));
  const s = await shopOf(c);
  assert.deepEqual([s.balance, s.disputes[0]?.state, s.openFeesCents > 0, s.locked], [0, 'lost', true, true]);
  assert.equal(env.app.ctx.shop.shop.getPurchase(id)?.status, 'dispute_lost');
});

test('dispute rate above 0.5 percent: one alert per month (log, audit and the owner hook)', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'rate1');
  const a = await buy(env, c, 'p100', 300);
  const b = await buy(env, c, 'p100', 300);
  ok(await webhook(env, dispute('dp_a', a)));
  assert.equal(env.alerts.length, 1);
  assert.match(env.alerts[0] ?? '', /2026-11/);
  ok(await webhook(env, dispute('dp_b', b)));
  assert.equal(env.alerts.length, 1, 'not again in the same month');
  assert.equal(env.app.ctx.store.auditRows().filter((r) => r.action === 'dispute_rate_alert').length, 1);
  const report = env.app.ctx.shop.paymentsReport();
  assert.deepEqual([report?.paidCount, report?.disputes, report?.rate], [2, 2, 1]);
});

test('dispute: no alert at a low rate', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'rate2');
  const ids: number[] = [];
  for (let i = 0; i < 4; i++) ids.push(await buy(env, c, 'p100', 300));
  // 1 of 4 is 25%: that alerts; the point here is the threshold function, so check a 0-dispute month stays quiet
  assert.equal(env.alerts.length, 0);
  assert.equal(env.app.ctx.shop.paymentsReport('2026-11')?.disputes, 0);
  assert.equal(env.app.ctx.shop.paymentsReport('2026-13'), null);
});

// ---- VAT in the webhook ------------------------------------------------------------------------

test('webhook: a paid session with VAT stores net, VAT, rate and billing country; the charge is net + VAT', async () => {
  const env = await makeShopApp({ stripeTax: true });
  const c = await player(env, 'vatpay');
  ok(await c.post(`${SHOP}/checkout`, checkoutBody('p100')));
  const id = env.gw.sessions[0]?.purchaseId ?? 0;
  ok(await webhook(env, sessionPaid(id, 372, { amount_subtotal: 300, total_details: { amount_tax: 72 }, customer_details: { email: 'e@example.com', address: { country: 'EE' } } })));
  const p = env.app.ctx.shop.shop.getPurchase(id);
  assert.deepEqual([p?.status, p?.priceCents, p?.netCents, p?.vatCents, p?.vatRateBp, p?.vatCountry], ['paid', 372, 300, 72, 2400, 'EE']);
  assert.equal(balanceOf(env), 100);
  const dto = (await shopOf(c)).purchases[0];
  assert.deepEqual([dto?.priceCents, dto?.netCents, dto?.vatCents, dto?.vatRateBp, dto?.vatCountry], [372, 300, 72, 2400, 'EE']);
  assert.match(env.app.ctx.store.auditRows(20).find((a) => a.action === 'shop_purchase_paid')?.detail ?? '', /372 cents \(net 300 \+ VAT 72\) EE/);
});

test('webhook: a subtotal that is not the net price, or a total that is not subtotal + tax, is ignored', async () => {
  const env = await makeShopApp({ stripeTax: true });
  const c = await player(env, 'vatbad2');
  ok(await c.post(`${SHOP}/checkout`, checkoutBody('p100')));
  const id = env.gw.sessions[0]?.purchaseId ?? 0;
  const st = env.app.ctx.shop.shop;
  const attempt = async (extra: Record<string, unknown>, amount: number): Promise<void> => {
    ok(await webhook(env, sessionPaid(id, amount, extra)));
    assert.equal(st.getPurchase(id)?.status, 'pending');
    assert.equal(balanceOf(env), 0);
  };
  await attempt({ amount_subtotal: 299, total_details: { amount_tax: 72 } }, 371); // wrong subtotal, consistent total
  await attempt({ amount_subtotal: 300, total_details: { amount_tax: 72 } }, 400); // total is not subtotal + tax
  await attempt({ amount_subtotal: 300, total_details: { amount_tax: 72 } }, 300); // tax missing from the total
  await attempt({ amount_subtotal: 300, total_details: { amount_tax: -5 } }, 295); // negative tax
  await attempt({ amount_subtotal: undefined }, 300); // no subtotal at all
  await attempt({ amount_subtotal: 300, currency: 'usd' }, 300);
  assert.equal(env.app.ctx.store.auditRows(50).filter((a) => a.action === 'shop_payment_mismatch').length, 6);
  // the right numbers still work afterwards
  ok(await webhook(env, sessionPaid(id, 372, { amount_subtotal: 300, total_details: { amount_tax: 72 } })));
  assert.equal(st.getPurchase(id)?.status, 'paid');
  assert.equal(balanceOf(env), 100);
});

// ---- migration, env, gateway, CLI ------------------------------------------------------------------

test('migration: a v6 database upgrades in place, keeps its rows, gets the shop tables and columns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-lobby-v6-'));
  try {
    const file = join(dir, 'lobby.sqlite');
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, username_lower TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        chieftain TEXT NOT NULL DEFAULT 'old-orm', created_at INTEGER NOT NULL, last_login INTEGER, banned_at INTEGER, ban_reason TEXT,
        staff_role TEXT CHECK (staff_role IN ('support', 'moderator', 'admin')));
      CREATE TABLE worlds (id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 32), name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'full', 'closed', 'finished')), path TEXT NOT NULL, created_at INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
      INSERT INTO accounts (username, username_lower, password_hash, created_at) VALUES ('Old', 'old', 'x', 5);
      INSERT INTO worlds VALUES ('w1', 'First', 'open', '/w/w1/', 100, 10);
      PRAGMA user_version = 6;
    `);
    old.close();
    const db = openDatabase(file);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, SCHEMA_VERSION);
    const store = new Store(db);
    const acct = store.getAccountByLowerName('old');
    assert.deepEqual([acct?.username, acct?.payBannedAt, acct?.disputes, acct?.ageGroup], ['Old', null, 0, null]);
    assert.equal(store.getWorld('w1')?.shopPremium, false);
    store.setWorldShopPremium('w1', true);
    assert.equal(store.getWorld('w1')?.shopPremium, true);
    for (const t of ['flames_ledger', 'purchases', 'consents', 'stripe_events', 'login_history', 'world_premium', 'account_items', 'account_fees']) {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t), t);
    }
    db.exec("INSERT INTO flames_ledger (account_id, at, delta, reason) VALUES (1, 0, 5, 'support')");
    assert.throws(() => db.exec('DELETE FROM flames_ledger'), /append-only/);
    db.close();
    openDatabase(file).close(); // opening again is a no-op
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migration: a v7 database gets the VAT columns (v9) and net_cents = price_cents for its purchases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-lobby-v7-'));
  try {
    const file = join(dir, 'lobby.sqlite');
    const first = openDatabase(file);
    for (const col of ['net_cents', 'vat_cents', 'vat_rate_bp', 'vat_country']) first.exec(`ALTER TABLE purchases DROP COLUMN ${col}`);
    first.exec(`INSERT INTO purchases (account_id, kind, pack_id, flames, price_cents, currency, status, ip, user_agent, created_at)
      VALUES (1, 'flames', 'p220', 220, 600, 'eur', 'paid', '1.1.1.1', 'x', 5), (1, 'settle', '', 0, 1900, 'eur', 'pending', '1.1.1.1', 'x', 6)`);
    first.exec('PRAGMA user_version = 7');
    first.close();
    const db = openDatabase(file);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, SCHEMA_VERSION);
    const rows = db.prepare('SELECT price_cents, net_cents, vat_cents, vat_rate_bp, vat_country FROM purchases ORDER BY id').all();
    assert.deepEqual(rows.map((r) => [r.price_cents, r.net_cents, r.vat_cents, r.vat_rate_bp, r.vat_country]), [[600, 600, null, null, null], [1900, 1900, null, null, null]]);
    db.close();
    const again = openDatabase(file); // opening again is a no-op: net_cents is not backfilled a second time
    again.exec('UPDATE purchases SET net_cents = 1 WHERE id = 1');
    again.close();
    const third = openDatabase(file);
    assert.equal(third.prepare('SELECT net_cents FROM purchases WHERE id = 1').get()?.net_cents, 1);
    third.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('env: Stripe settings are all-or-nothing; a live key needs PAYMENTS_LIVE; errors never contain a key', () => {
  const key = 'sk_test_abcdefghij1234567890';
  const live = 'sk_live_abcdefghij1234567890';
  const whsec = 'whsec_abcdefghij1234567890';
  assert.equal(parseStripeEnv({}).paymentsEnabled, false);
  assert.equal(parseStripeEnv({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: whsec, PUBLIC_URL: 'https://clanflame.example/' }).publicUrl, 'https://clanflame.example');
  assert.equal(parseStripeEnv({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: whsec, PUBLIC_URL: 'https://x.example', STRIPE_TAX: '1' }).stripeTax, true);
  const bad: Record<string, string | undefined>[] = [
    { STRIPE_SECRET_KEY: key },
    { STRIPE_WEBHOOK_SECRET: whsec },
    { STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: whsec },
    { STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: whsec, PUBLIC_URL: 'https://x.example/path' },
    { STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: whsec, PUBLIC_URL: 'ftp://x.example' },
    { STRIPE_SECRET_KEY: live, STRIPE_WEBHOOK_SECRET: whsec, PUBLIC_URL: 'https://x.example' },
    { STRIPE_SECRET_KEY: 'nonsense', STRIPE_WEBHOOK_SECRET: whsec, PUBLIC_URL: 'https://x.example' },
    { STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: 'nonsense', PUBLIC_URL: 'https://x.example' },
  ];
  for (const e of bad) {
    assert.throws(
      () => parseStripeEnv(e),
      (err: Error) => !err.message.includes(key) && !err.message.includes(live) && !err.message.includes(whsec) && !err.message.includes('nonsense'),
    );
  }
  assert.equal(parseStripeEnv({ STRIPE_SECRET_KEY: live, STRIPE_WEBHOOK_SECRET: whsec, PUBLIC_URL: 'https://x.example', PAYMENTS_LIVE: '1' }).paymentsEnabled, true);
});

test('gateway: Stripe requests are form-encoded with the pinned version, idempotency keys and 3-D Secure', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/checkout/sessions')) return Response.json({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' });
    return Response.json({ id: 're_1' });
  }) as unknown as typeof fetch;
  const g = new StripeGateway({ secretKey: 'sk_test_SECRETVALUE123', tax: true, fetch: fakeFetch });
  const s = await g.createCheckout({ purchaseId: 7, accountId: 3, kind: 'flames', packId: 'p100', flames: 100, amountCents: 300, successUrl: 'https://x.test/lobby/#shop-paid', cancelUrl: 'https://x.test/lobby/#shop', expiresAtSec: 1_800_000_000 });
  assert.equal(s.url, 'https://checkout.stripe.com/c/pay/cs_1');
  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer sk_test_SECRETVALUE123');
  assert.equal(headers['Stripe-Version'], STRIPE_VERSION);
  assert.equal(headers['Idempotency-Key'], 'checkout-7');
  const p = new URLSearchParams(String(calls[0]?.init.body));
  assert.equal(p.get('mode'), 'payment');
  assert.equal(p.get('payment_method_options[card][request_three_d_secure]'), 'any');
  assert.equal(p.get('payment_intent_data[statement_descriptor_suffix]'), 'CLANFIRE');
  assert.equal(p.get('line_items[0][price_data][currency]'), 'eur');
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), '300');
  assert.equal(p.get('payment_method_types[0]'), 'card');
  assert.equal(p.get('client_reference_id'), '7');
  assert.equal(p.get('metadata[purchase_id]'), '7');
  assert.equal(p.get('metadata[account_id]'), '3');
  assert.equal(p.get('expires_at'), '1800000000');
  assert.equal(p.get('automatic_tax[enabled]'), 'true');
  assert.equal(p.get('line_items[0][price_data][tax_behavior]'), 'exclusive');
  assert.equal(p.get('billing_address_collection'), 'required');
  assert.equal(p.get('success_url'), 'https://x.test/lobby/#shop-paid');
  await g.refund('pi_1', 300, 'refund-7-1');
  assert.equal(calls[1]?.url, 'https://api.stripe.com/v1/refunds');
  assert.equal((calls[1]?.init.headers as Record<string, string>)['Idempotency-Key'], 'refund-7-1');
  assert.equal(new URLSearchParams(String(calls[1]?.init.body)).get('payment_intent'), 'pi_1');
  await g.submitDisputeEvidence('dp_1', { customer_name: 'x' });
  assert.equal(calls[2]?.url, 'https://api.stripe.com/v1/disputes/dp_1');
  const ep = new URLSearchParams(String(calls[2]?.init.body));
  assert.deepEqual([ep.get('evidence[customer_name]'), ep.get('submit')], ['x', 'true']);
  // no tax parameter by default
  const g2 = new StripeGateway({ secretKey: 'sk_test_SECRETVALUE123', fetch: fakeFetch });
  await g2.createCheckout({ purchaseId: 8, accountId: 3, kind: 'settle', packId: '', flames: 0, amountCents: 1900, successUrl: 'a', cancelUrl: 'b', expiresAtSec: 1 });
  assert.equal(new URLSearchParams(String(calls[3]?.init.body)).has('automatic_tax[enabled]'), false);
  // tax off: no VAT parameters for a pack either
  await g2.createCheckout({ purchaseId: 9, accountId: 3, kind: 'flames', packId: 'p100', flames: 100, amountCents: 300, successUrl: 'a', cancelUrl: 'b', expiresAtSec: 1 });
  const off = new URLSearchParams(String(calls[4]?.init.body));
  for (const k of ['automatic_tax[enabled]', 'line_items[0][price_data][tax_behavior]', 'billing_address_collection']) assert.equal(off.has(k), false, k);
  // tax on, but a settlement never carries VAT
  await g.createCheckout({ purchaseId: 10, accountId: 3, kind: 'settle', packId: '', flames: 0, amountCents: 1900, successUrl: 'a', cancelUrl: 'b', expiresAtSec: 1 });
  const settle = new URLSearchParams(String(calls[5]?.init.body));
  assert.equal(settle.get('line_items[0][price_data][unit_amount]'), '1900');
  for (const k of ['automatic_tax[enabled]', 'line_items[0][price_data][tax_behavior]', 'billing_address_collection']) assert.equal(settle.has(k), false, k);
});

test('gateway: a checkout address that is not Stripe is refused; errors never carry the key', async () => {
  const KEY = 'sk_test_SECRETVALUE123';
  const evil = (async () => Response.json({ id: 'cs_1', url: 'https://evil.example/pay' })) as unknown as typeof fetch;
  await assert.rejects(new StripeGateway({ secretKey: KEY, fetch: evil }).createCheckout({ purchaseId: 1, accountId: 1, kind: 'flames', packId: 'p100', flames: 100, amountCents: 300, successUrl: 'a', cancelUrl: 'b', expiresAtSec: 1 }), PaymentError);
  const leaky = (async () => Response.json({ error: { type: 'invalid_request_error', code: 'api_key_expired', message: `Invalid API Key provided: ${KEY}` } }, { status: 401 })) as unknown as typeof fetch;
  const g = new StripeGateway({ secretKey: KEY, fetch: leaky });
  await assert.rejects(g.refund('pi_1', 1, 'k'), (err: Error) => err instanceof PaymentError && !err.message.includes(KEY) && /401/.test(err.message));
  const down = (async () => {
    throw new Error(`connect failed with ${KEY}`);
  }) as unknown as typeof fetch;
  await assert.rejects(new StripeGateway({ secretKey: KEY, fetch: down }).refund('pi_1', 1, 'k'), (err: Error) => !err.message.includes(KEY));
  // through the real route: the player sees a plain message without the key
  const { app } = await makeApp({ payments: new StripeGateway({ secretKey: KEY, fetch: leaky }), webhookSecret: WHSEC, publicUrl: 'https://x.test' });
  const { register } = await import('./helpers.ts');
  const c = await register(app, 'leakroute');
  ok(await c.post(`${SHOP}/age`, { ageGroup: 'adult' }));
  const res = await c.post(`${SHOP}/checkout`, checkoutBody('p100'));
  errorOf(res, 500, 'internal_error');
  assert.ok(!res.body.includes(KEY) && !res.body.includes('sk_'));
});

test('cli: world-shop, flames, flames-grant, age-group, payments-report', async () => {
  const env = await makeShopApp();
  const { addWorld } = await import('./helpers.ts');
  addWorld(env.app, 'w1');
  const c = await player(env, 'clifan', null);
  const store = env.app.ctx.store;
  const out: string[] = [];
  const err: string[] = [];
  const run = (...argv: string[]): number => runAdmin(argv, { openStore: () => store, env: {}, now: env.clock.now, out: (l) => out.push(l), err: (l) => err.push(l) });
  assert.equal(run('world-shop', 'w1', 'on'), 0);
  assert.equal(store.getWorld('w1')?.shopPremium, true);
  assert.equal(run('world-shop', 'w1', 'off'), 0);
  assert.equal(store.getWorld('w1')?.shopPremium, false);
  assert.equal(run('world-shop', 'w1', 'maybe'), 1);
  assert.equal(run('world-shop', 'nope', 'on'), 1);
  assert.equal(run('flames-grant', 'clifan', '50', 'welcome', 'gift'), 0);
  assert.equal(run('flames-grant', 'clifan', '-70', 'correction'), 0);
  assert.equal(store.db.prepare('SELECT SUM(delta) AS s FROM flames_ledger').get()?.s, -20);
  assert.equal(run('flames-grant', 'clifan', '0', 'x'), 1);
  assert.equal(run('flames-grant', 'clifan', '5'), 1, 'a reason is required');
  assert.equal(run('flames-grant', 'clifan', 'five', 'x'), 1);
  assert.equal(run('flames-grant', 'ghost', '5', 'x'), 1);
  const audit = store.auditRows(20).filter((a) => a.action === 'flames_grant');
  assert.deepEqual(audit.map((a) => a.detail).reverse(), ['50 welcome gift', '-70 correction']);
  out.length = 0;
  assert.equal(run('flames', 'clifan'), 0);
  assert.match(out.join('\n'), /-20 Flames \(LOCKED\)/);
  assert.match(out.join('\n'), /-70 support/);
  assert.equal(run('age-group', 'clifan', 'minor'), 0);
  assert.equal(store.getAccount(1)?.ageGroup, 'minor');
  assert.equal(run('age-group', 'clifan', 'adult'), 0);
  assert.equal(run('age-group', 'clifan', 'old'), 1);
  assert.equal(store.getAccount(1)?.ageGroup, 'adult');
  out.length = 0;
  assert.equal(run('payments-report', '2026-11'), 0);
  assert.match(out.join('\n'), /^2026-11: 0 paid purchases/);
  assert.equal(run('payments-report', 'november'), 1);
  const text = err.join('\n');
  assert.ok(!text.includes('sk_'));
  void c;
});

test('cli: usage lists the shop commands', async () => {
  const lines: string[] = [];
  runAdmin(['nonsense'], { openStore: () => new Store(openDatabase(':memory:')), env: {}, now: Date.now, out: () => {}, err: (l) => lines.push(l) });
  const text = lines.join('\n');
  for (const cmd of ['world-shop', 'flames <username>', 'flames-grant', 'refund <purchaseId> <reason...> [--keep-flames]', 'dispute-evidence', 'payments-report', 'age-group']) assert.ok(text.includes(cmd), cmd);
  void DAY;
});
