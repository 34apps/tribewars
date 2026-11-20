// Lobby-side analytics (docs/ANALYTICS.md): decides WHAT is sent for an account; the shared sender (@clanfire/analytics) does the sending.
// Off (every method returns at once) unless the sender is enabled (ANALYTICS=1 and ANALYTICS_SALT; never in dev or tests).
// An account that switched "Share play stats" off (accounts.share_stats = 0) sends nothing, and a deleted account sends nothing.
// The person id is HMAC(salt, account id): the same one the worlds compute from the `aid` of the entry pass.

import type { Analytics, Params } from '@clanfire/analytics';
import type { ShopFromId } from '@clanfire/engine';
import type { Store } from './store.ts';

/** What the shop service needs: queue an event for an account. Never throws, never waits. */
export interface AccountEvents {
  track(accountId: number, event: string, params?: Params): void;
}

/** The shop page is fetched again and again (country switch, reload): one `shop_open` per account per this long. */
const SHOP_OPEN_GAP_MS = 30 * 60_000;
const MAP_LIMIT = 20_000;

export class LobbyAnalytics implements AccountEvents {
  private readonly shopSeen = new Map<number, number>();

  constructor(
    private readonly store: Store,
    private readonly sender: Analytics,
    private readonly now: () => number,
    private readonly warn: (msg: string) => void = () => {},
  ) {}

  get enabled(): boolean {
    return this.sender.enabled;
  }

  track(accountId: number, event: string, params?: Params): void {
    if (!this.sender.enabled) return;
    try {
      const account = this.store.getAccount(accountId);
      if (!account || account.deletedAt !== null || !account.shareStats) return;
      this.sender.track(String(accountId), event, params);
    } catch (err) {
      this.warn(`analytics ${event} failed: ${err instanceof Error ? err.message : 'unexpected error'}`);
    }
  }

  /** The shop page was opened (from where: a fixed id). */
  shopOpen(accountId: number, from: ShopFromId): void {
    if (!this.sender.enabled) return;
    const t = this.now();
    const last = this.shopSeen.get(accountId);
    if (last !== undefined && t - last < SHOP_OPEN_GAP_MS) return;
    if (this.shopSeen.size > MAP_LIMIT) this.shopSeen.clear();
    this.shopSeen.set(accountId, t);
    this.track(accountId, 'shop_open', { from });
  }
}
