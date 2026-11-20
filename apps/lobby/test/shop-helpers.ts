import assert from 'node:assert/strict';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { ShopCheckoutResponse, ShopResponse } from '@clanfire/engine';
import type { BuildAppOptions } from '../src/app.ts';
import { TERMS_VERSION } from '../src/shop/catalogue.ts';
import { PaymentError, type CheckoutRequest, type PaymentGateway } from '../src/shop/gateway.ts';
import { signWebhook } from '../src/shop/webhook-signature.ts';
import { HOST, addWorld, makeApp, ok, register, type Client, type Clock } from './helpers.ts';

export const WHSEC = 'whsec_testsecret0123456789';
export const PUBLIC_URL = 'https://clanflame.test';
export const DAY = 24 * 3_600_000;

export class FakeGateway implements PaymentGateway {
  sessions: CheckoutRequest[] = [];
  refunds: { paymentIntentId: string; amountCents: number; key: string }[] = [];
  evidence: { disputeId: string; evidence: Record<string, string> }[] = [];
  failRefund = false;
  failEvidence = false;
  failCheckout = false;

  async createCheckout(req: CheckoutRequest): Promise<{ id: string; url: string }> {
    if (this.failCheckout) throw new PaymentError('Stripe /checkout/sessions: HTTP 500 api_error');
    this.sessions.push(req);
    return { id: `cs_test_${req.purchaseId}`, url: `https://checkout.stripe.com/c/pay/cs_test_${req.purchaseId}` };
  }
  async refund(paymentIntentId: string, amountCents: number, key: string): Promise<{ id: string }> {
    if (this.failRefund) throw new PaymentError('Stripe /refunds: HTTP 402 card_error');
    this.refunds.push({ paymentIntentId, amountCents, key });
    return { id: `re_${this.refunds.length}` };
  }
  async submitDisputeEvidence(disputeId: string, evidence: Record<string, string>): Promise<void> {
    if (this.failEvidence) throw new PaymentError('Stripe /disputes: HTTP 500 api_error');
    this.evidence.push({ disputeId, evidence });
  }
}

export interface ShopEnv {
  app: FastifyInstance;
  clock: Clock;
  gw: FakeGateway;
  alerts: string[];
}

export async function makeShopApp(over: Partial<BuildAppOptions> = {}): Promise<ShopEnv> {
  const gw = new FakeGateway();
  const alerts: string[] = [];
  const { app, clock } = await makeApp({ payments: gw, webhookSecret: WHSEC, publicUrl: PUBLIC_URL, notify: async (t) => void alerts.push(t), ...over });
  return { app, clock, gw, alerts };
}

let evtCounter = 0;
export const event = (type: string, object: Record<string, unknown>, id = `evt_${++evtCounter}`) => ({ id, type, data: { object } });

/** POST a signed event to the webhook (as Stripe would: no cookie, no Origin). */
export async function webhook(env: Pick<ShopEnv, 'app' | 'clock'>, ev: unknown, opts: { secret?: string; t?: number; raw?: string; header?: string | null } = {}): Promise<LightMyRequestResponse> {
  const raw = opts.raw ?? JSON.stringify(ev);
  const t = opts.t ?? Math.floor(env.clock.t / 1000);
  const headers: Record<string, string> = { host: HOST, 'content-type': 'application/json' };
  if (opts.header !== null) headers['stripe-signature'] = opts.header ?? signWebhook(raw, opts.secret ?? WHSEC, t);
  return env.app.inject({ method: 'POST', url: '/lobby/api/stripe/webhook', headers, payload: raw, remoteAddress: '203.0.113.9' });
}

export const sessionPaid = (purchaseId: number, amountCents: number, extra: Record<string, unknown> = {}) =>
  event('checkout.session.completed', {
    id: `cs_test_${purchaseId}`,
    object: 'checkout.session',
    payment_status: 'paid',
    amount_total: amountCents,
    currency: 'eur',
    payment_intent: `pi_${purchaseId}`,
    client_reference_id: String(purchaseId),
    customer_details: { email: 'buyer@example.com', address: { country: 'DE' } },
    ...extra,
  });

export const checkoutBody = (packId: string, extra: Record<string, unknown> = {}) => ({ packId, consent: true, termsVersion: TERMS_VERSION, ...extra });

export async function setAge(c: Client, ageGroup: 'adult' | 'minor' = 'adult'): Promise<void> {
  ok(await c.post('/lobby/api/shop/age', { ageGroup }));
}

/** Check out a pack and complete the payment through the webhook. Returns the purchase id. */
export async function buy(env: ShopEnv, c: Client, packId = 'p100', priceCents = 300): Promise<number> {
  const before = env.gw.sessions.length;
  ok(await c.post('/lobby/api/shop/checkout', checkoutBody(packId, { parentConsent: true })));
  const req = env.gw.sessions[before];
  assert.ok(req, 'a checkout session was created');
  ok(await webhook(env, sessionPaid(req.purchaseId, priceCents)));
  return req.purchaseId;
}

export async function shopOf(c: Client): Promise<ShopResponse> {
  const res = await c.get('/lobby/api/shop');
  ok(res);
  return res.json<ShopResponse>();
}

export async function player(env: ShopEnv, name: string, ageGroup: 'adult' | 'minor' | null = 'adult'): Promise<Client> {
  const c = await register(env.app, name);
  if (ageGroup) await setAge(c, ageGroup);
  return c;
}

export const spendBody = (itemId: string, worldId: string | undefined, requestId: string) => ({ itemId, ...(worldId ? { worldId } : {}), requestId });
let reqCounter = 0;
export const newRequestId = (): string => `req_${String(++reqCounter).padStart(14, '0')}`;

export function shopWorld(env: ShopEnv, id = 'w1', status: 'open' | 'full' | 'closed' | 'finished' = 'open'): void {
  addWorld(env.app, id, `World ${id}`, status);
  env.app.ctx.store.setWorldShopPremium(id, true);
}

export type { ShopCheckoutResponse };
