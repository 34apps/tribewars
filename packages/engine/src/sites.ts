// Map sites: the Great Fire and eight Fire Shrines (docs/GAME_DESIGN.md 18.4b "Step 5"). Placement, militia, wake-up, Renown
// bonus and the battle shape. Pure and deterministic from the world seed; ownership and garrisons live on the server.

import {
  POP_PER_UNIT,
  SHRINE_AWAKE_MILITIA_FACTOR,
  SHRINE_COUNT_PER_RING,
  SHRINE_RING_RADII,
  SHRINE_WAKE_DAYS,
  SITE_CALM_HOURS,
  SITE_MAX_POPULATION,
  SITE_MILITIA,
  SITE_MIN_SPACING,
  SITE_NO_VILLAGE_RADIUS,
  SITE_RENOWN_BONUS,
  SITE_RENOWN_BONUS_CAP,
} from './config.ts';
import type { SiteKind } from './config.ts';
import { hashSeed, mulberry32 } from './random.ts';
import { BUILDING_IDS } from './types.ts';
import type { BattleResult, BuildingLevels, Units, VillageRanks, VillageState, WorldSettings } from './types.ts';
import { MS_PER_HOUR, emptyResources, emptyUnits } from './util.ts';
import { resolveBattle } from './army.ts';
import { isBuildableTerrain, terrainAt } from './world.ts';

/** One site on the map. `id` is its stable index: 1 = Great Fire, 2-5 inner ring shrines, 6-9 outer ring shrines. */
export interface SiteDef {
  id: number;
  kind: SiteKind;
  x: number;
  y: number;
}

// ---- Placement ----------------------------------------------------------------------------------

const SITE_SEED_SALT = 5151;
/** How far (tiles, per axis) an ideal spot may move to find a legal tile. Far beyond what any real seed needs. */
const SEARCH_REACH = 40;

/** Sine and cosine by Taylor series using only + - * / (IEEE-exact), so every platform rounds the same tile. For 0 <= a <= pi/2. */
function sinCos(a: number): { sin: number; cos: number } {
  let sin = 0;
  let cos = 0;
  let term = 1;
  for (let n = 0; n < 14; n++) {
    // term = a^n / n!
    if (n % 2 === 0) cos += (n % 4 === 0 ? 1 : -1) * term;
    else sin += (n % 4 === 1 ? 1 : -1) * term;
    term = (term * a) / (n + 1);
  }
  return { sin, cos };
}

let offsetCache: Array<[number, number]> | null = null;
/** Offsets within SEARCH_REACH, nearest first; ties by dy then dx (fixed order, so the search is deterministic). */
function spiralOffsets(): Array<[number, number]> {
  if (offsetCache) return offsetCache;
  const list: Array<[number, number]> = [];
  for (let dy = -SEARCH_REACH; dy <= SEARCH_REACH; dy++) for (let dx = -SEARCH_REACH; dx <= SEARCH_REACH; dx++) list.push([dx, dy]);
  list.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);
  offsetCache = list;
  return list;
}

/** Nearest legal tile to the ideal spot, or null when none lies within reach: inside the world, no mountain or lake, spaced from placed sites. */
function nearestLegalTile(ideal: { x: number; y: number }, seed: number, radius: number, placed: readonly SiteDef[]): { x: number; y: number } | null {
  const minSq = SITE_MIN_SPACING * SITE_MIN_SPACING;
  for (const [dx, dy] of spiralOffsets()) {
    const x = ideal.x + dx;
    const y = ideal.y + dy;
    if (Math.abs(x) > radius || Math.abs(y) > radius) continue;
    if (!isBuildableTerrain(terrainAt(x, y, seed))) continue;
    if (placed.some((p) => (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < minSq)) continue;
    return { x, y };
  }
  return null;
}

/**
 * The map's sites, a pure function of the world seed and radius: the Great Fire near (0,0), then SHRINE_COUNT_PER_RING Fire Shrines on
 * each ring of SHRINE_RING_RADII at 90 degree spacing (the count is fixed at 4) with a seeded rotation per ring. Each ideal spot moves to the nearest
 * tile (spiral search) inside the world, not mountain or lake, and at least SITE_MIN_SPACING (Euclid) from every site placed before it.
 * Order and ids are fixed (1 = Great Fire); a site that finds no tile (tiny world) is left out, the others keep their ids.
 */
export function generateSites(seed: number, radius: number): SiteDef[] {
  const r = Math.max(0, Math.floor(radius));
  const sites: SiteDef[] = [];
  const place = (id: number, kind: SiteKind, ideal: { x: number; y: number }): void => {
    const clamped = { x: Math.max(-r, Math.min(r, ideal.x)), y: Math.max(-r, Math.min(r, ideal.y)) };
    const spot = nearestLegalTile(clamped, seed, r, sites);
    if (spot) sites.push({ id, kind, x: spot.x, y: spot.y });
  };
  place(1, 'great_fire', { x: 0, y: 0 });
  let id = 2;
  SHRINE_RING_RADII.forEach((ringRadius, ring) => {
    const angle = mulberry32(hashSeed(seed, SITE_SEED_SALT, ring))() * (Math.PI / 2);
    const { sin, cos } = sinCos(angle);
    for (let k = 0; k < SHRINE_COUNT_PER_RING; k++) {
      // 90 degree spacing: shrine k is the first one turned k quarter turns, an exact swap of coordinates (SHRINE_COUNT_PER_RING is 4).
      let ux = cos;
      let uy = sin;
      for (let q = 0; q < k; q++) [ux, uy] = [-uy, ux];
      place(id++, 'fire_shrine', { x: Math.round(ringRadius * ux), y: Math.round(ringRadius * uy) });
    }
  });
  return sites;
}

/**
 * True when (x, y) is within SITE_NO_VILLAGE_RADIUS of a site. Distance is Chebyshev (a square of tiles, like the village spacing
 * rule): a tile is near when max(|dx|, |dy|) < SITE_NO_VILLAGE_RADIUS. Abandoned-village generation and new-player landing use it.
 */
export function isNearSite(x: number, y: number, sites: ReadonlyArray<{ x: number; y: number }>): boolean {
  return sites.some((s) => Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) < SITE_NO_VILLAGE_RADIUS);
}

// ---- Timing -------------------------------------------------------------------------------------

type Speed = Pick<WorldSettings, 'speed'>;

/** Length of the dormant phase in ms: SHRINE_WAKE_DAYS divided by world speed. */
export function shrineWakeMs(s: Speed): number {
  return Math.round((SHRINE_WAKE_DAYS * 24 * MS_PER_HOUR) / s.speed);
}

/** Calm time after a capture in ms: SITE_CALM_HOURS divided by world speed. */
export function siteCalmMs(s: Speed): number {
  return Math.round((SITE_CALM_HOURS * MS_PER_HOUR) / s.speed);
}

/** Sites (shrines and the Great Fire) are awake once shrineWakeMs has passed since the world was created. */
export function isShrineAwake(worldCreatedAt: number, now: number, s: Speed): boolean {
  return now - worldCreatedAt >= shrineWakeMs(s);
}

// ---- Militia, cap, bonus ------------------------------------------------------------------------

/** Population of the militia of an unheld site (doubled while awake). */
export function siteMilitiaPopulation(kind: SiteKind, awake: boolean): number {
  return SITE_MILITIA[kind] * (awake ? SHRINE_AWAKE_MILITIA_FACTOR : 1);
}

/** Militia of an unheld site: half the population as pikemen, the rest as shieldbearers (POP_PER_UNIT sizes the counts). */
export function siteMilitia(kind: SiteKind, awake: boolean): Units {
  const pop = siteMilitiaPopulation(kind, awake);
  const u = emptyUnits();
  u.pikeman = Math.floor(pop / 2 / POP_PER_UNIT.pikeman);
  u.guard = Math.floor((pop - u.pikeman * POP_PER_UNIT.pikeman) / POP_PER_UNIT.guard);
  return u;
}

/** Most population that can be stationed at a site. */
export function siteMaxPopulation(kind: SiteKind): number {
  return SITE_MAX_POPULATION[kind];
}

/** Renown bonus (0.04 = +4%) one held site gives every member of the holding tribe. */
export function siteBonus(kind: SiteKind, awake: boolean): number {
  return SITE_RENOWN_BONUS[awake ? 'awake' : 'dormant'][kind];
}

/** Sum of the held sites' bonuses, capped at SITE_RENOWN_BONUS_CAP: add it to 1 for the Renown multiplier. */
export function tribeRenownBonus(heldSites: ReadonlyArray<{ kind: SiteKind; awake: boolean }>): number {
  let sum = 0;
  for (const h of heldSites) sum += siteBonus(h.kind, h.awake);
  return Math.min(SITE_RENOWN_BONUS_CAP, sum);
}

// ---- Battle -------------------------------------------------------------------------------------

export interface SiteBattleInput {
  attackerUnits: Units;
  /** The site's own defenders: the militia of an unheld site, or nothing (empty) when only stationed troops hold it. */
  militia: Units;
  /** Troops stationed at the site by the holding tribe (each contingent fights with its home village's ranks). */
  support?: Units[];
  attackerRanks?: VillageRanks;
  supportRanks?: Array<VillageRanks | undefined>;
  seed: number;
}

/**
 * A battle at a site: resolveBattle against a defender with no buildings (wall 0), no resources and no loot, the militia as its own
 * troops and no Bulwark on it. No siege damage. Note resolveBattle still adds the small flat WALL_BASE_DEFENSE every defender has.
 * The result is the usual BattleResult: `defenderLosses` is the militia's, `supportLosses[i]` the contingents'. Apply the losses to
 * the site's stored garrison yourself (the engine keeps no site state).
 */
export function resolveSiteBattle(input: SiteBattleInput): BattleResult {
  const buildings = {} as BuildingLevels;
  for (const b of BUILDING_IDS) buildings[b] = 0;
  const defender: VillageState = {
    resources: emptyResources(),
    lastUpdate: 0,
    buildings,
    troops: { ...input.militia },
    away: emptyUnits(),
    buildQueue: [],
    trainQueues: { barracks: [], stables: [], bannerhall: [] },
  };
  const result = resolveBattle({
    attackerUnits: input.attackerUnits,
    defender,
    support: input.support,
    attackerRanks: input.attackerRanks,
    supportRanks: input.supportRanks,
    seed: input.seed,
    noLoot: true,
    siegeTarget: null,
  });
  return { ...result, siege: [] };
}
