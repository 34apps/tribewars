// Flames shop helpers (pure: unit-tested). Money is always whole euro cents. Pack prices are NET; VAT of the shown country comes on top (the server rounds it).

import type { FlamesPackDto, PurchaseDto, PurchaseStatus, ShopDisputeDto, ShopItemDto, ShopPremiumWorldDto, ShopVatDto, VatCountryDto } from '@clanfire/engine';

/** Stripe's hosted checkout is the only address the browser is ever sent to after "Buy". */
export const STRIPE_CHECKOUT_PREFIX = 'https://checkout.stripe.com/';

/** "3.00", "4.50", "1,234.00": euro cents as a plain amount (the texts add " EUR"). */
export function eurAmount(cents: number): string {
  const c = Math.round(Math.abs(cents));
  return `${cents < 0 ? '-' : ''}${Math.floor(c / 100).toLocaleString('en-US')}.${String(c % 100).padStart(2, '0')}`;
}

/** "3.00 EUR" (legal texts: amount, space, EUR). */
export function formatEur(cents: number): string {
  return `${eurAmount(cents)} EUR`;
}

/** Placeholder until the operator's address is decided (docs/legal/checkout-texts.md uses the same name). */
export const CONTACT_EMAIL = '{{contact_email}}';

/** "100 Flames" / "1 Flame" with thousands separators. */
export function flamesLabel(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'Flame' : 'Flames'}`;
}

/** The redirect is allowed only to Stripe's checkout host. */
export function isStripeCheckoutUrl(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith(STRIPE_CHECKOUT_PREFIX) && url.length > STRIPE_CHECKOUT_PREFIX.length;
}

/**
 * Extra Flames per euro of a pack relative to the smallest pack, in whole percent ("+10% Flames"); 0 when none or the
 * pack IS the smallest. Computed from the real prices, nothing invented.
 */
export function packBonusPercent(pack: FlamesPackDto, packs: readonly FlamesPackDto[]): number {
  if (packs.length === 0 || pack.netCents <= 0) return 0;
  const smallest = packs.reduce((a, b) => (b.netCents < a.netCents ? b : a), packs[0]!);
  const baseRate = smallest.flames / smallest.netCents;
  const pct = Math.round((pack.flames / pack.netCents / baseRate - 1) * 100);
  return pct > 0 ? pct : 0;
}

/** Buying needs: payments on, not banned, age group known, a pack that fits, both tick boxes (parent tick for under 18). Locked does NOT block buying. */
export interface BuyGate {
  paymentsEnabled: boolean;
  paymentsBanned: boolean;
  ageGroup: 'adult' | 'minor' | null;
  packId: string | null;
  consent: boolean;
  parentConsent: boolean;
  /** Under 18: euro cents still free this month and the chosen pack's price (the server checks again). */
  minorRemainingCents?: number;
  packCents?: number;
  /** VAT is shown by country (mode 'stripe_tax') but none is chosen yet: the full price is unknown, so paying is off. */
  needsCountry?: boolean;
}

export function canBuy(g: BuyGate): boolean {
  if (!g.paymentsEnabled || g.paymentsBanned || g.ageGroup === null || g.packId === null || !g.consent || g.needsCountry) return false;
  if (g.ageGroup === 'minor') {
    if (!g.parentConsent) return false;
    if (g.minorRemainingCents !== undefined && g.packCents !== undefined && g.packCents > g.minorRemainingCents) return false;
  }
  return true;
}

/** Euro cents an under-18 account may still buy this month. */
export function minorRemainingCents(cap: number, bought: number): number {
  return Math.max(0, cap - bought);
}

/** "12.00 of 30.00 EUR used this month" (whole euros when round: "12 of 30 EUR used this month"). */
export function minorUsedText(bought: number, cap: number): string {
  const f = (c: number) => (c % 100 === 0 ? String(c / 100) : eurAmount(c));
  return `${f(bought)} of ${f(cap)} EUR used this month`;
}

/** Why buying is off (null when possible in principle). Locked is not a reason: new Flames fill the minus. */
export function buyBlocker(g: Pick<BuyGate, 'paymentsEnabled' | 'paymentsBanned'>): string | null {
  if (g.paymentsBanned) return `Because of a second bank dispute, buying is switched off for this account. Write to ${CONTACT_EMAIL} if you think this is a mistake.`;
  if (!g.paymentsEnabled) return 'Payments are not switched on yet.';
  return null;
}

/** Plain note while paid features are locked (not a dispute banner). */
export function lockedNote(balance: number): string {
  return balance < 0
    ? 'Paid features are locked: your Flames balance is below zero. Buying Flames fills the minus first. Premium and looks work again when it is back to zero.'
    : 'Paid features are locked until your account is settled. You can keep playing the free game.';
}

/** Dispute banner text for one open dispute. */
export function disputeBannerText(d: ShopDisputeDto, openFeesCents: number): string {
  const amount = openFeesCents > 0 ? ` Open amount: ${formatEur(openFeesCents)}.` : '';
  return `A payment of ${formatEur(d.priceCents)} was disputed with your bank. ${d.flames.toLocaleString('en-US')} Flames were removed and paid features are locked.${amount}`;
}

export const SETTLED_TEXT = 'Your account is settled. Paid features are unlocked again.';

/** Open disputes first (for banners). */
export function openDisputes(disputes: readonly ShopDisputeDto[]): ShopDisputeDto[] {
  return disputes.filter((d) => d.state === 'open');
}

/** The settled banner: a dispute happened, none is open, nothing owed, and the account is unlocked. */
export function showSettled(disputes: readonly ShopDisputeDto[], openFeesCents: number, locked: boolean): boolean {
  return disputes.length > 0 && openDisputes(disputes).length === 0 && openFeesCents === 0 && !locked;
}

const STATUS_WORDS: Record<PurchaseStatus, string> = {
  pending: 'Waiting for payment',
  paid: 'Paid',
  refunded: 'Refunded',
  disputed: 'Disputed',
  dispute_lost: 'Dispute lost',
  dispute_won: 'Dispute won, paid',
  expired: 'Not completed',
};

export function purchaseStatusLabel(status: PurchaseStatus): string {
  return STATUS_WORDS[status] ?? status;
}

/** Tag colour class for a status. */
export function purchaseStatusTone(status: PurchaseStatus): 'ok' | 'bad' | 'info' | 'plain' {
  switch (status) {
    case 'paid':
    case 'dispute_won':
      return 'ok';
    case 'disputed':
    case 'dispute_lost':
      return 'bad';
    case 'refunded':
      return 'info';
    default:
      return 'plain';
  }
}

/** What a support refund took back: "100 Flames refunded (3.00 EUR)". */
export function refundedNote(p: PurchaseDto): string | null {
  return p.refundedFlames > 0 ? `${flamesLabel(p.refundedFlames)} refunded (${formatEur(p.refundedCents)})` : null;
}

/** "24%", "25.5%", "0%". */
export function rateLabel(ratePercent: number): string {
  return `${Number.isInteger(ratePercent) ? ratePercent : String(ratePercent)}%`;
}

/** The country picker's options: the lobby's EU countries by name, then "Outside the EU" ('XX'). */
export function countryOptions(countries: readonly VatCountryDto[]): { code: string; label: string }[] {
  const list = [...countries].sort((a, b) => a.name.localeCompare(b.name, 'en')).map((c) => ({ code: c.code, label: c.name }));
  return [...list, { code: OUTSIDE_EU, label: 'Outside the EU' }];
}

export const OUTSIDE_EU = 'XX';

/** Name shown for the VAT country of a price ("Estonia"); 'XX' reads "outside the EU". */
export function countryName(code: string | null, countries: readonly VatCountryDto[]): string | null {
  if (code === null) return null;
  if (code === OUTSIDE_EU) return 'outside the EU';
  return countries.find((c) => c.code === code)?.name ?? code;
}

/** What one pack card shows. All numbers come from the server (it rounds the VAT); nothing is recomputed here. */
export interface PackPrice {
  kind: 'full' | 'no_eu_vat' | 'plus_vat' | 'at_checkout';
  net: string;
  /** "+ 24% VAT (Estonia)" for kind 'full'. */
  vatLine: string | null;
  /** "3.72 EUR" for 'full'; the net price for 'no_eu_vat'. */
  total: string | null;
  /** One sentence for screen readers / the pay button. */
  spoken: string;
}

export function packPrice(pack: FlamesPackDto, vat: ShopVatDto, countries: readonly VatCountryDto[]): PackPrice {
  const net = formatEur(pack.netCents);
  if (vat.mode === 'none') return { kind: 'at_checkout', net, vatLine: 'VAT: added at checkout', total: null, spoken: `${net}, VAT added at checkout` };
  if (vat.country === null || pack.vatCents === null || pack.totalCents === null) return { kind: 'plus_vat', net, vatLine: '+ VAT', total: null, spoken: `${net} plus VAT` };
  if (vat.country === OUTSIDE_EU || vat.ratePercent === 0) return { kind: 'no_eu_vat', net, vatLine: 'no EU VAT', total: formatEur(pack.totalCents), spoken: `${formatEur(pack.totalCents)}, no EU VAT` };
  const where = countryName(vat.country, countries);
  return {
    kind: 'full',
    net,
    vatLine: `+ ${rateLabel(vat.ratePercent ?? 0)} VAT (${where})`,
    total: formatEur(pack.totalCents),
    spoken: `${net} plus ${rateLabel(vat.ratePercent ?? 0)} VAT (${where}) is ${formatEur(pack.totalCents)}`,
  };
}

/** The pay button: the full price in stripe_tax mode, a plain label when VAT comes at checkout, a hint without a country. */
export function payLabel(pack: FlamesPackDto | null, vat: ShopVatDto): string {
  if (!pack) return 'Pay';
  const flames = flamesLabel(pack.flames);
  if (vat.mode === 'none') return `Pay for ${flames}`;
  if (vat.country === null || pack.totalCents === null) return 'Choose your country to see the full price';
  return `Pay ${formatEur(pack.totalCents)} for ${flames}`;
}

/** Cents the buyer pays for a pack as far as known (total when VAT is shown, else net). */
export function packChargeCents(pack: FlamesPackDto): number {
  return pack.totalCents ?? pack.netCents;
}

/** The country is chosen by the player in stripe_tax mode only. */
export function needsCountry(vat: ShopVatDto): boolean {
  return vat.mode === 'stripe_tax' && vat.country === null;
}

export const COUNTRY_KEY = 'clanfire.shop.country';

/** A remembered country code if it is a valid choice; storage may be blocked or hold junk. */
export function rememberedCountry(storage: Pick<Storage, 'getItem'> | null | undefined, countries: readonly VatCountryDto[] | null = null): string | null {
  try {
    const v = storage?.getItem(COUNTRY_KEY) ?? null;
    if (v === null || !/^[A-Z]{2}$/.test(v)) return null;
    if (countries && v !== OUTSIDE_EU && !countries.some((c) => c.code === v)) return null;
    return v;
  } catch {
    return null;
  }
}

export function rememberCountry(storage: Pick<Storage, 'setItem'> | null | undefined, code: string): void {
  try {
    storage?.setItem(COUNTRY_KEY, code);
  } catch {
    /* private mode or blocked storage: the choice just is not remembered */
  }
}

/** History row: "2.50 EUR + 0.60 EUR VAT (Estonia)" when the VAT is known, else null. */
export function purchaseVatLine(p: PurchaseDto, countries: readonly VatCountryDto[]): string | null {
  if (p.kind !== 'flames' || p.vatCents === null) return null;
  if (p.vatCents === 0) return `${formatEur(p.netCents)}, no VAT`;
  const where = countryName(p.vatCountry, countries);
  return `${formatEur(p.netCents)} + ${formatEur(p.vatCents)} VAT${where ? ` (${where})` : ''}`;
}

/** History row title: "100 Flames" or "Account settlement". */
export function purchaseTitle(p: PurchaseDto): string {
  return p.kind === 'settle' ? 'Account settlement' : flamesLabel(p.flames);
}

/** The exact spend confirmation, as lines (legal texts section 4). */
export function spendConfirmLines(item: ShopItemDto, worldName: string | undefined, balance: number): { title: string; price: string; body: string[]; button: string } {
  const price = `${item.priceFlames.toLocaleString('en-US')} Flames (${formatEur(item.eurCents)} + VAT)`;
  const left = `Spending Flames ends your right of withdrawal for them. Flames left after this: ${(balance - item.priceFlames).toLocaleString('en-US')}.`;
  if (item.kind === 'premium') {
    return {
      title: `Premium for ${item.days ?? 30} days in ${worldName ?? 'this world'}`,
      price,
      body: ['It starts now and ends after 30 days. It does not renew by itself.'.replace('30', String(item.days ?? 30)), left],
      button: `Spend ${item.priceFlames.toLocaleString('en-US')} Flames`,
    };
  }
  return {
    title: item.name,
    price,
    body: ['This look is yours as long as your account exists. ' + left],
    button: `Spend ${item.priceFlames.toLocaleString('en-US')} Flames`,
  };
}

/** Day, month name, year: "20 Nov 2026". */
export function shopDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Premium of one world: "Active until 12 Dec 2026" or "Not active". */
export function premiumStatus(w: ShopPremiumWorldDto, now: number): string {
  return w.until > now ? `Active until ${shopDate(w.until)}` : 'Not active';
}

/** The spend button: "Add 30 days" or, when active, "Add 30 days (extends from 12 Dec 2026)". */
export function premiumButtonLabel(w: ShopPremiumWorldDto | undefined, days: number, now: number): string {
  return w && w.until > now ? `Add ${days} days, extends from ${shopDate(w.until)}` : `Add ${days} days`;
}

/** "You need 40 more Flames", or null when the balance covers the price. */
export function shortfallText(balance: number, price: number): string | null {
  return balance >= price ? null : `You need ${(price - balance).toLocaleString('en-US')} more Flames`;
}

/** A fresh spend id: 24 url-safe characters from the browser's secure random source. */
export function newRequestId(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  return Array.from(rand(24), (b) => abc[b & 63]).join('');
}
