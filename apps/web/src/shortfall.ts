// Which resource a player can never reach: stock below the cost and nothing produced. Gold is the common case (a new village has no
// Gold Mine), so the UI names it instead of saying only "too low".

import { BUILDINGS, RESOURCE_IDS } from '@clanfire/engine';
import type { BuildingLevels, ResourceId, Resources } from '@clanfire/engine';

/** Resources that are short for `cost` and have no production (or a cost above the storage cap). */
export function unreachableResources(have: Resources, net: Resources, cost: Resources, cap: number): ResourceId[] {
  return RESOURCE_IDS.filter((r) => cost[r] > Math.floor(have[r] + 1e-9) && (cost[r] > cap || net[r] <= 0));
}

/** True when gold is short and no gold is coming in. */
export function goldNeverArrives(have: Resources, net: Resources, cost: Resources, cap: number): boolean {
  return cost.gold > Math.floor(have.gold + 1e-9) && cost.gold <= cap && net.gold <= 0;
}

/** Player-facing text for missing gold: names the fix, and the Town Hall step when the Gold Mine is still locked. */
export function needsGoldText(buildings: BuildingLevels): string {
  const need = BUILDINGS.goldmine.requires.hall ?? 0;
  const locked = buildings.goldmine === 0 && buildings.hall < need;
  return `Needs gold · build a Gold Mine${locked ? ` (needs Town Hall ${need})` : ''}`;
}

/** Chieftain button hint when the War Chest cannot pay (not the village's gold: a Gold Mine does not help here). */
export const NEEDS_CHEST_TEXT = 'Needs War Chest gold';
