import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FlamesPackDto, PurchaseDto } from '@clanfire/engine';
import { buyBlocker, canBuy, countryName, countryOptions, formatEur, eurAmount, minorUsedText, needsCountry, packChargeCents, packPrice, payLabel, purchaseVatLine, rateLabel, refundedNote, rememberCountry, rememberedCountry, spendConfirmLines, isStripeCheckoutUrl, newRequestId, packBonusPercent, premiumButtonLabel, purchaseStatusLabel, shortfallText } from '../src/shop.ts';

const packs: FlamesPackDto[] = [
  { id: 'p100', flames: 100, netCents: 300, vatCents: 72, totalCents: 372, currency: 'eur' },
  { id: 'p220', flames: 220, netCents: 600, vatCents: 144, totalCents: 744, currency: 'eur' },
  { id: 'p480', flames: 480, netCents: 1200, vatCents: 288, totalCents: 1488, currency: 'eur' },
  { id: 'p1100', flames: 1100, netCents: 2500, vatCents: 600, totalCents: 3100, currency: 'eur' },
  { id: 'p3000', flames: 3000, netCents: 6000, vatCents: 1440, totalCents: 7440, currency: 'eur' },
];
const purchase = (o: Partial<PurchaseDto> = {}): PurchaseDto => ({
  id: 1, kind: 'flames', receiptNo: 'CF-000001', cardBrand: null, cardLast4: null, packId: 'p100', flames: 100, priceCents: 300, netCents: 300, vatCents: null, vatRateBp: null, vatCountry: null,
  currency: 'eur', status: 'paid', createdAt: 0, paidAt: 0, refundedFlames: 0, refundedCents: 0, ...o,
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

test('status and support-refund note', () => {
  assert.equal(purchaseStatusLabel('refunded'), 'Refunded');
  assert.equal(purchaseStatusLabel('dispute_lost'), 'Dispute lost');
  assert.equal(refundedNote(purchase()), null);
  assert.equal(refundedNote(purchase({ status: 'refunded', refundedFlames: 100, refundedCents: 372 })), '100 Flames refunded (3.72 EUR)');
});

const ee = { mode: 'stripe_tax' as const, country: 'EE', ratePercent: 24, ratesDate: '2026-11-20' };
const countries = [
  { code: 'SE', name: 'Sweden', ratePercent: 25 },
  { code: 'EE', name: 'Estonia', ratePercent: 24 },
  { code: 'FI', name: 'Finland', ratePercent: 25.5 },
];

test('VAT price lines use the server numbers', () => {
  const p = packs[0]!;
  const full = packPrice(p, ee, countries);
  assert.equal(full.kind, 'full');
  assert.equal(full.net, '3.00 EUR');
  assert.equal(full.vatLine, '+ 24% VAT (Estonia)');
  assert.equal(full.total, '3.72 EUR');
  assert.equal(full.spoken, '3.00 EUR plus 24% VAT (Estonia) is 3.72 EUR');
  assert.equal(packPrice({ ...p, vatCents: 77, totalCents: 377 }, { ...ee, country: 'FI', ratePercent: 25.5 }, countries).vatLine, '+ 25.5% VAT (Finland)');
  assert.equal(packPrice({ ...p, vatCents: 77, totalCents: 377 }, ee, countries).total, '3.77 EUR', 'never recomputed: the server total is shown');
  const out = packPrice({ ...p, vatCents: 0, totalCents: 300 }, { ...ee, country: 'XX', ratePercent: 0 }, countries);
  assert.equal(out.kind, 'no_eu_vat');
  assert.equal(out.vatLine, 'no EU VAT');
  assert.equal(out.total, '3.00 EUR');
  const none = packPrice({ ...packs[0]!, vatCents: null, totalCents: null }, { ...ee, country: null, ratePercent: null }, countries);
  assert.equal(none.kind, 'plus_vat');
  assert.equal(none.vatLine, '+ VAT');
  assert.equal(packPrice(p, { mode: 'none', country: null, ratePercent: null, ratesDate: '2026-11-20' }, []).vatLine, 'VAT: added at checkout');
});

test('pay button and country gate', () => {
  const p = packs[0]!;
  assert.equal(payLabel(p, ee), 'Pay 3.72 EUR for 100 Flames');
  assert.equal(payLabel({ ...p, vatCents: null, totalCents: null }, { ...ee, country: null, ratePercent: null }), 'Choose your country to see the full price');
  assert.equal(payLabel({ ...p, vatCents: null, totalCents: null }, { mode: 'none', country: null, ratePercent: null, ratesDate: 'x' }), 'Pay for 100 Flames');
  assert.equal(payLabel(null, ee), 'Pay');
  assert.equal(needsCountry({ ...ee, country: null }), true);
  assert.equal(needsCountry(ee), false);
  assert.equal(needsCountry({ mode: 'none', country: null, ratePercent: null, ratesDate: 'x' }), false);
  const ok = { paymentsEnabled: true, paymentsBanned: false, ageGroup: 'adult' as const, packId: 'p100', consent: true, parentConsent: false };
  assert.equal(canBuy({ ...ok, needsCountry: true }), false);
  assert.equal(canBuy({ ...ok, needsCountry: false }), true);
  assert.equal(packChargeCents(p), 372);
  assert.equal(packChargeCents({ ...p, vatCents: null, totalCents: null }), 300);
});

test('country picker options and memory', () => {
  const o = countryOptions(countries);
  assert.deepEqual(o.map((c) => c.label), ['Estonia', 'Finland', 'Sweden', 'Outside the EU']);
  assert.equal(o[3]!.code, 'XX');
  assert.equal(rateLabel(25.5), '25.5%');
  assert.equal(rateLabel(0), '0%');
  assert.equal(countryName('XX', countries), 'outside the EU');
  assert.equal(countryName('EE', countries), 'Estonia');
  const store = new Map<string, string>();
  const st = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.equal(rememberedCountry(st, countries), null);
  rememberCountry(st, 'EE');
  assert.equal(rememberedCountry(st, countries), 'EE');
  rememberCountry(st, 'ZZ');
  assert.equal(rememberedCountry(st, countries), null, 'not in the list');
  rememberCountry(st, 'XX');
  assert.equal(rememberedCountry(st, countries), 'XX');
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(rememberedCountry(broken), null);
  assert.doesNotThrow(() => rememberCountry(broken, 'EE'));
});

test('history VAT line', () => {
  assert.equal(purchaseVatLine(purchase(), countries), null);
  assert.equal(purchaseVatLine(purchase({ netCents: 300, vatCents: 72, priceCents: 372, vatCountry: 'EE', vatRateBp: 2400 }), countries), '3.00 EUR + 0.72 EUR VAT (Estonia)');
  assert.equal(purchaseVatLine(purchase({ netCents: 300, vatCents: 0, vatCountry: 'US' }), countries), '3.00 EUR, no VAT');
  assert.equal(purchaseVatLine(purchase({ kind: 'settle', vatCents: 0 }), countries), null);
});

test('spend confirmation', () => {
  const item = { id: 'premium30', kind: 'premium' as const, name: 'Premium', priceFlames: 150, eurCents: 450, days: 30 };
  const c = spendConfirmLines(item, 'World 1', 320);
  assert.equal(c.title, 'Premium for 30 days in World 1');
  assert.equal(c.price, '150 Flames (4.50 EUR + VAT)');
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
