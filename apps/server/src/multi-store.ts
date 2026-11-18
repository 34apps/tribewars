// SQL for the multi-account tooling: device ids (hashed), activity slots, the pair-event log, group reviews and the 30-day cleanup.
// Rules and wording live in multi-service.ts, numbers in packages/engine/src/config.ts. Staff-only data: never returned to players.

import { MULTI_ACTIVITY_SLOT_MS } from '@clanfire/engine';
import { SqlBase, type Param, type Raw } from './sql.ts';

export type PairEventKind = 'ship' | 'ship_blocked' | 'support' | 'support_blocked' | 'attack' | 'attack_blocked' | 'strike' | 'conquest';

export interface NewPairEvent {
  at: number;
  kind: PairEventKind;
  /** The acting side: sender, attacker, claimant. */
  a: number;
  /** The other account. */
  b: number;
  amount?: number;
  lostA?: number;
  lostB?: number;
  defenders?: number;
}

export interface PairEventRow {
  id: number;
  at: number;
  kind: PairEventKind;
  a: number;
  b: number;
  amount: number;
  lostA: number;
  lostB: number;
  defenders: number;
}

export interface SeenRow {
  key: string;
  playerId: number;
  firstSeen: number;
  lastSeen: number;
}

export interface MemberRow {
  id: number;
  username: string;
  householdShared: boolean;
  bannedAt: number | null;
  lastActive: number;
}

const toEvent = (r: Raw): PairEventRow => ({
  id: r.id as number,
  at: r.at as number,
  kind: r.kind as PairEventKind,
  a: r.a_player as number,
  b: r.b_player as number,
  amount: r.amount as number,
  lostA: r.lost_a as number,
  lostB: r.lost_b as number,
  defenders: r.defenders as number,
});

const marks = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

export const slotOf = (t: number): number => Math.floor(t / MULTI_ACTIVITY_SLOT_MS);

/** Staff tooling must never break a game action or a request: a failed write is logged (no data in the message) and skipped. */
function bestEffort(what: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.warn(`[multi] ${what} not recorded: ${err instanceof Error ? err.message : 'error'}`);
  }
}

export class MultiStore extends SqlBase {
  // ---- recording -----------------------------------------------------------------------------------

  /** Remember that this account was seen with these device hashes (already hashed; never the raw id). */
  recordDevices(playerId: number, hashes: readonly string[], now: number): void {
    for (const h of hashes) {
      bestEffort('device', () => this.run(
        'INSERT INTO player_devices (player_id, device_hash, first_seen, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(player_id, device_hash) DO UPDATE SET last_seen = excluded.last_seen',
        playerId,
        h,
        now,
        now,
      ));
    }
  }

  recordActivity(playerId: number, now: number): void {
    bestEffort('activity', () => this.run('INSERT OR IGNORE INTO player_activity (player_id, slot) VALUES (?, ?)', playerId, slotOf(now)));
  }

  logEvent(e: NewPairEvent): void {
    if (e.a === e.b) return;
    bestEffort('pair event', () => this.run(
      'INSERT INTO pair_events (at, kind, a_player, b_player, amount, lost_a, lost_b, defenders) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      e.at,
      e.kind,
      e.a,
      e.b,
      Math.round(e.amount ?? 0),
      Math.round(e.lostA ?? 0),
      Math.round(e.lostB ?? 0),
      Math.round(e.defenders ?? 0),
    ));
  }

  // ---- retention -----------------------------------------------------------------------------------

  /** Delete everything older than `cutoff` (ms) and blank old audit-log addresses. Returns the number of rows changed. */
  cleanup(cutoff: number): number {
    let n = 0;
    n += this.run('DELETE FROM player_ips WHERE last_seen < ?', cutoff).changes;
    n += this.run('DELETE FROM player_devices WHERE last_seen < ?', cutoff).changes;
    n += this.run('DELETE FROM player_activity WHERE slot < ?', slotOf(cutoff)).changes;
    n += this.run('DELETE FROM pair_events WHERE at < ?', cutoff).changes;
    n += this.run('DELETE FROM multi_reviews WHERE reviewed_at < ?', cutoff).changes;
    // Audit log: the entry stays (who did what, when), only the address is blanked (the one update its trigger allows).
    n += this.run('UPDATE audit_log SET actor_ip = NULL WHERE actor_ip IS NOT NULL AND at < ?', cutoff).changes;
    return n;
  }

  // ---- links -----------------------------------------------------------------------------------------

  /** Every IP seen since `since` with its account; the caller keeps the ones with two or more accounts. */
  ipSeen(since: number): SeenRow[] {
    return this.all('SELECT ip AS k, player_id, first_seen, last_seen FROM player_ips WHERE last_seen >= ? ORDER BY ip, player_id', since).map(toSeen);
  }

  deviceSeen(since: number): SeenRow[] {
    return this.all('SELECT device_hash AS k, player_id, first_seen, last_seen FROM player_devices WHERE last_seen >= ? ORDER BY device_hash, player_id', since).map(toSeen);
  }

  devicesOf(playerId: number): Array<{ hash: string; firstSeen: number; lastSeen: number }> {
    return this.all('SELECT device_hash, first_seen, last_seen FROM player_devices WHERE player_id = ? ORDER BY last_seen DESC', playerId).map((r) => ({
      hash: r.device_hash as string,
      firstSeen: r.first_seen as number,
      lastSeen: r.last_seen as number,
    }));
  }

  // ---- members -----------------------------------------------------------------------------------------

  members(ids: readonly number[]): MemberRow[] {
    if (ids.length === 0) return [];
    return this.all(
      `SELECT id, username, household_shared, banned_at, COALESCE(last_active, created_at) AS last_active FROM players WHERE id IN (${marks(ids.length)}) ORDER BY id`,
      ...ids,
    ).map((r) => ({
      id: r.id as number,
      username: r.username as string,
      householdShared: (r.household_shared as number) === 1,
      bannedAt: (r.banned_at as number | null) ?? null,
      lastActive: r.last_active as number,
    }));
  }

  villageTotals(ids: readonly number[]): Map<number, { villages: number; points: number }> {
    const out = new Map<number, { villages: number; points: number }>();
    if (ids.length === 0) return out;
    for (const r of this.all(`SELECT owner_id, COUNT(*) AS n, COALESCE(SUM(points), 0) AS p FROM villages WHERE owner_id IN (${marks(ids.length)}) GROUP BY owner_id`, ...ids)) {
      out.set(r.owner_id as number, { villages: Number(r.n), points: Number(r.p) });
    }
    return out;
  }

  // ---- events --------------------------------------------------------------------------------------------

  /** Events where both sides are in `ids`. */
  eventsAmong(ids: readonly number[], since: number): PairEventRow[] {
    if (ids.length < 2) return [];
    const m = marks(ids.length);
    return this.all(`SELECT * FROM pair_events WHERE at >= ? AND a_player IN (${m}) AND b_player IN (${m}) ORDER BY id`, since, ...ids, ...ids).map(toEvent);
  }

  /** Shipments sent by any of `ids` (to anyone). */
  shipsFrom(ids: readonly number[], since: number): PairEventRow[] {
    if (ids.length === 0) return [];
    return this.all(`SELECT * FROM pair_events WHERE kind = 'ship' AND at >= ? AND a_player IN (${marks(ids.length)}) ORDER BY id`, since, ...ids).map(toEvent);
  }

  /** Shipments received by any of `ids` (from anyone). */
  shipsTo(ids: readonly number[], since: number): PairEventRow[] {
    if (ids.length === 0) return [];
    return this.all(`SELECT * FROM pair_events WHERE kind = 'ship' AND at >= ? AND b_player IN (${marks(ids.length)}) ORDER BY id`, since, ...ids).map(toEvent);
  }

  /** What each of `ids` shipped to anyone in total. */
  shippedTotals(ids: readonly number[], since: number): Map<number, number> {
    const out = new Map<number, number>();
    if (ids.length === 0) return out;
    for (const r of this.all(`SELECT a_player, SUM(amount) AS s FROM pair_events WHERE kind = 'ship' AND at >= ? AND a_player IN (${marks(ids.length)}) GROUP BY a_player`, since, ...ids)) {
      out.set(r.a_player as number, Number(r.s));
    }
    return out;
  }

  /** Account pairs (a, b) with at least `minCount` events of `kind` since `since`: candidates for the behaviour-only groups. */
  busyPairs(kind: PairEventKind, since: number, minCount: number): Array<{ a: number; b: number }> {
    return this.all('SELECT a_player, b_player FROM pair_events WHERE kind = ? AND at >= ? GROUP BY a_player, b_player HAVING COUNT(*) >= ?', kind, since, minCount).map((r) => ({
      a: r.a_player as number,
      b: r.b_player as number,
    }));
  }

  activitySlots(playerId: number, sinceSlot: number): number[] {
    return this.all('SELECT slot FROM player_activity WHERE player_id = ? AND slot >= ? ORDER BY slot', playerId, sinceSlot).map((r) => r.slot as number);
  }

  // ---- reviews -----------------------------------------------------------------------------------------

  reviews(keys: readonly string[]): Map<string, number> {
    const out = new Map<string, number>();
    if (keys.length === 0) return out;
    for (const r of this.all(`SELECT group_key, last_event_id FROM multi_reviews WHERE group_key IN (${marks(keys.length)})`, ...(keys as Param[]))) {
      out.set(r.group_key as string, r.last_event_id as number);
    }
    return out;
  }

  setReview(key: string, now: number, reviewerId: number | null, lastEventId: number): void {
    this.run(
      'INSERT INTO multi_reviews (group_key, reviewed_at, reviewer_id, last_event_id) VALUES (?, ?, ?, ?) ON CONFLICT(group_key) DO UPDATE SET reviewed_at = excluded.reviewed_at, reviewer_id = excluded.reviewer_id, last_event_id = excluded.last_event_id',
      key,
      now,
      reviewerId,
      lastEventId,
    );
  }
}

const toSeen = (r: Raw): SeenRow => ({ key: r.k as string, playerId: r.player_id as number, firstSeen: r.first_seen as number, lastSeen: r.last_seen as number });
