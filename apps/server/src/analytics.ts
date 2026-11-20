// World-side analytics (docs/ANALYTICS.md): decides WHAT is sent for a player; the shared sender (@clanfire/analytics) does the sending.
// Off (every method returns at once) unless the sender is enabled (ANALYTICS=1 and ANALYTICS_SALT; never in dev, tests or the preview).
// Rules: nothing for a player who switched "Share play stats" off in the lobby; one-time steps once per player EVER (remembered in the
// database, so a restart sends nothing twice); world_enter at most once per player per UTC day; nothing here ever throws into a request.

import { isStatsPage, type StatsPageId } from '@clanfire/engine';
import type { Analytics } from '@clanfire/analytics';
import type { FtueStep } from './analytics-store.ts';
import type { PlayerRow, Store } from './store.ts';

const DAY_MS = 86_400_000;
/** The Hall level shown as `lvl` is read from the villages at most this often per player. */
const LVL_CACHE_MS = 10 * 60_000;
/** The same page of the same player is sent at most this often (the client sends it once per session; this guards against a script). */
const PAGE_GAP_MS = 10 * 60_000;
const MAP_LIMIT = 20_000;

const utcDay = (t: number): string => new Date(t).toISOString().slice(0, 10);

export class WorldAnalytics {
  private readonly enterDay = new Map<number, string>();
  private readonly lvlCache = new Map<number, { lvl: number | undefined; at: number }>();
  private readonly pageSeen = new Map<string, number>();
  private pruned = '';

  constructor(
    private readonly store: Store,
    private readonly sender: Analytics,
    private readonly worldId: string,
    private readonly now: () => number,
    private readonly warn: (msg: string) => void = () => {},
  ) {}

  get enabled(): boolean {
    return this.sender.enabled;
  }

  /** The stable text the person id is made from: the lobby account id; without one, a world-specific fallback. */
  private subjectOf(p: Pick<PlayerRow, 'id' | 'accountId'>): string {
    return p.accountId !== null ? String(p.accountId) : `world:${this.worldId}:${p.id}`;
  }

  /** Hall level of the player's best village, or undefined when unknown. Cached for a few minutes. */
  private lvlOf(playerId: number, t: number): number | undefined {
    const hit = this.lvlCache.get(playerId);
    if (hit && t - hit.at < LVL_CACHE_MS) return hit.lvl;
    let lvl: number | undefined;
    try {
      const levels = this.store.villagesOfPlayer(playerId).map((v) => Number(v.state.buildings.hall ?? 0));
      lvl = levels.length > 0 ? Math.max(...levels) : undefined;
    } catch {
      lvl = undefined;
    }
    if (this.lvlCache.size > MAP_LIMIT) this.lvlCache.clear();
    this.lvlCache.set(playerId, { lvl, at: t });
    return lvl;
  }

  /** Switch the opt-out of a player (copied from the entry pass at every entry). */
  setOptOut(playerId: number, optedOut: boolean): void {
    this.store.analytics.setOptOut(playerId, optedOut);
  }

  private player(playerId: number): PlayerRow | null {
    if (!this.sender.enabled || this.store.analytics.isOptedOut(playerId)) return null;
    return this.store.getPlayer(playerId);
  }

  /** A one-time step. Sent once per player ever. `first_build_done` only counts after a `first_build` of ours. */
  ftue(playerId: number, step: FtueStep): void {
    if (!this.sender.enabled) return;
    try {
      const t = this.now();
      const p = this.player(playerId);
      if (!p) return;
      if (step === 'first_build_done' && !this.store.analytics.wasSent(playerId, 'ftue:first_build')) return;
      if (!this.store.analytics.markSent(playerId, `ftue:${step}`, t)) return;
      this.sender.track(this.subjectOf(p), 'ftue_step', { step }, this.lvlOf(playerId, t));
    } catch (err) {
      this.warn(`analytics ftue failed: ${err instanceof Error ? err.message : 'unexpected error'}`);
    }
  }

  /** The player is active in this world today: at most one `world_enter` per player per UTC day. Cheap to call on every request. */
  worldEnter(player: Pick<PlayerRow, 'id'>): void {
    if (!this.sender.enabled) return;
    try {
      const t = this.now();
      const day = utcDay(t);
      if (this.enterDay.get(player.id) === day) return;
      if (this.enterDay.size > MAP_LIMIT) this.enterDay.clear();
      this.enterDay.set(player.id, day);
      const p = this.player(player.id);
      if (!p) return;
      if (this.pruned !== day) {
        this.pruned = day;
        this.store.analytics.pruneDays(t - 3 * DAY_MS);
      }
      if (!this.store.analytics.markSent(p.id, `enter:${day}`, t)) return;
      this.sender.track(this.subjectOf(p), 'world_enter', { world: this.worldId.toLowerCase().replace(/[^a-z0-9_.]/g, '_').slice(0, 40) }, this.lvlOf(p.id, t));
    } catch (err) {
      this.warn(`analytics world_enter failed: ${err instanceof Error ? err.message : 'unexpected error'}`);
    }
  }

  /** The client opened a page for the first time this session. */
  pageOpen(playerId: number, page: StatsPageId): void {
    if (!this.sender.enabled || !isStatsPage(page)) return;
    try {
      const t = this.now();
      const key = `${playerId}:${page}`;
      const last = this.pageSeen.get(key);
      if (last !== undefined && t - last < PAGE_GAP_MS) return;
      if (this.pageSeen.size > MAP_LIMIT) this.pageSeen.clear();
      this.pageSeen.set(key, t);
      const p = this.player(playerId);
      if (!p) return;
      this.sender.track(this.subjectOf(p), 'page_open', { page }, this.lvlOf(playerId, t));
    } catch (err) {
      this.warn(`analytics page_open failed: ${err instanceof Error ? err.message : 'unexpected error'}`);
    }
  }
}
