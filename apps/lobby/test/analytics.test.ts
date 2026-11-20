// Lobby-side analytics (docs/ANALYTICS.md): register_done, shop_open, iap_done, iap_refund, premium_buy, the "Share play stats" switch and the
// pass claim that carries it to the worlds. The real ingest is never contacted: the sender gets a fake fetch.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EnterWorldResponse, LobbyMeResponse } from '@clanfire/engine';
import { AnalyticsSender, NO_ANALYTICS, iidOf, validateEvent } from '@clanfire/analytics';
import { PUBLIC_KEY, errorOf, ok, register, Client } from './helpers.ts';
import { verifyPass } from '../src/pass.ts';
import { buy, event, makeShopApp, newRequestId, player, sessionPaid, setAge, shopWorld, spendBody, webhook, type ShopEnv } from './shop-helpers.ts';

const SALT = 'lobby-test-salt';
const SHOP = '/lobby/api/shop';

interface Sent {
  iid: string;
  e: string;
  p?: Record<string, string | number>;
}

function recorder(now: () => number) {
  const batches: Array<Record<string, unknown>> = [];
  const f = (async (_url: string, init: { body: string }) => {
    batches.push(JSON.parse(init.body) as Record<string, unknown>);
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  const sender = new AnalyticsSender({ salt: SALT, app: '0.1.0-dev', fetch: f, now, timer: false });
  const sent = async (): Promise<Sent[]> => {
    await sender.flush();
    return batches.flatMap((b) => (b.events as Array<{ e: string; p?: Record<string, string | number> }>).map((e) => ({ iid: b.iid as string, e: e.e, p: e.p })));
  };
  return { sender, sent };
}

/** A shop app whose analytics sender records instead of sending. The clock is the app's own, so the recorder is created lazily. */
async function onShop() {
  const holder: { now: () => number } = { now: Date.now };
  const rec = recorder(() => holder.now());
  const env = await makeShopApp({ analytics: rec.sender });
  holder.now = env.clock.now;
  return { env, rec };
}

test('off by default: no sender, nothing recorded, the share-stats route still works', async () => {
  const real = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (() => {
    fetched++;
    throw new Error('no network in tests');
  }) as unknown as typeof fetch;
  try {
    const env = await makeShopApp();
    assert.equal(env.app.ctx.analytics.enabled, false);
    const c = await player(env, 'quiet');
    await buy(env, c, 'p100', 300);
    ok(await c.get(`${SHOP}?from=lobby`));
    ok(await c.post('/lobby/api/account/share-stats', { share: false }));
    assert.equal(fetched, 0);
    await env.app.close();
  } finally {
    globalThis.fetch = real;
  }
});

test('register_done is sent once at registration, with the hashed account id and no params', async () => {
  const { env, rec } = await onShop();
  const c = await register(env.app, 'newbie');
  const me = (await c.get('/lobby/api/auth/me')).json<LobbyMeResponse>().account!;
  const sent = await rec.sent();
  assert.deepEqual(sent, [{ iid: iidOf(SALT, String(me.id)), e: 'register_done', p: undefined }]);
  assert.notEqual(sent[0]!.iid, String(me.id));
  // Signing in again is not a registration.
  const again = new Client(env.app);
  ok(await again.post('/lobby/api/auth/login', { username: 'newbie', password: 'correct horse battery' }));
  assert.equal((await rec.sent()).length, 1);
  await env.app.close();
});

test('shop_open: `from` comes from a fixed list, one event per account per 30 minutes; no `from` sends nothing', async () => {
  const { env, rec } = await onShop();
  const c = await player(env, 'looker');
  const opens = async () => (await rec.sent()).filter((e) => e.e === 'shop_open').map((e) => e.p?.from);
  ok(await c.get(SHOP));
  assert.deepEqual(await opens(), []);
  errorOf(await c.get(`${SHOP}?from=Elsewhere`), 400, 'invalid_input');
  errorOf(await c.get(`${SHOP}?from=map`), 400, 'invalid_input');
  ok(await c.get(`${SHOP}?from=menu`));
  ok(await c.get(`${SHOP}?from=feast&country=DE`));
  assert.deepEqual(await opens(), ['menu']);
  env.clock.advance(31 * 60_000);
  ok(await c.get(`${SHOP}?from=lobby`));
  assert.deepEqual(await opens(), ['menu', 'lobby']);
  await env.app.close();
});

async function paidPack(env: ShopEnv, c: Client, pack: string, cents: number): Promise<number> {
  return buy(env, c, pack, cents);
}

test('iap_done comes from the confirmed webhook: net price in micros, EUR, first 1/0, once even if Stripe repeats', async () => {
  const { env, rec } = await onShop();
  const c = await player(env, 'payer');
  // Checkout alone sends nothing: only the confirmed payment does.
  ok(await c.post(`${SHOP}/checkout`, { packId: 'p100', consent: true, parentConsent: true, termsVersion: (await c.get(SHOP)).json<{ termsVersion: string }>().termsVersion }));
  assert.equal((await rec.sent()).filter((e) => e.e === 'iap_done').length, 0);
  const first = await paidPack(env, c, 'p100', 300);
  const second = await paidPack(env, c, 'p1100', 2500);
  const done = (await rec.sent()).filter((e) => e.e === 'iap_done');
  assert.equal(done.length, 2);
  assert.deepEqual(done[0]!.p, { product: 'flames_100', price_micros: 3_000_000, currency: 'EUR', first: 1 });
  assert.deepEqual(done[1]!.p, { product: 'flames_1100', price_micros: 25_000_000, currency: 'EUR', first: 0 });
  for (const e of done) assert.equal(validateEvent(e.e, e.p), null);
  // A replay of the same Stripe event, and a second "paid" event for the same purchase, send nothing more.
  const ev = sessionPaid(first, 300);
  ok(await webhook(env, ev));
  ok(await webhook(env, ev));
  assert.equal((await rec.sent()).filter((e) => e.e === 'iap_done').length, 2);
  assert.ok(second > first);
  await env.app.close();
});

test('iap_done uses the NET price when VAT is added on top (the money in micros is ex-VAT)', async () => {
  const { env, rec } = await onShop();
  const c = await player(env, 'eurobuyer');
  ok(await c.post(`${SHOP}/checkout`, { packId: 'p100', consent: true, parentConsent: true, termsVersion: (await c.get(SHOP)).json<{ termsVersion: string }>().termsVersion }));
  const req = env.gw.sessions[0]!;
  // 19 % VAT on 300 net: Stripe charges 357.
  ok(await webhook(env, sessionPaid(req.purchaseId, 300, { amount_total: 357, total_details: { amount_tax: 57 } })));
  const done = (await rec.sent()).find((e) => e.e === 'iap_done')!;
  assert.equal(done.p!.price_micros, 3_000_000);
  await env.app.close();
});

test('iap_refund: a refund at the provider and a lost dispute are reported once, as net money; a won dispute sends nothing', async () => {
  const { env, rec } = await onShop();
  const c = await player(env, 'refunded');
  const id = await paidPack(env, c, 'p220', 600);
  const refunds = async () => (await rec.sent()).filter((e) => e.e === 'iap_refund');
  assert.equal((await refunds()).length, 0);
  // The whole 600 cents refunded in the dashboard.
  ok(await webhook(env, event('charge.refunded', { id: 'ch_9', object: 'charge', payment_intent: `pi_${id}`, amount_refunded: 600 })));
  assert.deepEqual((await refunds()).map((e) => e.p), [{ product: 'flames_220', price_micros: 6_000_000, currency: 'EUR', first: 1 }]);
  // The same refund event again (and another one with the same total) reports nothing new.
  ok(await webhook(env, event('charge.refunded', { id: 'ch_9', object: 'charge', payment_intent: `pi_${id}`, amount_refunded: 600 })));
  assert.equal((await refunds()).length, 1);

  // A second purchase: a partial refund (200 of 300) is reported as its net share, the rest later on top.
  const id2 = await paidPack(env, c, 'p100', 300);
  ok(await webhook(env, event('charge.refunded', { id: 'ch_10', object: 'charge', payment_intent: `pi_${id2}`, amount_refunded: 150 })));
  ok(await webhook(env, event('charge.refunded', { id: 'ch_10', object: 'charge', payment_intent: `pi_${id2}`, amount_refunded: 300 })));
  const all = (await refunds()).map((e) => [e.p!.product, e.p!.price_micros, e.p!.first]);
  assert.deepEqual(all, [['flames_220', 6_000_000, 1], ['flames_100', 1_500_000, 0], ['flames_100', 1_500_000, 0]]);

  // A lost dispute reports the rest of the money; a won one reports nothing.
  const id3 = await paidPack(env, c, 'p480', 1200);
  ok(await webhook(env, event('charge.dispute.created', { id: 'dp_1', object: 'dispute', payment_intent: `pi_${id3}`, charge: `ch_${id3}`, reason: 'general', status: 'needs_response', balance_transactions: [{ fee: 1500 }] })));
  assert.equal((await refunds()).length, 3, 'opening a dispute alone is not a refund');
  ok(await webhook(env, event('charge.dispute.closed', { id: 'dp_1', object: 'dispute', payment_intent: `pi_${id3}`, status: 'lost' })));
  assert.deepEqual((await refunds()).at(-1)!.p, { product: 'flames_480', price_micros: 12_000_000, currency: 'EUR', first: 0 });
  const id4 = await paidPack(env, c, 'p100', 300);
  ok(await webhook(env, event('charge.dispute.created', { id: 'dp_2', object: 'dispute', payment_intent: `pi_${id4}`, charge: `ch_${id4}`, reason: 'general', status: 'needs_response', balance_transactions: [{ fee: 1500 }] })));
  ok(await webhook(env, event('charge.dispute.closed', { id: 'dp_2', object: 'dispute', payment_intent: `pi_${id4}`, status: 'won' })));
  assert.equal((await refunds()).length, 4);
  await env.app.close();
});

test('premium_buy: sent when Flames are spent on Premium (days 30), not for a repeated request, not for a refused one', async () => {
  const { env, rec } = await onShop();
  shopWorld(env);
  const c = await player(env, 'premy');
  await paidPack(env, c, 'p220', 600);
  const premium = async () => (await rec.sent()).filter((e) => e.e === 'premium_buy');
  errorOf(await c.post(`${SHOP}/spend`, spendBody('premium30', 'nope', newRequestId())), 404, 'not_found');
  assert.equal((await premium()).length, 0);
  const req = newRequestId();
  ok(await c.post(`${SHOP}/spend`, spendBody('premium30', 'w1', req)));
  ok(await c.post(`${SHOP}/spend`, spendBody('premium30', 'w1', req))); // the same request again
  assert.deepEqual((await premium()).map((e) => e.p), [{ days: 30 }]);
  await env.app.close();
});

test('Share play stats: default on, a switch in the account, nothing is sent while off, events resume when on again', async () => {
  const { env, rec } = await onShop();
  const c = await register(env.app, 'private_one');
  assert.equal((await c.get('/lobby/api/auth/me')).json<LobbyMeResponse>().account!.shareStats, true);
  assert.equal((await rec.sent()).length, 1, 'registered while on: register_done');
  const off = await c.post('/lobby/api/account/share-stats', { share: false });
  ok(off);
  assert.equal(off.json<LobbyMeResponse>().account!.shareStats, false);
  assert.equal((await c.get('/lobby/api/auth/me')).json<LobbyMeResponse>().account!.shareStats, false);
  await setAge(c);
  shopWorld(env);
  await buy(env, c, 'p220', 600);
  ok(await c.get(`${SHOP}?from=menu`));
  ok(await c.post(`${SHOP}/spend`, spendBody('premium30', 'w1', newRequestId())));
  ok(await webhook(env, event('charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: 'pi_1', amount_refunded: 600 })));
  assert.equal((await rec.sent()).length, 1, 'opted out: no iap_done, shop_open, premium_buy or iap_refund');
  ok(await c.post('/lobby/api/account/share-stats', { share: true }));
  env.clock.advance(60 * 60_000);
  ok(await c.get(`${SHOP}?from=menu`));
  assert.equal((await rec.sent()).filter((e) => e.e === 'shop_open').length, 1);
  await env.app.close();
});

test('POST /lobby/api/account/share-stats: signed in only, strict body', async () => {
  const { env } = await onShop();
  const anon = new Client(env.app);
  errorOf(await anon.post('/lobby/api/account/share-stats', { share: false }), 401, 'unauthorized');
  const c = await register(env.app, 'strict_one');
  errorOf(await c.post('/lobby/api/account/share-stats', {}), 400, 'invalid_input');
  errorOf(await c.post('/lobby/api/account/share-stats', { share: 'no' }), 400, 'invalid_input');
  errorOf(await c.post('/lobby/api/account/share-stats', { share: false, extra: 1 }), 400, 'invalid_input');
  await env.app.close();
});

test('the entry pass carries the switch (ana 1/0) to the world, and always says it', async () => {
  const { env } = await onShop();
  shopWorld(env);
  const c = await register(env.app, 'passer');
  const claims = async () => verifyPass((await c.post('/lobby/api/worlds/w1/enter')).json<EnterWorldResponse>().pass, [PUBLIC_KEY], env.clock.t);
  assert.equal((await claims()).ana, 1);
  ok(await c.post('/lobby/api/account/share-stats', { share: false }));
  assert.equal((await claims()).ana, 0);
  ok(await c.post('/lobby/api/account/share-stats', { share: true }));
  assert.equal((await claims()).ana, 1);
  await env.app.close();
});

test('NO_ANALYTICS is what dev and tests get', () => {
  assert.equal(NO_ANALYTICS.enabled, false);
});
