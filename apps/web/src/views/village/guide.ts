// "What should I do in the village?" Picks the one building the village page points at: the building the current First-steps
// step asks for. Only while First steps run (owner 2026-11-11: a bubble that keeps suggesting buildings afterwards just covers
// the village), and the player can close it for good (×, remembered in this browser). Pure pick + a hook; the client only
// previews, the Up button goes through the normal build call (useBuild) and the server decides.

import { useSyncExternalStore } from 'react';
import { BUILDINGS } from '@clanfire/engine';
import type { BuildingId, FirstStepsDto } from '@clanfire/engine';
import { FIRST_STEP_TARGET, firstStepsVisible, nextOpenStep } from '../../firstSteps.ts';
import { useGame, useRules } from '../../game.ts';
import { buildingInfo } from './buildingInfo.ts';
import type { BuildingInfo } from './buildingInfo.ts';

export interface Guide {
  id: BuildingId;
  /** upgrade: the callout shows the cost and an Up button; open: it only leads to the building's page (e.g. train raiders). */
  kind: 'upgrade' | 'open';
  title: string;
}

type GuideInfo = Pick<BuildingInfo, 'pick' | 'level'>;

export function pickGuide(firstSteps: FirstStepsDto | undefined, infoOf: (id: BuildingId) => GuideInfo): Guide | null {
  const step = firstStepsVisible(firstSteps) ? nextOpenStep(firstSteps) : null;
  const target = step ? FIRST_STEP_TARGET[step.id] : null;
  if (step && target?.kind === 'building') {
    const info = infoOf(target.id);
    if (step.id === 'raiders5') {
      if (info.level > 0) return { id: target.id, kind: 'open', title: 'Train 5 Raiders' };
    } else {
      const k = info.pick.kind;
      // Already being built, queue full, maxed, or refused for another reason (cold hearth, cost above storage): nothing to point at here.
      if (k === 'upgrading' || k === 'queued' || k === 'queuefull' || k === 'max' || k === 'blocked') return null;
      if (k !== 'locked') return { id: target.id, kind: 'upgrade', title: `Upgrade the ${BUILDINGS[target.id].name}` };
    }
  }
  return null;
}

/** The village page's pointer (null = nothing to suggest). `enabled` off skips the work (design preview, other pages). */
export function useGuide(enabled = true): Guide | null {
  const { live, now, settings, village, firstSteps } = useGame();
  const limit = useRules().queues.build;
  const off = useSyncExternalStore(subscribe, guideOff, () => false);
  if (!enabled || off) return null;
  return pickGuide(firstSteps, (id) => buildingInfo(live, now, settings, !!village.hearth, limit, id));
}

// ---- "Don't show again" (this browser only; storage can be missing or blocked) ----
const OFF_KEY = 'clanfire.guide.off';
const listeners = new Set<() => void>();
let offMemory = false;
function guideOff(): boolean {
  try {
    return offMemory || window.localStorage.getItem(OFF_KEY) === '1';
  } catch {
    return offMemory;
  }
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
/** The × on the bubble: stop pointing at buildings in this browser. */
export function closeGuide(): void {
  offMemory = true;
  try {
    window.localStorage.setItem(OFF_KEY, '1');
  } catch {
    /* private mode: remembered until reload */
  }
  for (const fn of listeners) fn();
}
