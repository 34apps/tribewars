// Extension points for account deletion, export and the inactivity warning (docs/MULTI_WORLD.md, "Account data").
// The lobby core knows nothing about the Flames shop; the shop session fills these in (in `lobbyHooks`, src/hooks-config.ts,
// which both the lobby entry point and the operator CLI import, so a CLI deletion runs the same code as a self-service one).

import type { DatabaseSync } from 'node:sqlite';

export interface AccountDataHooks {
  /** Extra sections for GET /account/export (key = section name), e.g. purchases, flames ledger, consents, login history. Must not contain secrets. */
  exportSections(db: DatabaseSync, accountId: number): Record<string, unknown>;
  /** What deleting costs the player: Flames on the account (null = no shop) and purchases that can still be refunded. */
  deletionInfo(db: DatabaseSync, accountId: number): { flames: number | null };
  /**
   * Called INSIDE the deletion transaction, after the lobby's own rows are removed (the tombstone row stays, so rows keyed by
   * account_id that the law makes us keep, e.g. purchases and the ledger, remain valid). Throwing rolls the whole deletion back.
   */
  onAccountDeleted(db: DatabaseSync, accountId: number, now: number): void;
  /**
   * Tell the player their account will be closed at `closeAt` (ms) for inactivity. Return true only if a message was really
   * delivered. Today nothing can deliver (the lobby holds no e-mail address), so the default returns false and the sweep records that.
   */
  notifyInactiveWarning(db: DatabaseSync, accountId: number, closeAt: number): boolean;
}

export const noopHooks: AccountDataHooks = {
  exportSections: () => ({}),
  deletionInfo: () => ({ flames: null }),
  onAccountDeleted: () => {},
  notifyInactiveWarning: () => false,
};
