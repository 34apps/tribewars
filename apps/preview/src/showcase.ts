// Building showcase (preview only): the level that puts a building into each of its four looks.
// Pure on purpose, so it is testable without the web client's asset imports.

import { BUILDINGS, BUILDING_IDS, type BuildingId } from '@clanfire/engine';

export type ShowcaseStage = 1 | 2 | 3 | 4;
export type StageTops = Record<BuildingId, readonly [number, number]>;

/** Stage 1 -> level 1; stage 2 -> first level of stage 2; stage 3 -> first level of stage 3; stage 4 -> the max level. */
export function showcaseLevels(stage: ShowcaseStage, tops: StageTops): Record<BuildingId, number> {
  const out = {} as Record<BuildingId, number>;
  for (const id of BUILDING_IDS) {
    const max = BUILDINGS[id].maxLevel;
    const level = stage === 1 ? 1 : stage === 2 ? tops[id][0] + 1 : stage === 3 ? tops[id][1] + 1 : max;
    out[id] = Math.max(1, Math.min(max, level));
  }
  return out;
}
