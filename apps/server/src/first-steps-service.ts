// First steps card (docs/GAME_DESIGN.md "First steps"): store newly seen steps, build the DTO. Rules live in the engine.
// Done is derived from the player's villages and tribe membership; `raid` and `report` are written at the event itself
// (send route / report read). A step, once stored, stays done.

import {
  FIRST_STEPS,
  firstStepsSatisfied,
  type FirstStepId,
  type FirstStepsDto,
  type VillageState,
} from '@clanfire/engine';
import type { Store } from './store.ts';

/** Store the steps the villages (already settled to `t`) and tribe show as done and return the stored set. Writes only when something is new. */
export function syncFirstSteps(store: Store, playerId: number, villages: readonly VillageState[], t: number): Map<string, number | null> {
  const stored = store.firstSteps.list(playerId);
  const known = new Set(stored.map((s) => s.stepId));
  const events = new Set<FirstStepId>(stored.map((s) => s.stepId as FirstStepId));
  const seen = firstStepsSatisfied({ villages, inTribe: store.firstSteps.inTribe(playerId), events });
  let changed = false;
  for (const id of seen) {
    if (known.has(id)) continue;
    store.firstSteps.markDone(playerId, id, t);
    changed = true;
  }
  const rows = changed ? store.firstSteps.list(playerId) : stored;
  return new Map(rows.map((r) => [r.stepId, r.claimedAt]));
}

export function firstStepsDto(store: Store, playerId: number, villages: readonly VillageState[], t: number): FirstStepsDto {
  const state = syncFirstSteps(store, playerId, villages, t);
  const steps = FIRST_STEPS.map((s) => ({ id: s.id, done: state.has(s.id), claimed: state.get(s.id) != null, reward: { ...s.reward } }));
  return { steps, hidden: store.firstSteps.isHidden(playerId), allClaimed: steps.every((s) => s.claimed) };
}
