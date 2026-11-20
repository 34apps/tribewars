// The Flames shop's side of account export and deletion (AccountDataHooks, src/account-hooks.ts). Plain SQL on the lobby database.

import type { DatabaseSync } from 'node:sqlite';
import { noopHooks, type AccountDataHooks } from '../account-hooks.ts';
import { receiptNo } from './service.ts';

type Raw = Record<string, unknown>;
const all = (db: DatabaseSync, sql: string, id: number): Raw[] => db.prepare(sql).all(id) as Raw[];

function balance(db: DatabaseSync, accountId: number): number {
  return Number((db.prepare('SELECT COALESCE(SUM(delta), 0) AS b FROM flames_ledger WHERE account_id = ?').get(accountId) as Raw).b);
}

export function createShopAccountDataHooks(): AccountDataHooks {
  return {
    deletionInfo: (db, accountId) => ({ flames: balance(db, accountId) }),

    // The person's own data. Left out on purpose: Stripe ids (session, payment intent, charge, dispute), the evidence blob, the event table.
    exportSections: (db, accountId) => ({
      flames: {
        balance: balance(db, accountId),
        ledger: all(db, 'SELECT at, delta, reason, world_id, item_id, purchase_id, detail FROM flames_ledger WHERE account_id = ? ORDER BY id', accountId).map((r) => ({
          at: r.at,
          delta: r.delta,
          reason: r.reason,
          worldId: r.world_id,
          itemId: r.item_id,
          purchaseId: r.purchase_id,
          detail: r.detail,
        })),
      },
      purchases: all(db, 'SELECT * FROM purchases WHERE account_id = ? ORDER BY id', accountId).map((r) => ({
        id: r.id,
        receiptNo: receiptNo(Number(r.id)),
        kind: r.kind,
        pack: r.pack_id,
        flames: r.flames,
        priceCents: r.price_cents,
        netCents: r.net_cents,
        vatCents: r.vat_cents,
        vatRateBp: r.vat_rate_bp,
        vatCountry: r.vat_country,
        currency: r.currency,
        status: r.status,
        createdAt: r.created_at,
        paidAt: r.paid_at,
        disputedAt: r.disputed_at,
        refundedFlames: r.refunded_flames,
        refundedCents: r.refunded_cents,
        refundedAt: r.refunded_at,
        country: r.country,
        cardBrand: r.card_brand,
        cardLast4: r.card_last4,
        cardCountry: r.card_country,
        email: r.email,
        ip: r.ip,
        userAgent: r.user_agent,
      })),
      consents: all(db, 'SELECT id, purchase_id, at, ip, terms_version, kind, text FROM consents WHERE account_id = ? ORDER BY id', accountId).map((r) => ({
        id: r.id,
        purchaseId: r.purchase_id,
        at: r.at,
        ip: r.ip,
        termsVersion: r.terms_version,
        kind: r.kind,
        text: r.text,
      })),
      loginHistory: all(db, 'SELECT at, ip, user_agent, kind, world_id FROM login_history WHERE account_id = ? ORDER BY id', accountId).map((r) => ({
        at: r.at,
        ip: r.ip,
        userAgent: r.user_agent,
        kind: r.kind,
        worldId: r.world_id,
      })),
      worldPremium: all(db, 'SELECT world_id, until FROM world_premium WHERE account_id = ? ORDER BY world_id', accountId).map((r) => ({ worldId: r.world_id, until: r.until })),
      looks: all(db, 'SELECT item_id, at FROM account_items WHERE account_id = ? ORDER BY at, item_id', accountId).map((r) => ({ itemId: r.item_id, at: r.at })),
      fees: all(db, 'SELECT id, purchase_id, kind, cents, created_at, paid_at, cancelled_at FROM account_fees WHERE account_id = ? ORDER BY id', accountId).map((r) => ({
        id: r.id,
        purchaseId: r.purchase_id,
        kind: r.kind,
        cents: r.cents,
        createdAt: r.created_at,
        paidAt: r.paid_at,
        cancelledAt: r.cancelled_at,
      })),
    }),

    /**
     * Runs inside the deletion transaction. KEPT (7-year accounting / dispute rules): purchases, consents, flames_ledger (append-only),
     * account_fees (claims), stripe_events. login_history is kept only for payers (2-year evidence; Store.purgeLoginHistory removes it later).
     * DELETED: world_premium and account_items. The balance is left as it is: the Flames are lost with the account, which can never sign
     * in again; no ledger row is written (its CHECK has no reason for it, and the table is append-only).
     */
    onAccountDeleted: (db, accountId) => {
      db.prepare('DELETE FROM world_premium WHERE account_id = ?').run(accountId);
      db.prepare('DELETE FROM account_items WHERE account_id = ?').run(accountId);
      db.prepare('DELETE FROM login_history WHERE account_id = ? AND NOT EXISTS (SELECT 1 FROM purchases WHERE account_id = ? AND paid_at IS NOT NULL)').run(accountId, accountId);
    },
  };
}
