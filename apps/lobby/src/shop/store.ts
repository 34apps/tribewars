// All SQL of the Flames shop. Prepared statements with bound parameters only (column names in updatePurchase come from a fixed list).
// Shares the lobby's transaction (Store.tx), so a webhook event and its effects commit or roll back together.

import type { StatementSync } from 'node:sqlite';
import type { PurchaseStatus } from '@clanfire/engine';
import type { Store } from '../store.ts';

type Raw = Record<string, unknown>;
type Param = string | number | null;

export type LedgerReason = 'purchase' | 'spend' | 'refund' | 'refund_failed' | 'dispute' | 'dispute_won' | 'support';

export interface LedgerRow {
  id: number;
  accountId: number;
  at: number;
  delta: number;
  reason: LedgerReason;
  purchaseId: number | null;
  worldId: string | null;
  itemId: string | null;
  requestId: string | null;
  detail: string | null;
}

export interface NewLedger {
  accountId: number;
  at: number;
  delta: number;
  reason: LedgerReason;
  purchaseId?: number | null;
  worldId?: string | null;
  itemId?: string | null;
  requestId?: string | null;
  detail?: string | null;
}

export interface PurchaseRow {
  id: number;
  accountId: number;
  kind: 'flames' | 'settle';
  packId: string;
  flames: number;
  /** What was charged (net + VAT once paid; the net price before). */
  priceCents: number;
  /** Price without VAT. */
  netCents: number;
  vatCents: number | null;
  vatRateBp: number | null;
  vatCountry: string | null;
  currency: string;
  status: PurchaseStatus;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
  disputeId: string | null;
  country: string | null;
  ip: string;
  userAgent: string;
  consentId: number | null;
  email: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  cardCountry: string | null;
  createdAt: number;
  paidAt: number | null;
  disputedAt: number | null;
  refundedFlames: number;
  refundedCents: number;
  /** Gross refund money analytics was already told about (iap_refund), so each refund is reported once. */
  statsRefundCents: number;
  refundedAt: number | null;
  receiptSent: number;
  evidenceJson: string | null;
  evidenceSubmittedAt: number | null;
}

export interface NewPurchase {
  accountId: number;
  kind: 'flames' | 'settle';
  packId: string;
  flames: number;
  priceCents: number;
  ip: string;
  userAgent: string;
  consentId: number | null;
  createdAt: number;
}

export interface ConsentRow {
  id: number;
  accountId: number;
  purchaseId: number | null;
  at: number;
  ip: string;
  termsVersion: string;
  kind: 'withdrawal_waiver' | 'parent_consent';
  text: string;
}

export interface FeeRow {
  id: number;
  accountId: number;
  purchaseId: number;
  disputeId: string;
  kind: 'provider_fee' | 'handling_fee';
  cents: number;
  createdAt: number;
  paidAt: number | null;
  cancelledAt: number | null;
  settlePurchaseId: number | null;
}

export interface LoginHistoryRow {
  at: number;
  ip: string;
  userAgent: string;
  kind: string;
  worldId: string | null;
}

const toLedger = (r: Raw): LedgerRow => ({
  id: r.id as number,
  accountId: r.account_id as number,
  at: r.at as number,
  delta: r.delta as number,
  reason: r.reason as LedgerReason,
  purchaseId: (r.purchase_id as number | null) ?? null,
  worldId: (r.world_id as string | null) ?? null,
  itemId: (r.item_id as string | null) ?? null,
  requestId: (r.request_id as string | null) ?? null,
  detail: (r.detail as string | null) ?? null,
});

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const sOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const toPurchase = (r: Raw): PurchaseRow => ({
  id: r.id as number,
  accountId: r.account_id as number,
  kind: r.kind === 'settle' ? 'settle' : 'flames',
  packId: r.pack_id as string,
  flames: r.flames as number,
  priceCents: r.price_cents as number,
  netCents: r.net_cents as number,
  vatCents: n(r.vat_cents),
  vatRateBp: n(r.vat_rate_bp),
  vatCountry: sOrNull(r.vat_country),
  currency: r.currency as string,
  status: r.status as PurchaseStatus,
  checkoutSessionId: sOrNull(r.checkout_session_id),
  paymentIntentId: sOrNull(r.payment_intent_id),
  chargeId: sOrNull(r.charge_id),
  disputeId: sOrNull(r.dispute_id),
  country: sOrNull(r.country),
  ip: r.ip as string,
  userAgent: r.user_agent as string,
  consentId: n(r.consent_id),
  email: sOrNull(r.email),
  cardBrand: sOrNull(r.card_brand),
  cardLast4: sOrNull(r.card_last4),
  cardCountry: sOrNull(r.card_country),
  createdAt: r.created_at as number,
  paidAt: n(r.paid_at),
  disputedAt: n(r.disputed_at),
  refundedFlames: Number(r.refunded_flames),
  refundedCents: Number(r.refunded_cents),
  statsRefundCents: Number(r.stats_refund_cents ?? 0),
  refundedAt: n(r.refunded_at),
  receiptSent: Number(r.receipt_sent),
  evidenceJson: sOrNull(r.evidence_json),
  evidenceSubmittedAt: n(r.evidence_submitted_at),
});

const toFee = (r: Raw): FeeRow => ({
  id: r.id as number,
  accountId: r.account_id as number,
  purchaseId: r.purchase_id as number,
  disputeId: r.dispute_id as string,
  kind: r.kind as FeeRow['kind'],
  cents: r.cents as number,
  createdAt: r.created_at as number,
  paidAt: n(r.paid_at),
  cancelledAt: n(r.cancelled_at),
  settlePurchaseId: n(r.settle_purchase_id),
});

/** Columns updatePurchase may set (field name -> column). */
const PURCHASE_COLUMNS = {
  status: 'status',
  priceCents: 'price_cents',
  vatCents: 'vat_cents',
  vatRateBp: 'vat_rate_bp',
  vatCountry: 'vat_country',
  checkoutSessionId: 'checkout_session_id',
  paymentIntentId: 'payment_intent_id',
  chargeId: 'charge_id',
  disputeId: 'dispute_id',
  country: 'country',
  email: 'email',
  cardBrand: 'card_brand',
  cardLast4: 'card_last4',
  cardCountry: 'card_country',
  paidAt: 'paid_at',
  disputedAt: 'disputed_at',
  refundedFlames: 'refunded_flames',
  refundedCents: 'refunded_cents',
  statsRefundCents: 'stats_refund_cents',
  refundedAt: 'refunded_at',
  evidenceJson: 'evidence_json',
  evidenceSubmittedAt: 'evidence_submitted_at',
  consentId: 'consent_id',
} as const;
export type PurchasePatch = Partial<Record<keyof typeof PURCHASE_COLUMNS, Param>>;

export class ShopStore {
  private readonly cache = new Map<string, StatementSync>();

  constructor(private readonly store: Store) {}

  tx<T>(fn: () => T): T {
    return this.store.tx(fn);
  }

  private q(sql: string): StatementSync {
    let st = this.cache.get(sql);
    if (!st) {
      st = this.store.db.prepare(sql);
      this.cache.set(sql, st);
    }
    return st;
  }
  private get(sql: string, ...p: Param[]): Raw | undefined {
    return this.q(sql).get(...p) as Raw | undefined;
  }
  private all(sql: string, ...p: Param[]): Raw[] {
    return this.q(sql).all(...p) as Raw[];
  }
  private run(sql: string, ...p: Param[]): { changes: number; id: number } {
    const r = this.q(sql).run(...p);
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  }

  // ---- ledger ------------------------------------------------------------------------------------

  /** The balance is always the sum of the ledger. */
  balance(accountId: number): number {
    return Number(this.get('SELECT COALESCE(SUM(delta), 0) AS b FROM flames_ledger WHERE account_id = ?', accountId)?.b ?? 0);
  }

  addLedger(e: NewLedger): number {
    return this.run(
      'INSERT INTO flames_ledger (account_id, at, delta, reason, purchase_id, world_id, item_id, request_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      e.accountId,
      e.at,
      e.delta,
      e.reason,
      e.purchaseId ?? null,
      e.worldId ?? null,
      e.itemId ?? null,
      e.requestId ?? null,
      (e.detail ?? '').slice(0, 300) || null,
    ).id;
  }

  ledgerRows(accountId: number, limit: number): LedgerRow[] {
    return this.all('SELECT * FROM flames_ledger WHERE account_id = ? ORDER BY id DESC LIMIT ?', accountId, limit).map(toLedger);
  }

  ledgerByRequest(accountId: number, requestId: string): LedgerRow | null {
    const r = this.get('SELECT * FROM flames_ledger WHERE account_id = ? AND request_id = ?', accountId, requestId);
    return r ? toLedger(r) : null;
  }

  /** Flames removed by a dispute for this purchase (positive number). */
  disputeRemoved(purchaseId: number): number {
    return Number(this.get("SELECT COALESCE(-SUM(delta), 0) AS s FROM flames_ledger WHERE purchase_id = ? AND reason = 'dispute'", purchaseId)?.s ?? 0);
  }

  spendRows(accountId: number, limit: number): LedgerRow[] {
    return this.all("SELECT * FROM flames_ledger WHERE account_id = ? AND reason = 'spend' ORDER BY id LIMIT ?", accountId, limit).map(toLedger);
  }

  // ---- consents and purchases ----------------------------------------------------------------------

  insertConsent(c: { accountId: number; at: number; ip: string; termsVersion: string; kind: ConsentRow['kind']; text: string }): number {
    return this.run('INSERT INTO consents (account_id, purchase_id, at, ip, terms_version, kind, text) VALUES (?, NULL, ?, ?, ?, ?, ?)', c.accountId, c.at, c.ip, c.termsVersion, c.kind, c.text).id;
  }

  setConsentPurchase(consentId: number, purchaseId: number): void {
    this.run('UPDATE consents SET purchase_id = ? WHERE id = ?', purchaseId, consentId);
  }

  consentsOfPurchase(purchaseId: number): ConsentRow[] {
    return this.all('SELECT * FROM consents WHERE purchase_id = ? ORDER BY id', purchaseId).map((r) => ({
      id: r.id as number,
      accountId: r.account_id as number,
      purchaseId: n(r.purchase_id),
      at: r.at as number,
      ip: r.ip as string,
      termsVersion: r.terms_version as string,
      kind: r.kind as ConsentRow['kind'],
      text: r.text as string,
    }));
  }

  insertPurchase(p: NewPurchase): number {
    return this.run(
      `INSERT INTO purchases (account_id, kind, pack_id, flames, price_cents, net_cents, currency, status, ip, user_agent, consent_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'eur', 'pending', ?, ?, ?, ?)`,
      p.accountId,
      p.kind,
      p.packId,
      p.flames,
      p.priceCents,
      p.priceCents, // net = the price until the payment is confirmed
      p.ip.slice(0, 64),
      p.userAgent.slice(0, 200),
      p.consentId,
      p.createdAt,
    ).id;
  }

  getPurchase(id: number): PurchaseRow | null {
    const r = this.get('SELECT * FROM purchases WHERE id = ?', id);
    return r ? toPurchase(r) : null;
  }
  purchaseBySession(sessionId: string): PurchaseRow | null {
    const r = this.get('SELECT * FROM purchases WHERE checkout_session_id = ?', sessionId);
    return r ? toPurchase(r) : null;
  }
  purchaseByIntent(intentId: string): PurchaseRow | null {
    const r = this.get('SELECT * FROM purchases WHERE payment_intent_id = ?', intentId);
    return r ? toPurchase(r) : null;
  }
  purchaseByCharge(chargeId: string): PurchaseRow | null {
    const r = this.get('SELECT * FROM purchases WHERE charge_id = ? ORDER BY id LIMIT 1', chargeId);
    return r ? toPurchase(r) : null;
  }
  purchaseByDispute(disputeId: string): PurchaseRow | null {
    const r = this.get('SELECT * FROM purchases WHERE dispute_id = ? ORDER BY id LIMIT 1', disputeId);
    return r ? toPurchase(r) : null;
  }

  /** Newest first. */
  listPurchases(accountId: number, limit: number): PurchaseRow[] {
    return this.all('SELECT * FROM purchases WHERE account_id = ? ORDER BY id DESC LIMIT ?', accountId, limit).map(toPurchase);
  }

  updatePurchase(id: number, patch: PurchasePatch): void {
    const keys = Object.keys(patch) as (keyof typeof PURCHASE_COLUMNS)[];
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${PURCHASE_COLUMNS[k]} = ?`).join(', ');
    this.run(`UPDATE purchases SET ${sets} WHERE id = ?`, ...keys.map((k) => patch[k] ?? null), id);
  }

  /** Billing country (alpha-2) of the account's latest paid purchase, null when there is none. */
  lastVatCountry(accountId: number): string | null {
    return sOrNull(this.get("SELECT vat_country FROM purchases WHERE account_id = ? AND paid_at IS NOT NULL AND vat_country IS NOT NULL ORDER BY paid_at DESC, id DESC LIMIT 1", accountId)?.vat_country);
  }

  countPendingSince(accountId: number, since: number): number {
    return Number(this.get("SELECT COUNT(*) AS c FROM purchases WHERE account_id = ? AND status = 'pending' AND created_at > ?", accountId, since)?.c ?? 0);
  }

  /** NET pack money (cents, without VAT) of purchases that count against the under-18 monthly cap: paid ones, and pending ones newer than `pendingSince`. */
  packCentsInRange(accountId: number, from: number, to: number, pendingSince: number): number {
    return Number(
      this.get(
        `SELECT COALESCE(SUM(net_cents), 0) AS s FROM purchases
          WHERE account_id = ? AND kind = 'flames' AND created_at >= ? AND created_at < ?
            AND (status IN ('paid', 'disputed', 'dispute_lost', 'dispute_won') OR (status = 'pending' AND created_at > ?))`,
        accountId,
        from,
        to,
        pendingSince,
      )?.s ?? 0,
    );
  }

  /** True when no other paid Flames pack of the account came before this one (analytics `first`). */
  isFirstPaidFlames(accountId: number, purchaseId: number): boolean {
    const me = this.get('SELECT paid_at FROM purchases WHERE id = ?', purchaseId);
    if (!me || me.paid_at === null) return true;
    return (
      this.get(
        "SELECT 1 AS x FROM purchases WHERE account_id = ? AND kind = 'flames' AND paid_at IS NOT NULL AND id != ? AND (paid_at < ? OR (paid_at = ? AND id < ?)) LIMIT 1",
        accountId, purchaseId, me.paid_at as number, me.paid_at as number, purchaseId,
      ) === undefined
    );
  }

  hasPaidPurchase(accountId: number): boolean {
    return this.get('SELECT 1 AS x FROM purchases WHERE account_id = ? AND paid_at IS NOT NULL LIMIT 1', accountId) !== undefined;
  }

  // ---- Stripe events ---------------------------------------------------------------------------------

  /** True when the event id was new. */
  insertEvent(eventId: string, type: string, at: number): boolean {
    return this.run('INSERT OR IGNORE INTO stripe_events (event_id, type, received_at) VALUES (?, ?, ?)', eventId, type.slice(0, 80), at).changes > 0;
  }

  countEvents(type: string, from: number, to: number): number {
    return Number(this.get('SELECT COUNT(*) AS c FROM stripe_events WHERE type = ? AND received_at >= ? AND received_at < ?', type, from, to)?.c ?? 0);
  }

  // ---- reports -----------------------------------------------------------------------------------------

  paidInRange(from: number, to: number): { count: number; cents: number } {
    const r = this.get("SELECT COUNT(*) AS c, COALESCE(SUM(price_cents), 0) AS s FROM purchases WHERE kind = 'flames' AND paid_at >= ? AND paid_at < ?", from, to);
    return { count: Number(r?.c ?? 0), cents: Number(r?.s ?? 0) };
  }
  refundedInRange(from: number, to: number): { count: number; cents: number } {
    const r = this.get('SELECT COUNT(*) AS c, COALESCE(SUM(refunded_cents), 0) AS s FROM purchases WHERE refunded_at >= ? AND refunded_at < ?', from, to);
    return { count: Number(r?.c ?? 0), cents: Number(r?.s ?? 0) };
  }
  hasAudit(action: string, detail: string): boolean {
    return this.get('SELECT 1 AS x FROM audit_log WHERE action = ? AND detail = ? LIMIT 1', action, detail) !== undefined;
  }

  // ---- dispute fees ------------------------------------------------------------------------------------

  insertFee(f: { accountId: number; purchaseId: number; disputeId: string; kind: FeeRow['kind']; cents: number; at: number }): number {
    return this.run('INSERT INTO account_fees (account_id, purchase_id, dispute_id, kind, cents, created_at) VALUES (?, ?, ?, ?, ?, ?)', f.accountId, f.purchaseId, f.disputeId, f.kind, f.cents, f.at).id;
  }

  openFees(accountId: number): FeeRow[] {
    return this.all('SELECT * FROM account_fees WHERE account_id = ? AND paid_at IS NULL AND cancelled_at IS NULL ORDER BY id', accountId).map(toFee);
  }

  openFeesCents(accountId: number): number {
    return Number(this.get('SELECT COALESCE(SUM(cents), 0) AS s FROM account_fees WHERE account_id = ? AND paid_at IS NULL AND cancelled_at IS NULL', accountId)?.s ?? 0);
  }

  /** Tie all open fees of the account to a settlement purchase (the newest settlement wins). */
  bindOpenFees(accountId: number, settlePurchaseId: number): void {
    this.run('UPDATE account_fees SET settle_purchase_id = ? WHERE account_id = ? AND paid_at IS NULL AND cancelled_at IS NULL', settlePurchaseId, accountId);
  }

  /** Mark the fees bound to a paid settlement as paid. Returns how many cents that covered. */
  payBoundFees(settlePurchaseId: number, at: number): number {
    const cents = Number(this.get('SELECT COALESCE(SUM(cents), 0) AS s FROM account_fees WHERE settle_purchase_id = ? AND paid_at IS NULL AND cancelled_at IS NULL', settlePurchaseId)?.s ?? 0);
    this.run('UPDATE account_fees SET paid_at = ? WHERE settle_purchase_id = ? AND paid_at IS NULL AND cancelled_at IS NULL', at, settlePurchaseId);
    return cents;
  }

  /** A settlement payment was disputed: its fees are owed again. */
  reopenFeesOfSettle(settlePurchaseId: number): void {
    this.run('UPDATE account_fees SET paid_at = NULL WHERE settle_purchase_id = ? AND paid_at IS NOT NULL AND cancelled_at IS NULL', settlePurchaseId);
  }

  cancelOpenFeesOfDispute(disputeId: string, at: number): number {
    return this.run('UPDATE account_fees SET cancelled_at = ? WHERE dispute_id = ? AND paid_at IS NULL AND cancelled_at IS NULL', at, disputeId).changes;
  }

  /** Paid fees of one dispute, summed per settlement purchase (to refund them when the dispute is won). */
  paidFeesOfDispute(disputeId: string): { settlePurchaseId: number; cents: number }[] {
    return this.all('SELECT settle_purchase_id AS sp, SUM(cents) AS s FROM account_fees WHERE dispute_id = ? AND paid_at IS NOT NULL AND cancelled_at IS NULL AND settle_purchase_id IS NOT NULL GROUP BY settle_purchase_id', disputeId).map((r) => ({
      settlePurchaseId: Number(r.sp),
      cents: Number(r.s),
    }));
  }

  feesOfAccount(accountId: number): FeeRow[] {
    return this.all('SELECT * FROM account_fees WHERE account_id = ? ORDER BY id', accountId).map(toFee);
  }

  // ---- account flags ---------------------------------------------------------------------------------

  setPayBanned(accountId: number, at: number | null): void {
    this.run('UPDATE accounts SET pay_banned_at = ? WHERE id = ?', at, accountId);
  }
  incrementDisputes(accountId: number): number {
    this.run('UPDATE accounts SET disputes = disputes + 1 WHERE id = ?', accountId);
    return Number(this.get('SELECT disputes FROM accounts WHERE id = ?', accountId)?.disputes ?? 0);
  }
  setAgeGroup(accountId: number, g: 'adult' | 'minor'): void {
    this.run('UPDATE accounts SET age_group = ? WHERE id = ?', g, accountId);
  }

  // ---- premium and items -----------------------------------------------------------------------------

  premiumUntil(accountId: number, worldId: string): number {
    return Number(this.get('SELECT until FROM world_premium WHERE account_id = ? AND world_id = ?', accountId, worldId)?.until ?? 0);
  }
  setPremiumUntil(accountId: number, worldId: string, until: number): void {
    this.run('INSERT INTO world_premium (account_id, world_id, until) VALUES (?, ?, ?) ON CONFLICT(account_id, world_id) DO UPDATE SET until = excluded.until', accountId, worldId, until);
  }
  hasItem(accountId: number, itemId: string): boolean {
    return this.get('SELECT 1 AS x FROM account_items WHERE account_id = ? AND item_id = ?', accountId, itemId) !== undefined;
  }
  addItem(accountId: number, itemId: string, at: number): void {
    this.run('INSERT INTO account_items (account_id, item_id, at) VALUES (?, ?, ?)', accountId, itemId, at);
  }
  ownedItems(accountId: number): Set<string> {
    return new Set(this.all('SELECT item_id FROM account_items WHERE account_id = ?', accountId).map((r) => String(r.item_id)));
  }
  hasEntered(accountId: number, worldId: string): boolean {
    return this.get('SELECT 1 AS x FROM account_worlds WHERE account_id = ? AND world_id = ?', accountId, worldId) !== undefined;
  }

  // ---- login history (evidence) --------------------------------------------------------------------------

  loginHistory(accountId: number, limit: number): LoginHistoryRow[] {
    return this.all('SELECT at, ip, user_agent, kind, world_id FROM login_history WHERE account_id = ? ORDER BY id DESC LIMIT ?', accountId, limit).map((r) => ({
      at: r.at as number,
      ip: r.ip as string,
      userAgent: r.user_agent as string,
      kind: r.kind as string,
      worldId: (r.world_id as string | null) ?? null,
    }));
  }
}
