import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EnterWorldResponse, ShopCheckoutResponse, ShopResponse } from '@clanfire/engine';
import { CONSENT_TEXT, MINOR_MONTHLY_CAP_CENTS, PACKS, PARENT_CONSENT_TEXT, PREMIUM_DAYS, TERMS_VERSION } from '../src/shop/catalogue.ts';
import { verifyPass } from '../src/pass.ts';
import { Client, PUBLIC_KEY, errorOf, makeApp, nextIp, ok, register } from './helpers.ts';
import { DAY, WHSEC, buy, checkoutBody, makeShopApp, newRequestId, player, setAge, shopOf, shopWorld, spendBody, webhook } from './shop-helpers.ts';

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
  errorOf(await c.post(`${SHOP}/purchases/1/refund`, {}), 401, 'unauthorized');
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
  assert.deepEqual(s.packs.map((p) => [p.id, p.flames, p.priceCents]), PACKS.map((p) => [p.id, p.flames, p.priceCents]));
  assert.deepEqual(s.packs.map((p) => p.id), ['p100', 'p220', 'p480', 'p1100', 'p3000']);
  const premium = s.items.find((i) => i.id === 'premium30');
  assert.deepEqual(premium && [premium.priceFlames, premium.eurCents, premium.days], [150, 450, 30]);
  assert.equal(s.items.find((i) => i.id === 'look.test')?.owned, false);
  assert.equal(s.consentText, CONSENT_TEXT);
  assert.equal(s.parentConsentText, PARENT_CONSENT_TEXT);
  assert.equal(s.termsVersion, TERMS_VERSION);
  assert.equal(s.refundDays, 14);
  assert.equal(s.minorMonthlyCapCents, MINOR_MONTHLY_CAP_CENTS);
  const b = await c.get(`${SHOP}/balance`);
  assert.deepEqual(b.json(), { balance: 0, locked: false });
});

test('shop: payments off - the shop is shown, checkout, settle and refund answer 403', async () => {
  const { app } = await makeApp();
  const c = await register(app, 'noshop');
  const s = (await c.get(SHOP)).json<ShopResponse>();
  assert.equal(s.paymentsEnabled, false);
  ok(await c.post(`${SHOP}/age`, { ageGroup: 'adult' }));
  errorOf(await c.post(`${SHOP}/checkout`, checkoutBody('p100')), 403, 'forbidden');
  errorOf(await c.post(`${SHOP}/settle`, {}), 403, 'forbidden');
  errorOf(await c.post(`${SHOP}/purchases/1/refund`, {}), 403, 'forbidden');
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

test('refund: a whole unspent purchase within 14 days, ledger first then the provider', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'refunder');
  const id = await buy(env, c, 'p220', 600);
  const res = await c.post(`${SHOP}/purchases/${id}/refund`, {});
  ok(res);
  const s = res.json<ShopResponse>();
  assert.equal(s.balance, 0);
  assert.equal(s.purchases[0]?.status, 'refunded');
  assert.deepEqual([s.purchases[0]?.refundedFlames, s.purchases[0]?.refundedCents], [220, 600]);
  assert.equal(env.gw.refunds.length, 1);
  assert.deepEqual([env.gw.refunds[0]?.paymentIntentId, env.gw.refunds[0]?.amountCents], [`pi_${id}`, 600]);
  errorOf(await c.post(`${SHOP}/purchases/${id}/refund`, {}), 409, 'too_late');
  assert.equal(env.gw.refunds.length, 1, 'only one refund per purchase');
  assert.deepEqual(env.app.ctx.shop.shop.ledgerRows(1, 5).map((r) => [r.reason, r.delta]), [['refund', -220], ['purchase', 220]]);
  // the provider's charge.refunded for the same amount changes nothing more
  ok(await webhook(env, { id: 'evt_r1', type: 'charge.refunded', data: { object: { id: 'ch_1', object: 'charge', payment_intent: `pi_${id}`, amount_refunded: 600 } } }));
  assert.equal(env.app.ctx.shop.shop.balance(1), 0);
});

test('refund: spent Flames block it (oldest spent first), the 14 days end it', async () => {
  const env = await makeShopApp();
  shopWorld(env, 'w1');
  const c = await player(env, 'refunder2');
  const a = await buy(env, c, 'p220', 600);
  const b = await buy(env, c, 'p100', 300);
  ok(await c.post(`${SHOP}/spend`, spendBody('premium30', 'w1', newRequestId()))); // 150 of 320: all of A's oldest first? A has 70 left, B untouched
  const s = await shopOf(c);
  const dto = (id: number) => s.purchases.find((p) => p.id === id);
  assert.equal(dto(a)?.refundBlock, 'spent');
  assert.equal(dto(a)?.refundableFlames, 0);
  assert.equal(dto(b)?.refundBlock, null);
  assert.equal(dto(b)?.refundableFlames, 100);
  assert.equal(dto(b)?.refundableCents, 300);
  errorOf(await c.post(`${SHOP}/purchases/${a}/refund`, {}), 409, 'too_late');
  ok(await c.post(`${SHOP}/purchases/${b}/refund`, {}));
  assert.equal(env.app.ctx.shop.shop.balance(1), 70);
  // after 14 days the rest is blocked by time
  const d = await buy(env, c, 'p100', 300);
  env.clock.advance(13 * DAY);
  await shopOf(c);
  env.clock.advance(DAY + 1000);
  const late = (await shopOf(c)).purchases.find((p) => p.id === d);
  assert.equal(late?.refundBlock, 'too_late');
  errorOf(await c.post(`${SHOP}/purchases/${d}/refund`, {}), 409, 'too_late');
});

test('refund: the last purchase can be refunded while an older one is partly spent (FIFO math)', async () => {
  const env = await makeShopApp();
  shopWorld(env, 'w1');
  const c = await player(env, 'fifo');
  const first = await buy(env, c, 'p100', 300);
  const second = await buy(env, c, 'p100', 300);
  ok(await c.post(`${SHOP}/spend`, spendBody('premium30', 'w1', newRequestId()))); // 150: first fully, 50 of second
  const s = await shopOf(c);
  assert.deepEqual([first, second].map((id) => s.purchases.find((p) => p.id === id)?.refundBlock), ['spent', 'spent']);
  const third = await buy(env, c, 'p100', 300);
  const s2 = await shopOf(c);
  assert.equal(s2.purchases.find((p) => p.id === third)?.refundableFlames, 100);
  assert.equal(s2.purchases.find((p) => p.id === second)?.refundBlock, 'spent');
});

test('refund: another account\'s purchase is 404, a provider failure puts everything back', async () => {
  const env = await makeShopApp();
  const a = await player(env, 'owner1');
  const b = await player(env, 'intruder');
  const id = await buy(env, a, 'p100', 300);
  errorOf(await b.post(`${SHOP}/purchases/${id}/refund`, {}), 404, 'not_found');
  errorOf(await b.post(`${SHOP}/purchases/9999/refund`, {}), 404, 'not_found');
  errorOf(await a.post(`${SHOP}/purchases/abc/refund`, {}), 400, 'invalid_input');
  errorOf(await a.post(`${SHOP}/purchases/${id}/refund`, { amount: 1 }), 400, 'invalid_input');
  env.gw.failRefund = true;
  const res = await a.post(`${SHOP}/purchases/${id}/refund`, {});
  errorOf(res, 500, 'internal_error');
  assert.equal(env.app.ctx.shop.shop.balance(1), 100, 'the Flames are back');
  assert.equal(env.app.ctx.shop.shop.getPurchase(id)?.status, 'paid');
  assert.equal(env.app.ctx.shop.shop.getPurchase(id)?.refundedCents, 0);
  assert.deepEqual(env.app.ctx.shop.shop.ledgerRows(1, 3).map((r) => r.reason), ['refund_failed', 'refund', 'purchase']);
  env.gw.failRefund = false;
  ok(await a.post(`${SHOP}/purchases/${id}/refund`, {}));
  assert.equal(env.app.ctx.shop.shop.balance(1), 0);
});

test('refund: 5 a minute per account', async () => {
  const env = await makeShopApp();
  const c = await player(env, 'refspam');
  for (let i = 0; i < 5; i++) errorOf(await c.post(`${SHOP}/purchases/${i + 1}/refund`, {}), 404, 'not_found');
  errorOf(await c.post(`${SHOP}/purchases/1/refund`, {}), 429, 'rate_limited');
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
  const id = await buy(env, c, 'p100', 300);
  const bodies = [
    (await c.get(SHOP)).body,
    (await c.get(`${SHOP}/balance`)).body,
    (await c.post(`${SHOP}/checkout`, checkoutBody('p100'))).body,
    (await c.post(`${SHOP}/purchases/${id}/refund`, {})).body,
    (await webhook(env, { id: 'x' }, { secret: 'wrong' })).body,
  ];
  for (const b of bodies) assert.ok(!b.includes(WHSEC) && !b.includes('sk_') && !b.includes('whsec_'), b);
});
