// Siege: Log Rams hit the Wall during the battle (the lowered Wall counts), then the surviving Log Rams and Boulder Slings
// lower buildings after it; a lost attack still counts a share of its siege units (docs/GAME_DESIGN.md 18.9).
// Pure and deterministic: same army, same village, same seed, same result.

import { SIEGE_BASE_POINTS, SIEGE_DURING_SHARE, SIEGE_LOST_SHARE, SIEGE_MIN_LEVEL, SIEGE_POINTS_PER_LEVEL, UNITS } from './config.ts';
import { mulberry32 } from './random.ts';
import { BUILDING_IDS, UNIT_IDS } from './types.ts';
import type { BuildingId, BuildingLevels, SiegeHit, UnitId, Units, VillageState } from './types.ts';
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

/** Lower `level` with `points` siege points, at most `maxLevels` levels, never below the building's floor. */
function knockDown(building: BuildingId, level: number, points: number, maxLevels: number): { level: number; dropped: number } {
  let dropped = 0;
  while (dropped < maxLevels && level > siegeFloor(building) && points >= siegePointsNeeded(level)) {
    points -= siegePointsNeeded(level);
    level -= 1;
    dropped += 1;
  }
  return { level, dropped };
}

/**
 * The during-the-battle step: the Log Rams that were SENT (all of them stand when the battle starts) fire with SIEGE_DURING_SHARE
 * of their points at the Wall. Returns the Wall level the defence has to use in that battle and what each wall kind lowered
 * (levels, counted against its `maxLevels`). Pure; a wall kind that was not sent is absent.
 */
export function resolveSiegeDuring(sent: Partial<Units>, wall: number): { wall: number; dropped: Partial<Record<UnitId, number>>; from: Partial<Record<UnitId, number>> } {
  const army = normalizeUnits(sent);
  const dropped: Partial<Record<UnitId, number>> = {};
  const from: Partial<Record<UnitId, number>> = {};
  let level = wall;
  for (const unit of UNIT_IDS) {
    const rule = UNITS[unit].siege;
    if (!rule || rule.target !== 'wall' || !(army[unit] > 0)) continue;
    const r = knockDown('wall', level, army[unit] * rule.power * SIEGE_DURING_SHARE, rule.maxLevels);
    from[unit] = level;
    dropped[unit] = r.dropped;
    level = r.level;
  }
  return { wall: level, dropped, from };
}

/** Surviving siege units that count for the after-the-battle step of a LOST attack: floor(count * lossRatio * SIEGE_LOST_SHARE) of each siege kind. */
export function siegeLostSurvivors(sent: Partial<Units>, lossRatio: number): Units {
  const army = normalizeUnits(sent);
  const out = normalizeUnits({});
  for (const unit of UNIT_IDS) {
    if (UNITS[unit].siege === undefined) continue;
    out[unit] = Math.floor(army[unit] * Math.max(0, Math.min(1, lossRatio)) * SIEGE_LOST_SHARE);
  }
  return out;
}

/**
 * What the siege units do to a village with `buildings` (its levels BEFORE the battle). Kinds act in UNIT_IDS order (Log Ram, then
 * Boulder Sling) on the levels left by the one before. After the battle a kind has `survivors * power` points; each level lowered
 * costs siegePointsNeeded(level) of them; it stops at its `maxLevels`, when the points run out, or at the building's floor. A Boulder
 * Sling with no valid `chosen` building draws one from `seed` among the buildings that can still drop. A hit with `from === to` is a
 * miss (nothing there, or too few survivors).
 *
 * `sent` (optional): the whole army that arrived. When given, its wall kinds first fire the during-the-battle step
 * (resolveSiegeDuring); their hit then runs from the pre-battle level to the level after both steps and the `maxLevels` cap is
 * shared between the two. Without `sent` there is no during step (survivors only).
 * `chosen` is never checked against the village here: that would tell the sender what the village holds.
 */
export function resolveSiege(
  survivors: Partial<Units>,
  buildings: BuildingLevels,
  chosen: BuildingId | null | undefined,
  seed: number,
  sent?: Partial<Units>,
): SiegeHit[] {
  const alive = normalizeUnits(survivors);
  const levels = { ...buildings };
  const rng = mulberry32((seed ^ 0x51e9e1a5) >>> 0);
  const hits: SiegeHit[] = [];
  const during = sent ? resolveSiegeDuring(sent, buildings.wall) : null;
  if (during) levels.wall = during.wall;
  for (const unit of UNIT_IDS) {
    const rule = UNITS[unit].siege;
    if (!rule) continue;
    const count = alive[unit];
    const firedDuring = during !== null && during.from[unit] !== undefined;
    if (!(count > 0) && !firedDuring) continue;
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
    const usedDuring = during?.dropped[unit] ?? 0;
    const from = firedDuring ? (during?.from[unit] as number) : levels[building];
    const r = knockDown(building, levels[building], count * rule.power, Math.max(0, rule.maxLevels - usedDuring));
    levels[building] = r.level;
    hits.push({ unit, building, from, to: r.level, ...(random ? { random: true } : {}) });
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
