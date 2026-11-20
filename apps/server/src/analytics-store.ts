// SQL for the analytics bookkeeping (docs/ANALYTICS.md): which one-time events were already sent, and the "Share play stats" opt-out.
// Prepared statements with bound parameters only; every statement is keyed on the player id.

import { SqlBase } from './sql.ts';

/** One-time steps of the early game that are sent as `ftue_step` (docs/ANALYTICS.md section 3). */
export const FTUE_STEPS = ['world_joined', 'first_build', 'first_build_done', 'first_train', 'first_raid', 'first_report', 'tribe_joined', 'second_village'] as const;
export type FtueStep = (typeof FTUE_STEPS)[number];

export class AnalyticsStore extends SqlBase {
  /** Remember that `key` was sent for the player. True only for the first call (the caller then sends the event). */
  markSent(playerId: number, key: string, t: number): boolean {
    return this.run('INSERT OR IGNORE INTO analytics_sent (player_id, key, at) VALUES (?, ?, ?)', playerId, key, t).changes === 1;
  }

  wasSent(playerId: number, key: string): boolean {
    return this.get('SELECT 1 AS x FROM analytics_sent WHERE player_id = ? AND key = ?', playerId, key) !== undefined;
  }

  /** Old once-a-day rows are not needed any more (a day key only matters for its own day). */
  pruneDays(before: number): void {
    this.run("DELETE FROM analytics_sent WHERE key LIKE 'enter:%' AND at < ?", before);
  }

  isOptedOut(playerId: number): boolean {
    return this.get('SELECT 1 AS x FROM analytics_optout WHERE player_id = ?', playerId) !== undefined;
  }

  setOptOut(playerId: number, optedOut: boolean): void {
    if (optedOut) this.run('INSERT OR IGNORE INTO analytics_optout (player_id) VALUES (?)', playerId);
    else this.run('DELETE FROM analytics_optout WHERE player_id = ?', playerId);
  }
}
