// Caretaker bot for idle owners (docs/GAME_DESIGN.md section 17). Pure and deterministic given the rng.
// It only ever chooses a building to queue through the normal build check. It never trains, researches, or sends anything.

import { BOT_BUILD_WEIGHTS, BOT_IDLE_DAYS, BOT_STEP_HOURS, MAX_BUILD_QUEUE } from './config.ts';
import { checkBuild, settleVillage } from './village.ts';
import { BUILDING_IDS } from './types.ts';
import type { BuildingId, VillageState, WorldSettings } from './types.ts';
import { MS_PER_HOUR } from './util.ts';

/** How long an owner may be away before the caretaker steps in (ms, scaled by world speed). */
export const botIdleMs = (s: WorldSettings): number => (BOT_IDLE_DAYS * 24 * MS_PER_HOUR) / s.speed;
/** Minimum gap between two caretaker runs on the same village (ms, scaled by world speed). */
export const botStepMs = (s: WorldSettings): number => (BOT_STEP_HOURS * MS_PER_HOUR) / s.speed;

/** Is an owner whose last request was at `lastActive` idle at `now`? */
export const isOwnerIdle = (lastActive: number, now: number, s: WorldSettings): boolean => now - lastActive >= botIdleMs(s);

/**
 * Pick ONE random building upgrade the village can afford right now, weighted by BOT_BUILD_WEIGHTS, or null.
 * Uses the same rule check as the player's build button (cost, storage, requirements, max level, queue, population).
 */
export function botBuildChoice(
  state: VillageState,
  now: number,
  settings: WorldSettings,
  rng: () => number,
  maxQueue: number = MAX_BUILD_QUEUE,
): BuildingId | null {
  const settled = settleVillage(state, now, settings);
  const options: Array<{ id: BuildingId; weight: number }> = [];
  for (const id of BUILDING_IDS) {
    const weight = BOT_BUILD_WEIGHTS[id];
    if (weight > 0 && checkBuild(settled, id, now, settings, maxQueue).ok) options.push({ id, weight });
  }
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const o of options) {
    roll -= o.weight;
    if (roll < 0) return o.id;
  }
  return options[options.length - 1]?.id ?? null;
}
