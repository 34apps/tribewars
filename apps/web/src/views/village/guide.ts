// "What should I do in the village?" Picks the one building the village page points at: the building the current First-steps
// step asks for, else (builders idle) the cheapest resource building the player can afford. Pure pick + a hook; the client only
// previews, the Up button goes through the normal build call (useBuild) and the server decides.

import { BUILDINGS, RESOURCE_PRODUCER } from '@clanfire/engine';
import type { BuildingId, FirstStepsDto, Resources } from '@clanfire/engine';
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

type GuideInfo = Pick<BuildingInfo, 'pick' | 'cost' | 'level'>;

const costTotal = (c: Resources | null) => (c ? c.wood + c.food + c.iron + c.gold : Infinity);

export function pickGuide(firstSteps: FirstStepsDto | undefined, infoOf: (id: BuildingId) => GuideInfo, queueEmpty: boolean): Guide | null {
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
  if (!queueEmpty) return null;
  let best: { id: BuildingId; total: number } | null = null;
  for (const id of Object.values(RESOURCE_PRODUCER)) {
    const info = infoOf(id);
    if (!info.pick.actionable) continue;
    const total = costTotal(info.cost);
    if (!best || total < best.total) best = { id, total };
  }
  return best ? { id: best.id, kind: 'upgrade', title: `Upgrade the ${BUILDINGS[best.id].name}` } : null;
}

/** The village page's pointer (null = nothing to suggest). `enabled` off skips the work (design preview, other pages). */
export function useGuide(enabled = true): Guide | null {
  const { live, now, settings, village, firstSteps } = useGame();
  const limit = useRules().queues.build;
  if (!enabled) return null;
  return pickGuide(firstSteps, (id) => buildingInfo(live, now, settings, !!village.hearth, limit, id), live.buildQueue.length === 0);
}
