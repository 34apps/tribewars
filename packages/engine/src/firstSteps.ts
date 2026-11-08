// First steps (docs/GAME_DESIGN.md "First steps"): which starter tasks the game currently sees as done, and the reward cap.
// Pure rules; the server stores a step once it is seen (sticky) and does the claiming inside a transaction.

import type { FirstStepId } from './api.ts';
import { FIRST_STEPS, FIRST_STEP_BUILDING_LEVEL, FIRST_STEP_RAIDERS } from './config.ts';
import { addClamped } from './economy.ts';
import { RESOURCE_IDS, TRAINING_BUILDING_IDS, type BuildingId, type Resources, type VillageState } from './types.ts';

export interface FirstStepsSnapshot {
  /** All the player's villages, settled to now (finished builds and trained units already counted). */
  villages: readonly VillageState[];
  /** Member of a tribe (founding counts). */
  inTribe: boolean;
  /** Steps the server recorded at the event itself (`raid`, `report`). */
  events: ReadonlySet<FirstStepId>;
}

const BUILDING_STEPS: ReadonlyArray<[FirstStepId, BuildingId]> = [
  ['lumber2', 'lumber'],
  ['farm2', 'farm'],
  ['hall2', 'hall'],
  ['barracks2', 'barracks'],
];

/** The building is at the step level in some village, or an upgrade to that level is queued or running. */
function buildingReached(v: VillageState, b: BuildingId): boolean {
  return v.buildings[b] >= FIRST_STEP_BUILDING_LEVEL || v.buildQueue.some((j) => j.building === b && j.targetLevel >= FIRST_STEP_BUILDING_LEVEL);
}

/** Raiders at home, away and still in training queues, over all villages. */
export function raidersOwned(villages: readonly VillageState[]): number {
  let n = 0;
  for (const v of villages) {
    n += v.troops.raider + v.away.raider;
    for (const b of TRAINING_BUILDING_IDS) for (const j of v.trainQueues[b] ?? []) if (j.unit === 'raider') n += Math.max(0, j.count - j.done);
  }
  return n;
}

/** The steps that are done in this snapshot (done steps the server stored earlier are added by the caller). */
export function firstStepsSatisfied(snap: FirstStepsSnapshot): Set<FirstStepId> {
  const out = new Set<FirstStepId>();
  for (const [step, b] of BUILDING_STEPS) if (snap.villages.some((v) => buildingReached(v, b))) out.add(step);
  if (raidersOwned(snap.villages) >= FIRST_STEP_RAIDERS) out.add('raiders5');
  if (snap.inTribe) out.add('tribe');
  for (const e of snap.events) out.add(e);
  return out;
}

/** The step's reward, or null for an unknown id. */
export function firstStepReward(id: string): Resources | null {
  const s = FIRST_STEPS.find((x) => x.id === id);
  return s ? { ...s.reward } : null;
}

/** New stock after a claim: each resource capped at `cap`; `added` is what really arrived (the overflow is lost). */
export function claimReward(cap: number, current: Resources, reward: Resources): { resources: Resources; added: Resources } {
  const resources = { ...current };
  const added = { wood: 0, food: 0, iron: 0, gold: 0 };
  for (const r of RESOURCE_IDS) {
    resources[r] = addClamped(current[r], reward[r], cap);
    added[r] = Math.max(0, resources[r] - current[r]);
  }
  return { resources, added };
}
