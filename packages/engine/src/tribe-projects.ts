// Tribe projects (docs/GAME_DESIGN.md 18.5): pure helpers. The server keeps the store, runs and ledger and decides who may do what.

import {
  POP_PER_UNIT,
  PROJECT_BASE_COST_PER_RESOURCE,
  PROJECT_BUILD_HOURS_PER_LEVEL,
  PROJECT_COST_GROWTH,
  ROADS_SPEED_BONUS,
  TRIBE_PROJECT_MAX_LEVEL,
  TRIBE_STORE_LOOT_SHARE,
  UNITS,
  WARD_DEFENCE_BONUS,
  WATCHTOWER_ROUND_TO,
  WATCHTOWER_SIZE_BANDS,
} from './config.ts';
import type { WatchtowerSizeBand } from './api.ts';
import { RESOURCE_IDS, UNIT_IDS } from './types.ts';
import type { Resources, TribeProjectId, UnitId, Units, WorldSettings } from './types.ts';
import { MS_PER_HOUR, emptyResources } from './util.ts';

/** Cost of building `level` (1-based) of any project: the same amount of each of the 4 resources. */
export function projectCost(level: number): Resources {
  const each = Math.round(PROJECT_BASE_COST_PER_RESOURCE * Math.pow(PROJECT_COST_GROWTH, Math.max(0, level - 1)));
  const out = emptyResources();
  for (const r of RESOURCE_IDS) out[r] = each;
  return out;
}

/** Build time of `level` in ms: level * PROJECT_BUILD_HOURS_PER_LEVEL hours, divided by the world speed. */
export function projectBuildMs(level: number, s: Pick<WorldSettings, 'speed'>): number {
  return Math.max(1, Math.round((level * PROJECT_BUILD_HOURS_PER_LEVEL * MS_PER_HOUR) / s.speed));
}

export const projectMaxLevel = (_p: TribeProjectId): number => TRIBE_PROJECT_MAX_LEVEL;

/** Travel-time factor of Roads at `level` (1 = no effect): support and shipments between members of one tribe. */
export function roadsMultiplier(level: number): number {
  const l = Math.min(TRIBE_PROJECT_MAX_LEVEL, Math.floor(level));
  return l >= 1 ? 1 - (ROADS_SPEED_BONUS[l - 1] ?? 0) : 1;
}

/** Apply Roads to a travel time (ms), rounding up so it is never zero for a real trip. */
export function applyRoads(ms: number, level: number): number {
  return level >= 1 ? Math.ceil(ms * roadsMultiplier(level)) : ms;
}

/** Defence factor of Wards at `level` for the holding tribe's side at a map site (1 = no effect). */
export function wardMultiplier(level: number): number {
  const l = Math.min(TRIBE_PROJECT_MAX_LEVEL, Math.floor(level));
  return l >= 1 ? 1 + (WARD_DEFENCE_BONUS[l - 1] ?? 0) : 1;
}

/** What the finished level does now, as a plain number for the client's text (see TribeProjectOptionDto). */
export function projectEffect(project: TribeProjectId, level: number): number {
  const l = Math.max(0, Math.min(TRIBE_PROJECT_MAX_LEVEL, Math.floor(level)));
  if (l === 0) return 0;
  if (project === 'roads') return ROADS_SPEED_BONUS[l - 1] ?? 0;
  if (project === 'wards') return WARD_DEFENCE_BONUS[l - 1] ?? 0;
  return l;
}

export interface WatchtowerInfo {
  sizeBand?: WatchtowerSizeBand;
  slowestUnit?: UnitId;
  sizeAbout?: number;
}

/**
 * What a Watchtower of `level` shows about an incoming attack. Chieftains are never counted or named (owner decision 11):
 * a Chieftain-only attack is just "small" with nothing else. Level 0 shows nothing.
 */
export function watchtowerInfo(units: Units, level: number): WatchtowerInfo {
  if (level < 1) return {};
  let pop = 0;
  let slowest: UnitId | undefined;
  for (const u of UNIT_IDS) {
    if (u === 'chieftain' || !(units[u] > 0)) continue;
    pop += units[u] * POP_PER_UNIT[u];
    if (slowest === undefined || UNITS[u].speed < UNITS[slowest].speed) slowest = u;
  }
  const [a, b, c] = WATCHTOWER_SIZE_BANDS;
  const out: WatchtowerInfo = { sizeBand: pop < a ? 'small' : pop < b ? 'medium' : pop < c ? 'large' : 'huge' };
  if (level >= 2 && slowest !== undefined) out.slowestUnit = slowest;
  if (level >= 3 && pop > 0) out.sizeAbout = Math.max(WATCHTOWER_ROUND_TO, Math.round(pop / WATCHTOWER_ROUND_TO) * WATCHTOWER_ROUND_TO);
  return out;
}

/** The part of the Tribe Store a won attack on the store village may reach: a fifth of each resource, rounded down. */
export function storeLootable(store: Resources): Resources {
  const out = emptyResources();
  for (const r of RESOURCE_IDS) out[r] = Math.max(0, Math.floor(store[r] * TRIBE_STORE_LOOT_SHARE));
  return out;
}

/**
 * Split a raid's `loot` between the village stock and the store, per resource in proportion to what each offered
 * (`villagePool` = stock above the Vault, `storePool` = storeLootable). The parts always add up to the loot, neither exceeds its pool.
 */
export function splitLoot(loot: Resources, villagePool: Resources, storePool: Resources): { fromVillage: Resources; fromStore: Resources } {
  const fromVillage = emptyResources();
  const fromStore = emptyResources();
  for (const r of RESOURCE_IDS) {
    const v = Math.max(0, villagePool[r]);
    const s = Math.max(0, storePool[r]);
    const take = Math.max(0, Math.min(loot[r], v + s));
    let st = v + s > 0 ? Math.round((take * s) / (v + s)) : 0;
    st = Math.max(0, Math.min(st, s, take));
    if (take - st > v) st = take - v; // never more from the village than it offered
    fromStore[r] = st;
    fromVillage[r] = take - st;
  }
  return { fromVillage, fromStore };
}
