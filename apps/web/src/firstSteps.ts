// First steps card helpers (docs/GAME_DESIGN.md section 20). Pure: labels, the next step, and the storage-overflow check.
// The server decides what is done and what a claim adds; this only reads the state it sends.

import { RESOURCE_IDS } from '@clanfire/engine';
import type { BuildingId, FirstStepDto, FirstStepId, FirstStepsDto, Resources } from '@clanfire/engine';

/** Short card labels, one place. */
export const FIRST_STEP_LABEL: Record<FirstStepId, string> = {
  lumber2: 'Lumber Camp 2',
  farm2: 'Farm 2',
  hall2: 'Town Hall 2',
  barracks2: 'Barracks 2',
  raiders5: 'Train 5 Raiders',
  raid: 'Raid an abandoned village',
  report: 'Open a battle report',
  tribe: 'Join or found a tribe',
};

/** What "Show me" does for a step: select a building in the village, or open another screen. */
export type FirstStepTarget = { kind: 'building'; id: BuildingId } | { kind: 'tab'; tab: 'map' | 'reports' | 'tribe' };

export const FIRST_STEP_TARGET: Record<FirstStepId, FirstStepTarget> = {
  lumber2: { kind: 'building', id: 'lumber' },
  farm2: { kind: 'building', id: 'farm' },
  hall2: { kind: 'building', id: 'hall' },
  barracks2: { kind: 'building', id: 'barracks' },
  raiders5: { kind: 'building', id: 'barracks' },
  raid: { kind: 'tab', tab: 'map' },
  report: { kind: 'tab', tab: 'reports' },
  tribe: { kind: 'tab', tab: 'tribe' },
};

/** The card is shown unless the player folded it away or every reward is taken. */
export function firstStepsVisible(fs: FirstStepsDto | undefined): fs is FirstStepsDto {
  return !!fs && !fs.hidden && !fs.allClaimed;
}

/** Steps completed (claimed or waiting to be claimed), for the "3 / 8" count. */
export function doneCount(fs: FirstStepsDto): number {
  return fs.steps.filter((s) => s.done).length;
}

export function claimableSteps(fs: FirstStepsDto): FirstStepDto[] {
  return fs.steps.filter((s) => s.done && !s.claimed);
}

/** The first step (in display order) that is not done yet; null when every step is done. */
export function nextOpenStep(fs: FirstStepsDto): FirstStepDto | null {
  return fs.steps.find((s) => !s.done) ?? null;
}

/** True when claiming `reward` into a village with `stock` and storage `cap` would lose some of it. */
export function wouldOverflow(reward: Resources, stock: Resources, cap: number): boolean {
  return RESOURCE_IDS.some((r) => reward[r] > 0 && stock[r] + reward[r] > cap + 1e-9);
}

/** "+150 wood, +80 food" for the toast; zero amounts are left out. */
export function addedText(added: Resources): string {
  const parts = RESOURCE_IDS.filter((r) => added[r] > 0).map((r) => `${Math.round(added[r])} ${r}`);
  return parts.length ? parts.join(', ') : 'nothing (storage full)';
}
