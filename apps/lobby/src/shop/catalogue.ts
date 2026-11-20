// The Flames shop catalogue: the ONLY source of packs, prices and items (docs/PAYMENTS_PLAN.md). The client never sends a price.

import type { FlamesPackDto, ShopItemDto } from '@clanfire/engine';

/** A pack as sold: the price is NET (without VAT); the shop adds the VAT of the shown country on top. */
export type CataloguePack = Omit<FlamesPackDto, 'vatCents' | 'totalCents'>;

/** Euro cents are NET, VAT comes on top (owner, 2026-11-20). Currency is always eur. */
export const PACKS: readonly CataloguePack[] = [
  { id: 'p100', flames: 100, netCents: 300, currency: 'eur' },
  { id: 'p220', flames: 220, netCents: 600, currency: 'eur' },
  { id: 'p480', flames: 480, netCents: 1200, currency: 'eur' },
  { id: 'p1100', flames: 1100, netCents: 2500, currency: 'eur' },
  { id: 'p3000', flames: 3000, netCents: 6000, currency: 'eur' },
];

export function findPack(id: string): CataloguePack | undefined {
  return PACKS.find((p) => p.id === id);
}

/** Version of the shop terms the checkout tick box refers to. Bump it when they change. */
export const TERMS_VERSION = '2026-11-20-v2';
/** Exact text of the required tick box at checkout (stored with every purchase as the consent record). */
export const CONSENT_TEXT = 'I want my Flames delivered now. I understand that I lose my 14-day right of withdrawal once they are delivered.';
/** Small text under the tick box. */
export const CONSENT_NOTE = 'Your Flames are delivered as soon as the payment is confirmed. If something goes wrong, write to support.';
/** Second required tick box for accounts under 18 (stored as its own consent row). */
export const PARENT_CONSENT_TEXT = "I am a parent or guardian, or I have my parent's or guardian's consent to buy Flames.";
/** Under-18 purchases per calendar month (UTC), NET euro cents. */
export const MINOR_MONTHLY_CAP_CENTS = 3000;
/** Dispute fees: handling fee (not charged when the bank's reason is fraud) and the provider fee used when Stripe gives none. */
export const HANDLING_FEE_CENTS = 400;
export const DISPUTE_FEE_FALLBACK_CENTS = 2000;
export const PREMIUM_DAYS = 30;
export const DAY_MS = 24 * 3_600_000;

export const PREMIUM_ITEM_ID = 'premium30';
export const PREMIUM_PRICE_FLAMES = 150;

/** The smallest pack's rate: euro cents per 100 Flames. The euro value shown next to a Flames price uses it (EU rule). */
const BASE_CENTS_PER_100 = 300;

/** Euro value of an amount of Flames, in cents, at the smallest pack's rate. */
export function eurCentsOf(flames: number): number {
  return Math.round((flames * BASE_CENTS_PER_100) / 100);
}

export interface ShopLook {
  id: string;
  name: string;
  priceFlames: number;
}

/** Looks for sale (GAME_DESIGN 18.6). Empty until the first set exists; tests inject some through buildApp. */
export const LOOKS: readonly ShopLook[] = [];

export type ShopCatalogueItem = Omit<ShopItemDto, 'owned'>;

export function premiumItem(): ShopCatalogueItem {
  return { id: PREMIUM_ITEM_ID, kind: 'premium', name: `Premium, ${PREMIUM_DAYS} days`, priceFlames: PREMIUM_PRICE_FLAMES, eurCents: eurCentsOf(PREMIUM_PRICE_FLAMES), days: PREMIUM_DAYS };
}

export function lookItem(l: ShopLook): ShopCatalogueItem {
  return { id: l.id, kind: 'look', name: l.name, priceFlames: l.priceFlames, eurCents: eurCentsOf(l.priceFlames) };
}
