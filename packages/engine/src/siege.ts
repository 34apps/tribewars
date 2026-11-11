// Siege: Firecarts burn the Wall during the battle (the lowered Wall counts), then the surviving Firecarts burn the building the sender
// picked (the Wall if none) after it; a lost attack still counts a share of its Firecarts (docs/GAME_DESIGN.md 18.9).
// Pure and deterministic: same army, same village, same result.

import { SIEGE_BASE_POINTS, SIEGE_DURING_SHARE, SIEGE_LOST_SHARE, SIEGE_MIN_LEVEL, SIEGE_POINTS_PER_LEVEL, UNITS } from './config.ts';
import { UNIT_IDS } from './types.ts';
import type { BuildingId, BuildingLevels, SiegeHit, UnitId, Units, VillageState, WorldSettings } from './types.ts';
import { isBuildingId, normalizeUnits } from './util.ts';
import { worldRules } from './world-config.ts';

/** Message of the refusal when a world has siege switched off. */
export const SIEGE_OFF_MESSAGE = 'Siege is off in this world.';

/** Is siege on in this world (`features.siege`)? Off: siege units cannot be trained or researched and battles never lower buildings. */
export function siegeEnabled(s: Pick<WorldSettings, 'config'> | undefined | null): boolean {
  return worldRules(s).features.siege;
}

/** The lowest level siege can bring a building to: 0, and 1 for the Town Hall, Farm, Longhouse and Storehouse (SIEGE_MIN_LEVEL). */
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
 * The during-the-battle step: the Firecarts that were SENT (all of them stand when the battle starts) fire with SIEGE_DURING_SHARE
 * of their points at the Wall. Returns the Wall level the defence has to use in that battle and what each siege kind lowered
 * (levels, at most its `maxLevels`). Pure; a siege kind that was not sent is absent.
 */
export function resolveSiegeDuring(sent: Partial<Units>, wall: number): { wall: number; dropped: Partial<Record<UnitId, number>>; from: Partial<Record<UnitId, number>> } {
  const army = normalizeUnits(sent);
  const dropped: Partial<Record<UnitId, number>> = {};
  const from: Partial<Record<UnitId, number>> = {};
  let level = wall;
  for (const unit of UNIT_IDS) {
    const rule = UNITS[unit].siege;
    if (!rule || !(army[unit] > 0)) continue;
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
 * What the Firecarts do to a village with `buildings` (its levels BEFORE the battle). `sent` (optional) = the whole army that arrived:
 * its Firecarts first fire the during-the-battle step at the Wall (resolveSiegeDuring). Then the `survivors` spend their full
 * `power` points on the building the sender picked (`chosen`; the Wall if none or not a building id), at most `maxLevels` levels, never
 * below the building's floor. The two steps each get their own `maxLevels`. When both hit the Wall the result is ONE hit from the pre-battle
 * level to the level after both. A hit with `from === to` is a miss (too few survivors). A Wall hit of the during step is only listed when it lowered the Wall. Without `sent` there is no during step.
 * `chosen` is never checked against the village here: that would tell the sender what the village holds.
 */
export function resolveSiege(
  survivors: Partial<Units>,
  buildings: BuildingLevels,
  chosen: BuildingId | null | undefined,
  sent?: Partial<Units>,
): SiegeHit[] {
  const alive = normalizeUnits(survivors);
  const levels = { ...buildings };
  const hits: SiegeHit[] = [];
  const during = sent ? resolveSiegeDuring(sent, buildings.wall) : null;
  if (during) levels.wall = during.wall;
  const target: BuildingId = isBuildingId(chosen) ? chosen : 'wall';
  for (const unit of UNIT_IDS) {
    const rule = UNITS[unit].siege;
    if (!rule) continue;
    const count = alive[unit];
    // A Wall hit during the battle only shows when it lowered something (a pick elsewhere does not list a Wall miss).
    const duringHit: SiegeHit | undefined = during !== null && (during.dropped[unit] ?? 0) > 0 ? { unit, building: 'wall', from: buildings.wall, to: levels.wall } : undefined;
    if (duringHit) hits.push(duringHit);
    if (!(count > 0)) continue;
    const r = knockDown(target, levels[target], count * rule.power, rule.maxLevels);
    if (duringHit && target === 'wall') duringHit.to = r.level;
    else hits.push({ unit, building: target, from: levels[target], to: r.level });
    levels[target] = r.level;
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
