// SQL for the first steps card (docs/GAME_DESIGN.md "First steps"): prepared statements with bound parameters only.
// Every statement is keyed on the player id, so one player can never read or change another's rows.

import type { FirstStepId } from '@clanfire/engine';
import { SqlBase } from './sql.ts';

export interface StoredStep {
  stepId: string;
  doneAt: number;
  claimedAt: number | null;
}

export class FirstStepsStore extends SqlBase {
  list(playerId: number): StoredStep[] {
    return this.all('SELECT step_id, done_at, claimed_at FROM first_steps WHERE player_id = ?', playerId).map((r) => ({
      stepId: r.step_id as string,
      doneAt: r.done_at as number,
      claimedAt: (r.claimed_at as number | null) ?? null,
    }));
  }

  /** Record a step as done (sticky; a second call changes nothing). */
  markDone(playerId: number, step: FirstStepId, t: number): void {
    this.run('INSERT OR IGNORE INTO first_steps (player_id, step_id, done_at) VALUES (?, ?, ?)', playerId, step, t);
  }

  /** True only for the one call that takes the reward: an already claimed or never-done step changes nothing. */
  claim(playerId: number, step: FirstStepId, t: number): boolean {
    return this.run('UPDATE first_steps SET claimed_at = ? WHERE player_id = ? AND step_id = ? AND claimed_at IS NULL', t, playerId, step).changes === 1;
  }

  isHidden(playerId: number): boolean {
    return Number(this.get('SELECT hidden FROM first_steps_card WHERE player_id = ?', playerId)?.hidden ?? 0) === 1;
  }

  setHidden(playerId: number, hidden: boolean): void {
    this.run('INSERT INTO first_steps_card (player_id, hidden) VALUES (?, ?) ON CONFLICT(player_id) DO UPDATE SET hidden = excluded.hidden', playerId, hidden ? 1 : 0);
  }

  inTribe(playerId: number): boolean {
    return this.get('SELECT 1 AS x FROM tribe_members WHERE player_id = ?', playerId) !== undefined;
  }
}
