// The Flames shop rules: checkout, spending, refunds, the Stripe webhook effects, disputes and dispute fees.
// Money rules (docs/PAYMENTS_PLAN.md, docs/legal/refunds.md): the ledger is the balance; ledger and state first, the provider second,
// and every provider failure is compensated; every webhook event is processed once (event row in the same transaction as its effects).

import {
  GameError,
  SHOP_PURCHASES_MAX,
  type PurchaseDto,
  type ShopAgeRequest,
  type ShopBalanceResponse,
  type ShopCheckoutRequest,
  type ShopDisputeDto,
  type ShopItemDto,
  type ShopResponse,
  type ShopSpendRequest,
} from '@clanfire/engine';
import type { AccountRow, Store } from '../store.ts';
import {
  CONSENT_NOTE,
  CONSENT_TEXT,
  DAY_MS,
  DISPUTE_FEE_FALLBACK_CENTS,
  HANDLING_FEE_CENTS,
  LOOKS,
  MINOR_MONTHLY_CAP_CENTS,
  PACKS,
  PARENT_CONSENT_TEXT,
  PREMIUM_DAYS,
  PREMIUM_ITEM_ID,
  PREMIUM_PRICE_FLAMES,
  REFUND_DAYS,
  TERMS_VERSION,
  findPack,
  lookItem,
  premiumItem,
  type ShopLook,
} from './catalogue.ts';
import { PaymentError, type PaymentGateway } from './gateway.ts';
import { ShopStore, type PurchaseRow } from './store.ts';

export interface ShopLog {
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
}

export interface ShopServiceOptions {
  store: Store;
  now: () => number;
  /** null = payments are off (no Stripe keys). */
  gateway: PaymentGateway | null;
  /** scheme://host, for the Stripe return URLs. */
  publicUrl: string | null;
  looks?: readonly ShopLook[];
  log: ShopLog;
  /** Owner alert (ALERT_WEBHOOK_URL). Failures are swallowed. */
  notify?: (text: string) => Promise<void>;
}

/** A Stripe checkout page is open this long (Stripe's minimum is 30 minutes from its receipt of the request). */
export const CHECKOUT_EXPIRES_MS = 31 * 60_000;
export const PENDING_MAX = 5;
export const PENDING_WINDOW_MS = 30 * 60_000;
export const DISPUTE_RATE_ALERT = 0.005;
export const DISPUTES_SHOWN = 10;
const EVIDENCE_FIELD_MAX = 20_000;

export const receiptNo = (id: number): string => `CF-${String(id).padStart(6, '0')}`;
const fail = (code: ConstructorParameters<typeof GameError>[0], message: string): never => {
  throw new GameError(code, message);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** UTC calendar month of a moment: [from, to) and "YYYY-MM". */
export function monthOf(t: number): { from: number; to: number; key: string } {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return { from: Date.UTC(y, m, 1), to: Date.UTC(y, m + 1, 1), key: `${y}-${String(m + 1).padStart(2, '0')}` };
}

export function monthFromKey(key: string): { from: number; to: number; key: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return monthOf(Date.UTC(Number(m[1]), month - 1, 15));
}

export interface EventResult {
  /** The event id was seen before: nothing was changed. */
  duplicate: boolean;
  /** Work for after the commit (provider calls); each catches its own errors. */
  after: (() => Promise<void>)[];
}

export class ShopService {
  readonly shop: ShopStore;
  private readonly store: Store;
  private readonly now: () => number;
  private readonly gateway: PaymentGateway | null;
  private readonly publicUrl: string | null;
  private readonly looks: readonly ShopLook[];
  private readonly log: ShopLog;
  private readonly notify: (text: string) => Promise<void>;

  constructor(o: ShopServiceOptions) {
    this.store = o.store;
    this.shop = new ShopStore(o.store);
    this.now = o.now;
    this.gateway = o.gateway;
    this.publicUrl = o.publicUrl;
    this.looks = o.looks ?? LOOKS;
    this.log = o.log;
    this.notify = o.notify ?? (async () => {});
  }

  get paymentsEnabled(): boolean {
    return this.gateway !== null && this.publicUrl !== null;
  }

  private audit(account: AccountRow | null, accountId: number | null, ip: string | null, action: string, detail: string): void {
    this.store.audit({ at: this.now(), actorId: account?.id ?? null, actorIp: ip, action, targetAccount: accountId, detail });
  }

  // ---- state helpers -------------------------------------------------------------------------------------

  /** Locked = the balance is below zero OR dispute fees are open. Locked: nothing can be spent and Premium is not passed to worlds. */
  isLocked(accountId: number): boolean {
    return this.shop.balance(accountId) < 0 || this.shop.openFeesCents(accountId) > 0;
  }

  /** The `prm` claim of an entry pass: this account's Premium in this world, 0 when none or locked. */
  premiumClaim(accountId: number, worldId: string, now: number): number {
    const until = this.shop.premiumUntil(accountId, worldId);
    if (until <= now || this.isLocked(accountId)) return 0;
    return until;
  }

  /** Flames of a purchase that are still unspent. Flames are spent oldest first, so what is left of the balance after the later credits belongs to it. */
  private unspentOf(p: PurchaseRow, balance: number): number {
    const creditId = this.shop.purchaseCreditId(p.id);
    if (creditId === null) return 0;
    return clamp(balance - this.shop.creditsAfter(p.accountId, creditId, p.id), 0, p.flames - p.refundedFlames);
  }

  /** A refund covers the whole purchase and only when none of its Flames is spent, within 14 days of payment. */
  private refundInfo(p: PurchaseRow, now: number, balance: number): { flames: number; cents: number; block: 'spent' | 'too_late' | null } {
    if (p.kind !== 'flames' || p.status !== 'paid' || p.paidAt === null) return { flames: 0, cents: 0, block: null };
    if (now > p.paidAt + REFUND_DAYS * DAY_MS) return { flames: 0, cents: 0, block: 'too_late' };
    if (p.refundedFlames > 0 || this.unspentOf(p, balance) < p.flames) return { flames: 0, cents: 0, block: 'spent' };
    return { flames: p.flames, cents: p.priceCents, block: null };
  }

  private purchaseDto(p: PurchaseRow, now: number, balance: number): PurchaseDto {
    const r = this.refundInfo(p, now, balance);
    return {
      id: p.id,
      kind: p.kind,
      receiptNo: receiptNo(p.id),
      packId: p.packId,
      flames: p.flames,
      priceCents: p.priceCents,
      currency: 'eur',
      status: p.status,
      createdAt: p.createdAt,
      paidAt: p.paidAt,
      cardBrand: p.cardBrand,
      cardLast4: p.cardLast4,
      refundableFlames: r.flames,
      refundableCents: r.cents,
      refundBlock: r.block,
      refundUntil: p.paidAt === null ? null : p.paidAt + REFUND_DAYS * DAY_MS,
      refundedFlames: p.refundedFlames,
      refundedCents: p.refundedCents,
    };
  }

  private catalogue(): ShopItemDto[] {
    return [premiumItem(), ...this.looks.map(lookItem)];
  }

  private minorBoughtThisMonth(accountId: number, now: number): number {
    const m = monthOf(now);
    return this.shop.packCentsInRange(accountId, m.from, m.to, now - PENDING_WINDOW_MS);
  }

  // ---- reads ---------------------------------------------------------------------------------------------

  balance(account: AccountRow): ShopBalanceResponse {
    return { balance: this.shop.balance(account.id), locked: this.isLocked(account.id) };
  }

  response(account: AccountRow): ShopResponse {
    const now = this.now();
    const fresh = this.store.getAccount(account.id) ?? account;
    const balance = this.shop.balance(fresh.id);
    const owned = this.shop.ownedItems(fresh.id);
    const premiumWorlds = this.store
      .listWorlds()
      .filter((w) => w.shopPremium && (w.status === 'open' || (w.status === 'full' && this.shop.hasEntered(fresh.id, w.id))))
      .map((w) => ({ worldId: w.id, worldName: w.name, until: this.shop.premiumUntil(fresh.id, w.id) }));
    const purchases = this.shop
      .listPurchases(fresh.id, SHOP_PURCHASES_MAX * 2)
      .filter((p) => p.status !== 'expired' && !(p.status === 'pending' && now - p.createdAt > PENDING_WINDOW_MS))
      .slice(0, SHOP_PURCHASES_MAX);
    const disputes: ShopDisputeDto[] = purchases
      .filter((p) => p.disputeId !== null)
      .slice(0, DISPUTES_SHOWN)
      .map((p) => ({
        purchaseId: p.id,
        receiptNo: receiptNo(p.id),
        priceCents: p.priceCents,
        flames: p.flames,
        state: p.status === 'dispute_won' ? 'won' : p.status === 'dispute_lost' ? 'lost' : 'open',
        openedAt: p.disputedAt ?? p.createdAt,
      }));
    const openFeesCents = this.shop.openFeesCents(fresh.id);
    return {
      balance,
      locked: balance < 0 || openFeesCents > 0,
      openFeesCents,
      disputes,
      ageGroup: fresh.ageGroup,
      minorMonthlyCapCents: MINOR_MONTHLY_CAP_CENTS,
      minorBoughtThisMonthCents: this.minorBoughtThisMonth(fresh.id, now),
      paymentsBanned: fresh.payBannedAt !== null,
      paymentsEnabled: this.paymentsEnabled,
      packs: PACKS.map((p) => ({ ...p })),
      items: this.catalogue().map((i) => (i.kind === 'look' ? { ...i, owned: owned.has(i.id) } : i)),
      premiumWorlds,
      purchases: purchases.map((p) => this.purchaseDto(p, now, balance)),
      consentText: CONSENT_TEXT,
      consentNote: CONSENT_NOTE,
      parentConsentText: PARENT_CONSENT_TEXT,
      termsVersion: TERMS_VERSION,
      refundDays: REFUND_DAYS,
    };
  }

  // ---- age group -------------------------------------------------------------------------------------------

  setAge(account: AccountRow, req: ShopAgeRequest, ip: string): ShopResponse {
    this.store.tx(() => {
      const fresh = this.store.getAccount(account.id);
      if (!fresh) return fail('not_found', 'No such account.');
      if (fresh.ageGroup !== null) return fail('too_late', 'Your age group is already set. Write to support if it is wrong.');
      this.shop.setAgeGroup(fresh.id, req.ageGroup);
      this.audit(fresh, fresh.id, ip, 'shop_age_group', req.ageGroup);
    });
    return this.response(account);
  }

  // ---- checkout ----------------------------------------------------------------------------------------------

  private requirePayments(): PaymentGateway {
    if (!this.gateway || !this.publicUrl) return fail('forbidden', 'Buying Flames is not switched on yet.');
    return this.gateway;
  }

  private async startSession(p: PurchaseRow, account: AccountRow, ip: string): Promise<{ url: string }> {
    const gateway = this.requirePayments();
    const base = this.publicUrl as string;
    try {
      const s = await gateway.createCheckout({
        purchaseId: p.id,
        accountId: account.id,
        kind: p.kind,
        packId: p.packId,
        flames: p.flames,
        amountCents: p.priceCents,
        successUrl: `${base}/lobby/#shop-paid`,
        cancelUrl: `${base}/lobby/#shop`,
        expiresAtSec: Math.floor((this.now() + CHECKOUT_EXPIRES_MS) / 1000),
      });
      this.shop.updatePurchase(p.id, { checkoutSessionId: s.id });
      return { url: s.url };
    } catch (err) {
      this.log.error({ purchase: p.id, problem: err instanceof PaymentError ? err.message : 'unexpected error' }, 'checkout session could not be created');
      this.shop.updatePurchase(p.id, { status: 'expired' });
      this.audit(account, account.id, ip, 'shop_checkout_failed', `purchase ${p.id}`);
      return fail('internal_error', 'Payments are temporarily unavailable. Please try again later.');
    }
  }

  async checkout(account: AccountRow, req: ShopCheckoutRequest, ip: string, userAgent: string): Promise<{ url: string }> {
    this.requirePayments();
    const now = this.now();
    const fresh = this.store.getAccount(account.id) ?? account;
    // Buying is allowed while locked: new Flames fill the minus first. A payments ban blocks buying.
    if (fresh.payBannedAt !== null) fail('forbidden', 'Buying Flames is switched off for this account. Write to support if you think this is a mistake.');
    if (fresh.ageGroup === null) fail('forbidden', 'Please tell us first whether you are 18 or older.');
    const pack = findPack(req.packId);
    if (!pack) fail('invalid_input', 'Unknown Flames pack.');
    if (req.consent !== true) fail('invalid_input', 'Please tick the box to confirm that you want your Flames now.');
    if (fresh.ageGroup === 'minor' && req.parentConsent !== true) fail('invalid_input', 'Please tick the box to confirm that a parent or guardian agrees.');
    if (req.termsVersion !== TERMS_VERSION) fail('too_late', 'The terms have changed. Please reload the shop and read them again.');
    const p = this.store.tx(() => {
      if (fresh.ageGroup === 'minor' && this.minorBoughtThisMonth(fresh.id, now) + (pack?.priceCents ?? 0) > MINOR_MONTHLY_CAP_CENTS) {
        fail('not_enough_resources', `Accounts under 18 can buy up to ${MINOR_MONTHLY_CAP_CENTS / 100} EUR of Flames per month. Try again next month.`);
      }
      if (this.shop.countPendingSince(fresh.id, now - PENDING_WINDOW_MS) >= PENDING_MAX) {
        fail('rate_limited', 'You have several unfinished payments. Finish or wait for them to expire, then try again.');
      }
      const consentId = this.shop.insertConsent({ accountId: fresh.id, at: now, ip: ip.slice(0, 64), termsVersion: TERMS_VERSION, kind: 'withdrawal_waiver', text: CONSENT_TEXT });
      const parentId = fresh.ageGroup === 'minor' ? this.shop.insertConsent({ accountId: fresh.id, at: now, ip: ip.slice(0, 64), termsVersion: TERMS_VERSION, kind: 'parent_consent', text: PARENT_CONSENT_TEXT }) : null;
      const id = this.shop.insertPurchase({ accountId: fresh.id, kind: 'flames', packId: pack!.id, flames: pack!.flames, priceCents: pack!.priceCents, ip, userAgent, consentId, createdAt: now });
      this.shop.setConsentPurchase(consentId, id);
      if (parentId !== null) this.shop.setConsentPurchase(parentId, id);
      this.audit(fresh, fresh.id, ip, 'shop_checkout', `purchase ${id} ${pack!.id} ${pack!.priceCents} eur`);
      return this.shop.getPurchase(id) as PurchaseRow;
    });
    return this.startSession(p, fresh, ip);
  }

  /** Pay the open dispute fees with a normal Stripe checkout. Allowed even when buying is banned. */
  async settle(account: AccountRow, ip: string, userAgent: string): Promise<{ url: string }> {
    this.requirePayments();
    const now = this.now();
    const p = this.store.tx(() => {
      const cents = this.shop.openFeesCents(account.id);
      if (cents <= 0) fail('too_late', 'There is nothing to settle.');
      if (this.shop.countPendingSince(account.id, now - PENDING_WINDOW_MS) >= PENDING_MAX) {
        fail('rate_limited', 'You have several unfinished payments. Finish or wait for them to expire, then try again.');
      }
      const id = this.shop.insertPurchase({ accountId: account.id, kind: 'settle', packId: '', flames: 0, priceCents: cents, ip, userAgent, consentId: null, createdAt: now });
      this.shop.bindOpenFees(account.id, id);
      this.audit(account, account.id, ip, 'shop_settle_checkout', `purchase ${id} ${cents} eur`);
      return this.shop.getPurchase(id) as PurchaseRow;
    });
    return this.startSession(p, account, ip);
  }

  // ---- spending ------------------------------------------------------------------------------------------------

  spend(account: AccountRow, req: ShopSpendRequest, ip: string): ShopResponse {
    const now = this.now();
    this.store.tx(() => {
      const prior = this.shop.ledgerByRequest(account.id, req.requestId);
      if (prior) {
        // The same request again: the answer is the same, nothing is spent twice.
        if (prior.itemId !== req.itemId || (prior.worldId ?? undefined) !== req.worldId) fail('invalid_input', 'This request id was already used for something else.');
        return;
      }
      if (this.isLocked(account.id)) fail('forbidden', 'Your account is locked: settle the open amount or buy Flames to fill the minus first.');
      const item = this.catalogue().find((i) => i.id === req.itemId);
      if (!item) return fail('not_found', 'No such item.');
      let worldId: string | null = null;
      if (item.kind === 'premium') {
        if (!req.worldId) return fail('invalid_input', 'Choose the world for your Premium.');
        const world = this.store.getWorld(req.worldId);
        if (!world) return fail('not_found', 'No such world.');
        if (!world.shopPremium) return fail('forbidden', 'This world does not sell Premium.');
        const allowed = world.status === 'open' || (world.status === 'full' && this.shop.hasEntered(account.id, world.id));
        if (!allowed) return fail('forbidden', 'Premium can not be bought for this world now.');
        worldId = world.id;
      } else {
        if (req.worldId !== undefined) return fail('invalid_input', 'A look is not bought for a world.');
        if (this.shop.hasItem(account.id, item.id)) return fail('invalid_input', 'You already own this look.');
      }
      if (this.shop.balance(account.id) < item.priceFlames) return fail('not_enough_resources', 'You do not have enough Flames.');
      this.shop.addLedger({ accountId: account.id, at: now, delta: -item.priceFlames, reason: 'spend', worldId, itemId: item.id, requestId: req.requestId });
      if (item.kind === 'premium' && worldId !== null) {
        const until = Math.max(this.shop.premiumUntil(account.id, worldId), now) + PREMIUM_DAYS * DAY_MS;
        this.shop.setPremiumUntil(account.id, worldId, until);
      } else {
        this.shop.addItem(account.id, item.id, now);
      }
      this.audit(account, account.id, ip, 'shop_spend', `${item.id} ${item.priceFlames} flames${worldId ? ` world ${worldId}` : ''}`);
    });
    return this.response(account);
  }

  // ---- refund ----------------------------------------------------------------------------------------------------

  async refund(account: AccountRow, purchaseId: number, ip: string): Promise<ShopResponse> {
    const gateway = this.requirePayments();
    const now = this.now();
    const done = this.store.tx(() => {
      const p = this.shop.getPurchase(purchaseId);
      if (!p || p.accountId !== account.id) return fail('not_found', 'No such purchase.');
      const balance = this.shop.balance(account.id);
      const r = this.refundInfo(p, now, balance);
      if (r.flames === 0) {
        if (r.block === 'spent') return fail('too_late', 'This purchase can no longer be refunded because some of its Flames have been spent.');
        if (r.block === 'too_late') return fail('too_late', `The ${REFUND_DAYS}-day refund time for this purchase has passed.`);
        return fail('too_late', 'This purchase can not be refunded.');
      }
      if (!p.paymentIntentId) return fail('too_late', 'This purchase can not be refunded here. Write to support.');
      const ledgerId = this.shop.addLedger({ accountId: account.id, at: now, delta: -r.flames, reason: 'refund', purchaseId: p.id, detail: 'refund button' });
      this.shop.updatePurchase(p.id, { status: 'refunded', refundedFlames: r.flames, refundedCents: r.cents, refundedAt: now });
      this.audit(account, account.id, ip, 'shop_refund_requested', `purchase ${p.id} ${r.flames} flames ${r.cents} cents`);
      return { p, flames: r.flames, cents: r.cents, ledgerId };
    });
    try {
      // A new key per attempt: a retry after a failed attempt may legitimately differ.
      await gateway.refund(done.p.paymentIntentId as string, done.cents, `refund-${done.p.id}-${done.ledgerId}`);
    } catch (err) {
      this.log.error({ purchase: done.p.id, problem: err instanceof PaymentError ? err.message : 'unexpected error' }, 'refund failed at the provider');
      // Put everything back: the Flames, the status. (If Stripe did refund after all, its charge.refunded event removes the Flames again.)
      this.store.tx(() => {
        this.shop.addLedger({ accountId: account.id, at: this.now(), delta: done.flames, reason: 'refund_failed', purchaseId: done.p.id, detail: 'provider refused' });
        this.shop.updatePurchase(done.p.id, { status: 'paid', refundedFlames: 0, refundedCents: 0, refundedAt: null });
        this.audit(account, account.id, ip, 'shop_refund_failed', `purchase ${done.p.id}`);
      });
      return fail('internal_error', 'The refund could not be sent to the payment provider. Nothing was changed. Please try again later.');
    }
    return this.response(account);
  }

  // ---- support ---------------------------------------------------------------------------------------------------

  /** Operator grant or correction (CLI). Returns the new balance. */
  supportGrant(accountId: number, amount: number, reason: string): number {
    return this.store.tx(() => {
      this.shop.addLedger({ accountId, at: this.now(), delta: amount, reason: 'support', detail: reason });
      this.store.audit({ at: this.now(), actorId: null, actorIp: 'cli', action: 'flames_grant', targetAccount: accountId, detail: `${amount} ${reason}` });
      return this.shop.balance(accountId);
    });
  }

  // ---- evidence --------------------------------------------------------------------------------------------------

  private buildEvidence(p: PurchaseRow, account: AccountRow): Record<string, string> {
    const iso = (t: number): string => new Date(t).toISOString();
    const consents = this.shop.consentsOfPurchase(p.id);
    const spends = this.shop.spendRows(account.id, 200);
    const logins = this.shop.loginHistory(account.id, 200).reverse();
    const cut = (s: string): string => s.slice(0, EVIDENCE_FIELD_MAX);
    const spendText = spends.length === 0 ? 'No Flames were spent yet.' : spends.map((s) => `${iso(s.at)} spent ${-s.delta} Flames on ${s.itemId ?? 'an item'}${s.worldId ? ` in world ${s.worldId}` : ''}`).join('\n');
    const consentText = consents.map((c) => `${iso(c.at)} (UTC), terms version ${c.termsVersion}, IP ${c.ip}, ${c.kind}: "${c.text}"`).join('\n');
    const card = p.cardBrand ? `Card: ${p.cardBrand} ending ${p.cardLast4 ?? '????'}${p.cardCountry ? `, card country ${p.cardCountry}` : ''}.` : '';
    const out: Record<string, string> = {
      product_description: cut(
        `Receipt ${receiptNo(p.id)}: ${p.flames} Flames, the in-game currency of the browser strategy game Clanflame, delivered digitally to the player account "${account.username}" ` +
          `${p.paidAt ? `on ${iso(p.paidAt)} ` : ''}right after payment. ${card}\nWhat the Flames were spent on:\n${spendText}`,
      ),
      customer_purchase_ip: p.ip,
      service_date: iso(p.paidAt ?? p.createdAt).slice(0, 10),
      access_activity_log: cut(
        logins.length === 0 ? 'No sign-in records.' : logins.map((l) => `${iso(l.at)} ${l.kind}${l.worldId ? ` world ${l.worldId}` : ''} ip ${l.ip} browser ${l.userAgent}`).join('\n'),
      ),
      refund_policy_disclosure: cut(
        `At checkout the buyer saw and ticked the required box (terms version ${TERMS_VERSION}): "${CONSENT_TEXT}" and the note: "${CONSENT_NOTE}" ` +
          `A full refund of a purchase whose Flames are unspent is available with one button for ${REFUND_DAYS} days.`,
      ),
      uncategorized_text: cut(`Consent records for this purchase:\n${consentText || 'none'}\nThe buyer did not ask for a refund before the dispute.`),
      customer_name: account.username,
    };
    if (p.email) out.customer_email_address = p.email;
    return out;
  }

  /** Send the stored evidence of a disputed purchase to the provider (also the CLI retry). */
  async submitEvidence(purchaseId: number): Promise<void> {
    if (!this.gateway) throw new Error('Payments are not configured (no Stripe key).');
    const p = this.shop.getPurchase(purchaseId);
    if (!p || !p.disputeId) throw new Error(`Purchase ${purchaseId} has no dispute.`);
    if (!p.evidenceJson) throw new Error(`Purchase ${purchaseId} has no evidence pack.`);
    await this.gateway.submitDisputeEvidence(p.disputeId, JSON.parse(p.evidenceJson) as Record<string, string>);
    this.shop.updatePurchase(p.id, { evidenceSubmittedAt: this.now() });
    this.store.audit({ at: this.now(), actorId: null, actorIp: null, action: 'shop_dispute_evidence', targetAccount: p.accountId, detail: `purchase ${p.id} dispute ${p.disputeId}` });
  }

  // ---- reports and alerts ------------------------------------------------------------------------------------

  paymentsReport(monthKey?: string): { month: string; paidCount: number; paidCents: number; refundCount: number; refundCents: number; disputes: number; rate: number | null } | null {
    const m = monthKey ? monthFromKey(monthKey) : monthOf(this.now());
    if (!m) return null;
    const paid = this.shop.paidInRange(m.from, m.to);
    const refunds = this.shop.refundedInRange(m.from, m.to);
    const disputes = this.shop.countEvents('charge.dispute.created', m.from, m.to);
    return { month: m.key, paidCount: paid.count, paidCents: paid.cents, refundCount: refunds.count, refundCents: refunds.cents, disputes, rate: paid.count > 0 ? disputes / paid.count : null };
  }

  /** Alert once per month when disputes exceed 0.5% of the month's paid purchases. Returns the alert text when one was raised now. */
  private checkDisputeRate(): string | null {
    const r = this.paymentsReport();
    if (!r || r.disputes === 0) return null;
    if (r.rate !== null && r.rate <= DISPUTE_RATE_ALERT) return null;
    if (this.shop.hasAudit('dispute_rate_alert', r.month)) return null;
    const text = `Clanflame: ${r.disputes} bank dispute(s) against ${r.paidCount} paid purchase(s) in ${r.month}${r.rate === null ? '' : ` (${(r.rate * 100).toFixed(2)}%)`}: above the 0.5% alert level.`;
    this.store.audit({ at: this.now(), actorId: null, actorIp: null, action: 'dispute_rate_alert', targetAccount: null, detail: r.month });
    this.log.warn({ month: r.month, disputes: r.disputes, paid: r.paidCount }, text);
    return text;
  }

  // ---- webhook ------------------------------------------------------------------------------------------------------

  /**
   * Apply one verified Stripe event. The event row and every effect are written in ONE transaction: a replay changes nothing, a crash
   * changes nothing. Throws only on unexpected errors (the route then answers 500 and Stripe retries).
   */
  applyEvent(event: Record<string, unknown>): EventResult {
    const id = str(event.id);
    const type = str(event.type);
    const data = isObj(event.data) ? event.data : null;
    const obj = data && isObj(data.object) ? data.object : null;
    if (!id || !type || !obj) throw new GameError('invalid_input', 'Malformed event.');
    const after: (() => Promise<void>)[] = [];
    const duplicate = this.store.tx(() => {
      if (!this.shop.insertEvent(id, type, this.now())) return true;
      switch (type) {
        case 'checkout.session.completed':
          this.onSessionCompleted(obj);
          break;
        case 'checkout.session.expired':
          this.onSessionExpired(obj);
          break;
        case 'charge.succeeded':
          this.onChargeSucceeded(obj);
          break;
        case 'charge.refunded':
          this.onChargeRefunded(obj);
          break;
        case 'charge.dispute.created':
          this.onDisputeCreated(obj, after);
          break;
        case 'charge.dispute.closed':
          this.onDisputeClosed(obj, after);
          break;
        default:
          break; // unknown types: stored (so a replay is a no-op) and ignored
      }
      return false;
    });
    return { duplicate, after };
  }

  /** The purchase a charge or dispute object belongs to. */
  private purchaseOfCharge(o: Record<string, unknown>): PurchaseRow | null {
    const intent = str(o.payment_intent);
    const charge = str(o.object) === 'charge' ? str(o.id) : str(o.charge);
    let p: PurchaseRow | null = (intent && this.shop.purchaseByIntent(intent)) || (charge && this.shop.purchaseByCharge(charge)) || null;
    if (!p && isObj(o.metadata)) {
      const mid = Number(o.metadata.purchase_id);
      if (Number.isSafeInteger(mid) && mid > 0) p = this.shop.getPurchase(mid);
    }
    return p;
  }

  private onSessionCompleted(o: Record<string, unknown>): void {
    const sessionId = str(o.id);
    if (!sessionId) return;
    let p = this.shop.purchaseBySession(sessionId);
    if (!p) {
      const ref = Number(o.client_reference_id);
      const byRef = Number.isSafeInteger(ref) ? this.shop.getPurchase(ref) : null;
      if (byRef && byRef.checkoutSessionId === null) p = byRef;
    }
    if (!p) {
      this.log.warn({ session: sessionId }, 'payment for an unknown checkout session ignored');
      return;
    }
    if (o.payment_status !== 'paid') return;
    // Business-state idempotency: credited once, however many events say "paid".
    if (p.paidAt !== null || (p.status !== 'pending' && p.status !== 'expired')) return;
    if (int(o.amount_total) !== p.priceCents || o.currency !== 'eur') {
      this.log.warn({ purchase: p.id }, 'payment amount or currency does not match the purchase: ignored');
      this.store.audit({ at: this.now(), actorId: null, actorIp: null, action: 'shop_payment_mismatch', targetAccount: p.accountId, detail: `purchase ${p.id}` });
      return;
    }
    const intent = str(o.payment_intent);
    const other = intent ? this.shop.purchaseByIntent(intent) : null;
    if (other && other.id !== p.id) {
      this.store.audit({ at: this.now(), actorId: null, actorIp: null, action: 'shop_payment_mismatch', targetAccount: p.accountId, detail: `purchase ${p.id} intent already used` });
      return;
    }
    const details = isObj(o.customer_details) ? o.customer_details : null;
    const emailRaw = details ? str(details.email) : null;
    const email = emailRaw && emailRaw.length <= 254 && emailRaw.includes('@') ? emailRaw : null;
    const countryRaw = details && isObj(details.address) ? str(details.address.country) : null;
    const country = countryRaw && /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : null;
    const now = this.now();
    this.shop.updatePurchase(p.id, { status: 'paid', paidAt: now, paymentIntentId: p.paymentIntentId ?? intent, country, email: email ?? p.email, checkoutSessionId: sessionId });
    if (p.kind === 'flames') {
      this.shop.addLedger({ accountId: p.accountId, at: now, delta: p.flames, reason: 'purchase', purchaseId: p.id, detail: receiptNo(p.id) });
    } else {
      const covered = this.shop.payBoundFees(p.id, now);
      if (covered === 0) this.log.warn({ purchase: p.id }, 'a settlement was paid but no open fees were bound to it');
    }
    this.store.audit({ at: now, actorId: null, actorIp: null, action: p.kind === 'flames' ? 'shop_purchase_paid' : 'shop_settle_paid', targetAccount: p.accountId, detail: `purchase ${p.id} ${p.priceCents} cents${country ? ` ${country}` : ''}` });
  }

  private onSessionExpired(o: Record<string, unknown>): void {
    const sessionId = str(o.id);
    const p = sessionId ? this.shop.purchaseBySession(sessionId) : null;
    if (p && p.status === 'pending') this.shop.updatePurchase(p.id, { status: 'expired' });
  }

  private onChargeSucceeded(o: Record<string, unknown>): void {
    const p = this.purchaseOfCharge(o);
    if (!p) return;
    const pm = isObj(o.payment_method_details) ? o.payment_method_details : null;
    const card = pm && isObj(pm.card) ? pm.card : null;
    const brand = card ? str(card.brand) : null;
    const last4 = card ? str(card.last4) : null;
    const country = card ? str(card.country) : null;
    const intent = str(o.payment_intent);
    this.shop.updatePurchase(p.id, {
      chargeId: str(o.id) ?? p.chargeId,
      cardBrand: brand && /^[A-Za-z_ ]{1,30}$/.test(brand) ? brand : p.cardBrand,
      cardLast4: last4 && /^\d{4}$/.test(last4) ? last4 : p.cardLast4,
      cardCountry: country && /^[A-Z]{2}$/.test(country) ? country : p.cardCountry,
      paymentIntentId: p.paymentIntentId ?? (intent && !this.shop.purchaseByIntent(intent) ? intent : null),
    });
  }

  private onChargeRefunded(o: Record<string, unknown>): void {
    const p = this.purchaseOfCharge(o);
    if (!p) return;
    const total = int(o.amount_refunded);
    if (total === null) return;
    const beyond = total - p.refundedCents;
    if (beyond <= 0) return; // the refund button already took care of it
    const now = this.now();
    const chargeId = str(o.id) ?? p.chargeId;
    const refundedCents = p.refundedCents + beyond;
    if (p.kind === 'flames' && (p.status === 'paid' || p.status === 'refunded')) {
      const remove = Math.min(p.flames - p.refundedFlames, Math.round((beyond * p.flames) / p.priceCents));
      if (remove > 0) this.shop.addLedger({ accountId: p.accountId, at: now, delta: -remove, reason: 'refund', purchaseId: p.id, detail: 'refund made at the provider' });
      this.shop.updatePurchase(p.id, { status: 'refunded', refundedFlames: p.refundedFlames + remove, refundedCents, refundedAt: now, chargeId });
    } else {
      this.shop.updatePurchase(p.id, { refundedCents, refundedAt: now, chargeId, ...(p.kind === 'settle' && p.status === 'paid' && refundedCents >= p.priceCents ? { status: 'refunded' as const } : {}) });
    }
    this.store.audit({ at: now, actorId: null, actorIp: null, action: 'shop_refund_at_provider', targetAccount: p.accountId, detail: `purchase ${p.id} +${beyond} cents` });
  }

  private onDisputeCreated(o: Record<string, unknown>, after: (() => Promise<void>)[]): void {
    const disputeId = str(o.id);
    if (!disputeId) return;
    const p = this.purchaseOfCharge(o);
    if (!p) {
      this.log.warn({ dispute: disputeId }, 'dispute for an unknown payment ignored');
      return;
    }
    if (p.disputeId !== null) return;
    const account = this.store.getAccount(p.accountId);
    if (!account) return;
    const now = this.now();
    const remove = p.kind === 'flames' ? p.flames - p.refundedFlames : 0;
    if (remove > 0) this.shop.addLedger({ accountId: p.accountId, at: now, delta: -remove, reason: 'dispute', purchaseId: p.id, detail: `dispute ${disputeId}` });
    if (p.kind === 'settle') this.shop.reopenFeesOfSettle(p.id);
    this.shop.updatePurchase(p.id, { status: 'disputed', disputeId, disputedAt: now, chargeId: str(o.charge) ?? p.chargeId });
    const disputes = this.shop.incrementDisputes(p.accountId);
    if (disputes >= 2 && account.payBannedAt === null) this.shop.setPayBanned(p.accountId, now);
    // Fees: the provider's dispute fee plus our handling fee (no handling fee when the bank's reason is fraud).
    let providerFee = 0;
    if (Array.isArray(o.balance_transactions)) {
      for (const bt of o.balance_transactions) {
        const fee = isObj(bt) ? int(bt.fee) : null;
        if (fee !== null && fee > 0) providerFee += fee;
      }
    }
    if (providerFee <= 0) providerFee = DISPUTE_FEE_FALLBACK_CENTS;
    this.shop.insertFee({ accountId: p.accountId, purchaseId: p.id, disputeId, kind: 'provider_fee', cents: providerFee, at: now });
    if (o.reason !== 'fraudulent') this.shop.insertFee({ accountId: p.accountId, purchaseId: p.id, disputeId, kind: 'handling_fee', cents: HANDLING_FEE_CENTS, at: now });
    const fresh = this.shop.getPurchase(p.id) as PurchaseRow;
    this.shop.updatePurchase(p.id, { evidenceJson: JSON.stringify(this.buildEvidence(fresh, account)) });
    this.store.audit({ at: now, actorId: null, actorIp: null, action: 'shop_dispute', targetAccount: p.accountId, detail: `purchase ${p.id} dispute ${disputeId} -${remove} flames, fees ${providerFee}+${o.reason === 'fraudulent' ? 0 : HANDLING_FEE_CENTS}` });
    const alert = this.checkDisputeRate();
    after.push(async () => {
      try {
        await this.submitEvidence(p.id);
      } catch (err) {
        this.log.error({ purchase: p.id, problem: err instanceof PaymentError ? err.message : 'evidence not sent' }, 'dispute evidence not submitted (retry: admin dispute-evidence <purchaseId>)');
      }
    });
    if (alert) {
      after.push(async () => {
        try {
          await this.notify(alert);
        } catch {
          // an alert that cannot be delivered is already in the log and the audit log
        }
      });
    }
  }

  private onDisputeClosed(o: Record<string, unknown>, after: (() => Promise<void>)[]): void {
    const disputeId = str(o.id);
    if (!disputeId) return;
    const p = this.shop.purchaseByDispute(disputeId);
    if (!p || p.status !== 'disputed') return;
    const now = this.now();
    const status = str(o.status);
    if (status === 'won' || status === 'warning_closed') {
      const back = this.shop.disputeRemoved(p.id);
      if (back > 0) this.shop.addLedger({ accountId: p.accountId, at: now, delta: back, reason: 'dispute_won', purchaseId: p.id, detail: `dispute ${disputeId}` });
      this.shop.updatePurchase(p.id, { status: 'dispute_won' });
      this.shop.cancelOpenFeesOfDispute(disputeId, now);
      // Fees the player already paid come back on the settlement payment.
      for (const paid of this.shop.paidFeesOfDispute(disputeId)) {
        const sp = this.shop.getPurchase(paid.settlePurchaseId);
        if (!sp || !sp.paymentIntentId) continue;
        this.shop.updatePurchase(sp.id, { refundedCents: sp.refundedCents + paid.cents, refundedAt: now });
        after.push(async () => {
          try {
            await (this.gateway as PaymentGateway).refund(sp.paymentIntentId as string, paid.cents, `fee-refund-${disputeId}-${sp.id}`);
            this.store.audit({ at: this.now(), actorId: null, actorIp: null, action: 'shop_fee_refund', targetAccount: p.accountId, detail: `settlement ${sp.id} ${paid.cents} cents` });
          } catch (err) {
            this.log.error({ settlement: sp.id, problem: err instanceof PaymentError ? err.message : 'refund not sent' }, 'dispute fee refund failed: refund it in the Stripe dashboard');
            this.store.audit({ at: this.now(), actorId: null, actorIp: null, action: 'shop_fee_refund_failed', targetAccount: p.accountId, detail: `settlement ${sp.id} ${paid.cents} cents` });
          }
        });
      }
      this.store.audit({ at: now, actorId: null, actorIp: null, action: 'shop_dispute_won', targetAccount: p.accountId, detail: `purchase ${p.id} +${back} flames` });
    } else if (status === 'lost') {
      this.shop.updatePurchase(p.id, { status: 'dispute_lost' });
      this.store.audit({ at: now, actorId: null, actorIp: null, action: 'shop_dispute_lost', targetAccount: p.accountId, detail: `purchase ${p.id}` });
    }
  }
}
