import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FlamesPackDto, PurchaseDto } from '@clanfire/engine';
import { buyBlocker, canBuy, canRefund, formatEur, eurAmount, minorUsedText, refundBlockText, spendConfirmLines, isStripeCheckoutUrl, newRequestId, packBonusPercent, premiumButtonLabel, purchaseStatusLabel, refundConfirmText, shortfallText } from '../src/shop.ts';

const packs: FlamesPackDto[] = [
  { id: 'p100', flames: 100, priceCents: 300, currency: 'eur' },
  { id: 'p220', flames: 220, priceCents: 600, currency: 'eur' },
  { id: 'p480', flames: 480, priceCents: 1200, currency: 'eur' },
  { id: 'p1100', flames: 1100, priceCents: 2500, currency: 'eur' },
  { id: 'p3000', flames: 3000, priceCents: 6000, currency: 'eur' },
];
const purchase = (o: Partial<PurchaseDto> = {}): PurchaseDto => ({
  id: 1, kind: 'flames', receiptNo: 'CF-000001', cardBrand: null, cardLast4: null, refundBlock: null, packId: 'p100', flames: 100, priceCents: 300, currency: 'eur', status: 'paid', createdAt: 0, paidAt: 0,
  refundableFlames: 100, refundableCents: 300, refundUntil: 1000, refundedFlames: 0, refundedCents: 0, ...o,
});

test('euro formatting', () => {
  assert.equal(formatEur(300), '3.00 EUR');
  assert.equal(formatEur(450), '4.50 EUR');
  assert.equal(eurAmount(5), '0.05');
  assert.equal(eurAmount(123400), '1,234.00');
  assert.equal(minorUsedText(1200, 3000), '12 of 30 EUR used this month');
});

test('pack value is computed against the smallest pack', () => {
  assert.equal(packBonusPercent(packs[0]!, packs), 0);
  assert.equal(packBonusPercent(packs[1]!, packs), 10);
  assert.equal(packBonusPercent(packs[2]!, packs), 20);
  assert.equal(packBonusPercent(packs[3]!, packs), 32);
  assert.equal(packBonusPercent(packs[4]!, packs), 50);
  assert.equal(packBonusPercent(packs[0]!, []), 0);
});

test('consent gating', () => {
  const ok = { paymentsEnabled: true, paymentsBanned: false, ageGroup: 'adult' as const, packId: 'p100', consent: true, parentConsent: false };
  assert.equal(canBuy(ok), true);
  assert.equal(canBuy({ ...ok, consent: false }), false);
  assert.equal(canBuy({ ...ok, packId: null }), false);
  assert.equal(canBuy({ ...ok, ageGroup: null }), false);
  assert.equal(canBuy({ ...ok, paymentsBanned: true }), false);
  assert.equal(canBuy({ ...ok, paymentsEnabled: false }), false);
  const kid = { ...ok, ageGroup: 'minor' as const, minorRemainingCents: 1000, packCents: 600 };
  assert.equal(canBuy(kid), false, 'parent tick missing');
  assert.equal(canBuy({ ...kid, parentConsent: true }), true);
  assert.equal(canBuy({ ...kid, parentConsent: true, packCents: 1200 }), false, 'over the monthly cap');
  assert.equal(buyBlocker(ok), null);
  assert.match(buyBlocker({ ...ok, paymentsBanned: true })!, /second bank dispute/);
  assert.match(buyBlocker({ ...ok, paymentsEnabled: false })!, /not switched on/);
});

test('redirect only to Stripe checkout', () => {
  assert.equal(isStripeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_1'), true);
  assert.equal(isStripeCheckoutUrl('https://checkout.stripe.com.evil.com/x'), false);
  assert.equal(isStripeCheckoutUrl('http://checkout.stripe.com/x'), false);
  assert.equal(isStripeCheckoutUrl('https://checkout.stripe.com/'), false);
  assert.equal(isStripeCheckoutUrl(undefined), false);
});

test('refund texts and window', () => {
  const p = purchase({ cardBrand: 'Visa', cardLast4: '4242' });
  assert.match(refundConfirmText(p), /^Refund 3\.00 EUR to your Visa ending 4242\? The 100 Flames from this purchase will be removed/);
  assert.equal(canRefund(p, 500), true);
  assert.equal(canRefund(p, 1001), false);
  assert.equal(canRefund(purchase({ refundableFlames: 0, refundBlock: 'spent' }), 500), false);
  assert.equal(canRefund(purchase({ status: 'refunded' }), 500), false);
  assert.match(refundBlockText(purchase({ refundBlock: 'spent' }))!, /some of its Flames have been spent/);
  assert.match(refundBlockText(purchase({ refundBlock: 'too_late' }))!, /14-day refund time/);
  assert.equal(refundBlockText(p), null);
  assert.equal(purchaseStatusLabel('refunded'), 'Refunded');
  assert.equal(purchaseStatusLabel('dispute_lost'), 'Dispute lost');
});

test('spend confirmation', () => {
  const item = { id: 'premium30', kind: 'premium' as const, name: 'Premium', priceFlames: 150, eurCents: 450, days: 30 };
  const c = spendConfirmLines(item, 'World 1', 320);
  assert.equal(c.title, 'Premium for 30 days in World 1');
  assert.equal(c.price, '150 Flames (4.50 EUR)');
  assert.match(c.body.join(' '), /does not renew by itself/);
  assert.match(c.body.join(' '), /Flames left after this: 170\./);
  assert.equal(c.button, 'Spend 150 Flames');
});

test('spend labels', () => {
  assert.equal(shortfallText(320, 150), null);
  assert.equal(shortfallText(110, 150), 'You need 40 more Flames');
  assert.equal(premiumButtonLabel(undefined, 30, 1), 'Add 30 days');
  assert.match(premiumButtonLabel({ worldId: 'w', worldName: 'W', until: Date.UTC(2026, 11, 12) }, 30, 1), /^Add 30 days, extends from 12 Dec 2026$/);
});

test('request ids are url-safe and long enough', () => {
  const a = newRequestId();
  assert.match(a, /^[A-Za-z0-9_-]{16,64}$/);
  assert.notEqual(a, newRequestId());
});
