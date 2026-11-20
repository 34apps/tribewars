// Extension points for account deletion, export (docs/MULTI_WORLD.md, "Account data").
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
}

export const noopHooks: AccountDataHooks = {
  exportSections: () => ({}),
  deletionInfo: () => ({ flames: null }),
  onAccountDeleted: () => {},
};
