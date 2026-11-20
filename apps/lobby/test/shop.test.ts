import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EnterWorldResponse, ShopCheckoutResponse, ShopResponse } from '@clanfire/engine';
import { runAdminAsync } from '../src/admin-ops.ts';
import { CONSENT_TEXT, MINOR_MONTHLY_CAP_CENTS, PACKS, PARENT_CONSENT_TEXT, PREMIUM_DAYS, TERMS_VERSION } from '../src/shop/catalogue.ts';
import { verifyPass } from '../src/pass.ts';
import { Client, PUBLIC_KEY, errorOf, makeApp, nextIp, ok, register } from './helpers.ts';
import { DAY, WHSEC, buy, checkoutBody, event, makeShopApp, newRequestId, player, sessionPaid, setAge, shopOf, shopWorld, spendBody, webhook, type ShopEnv } from './shop-helpers.ts';

const SHOP = '/lobby/api/shop';

test('shop: signed out is 401 on every endpoint', async () => {
  const env = await makeShopApp();
  const c = new Client(env.app);
  errorOf(await c.get(SHOP), 401, 'unauthorized');
  errorOf(await c.get(`${SHOP}/balance`), 401, 'unauthorized');
  errorOf(await c.post(`${SHOP}/age`, { ageGroup: 'adult' }), 401, 'unauthorized');
  errorOf(await c.post(`${SHOP}/checkout`, checkoutBody('p100')), 401, 'unauthorized');
  errorOf(await c.post(`${SHOP}/settle`, {}), 401, 'unauthorized');
  errorOf(await c.post(`${SHOP}/spend`, spendBody('premium30', 'w1', newRequestId())), 401, 'unauthorized');
});

test('shop: GET /shop shows the catalogue, the texts and the account state', async () => {
  const env = await makeShopApp({ looks: [{ id: 'look.test', name: 'Test look', priceFlames: 40 }] });
  const c = await player(env, 'alice', null);
  const s = await shopOf(c);
  assert.equal(s.balance, 0);
  assert.equal(s.locked, false);
  assert.equal(s.ageGroup, null);
  assert.equal(s.paymentsEnabled, true);
  assert.equal(s.paymentsBanned, false);
  assert.deepEqual(s.packs.map((p) => [p.id, p.flames, p.netCents]), PACKS.map((p) => [p.id, p.flames, p.netCents]));
  assert.deepEqual(s.packs.map((p) => p.id), ['p100', 'p220', 'p480', 'p1100', 'p3000']);
  const premium = s.items.find((i) => i.id === 'premium30');
  assert.deepEqual(premium && [premium.priceFlames, premium.eurCents, premium.days], [150, 450, 30]);
  assert.equal(s.items.find((i) => i.id === 'look.test')?.owned, false);
  assert.equal(s.consentText, CONSENT_TEXT);
  assert.equal(s.parentConsentText, PARENT_CONSENT_TEXT);
  assert.equal(s.termsVersion, TERMS_VERSION);
  assert.deepEqual(s.vat, { mode: 'none', country: null, ratePercent: null, ratesDate: '2026-11-20' });
  assert.ok(s.packs.every((p) => p.vatCents === null && p.totalCents === null));
  assert.equal(s.vatCountries.length, 27);
  assert.equal(s.minorMonthlyCapCents, MINOR_MONTHLY_CAP_CENTS);
  const b = await c.get(`${SHOP}/balance`);
  assert.deepEqual(b.json(), { balance: 0, locked: false });
});

test('shop: payments off - the shop is shown, checkout and settle answer 403', async () => {
  const { app } = await makeApp();
  const c = await register(app, 'noshop');
  const s = (await c.get(SHOP)).json<ShopResponse>();
  assert.equal(s.paymentsEnabled, false);
  ok(await c.post(`${SHOP}/age`, { ageGroup: 'adult' }));
  errorOf(await c.post(`${SHOP}/checkout`, checkoutBody('p100')), 403, 'forbidden');
  errorOf(await c.post(`${SHOP}/settle`, {}), 403, 'forbidden');
  errorOf(await c.post('/lobby/api/stripe/webhook', {}), 404, 'not_found');
});

test('age: set once, schema is strict', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'agey', null);
  errorOf(await c.post(`${SHOP}/age`, { ageGroup: 'child' }), 400, 'invalid_input');
  errorOf(await c.post(`${SHOP}/age`, { ageGroup: 'adult', extra: 1 }), 400, 'invalid_input');
  errorOf(await c.post(`${SHOP}/age`, {}), 400, 'invalid_input');
  const res = await c.post(`${SHOP}/age`, { ageGroup: 'minor' });
  ok(res);
  assert.equal(res.json<ShopResponse>().ageGroup, 'minor');
  errorOf(await c.post(`${SHOP}/age`, { ageGroup: 'adult' }), 409, 'too_late');
  assert.equal((await shopOf(c)).ageGroup, 'minor');
});

test('checkout: needs the age group, consent, current terms and a known pack', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'buyer1', null);
  errorOf(await c.post(`${SHOP}/checkout`, checkoutBody('p100')), 403, 'forbidden');
  await setAge(c);
  errorOf(await c.post(`${SHOP}/checkout`, checkoutBody('p100', { consent: false })), 400, 'invalid_input');
  errorOf(await c.post(`${SHOP}/checkout`, { packId: 'p100', termsVersion: TERMS_VERSION }), 400, 'invalid_input');
  errorOf(await c.post(`${SHOP}/checkout`, checkoutBody('p100', { price: 1 })), 400, 'invalid_input');
  errorOf(await c.post(`${SHOP}/checkout`, checkoutBody('p100', { consent: 'yes' })), 400, 'invalid_input');
  errorOf(await c.post(`${SHOP}/checkout`, checkoutBody('p999')), 400, 'invalid_input');
  errorOf(await c.post(`${SHOP}/checkout`, { ...checkoutBody('p100'), termsVersion: '2020-01-01' }), 409, 'too_late');
  assert.equal(env.gw.sessions.length, 0, 'nothing reached the provider');
  assert.equal(env.app.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM purchases').get()?.n, 0, 'nothing stored');
});

test('checkout: happy path stores the consent and a pending purchase, the price comes from the catalogue', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'buyer2');
  const res = await c.post(`${SHOP}/checkout`, checkoutBody('p220'), { 'user-agent': 'TestBrowser/1.0' });
  ok(res);
  assert.match(res.json<ShopCheckoutResponse>().url, /^https:\/\/checkout\.stripe\.com\//);
  const req = env.gw.sessions[0];
  assert.ok(req);
  assert.deepEqual([req.kind, req.packId, req.flames, req.amountCents, req.accountId], ['flames', 'p220', 220, 600, 1]);
  assert.equal(req.successUrl, 'https://clanflame.test/lobby/#shop-paid');
  assert.equal(req.cancelUrl, 'https://clanflame.test/lobby/#shop');
  assert.ok(req.expiresAtSec * 1000 >= env.clock.t + 30 * 60_000, 'Stripe needs at least 30 minutes');
  const st = env.app.ctx.shop.shop;
  const p = st.getPurchase(req.purchaseId);
  assert.ok(p);
  assert.deepEqual([p.status, p.flames, p.priceCents, p.userAgent, p.checkoutSessionId], ['pending', 220, 600, 'TestBrowser/1.0', `cs_test_${p.id}`]);
  const consents = st.consentsOfPurchase(p.id);
  assert.equal(consents.length, 1);
  assert.deepEqual([consents[0]?.kind, consents[0]?.text, consents[0]?.termsVersion, consents[0]?.accountId], ['withdrawal_waiver', CONSENT_TEXT, TERMS_VERSION, 1]);
  assert.equal(st.balance(1), 0, 'nothing credited before the payment is confirmed');
  const s = await shopOf(c);
  assert.equal(s.purchases[0]?.status, 'pending');
  assert.equal(s.purchases[0]?.receiptNo, `CF-${String(p.id).padStart(6, '0')}`);
  assert.ok(env.app.ctx.store.auditRows().some((a) => a.action === 'shop_checkout'));
});

test('checkout: a payments ban stops buying but not settling', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'banned1');
  env.app.ctx.shop.shop.setPayBanned(1, env.clock.t);
  assert.equal((await shopOf(c)).paymentsBanned, true);
  errorOf(await c.post(`${SHOP}/checkout`, checkoutBody('p100')), 403, 'forbidden');
  // nothing to settle yet: 409, not 403
  errorOf(await c.post(`${SHOP}/settle`, {}), 409, 'too_late');
});

test('checkout: under 18 needs the parent tick and stays under the monthly cap; the parent tick is stored', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'kid1', 'minor');
  errorOf(await c.post(`${SHOP}/checkout`, checkoutBody('p100')), 400, 'invalid_input');
  errorOf(await c.post(`${SHOP}/checkout`, checkoutBody('p100', { parentConsent: false })), 400, 'invalid_input');
  ok(await c.post(`${SHOP}/checkout`, checkoutBody('p1100', { parentConsent: true }))); // 25 EUR
  const id = env.gw.sessions[0]?.purchaseId ?? 0;
  const kinds = env.app.ctx.shop.shop.consentsOfPurchase(id).map((x) => [x.kind, x.text]);
  assert.deepEqual(kinds, [['withdrawal_waiver', CONSENT_TEXT], ['parent_consent', PARENT_CONSENT_TEXT]]);
  ok(await c.post(`${SHOP}/checkout`, checkoutBody('p100', { parentConsent: true }))); // 28 EUR pending counts
  errorOf(await c.post(`${SHOP}/checkout`, checkoutBody('p100', { parentConsent: true })), 409, 'not_enough_resources'); // 31 > 30
  const s = await shopOf(c);
  assert.equal(s.minorBoughtThisMonthCents, 2800);
  // next month the cap starts again
  env.clock.advance(35 * DAY);
  ok(await c.post('/lobby/api/auth/login', { username: 'kid1', password: 'correct horse battery' }));
  assert.equal((await shopOf(c)).minorBoughtThisMonthCents, 0);
});

test('checkout: at most 5 unfinished payments, 10 requests a minute, buying while locked is allowed', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'buyer3');
  for (let i = 0; i < 5; i++) ok(await c.post(`${SHOP}/checkout`, checkoutBody('p100')));
  errorOf(await c.post(`${SHOP}/checkout`, checkoutBody('p100')), 429, 'rate_limited');

  const d = await player(env, 'buyer4');
  for (let i = 0; i < 10; i++) errorOf(await d.post(`${SHOP}/checkout`, checkoutBody('p100', { consent: false })), 400, 'invalid_input');
  errorOf(await d.post(`${SHOP}/checkout`, checkoutBody('p100')), 429, 'rate_limited');

  const e = await player(env, 'buyer5');
  env.app.ctx.shop.supportGrant(3, -40, 'test minus');
  assert.equal((await shopOf(e)).locked, true);
  ok(await e.post(`${SHOP}/checkout`, checkoutBody('p100')));
});

test('checkout: a provider failure answers 500 with a plain message and the purchase expires', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'buyer6');
  env.gw.failCheckout = true;
  const res = await c.post(`${SHOP}/checkout`, checkoutBody('p100'));
  errorOf(res, 500, 'internal_error');
  assert.ok(!res.body.includes('Stripe'));
  assert.equal(env.app.ctx.shop.shop.getPurchase(1)?.status, 'expired');
  assert.equal((await shopOf(c)).purchases.length, 0, 'expired purchases are not listed');
});

test('spend: Premium 30 days, extends, idempotent request id, every refusal', async () => {
  const env = await makeShopApp();
  shopWorld(env, 'w1');
  const c = await player(env, 'spender');
  const sp = (item: string, world: string | undefined, rid = newRequestId()) => c.post(`${SHOP}/spend`, spendBody(item, world, rid));
  errorOf(await sp('premium30', 'w1'), 409, 'not_enough_resources');
  await buy(env, c, 'p220', 600); // 220
  const rid = newRequestId();
  const first = await sp('premium30', 'w1', rid);
  ok(first);
  const t0 = env.clock.t;
  assert.equal(first.json<ShopResponse>().balance, 70);
  assert.equal(first.json<ShopResponse>().premiumWorlds[0]?.until, t0 + PREMIUM_DAYS * DAY);
  // same request id: same answer, nothing spent twice
  const again = await sp('premium30', 'w1', rid);
  ok(again);
  assert.equal(again.json<ShopResponse>().balance, 70);
  assert.equal(again.json<ShopResponse>().premiumWorlds[0]?.until, t0 + PREMIUM_DAYS * DAY);
  errorOf(await sp('premium30', 'w1', rid).then(() => sp('premium30', undefined, rid)), 400, 'invalid_input');
  errorOf(await sp('premium30', 'w1'), 409, 'not_enough_resources');
  await buy(env, c, 'p100', 300); // 170
  env.clock.advance(DAY);
  const ext = await sp('premium30', 'w1');
  ok(ext);
  assert.equal(ext.json<ShopResponse>().premiumWorlds[0]?.until, t0 + 2 * PREMIUM_DAYS * DAY, 'the new 30 days start where the old ones end');
  assert.equal(ext.json<ShopResponse>().balance, 20);
  // refusals
  errorOf(await sp('premium30', undefined), 400, 'invalid_input');
  errorOf(await sp('nothing', 'w1'), 404, 'not_found');
  errorOf(await sp('premium30', 'nowhere'), 404, 'not_found');
  errorOf(await c.post(`${SHOP}/spend`, { itemId: 'premium30', worldId: 'w1', requestId: 'short' }), 400, 'invalid_input');
  errorOf(await c.post(`${SHOP}/spend`, { ...spendBody('premium30', 'w1', newRequestId()), price: 1 }), 400, 'invalid_input');
  const ledger = env.app.ctx.shop.shop.ledgerRows(1, 50);
  assert.equal(ledger.filter((r) => r.reason === 'spend').length, 2);
});

test('spend: the world must sell Premium and be open (or full and entered before)', async () => {
  const env = await makeShopApp();
  shopWorld(env, 'wc', 'closed');
  shopWorld(env, 'wf', 'full');
  shopWorld(env, 'wd', 'finished');
  shopWorld(env, 'wo', 'open');
  const { addWorld } = await import('./helpers.ts');
  addWorld(env.app, 'wn', 'No shop');
  const c = await player(env, 'spender2');
  await buy(env, c, 'p1100', 2500);
  const sp = (world: string) => c.post(`${SHOP}/spend`, spendBody('premium30', world, newRequestId()));
  errorOf(await sp('wc'), 403, 'forbidden');
  errorOf(await sp('wd'), 403, 'forbidden');
  errorOf(await sp('wn'), 403, 'forbidden');
  errorOf(await sp('wf'), 403, 'forbidden');
  ok(await c.post('/lobby/api/worlds/wf/enter'));
  ok(await sp('wf'));
  ok(await sp('wo'));
  const s = await shopOf(c);
  assert.deepEqual(s.premiumWorlds.map((w) => w.worldId).sort(), ['wf', 'wo']);
});

test('spend: looks are owned once', async () => {
  const env = await makeShopApp({ looks: [{ id: 'look.test', name: 'Test look', priceFlames: 40 }] });
  const c = await player(env, 'looker');
  await buy(env, c, 'p100', 300);
  const res = await c.post(`${SHOP}/spend`, spendBody('look.test', undefined, newRequestId()));
  ok(res);
  assert.equal(res.json<ShopResponse>().balance, 60);
  assert.equal(res.json<ShopResponse>().items.find((i) => i.id === 'look.test')?.owned, true);
  errorOf(await c.post(`${SHOP}/spend`, spendBody('look.test', undefined, newRequestId())), 400, 'invalid_input');
  errorOf(await c.post(`${SHOP}/spend`, spendBody('look.test', 'w1', newRequestId())), 400, 'invalid_input');
  assert.equal((await shopOf(c)).balance, 60);
});

test('spend: rate limit 30 a minute per account', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'spammer');
  for (let i = 0; i < 30; i++) errorOf(await c.post(`${SHOP}/spend`, spendBody('nothing', undefined, newRequestId())), 404, 'not_found');
  errorOf(await c.post(`${SHOP}/spend`, spendBody('nothing', undefined, newRequestId())), 429, 'rate_limited');
});

test('pass: carries prm, the Premium end for that world; 0 without Premium and while locked', async () => {
  const env = await makeShopApp();
  shopWorld(env, 'w1');
  const { addWorld } = await import('./helpers.ts');
  addWorld(env.app, 'w2');
  const c = await player(env, 'passer');
  const claims = async (world: string) => verifyPass((await c.post(`/lobby/api/worlds/${world}/enter`)).json<EnterWorldResponse>().pass, [PUBLIC_KEY], env.clock.t);
  assert.equal((await claims('w1')).prm, 0, 'every pass carries prm');
  await buy(env, c, 'p220', 600);
  ok(await c.post(`${SHOP}/spend`, spendBody('premium30', 'w1', newRequestId())));
  const until = env.clock.t + PREMIUM_DAYS * DAY;
  assert.equal((await claims('w1')).prm, until);
  assert.equal((await claims('w2')).prm, 0, 'other worlds are not affected');
  // locked: a negative balance
  env.app.ctx.shop.supportGrant(1, -500, 'test');
  assert.equal((await claims('w1')).prm, 0);
  env.app.ctx.shop.supportGrant(1, 500, 'test back');
  assert.equal((await claims('w1')).prm, until);
  // ended
  env.clock.advance(31 * DAY);
  await c.post('/lobby/api/auth/login', { username: 'passer', password: 'correct horse battery' });
  assert.equal((await claims('w1')).prm, 0);
});


const dispute = (id: string, purchaseId: number, extra: Record<string, unknown> = {}) =>
  event('charge.dispute.created', { id, object: 'dispute', payment_intent: `pi_${purchaseId}`, charge: `ch_${purchaseId}`, reason: 'general', status: 'needs_response', balance_transactions: [{ fee: 1500 }], ...extra });
const disputeClosed = (id: string, purchaseId: number, status: string) => event('charge.dispute.closed', { id, object: 'dispute', payment_intent: `pi_${purchaseId}`, status });

// ---- support refund (CLI only) ----------------------------------------------------------------

async function cliRefund(env: ShopEnv, ...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runAdminAsync(['refund', ...argv], { openStore: () => env.app.ctx.store, env: {}, now: env.clock.now, out: (l) => out.push(l), err: (l) => err.push(l), gateway: env.gw });
  return { code, out: out.join('\n'), err: err.join('\n') };
}
const ledgerSum = (env: ShopEnv): number => Number(env.app.ctx.store.db.prepare('SELECT COALESCE(SUM(delta), 0) AS s FROM flames_ledger').get()?.s);

test('refund: the player route is gone (404), there is no refund button data in the shop', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'norefund');
  const id = await buy(env, c, 'p100', 300);
  errorOf(await c.post(`${SHOP}/purchases/${id}/refund`, {}), 404, 'not_found');
  assert.equal(env.gw.refunds.length, 0);
  const dto = (await shopOf(c)).purchases[0] as unknown as Record<string, unknown>;
  for (const k of ['refundableFlames', 'refundableCents', 'refundBlock', 'refundUntil']) assert.ok(!(k in dto), k);
  assert.ok(!('refundDays' in ((await shopOf(c)) as unknown as Record<string, unknown>)));
});

test('cli refund: whole purchase through the gateway, Flames off the ledger, audited; the later charge.refunded changes nothing', async () => {
  const env = await makeShopApp();
  shopWorld(env, 'w1');
  const c = await player(env, 'refunder');
  const id = await buy(env, c, 'p220', 600);
  ok(await c.post(`${SHOP}/spend`, spendBody('premium30', 'w1', newRequestId()))); // 70 left: the balance may go negative
  const r = await cliRefund(env, String(id), 'goodwill', 'after', 'a', 'bug');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /6\.00 EUR back to the card, 220 Flames removed\. Balance now -150/);
  const st = env.app.ctx.shop.shop;
  const p = st.getPurchase(id);
  assert.deepEqual([p?.status, p?.refundedFlames, p?.refundedCents], ['refunded', 220, 600]);
  assert.equal(st.balance(1), -150);
  assert.equal(env.gw.refunds.length, 1);
  assert.deepEqual([env.gw.refunds[0]?.paymentIntentId, env.gw.refunds[0]?.amountCents], [`pi_${id}`, 600]);
  assert.match(env.gw.refunds[0]?.key ?? '', new RegExp(`^support-refund-${id}-`));
  const row = st.ledgerRows(1, 1)[0];
  assert.deepEqual([row?.reason, row?.delta, row?.detail], ['refund', -220, 'support: goodwill after a bug']);
  const audit = env.app.ctx.store.auditRows(50).find((a) => a.action === 'shop_support_refund');
  assert.match(audit?.detail ?? '', /goodwill after a bug/);
  const s = await shopOf(c);
  assert.deepEqual([s.purchases[0]?.status, s.purchases[0]?.refundedFlames, s.purchases[0]?.refundedCents], ['refunded', 220, 600]);
  // Stripe's own charge.refunded for the same money: nothing more happens
  const rows = st.ledgerRows(1, 50).length;
  ok(await webhook(env, event('charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: `pi_${id}`, amount_refunded: 600 })));
  assert.equal(st.ledgerRows(1, 50).length, rows);
  assert.equal(st.balance(1), -150);
  assert.deepEqual([st.getPurchase(id)?.refundedFlames, st.getPurchase(id)?.refundedCents], [220, 600]);
  // a second refund of the same purchase is refused and sends nothing
  assert.equal((await cliRefund(env, String(id), 'again')).code, 1);
  assert.equal(env.gw.refunds.length, 1);
});

test('cli refund --keep-flames: the money goes back, the Flames stay', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'keeper');
  const id = await buy(env, c, 'p100', 300);
  const r = await cliRefund(env, String(id), 'chargeback', 'risk', '--keep-flames');
  assert.equal(r.code, 0, r.err);
  const st = env.app.ctx.shop.shop;
  assert.equal(st.balance(1), 100);
  assert.equal(st.ledgerRows(1, 5).filter((x) => x.reason === 'refund').length, 0);
  const p = st.getPurchase(id);
  assert.deepEqual([p?.status, p?.refundedFlames, p?.refundedCents], ['refunded', 0, 300]);
  assert.equal(env.gw.refunds[0]?.amountCents, 300);
  assert.match(env.app.ctx.store.auditRows(50).find((a) => a.action === 'shop_support_refund')?.detail ?? '', /flames kept/);
  ok(await webhook(env, event('charge.refunded', { id: 'ch_2', object: 'charge', payment_intent: `pi_${id}`, amount_refunded: 300 })));
  assert.equal(st.balance(1), 100, 'the later event changes nothing');
});

test('cli refund: refuses wrong status, settlements, missing reason, unknown purchase and a missing gateway; nothing is sent', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'refuser');
  ok(await c.post(`${SHOP}/checkout`, checkoutBody('p100')));
  const pending = env.gw.sessions[0]?.purchaseId ?? 0;
  assert.equal((await cliRefund(env, String(pending), 'x')).code, 1, 'pending');
  const paid = await buy(env, c, 'p100', 300);
  assert.equal((await cliRefund(env, String(paid))).code, 1, 'a reason is required');
  assert.equal((await cliRefund(env, String(paid), '--bogus', 'x')).code, 1, 'unknown flag');
  assert.equal((await cliRefund(env, '9999', 'x')).code, 1, 'unknown purchase');
  assert.equal((await cliRefund(env, 'abc', 'x')).code, 1);
  assert.equal(await runAdminAsync(['refund', String(paid), 'x'], { openStore: () => env.app.ctx.store, env: {}, now: env.clock.now, out: () => {}, err: () => {} }), 1, 'no Stripe key');
  // a disputed purchase and a settlement
  ok(await webhook(env, dispute('dp_r', paid)));
  const disputed = await cliRefund(env, String(paid), 'x');
  assert.equal(disputed.code, 1);
  assert.match(disputed.err, /disputed/);
  ok(await c.post(`${SHOP}/settle`, {}));
  const settleId = env.gw.sessions[env.gw.sessions.length - 1]?.purchaseId ?? 0;
  ok(await webhook(env, sessionPaid(settleId, 1900)));
  const settle = await cliRefund(env, String(settleId), 'x');
  assert.equal(settle.code, 1);
  assert.match(settle.err, /not a Flames pack/);
  assert.equal(env.gw.refunds.length, 0);
  assert.equal(env.app.ctx.shop.shop.getPurchase(paid)?.refundedCents, 0);
});

test('cli refund: a won dispute can be refunded', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'wonref');
  const id = await buy(env, c, 'p100', 300);
  ok(await webhook(env, dispute('dp_w', id)));
  ok(await webhook(env, disputeClosed('dp_w', id, 'won')));
  assert.equal(env.app.ctx.shop.shop.getPurchase(id)?.status, 'dispute_won');
  assert.equal((await cliRefund(env, String(id), 'customer asked')).code, 0);
  assert.equal(env.app.ctx.shop.shop.getPurchase(id)?.status, 'refunded');
  assert.equal(env.app.ctx.shop.shop.balance(1), 0);
});

test('cli refund: a provider failure puts everything back; a retry then works', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'failref');
  const id = await buy(env, c, 'p220', 600);
  const st = env.app.ctx.shop.shop;
  env.gw.failRefund = true;
  const r = await cliRefund(env, String(id), 'try');
  assert.equal(r.code, 1);
  assert.match(r.err, /Nothing was changed/);
  assert.ok(!r.err.includes('Stripe'));
  assert.equal(st.balance(1), 220);
  assert.equal(ledgerSum(env), 220);
  const p = st.getPurchase(id);
  assert.deepEqual([p?.status, p?.refundedFlames, p?.refundedCents, p?.refundedAt], ['paid', 0, 0, null]);
  assert.equal(env.gw.refunds.length, 0);
  assert.ok(env.app.ctx.store.auditRows(50).some((a) => a.action === 'shop_support_refund_failed'));
  env.gw.failRefund = false;
  assert.equal((await cliRefund(env, String(id), 'try again')).code, 0);
  assert.equal(st.balance(1), 0);
});

// ---- VAT --------------------------------------------------------------------------------------------

const vatEnv = (over: Parameters<typeof makeShopApp>[0] = {}) => makeShopApp({ stripeTax: true, ...over });
const packOf = (s: ShopResponse, id: string) => s.packs.find((p) => p.id === id);

test('vat: ?country=EE shows 300 + 72 = 372 for p100, ?country=FI rounds, ?country=XX shows no VAT', async () => {
  const env = await vatEnv();
  const c = await player(env, 'vatty');
  const ee = (await c.get(`${SHOP}?country=EE`)).json<ShopResponse>();
  assert.deepEqual(ee.vat, { mode: 'stripe_tax', country: 'EE', ratePercent: 24, ratesDate: '2026-11-20' });
  assert.deepEqual([packOf(ee, 'p100')?.netCents, packOf(ee, 'p100')?.vatCents, packOf(ee, 'p100')?.totalCents], [300, 72, 372]);
  assert.deepEqual([packOf(ee, 'p3000')?.vatCents, packOf(ee, 'p3000')?.totalCents], [1440, 7440]);
  const fi = (await c.get(`${SHOP}?country=FI`)).json<ShopResponse>();
  assert.deepEqual([fi.vat.ratePercent, packOf(fi, 'p100')?.vatCents, packOf(fi, 'p100')?.totalCents], [25.5, 77, 377]); // 76.5 rounds up
  const xx = (await c.get(`${SHOP}?country=XX`)).json<ShopResponse>();
  assert.deepEqual([xx.vat.country, xx.vat.ratePercent, packOf(xx, 'p100')?.vatCents, packOf(xx, 'p100')?.totalCents], ['XX', 0, 0, 300]);
  assert.equal(ee.vatCountries.length, 27);
  assert.deepEqual(ee.vatCountries.find((v) => v.code === 'FI'), { code: 'FI', name: 'Finland', ratePercent: 25.5 });
  assert.equal(packOf(ee, 'p100')?.currency, 'eur');
});

test('vat: a bad, unknown or extra query is 400', async () => {
  const env = await vatEnv();
  const c = await player(env, 'vatbad');
  for (const q of ['country=ee', 'country=USA', 'country=US', 'country=ZZ', 'country=', 'country=E1', 'country=EE&x=1', 'x=1', 'country=EE&country=DE']) {
    errorOf(await c.get(`${SHOP}?${q}`), 400, 'invalid_input');
  }
  ok(await c.get(`${SHOP}?country=DE`));
});

test('vat: without a query and without a purchase the country is not known; the last purchase\'s billing country is the guess', async () => {
  const env = await vatEnv();
  const c = await player(env, 'vatguess');
  const first = await shopOf(c);
  assert.deepEqual([first.vat.mode, first.vat.country, first.vat.ratePercent], ['stripe_tax', null, null]);
  assert.ok(first.packs.every((p) => p.vatCents === null && p.totalCents === null));
  await buy(env, c, 'p100', 300); // billing country DE (helper default)
  const de = await shopOf(c);
  assert.deepEqual([de.vat.country, de.vat.ratePercent, packOf(de, 'p100')?.vatCents, packOf(de, 'p100')?.totalCents], ['DE', 19, 57, 357]);
  // the query wins
  assert.equal((await c.get(`${SHOP}?country=EE`)).json<ShopResponse>().vat.country, 'EE');
  // a billing country outside the table is shown as "outside the EU"
  const id = await (async () => {
    ok(await c.post(`${SHOP}/checkout`, checkoutBody('p100')));
    const pid = env.gw.sessions[env.gw.sessions.length - 1]?.purchaseId ?? 0;
    env.clock.advance(1000);
    ok(await webhook(env, sessionPaid(pid, 300, { customer_details: { email: 'b@example.com', address: { country: 'US' } } })));
    return pid;
  })();
  assert.equal(env.app.ctx.shop.shop.getPurchase(id)?.vatCountry, 'US');
  assert.equal((await shopOf(c)).vat.country, 'XX');
});

test('vat: the CDN country header is used only when the proxy is trusted, after the query and the last purchase', async () => {
  const trusted = await vatEnv({ trustProxy: true });
  const a = await player(trusted, 'cdn1');
  const country = async (c: typeof a, headers: Record<string, string>, q = ''): Promise<string | null> => (await c.get(`${SHOP}${q}`, headers)).json<ShopResponse>().vat.country;
  assert.equal(await country(a, { 'cloudfront-viewer-country': 'FR' }), 'FR');
  assert.equal(await country(a, { 'cf-ipcountry': 'ee' }), 'EE');
  assert.equal(await country(a, { 'cf-ipcountry': 'US' }), 'XX', 'outside the EU');
  assert.equal(await country(a, { 'cf-ipcountry': 'ZZZZ' }), null, 'junk is ignored');
  assert.equal(await country(a, { 'cloudfront-viewer-country': 'FR' }, '?country=ES'), 'ES', 'the query wins');
  await buy(trusted, a, 'p100', 300); // billing country DE
  assert.equal(await country(a, { 'cloudfront-viewer-country': 'FR' }), 'DE', 'the last purchase wins over the header');
  const open = await vatEnv();
  const b = await player(open, 'cdn2');
  assert.equal(await country(b, { 'cloudfront-viewer-country': 'FR', 'cf-ipcountry': 'FR' }), null, 'anyone can send a header without a trusted proxy');
});

test('vat: Stripe Tax off - mode none, no VAT numbers, a ?country is accepted but changes nothing', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'notax');
  const s = (await c.get(`${SHOP}?country=EE`)).json<ShopResponse>();
  assert.deepEqual([s.vat.mode, s.vat.country, s.vat.ratePercent], ['none', null, null]);
  assert.ok(s.packs.every((p) => p.vatCents === null && p.totalCents === null));
});

test('vat: checkout charges the NET price (the gateway adds the tax); the minor cap counts net cents', async () => {
  const env = await vatEnv();
  const c = await player(env, 'kidvat', 'minor');
  ok(await c.post(`${SHOP}/checkout`, checkoutBody('p1100', { parentConsent: true })));
  assert.equal(env.gw.sessions[0]?.amountCents, 2500);
  const p = env.app.ctx.shop.shop.getPurchase(env.gw.sessions[0]?.purchaseId ?? 0);
  assert.deepEqual([p?.priceCents, p?.netCents, p?.vatCents], [2500, 2500, null]);
  ok(await webhook(env, sessionPaid(p?.id ?? 0, 3100, { amount_subtotal: 2500, total_details: { amount_tax: 600 }, customer_details: { email: 'k@example.com', address: { country: 'EE' } } })));
  assert.equal((await shopOf(c)).minorBoughtThisMonthCents, 2500, 'net, not the 31 EUR that was charged');
  ok(await c.post(`${SHOP}/checkout`, checkoutBody('p100', { parentConsent: true }))); // 28 <= 30
  errorOf(await c.post(`${SHOP}/checkout`, checkoutBody('p100', { parentConsent: true })), 409, 'not_enough_resources'); // 31 > 30
});

test('login history: register, sign-in and entering a world are recorded; the browser string is cut to 200 characters', async () => {
  const env = await makeShopApp();
  const { addWorld } = await import('./helpers.ts');
  addWorld(env.app, 'w1');
  const c = new Client(env.app, nextIp());
  const ua = 'U'.repeat(500);
  ok(await c.post('/lobby/api/auth/register', { username: 'historian', password: 'correct horse battery' }, { 'user-agent': ua }), 201);
  ok(await c.post('/lobby/api/auth/login', { username: 'historian', password: 'correct horse battery' }, { 'user-agent': 'B/1' }));
  ok(await c.post('/lobby/api/worlds/w1/enter', undefined, { 'user-agent': 'C/1' }));
  const rows = env.app.ctx.shop.shop.loginHistory(1, 10).reverse();
  assert.deepEqual(rows.map((r) => [r.kind, r.worldId]), [['register', null], ['login', null], ['enter', 'w1']]);
  assert.equal(rows[0]?.userAgent.length, 200);
  assert.equal(rows[1]?.ip, c.ip);
});

test('login history: 30 days for accounts that never paid, 2 years for payers', async () => {
  const env = await makeShopApp();
  const free = await player(env, 'freeplayer');
  const payer = await player(env, 'payingplayer');
  await buy(env, payer, 'p100', 300);
  const store = env.app.ctx.store;
  const t0 = env.clock.t;
  store.recordLoginHistory(1, t0 - 31 * DAY, '1.1.1.1', 'x', 'login');
  store.recordLoginHistory(2, t0 - 31 * DAY, '1.1.1.1', 'x', 'login');
  store.recordLoginHistory(2, t0 - 800 * DAY, '1.1.1.1', 'x', 'login');
  const count = (id: number): number => Number(store.db.prepare('SELECT COUNT(*) AS n FROM login_history WHERE account_id = ?').get(id)?.n);
  const before = [count(1), count(2)];
  store.purgeLoginHistory(t0);
  assert.equal(count(1), before[0]! - 1, 'the free player lost the old row (the fresh register row stays)');
  assert.equal(count(2), before[1]! - 1, 'the payer lost only the row older than 2 years');
  void free;
});

test('the Flames ledger is append-only', async () => {
  const env = await makeShopApp();
  await player(env, 'ledgerman');
  env.app.ctx.shop.supportGrant(1, 5, 'x');
  const db = env.app.ctx.store.db;
  assert.throws(() => db.exec('UPDATE flames_ledger SET delta = 1000'), /append-only/);
  assert.throws(() => db.exec('DELETE FROM flames_ledger'), /append-only/);
  assert.throws(() => db.exec("INSERT INTO flames_ledger (account_id, at, delta, reason) VALUES (1, 0, 0, 'support')"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO flames_ledger (account_id, at, delta, reason) VALUES (1, 0, 5, 'gift')"), /CHECK/);
  assert.equal(env.app.ctx.shop.shop.balance(1), 5);
});

test('no Stripe key or webhook secret appears in any response', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'leakcheck');
  await buy(env, c, 'p100', 300);
  const bodies = [
    (await c.get(SHOP)).body,
    (await c.get(`${SHOP}/balance`)).body,
    (await c.post(`${SHOP}/checkout`, checkoutBody('p100'))).body,
    (await webhook(env, { id: 'x' }, { secret: 'wrong' })).body,
  ];
  for (const b of bodies) assert.ok(!b.includes(WHSEC) && !b.includes('sk_') && !b.includes('whsec_'), b);
});
