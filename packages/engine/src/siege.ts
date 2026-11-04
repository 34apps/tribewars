// Siege: after a battle the attacker won, the surviving Log Rams and Boulder Slings lower buildings
// (docs/GAME_DESIGN.md 18.9). Pure and deterministic: same survivors, same village, same seed, same result.

import { SIEGE_BASE_POINTS, SIEGE_MIN_LEVEL, SIEGE_POINTS_PER_LEVEL, UNITS } from './config.ts';
import { mulberry32 } from './random.ts';
import { BUILDING_IDS, UNIT_IDS } from './types.ts';
import type { BuildingId, BuildingLevels, SiegeHit, Units, VillageState } from './types.ts';
import { isBuildingId, normalizeUnits } from './util.ts';

/** The lowest level siege can bring a building to: 0, and 1 for the Town Hall (SIEGE_MIN_LEVEL). */
export function siegeFloor(building: BuildingId): number {
  return SIEGE_MIN_LEVEL[building] ?? 0;
}

/** Siege points it takes to lower a building from `level` to `level - 1`. */
export function siegePointsNeeded(level: number): number {
  return SIEGE_BASE_POINTS + SIEGE_POINTS_PER_LEVEL * level;
}

/** Is any siege unit in this army? */
export function hasSiegeUnits(units: Partial<Units>): boolean {
  const u = normalizeUnits(units);
  return UNIT_IDS.some((id) => UNITS[id].siege !== undefined && u[id] > 0);
}

/** Do Boulder Slings (the kind that takes a chosen building) make up part of this army? */
export function hasChosenSiege(units: Partial<Units>): boolean {
  const u = normalizeUnits(units);
  return UNIT_IDS.some((id) => UNITS[id].siege?.target === 'chosen' && u[id] > 0);
}

/**
 * What the surviving siege units do to a village with `buildings` (its levels BEFORE the siege; the battle itself used the
 * pre-battle Wall). Kinds act in UNIT_IDS order (Log Ram, then Boulder Sling) on the levels left by the one before.
 * A kind has `survivors * power` points; each level lowered costs siegePointsNeeded(level) of them; it stops at its `maxLevels`,
 * when the points run out, or at the building's floor. A Boulder Sling with no valid `chosen` building draws one from `seed`
 * among the buildings that can still drop. A hit with `from === to` is a miss (nothing there, or too few survivors).
 * `chosen` is never checked against the village here: that would tell the sender what the village holds.
 */
export function resolveSiege(survivors: Partial<Units>, buildings: BuildingLevels, chosen: BuildingId | null | undefined, seed: number): SiegeHit[] {
  const alive = normalizeUnits(survivors);
  const levels = { ...buildings };
  const rng = mulberry32((seed ^ 0x51e9e1a5) >>> 0);
  const hits: SiegeHit[] = [];
  for (const unit of UNIT_IDS) {
    const rule = UNITS[unit].siege;
    const count = alive[unit];
    if (!rule || !(count > 0)) continue;
    let building: BuildingId | null = null;
    let random = false;
    if (rule.target === 'wall') building = 'wall';
    else if (isBuildingId(chosen)) building = chosen;
    else {
      random = true;
      const open = BUILDING_IDS.filter((b) => levels[b] > siegeFloor(b));
      const roll = rng(); // always drawn, so the stream does not depend on the village
      if (open.length > 0) building = open[Math.min(open.length - 1, Math.floor(roll * open.length))] as BuildingId;
    }
    if (building === null) continue;
    const from = levels[building];
    let level = from;
    let points = count * rule.power;
    let dropped = 0;
    while (dropped < rule.maxLevels && level > siegeFloor(building) && points >= siegePointsNeeded(level)) {
      points -= siegePointsNeeded(level);
      level -= 1;
      dropped += 1;
    }
    levels[building] = level;
    hits.push({ unit, building, from, to: level, ...(random ? { random: true } : {}) });
  }
  return hits;
}

/**
 * Lower the buildings in `hits` on a (cloned, settled) village. Queued upgrades of a lowered building aim that many levels lower
 * too (the money is not refunded), so the drop sticks. Levels already paid Renown for stay paid: building them again pays nothing.
 */
export function applySiegeHits(v: VillageState, hits: readonly SiegeHit[]): void {
  for (const h of hits) {
    const by = Math.min(h.from, v.buildings[h.building]) - h.to;
    if (!(by > 0)) continue;
    v.buildings[h.building] = Math.max(siegeFloor(h.building), v.buildings[h.building] - by);
    for (const job of v.buildQueue) if (job.building === h.building) job.targetLevel = Math.max(v.buildings[h.building] + 1, job.targetLevel - by);
  }
}
