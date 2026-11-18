// Map sites: the Great Fire, eight Fire Shrines, six Waymarks and six Lookouts (docs/GAME_DESIGN.md 18.4b "Step 5"). Placement, militia, wake-up, daily Renown
// per member and the battle shape. Pure and deterministic from the world seed; ownership and garrisons live on the server.

import {
  BUILDINGS,
  LOOKOUT_RADIUS,
  LOOKOUT_SIZE_BANDS,
  POP_PER_UNIT,
  SIDE_SITE_COUNT,
  SIDE_SITE_RING_RADIUS,
  SHRINE_AWAKE_MILITIA_FACTOR,
  SHRINE_COUNT_PER_RING,
  SHRINE_RING_RADII,
  SHRINE_WAKE_DAYS,
  SITE_CALM_HOURS,
  SITE_KEEPERS_REGROW_HOURS,
  SITE_WALL_STEP_HOURS,
  SITE_MAX_POPULATION,
  SITE_MILITIA,
  SITE_MIN_SPACING,
  SITE_NO_VILLAGE_RADIUS,
  SITE_RENOWN_PER_DAY,
} from './config.ts';
import type { SiteKind } from './config.ts';
import { hashSeed, mulberry32 } from './random.ts';
import { BUILDING_IDS } from './types.ts';
import type { SightingSize } from './api.ts';
import type { BattleResult, BuildingLevels, Coords, Units, VillageRanks, VillageState, WorldSettings } from './types.ts';
import { MS_PER_HOUR, emptyResources, emptyUnits } from './util.ts';
import { resolveBattle } from './army.ts';
import { isBuildableTerrain, terrainAt } from './world.ts';

/** One site on the map. `id` is its stable index: 1 = Great Fire, 2-5 inner ring shrines, 6-9 outer ring shrines, 10-21 the ring of Waymarks (even k) and Lookouts. */
export interface SiteDef {
  id: number;
  kind: SiteKind;
  x: number;
  y: number;
}

// ---- Placement ----------------------------------------------------------------------------------

const SITE_SEED_SALT = 5151;
/** Salt of the seeded rotation of the Waymark / Lookout ring (its own, so the rings of the shrines never move). */
const SIDE_SITE_SEED_SALT = 5152;
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
function nearestLegalTile(ideal: { x: number; y: number }, seed: number, amount: number, radius: number, placed: readonly SiteDef[]): { x: number; y: number } | null {
  const minSq = SITE_MIN_SPACING * SITE_MIN_SPACING;
  for (const [dx, dy] of spiralOffsets()) {
    const x = ideal.x + dx;
    const y = ideal.y + dy;
    if (Math.abs(x) > radius || Math.abs(y) > radius) continue;
    if (!isBuildableTerrain(terrainAt(x, y, seed, amount))) continue;
    if (placed.some((p) => (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < minSq)) continue;
    return { x, y };
  }
  return null;
}

/**
 * The map's sites, a pure function of the world seed and radius: the Great Fire near (0,0), then SHRINE_COUNT_PER_RING Fire Shrines on
 * each ring of SHRINE_RING_RADII at 90 degree spacing (the count is fixed at 4) with a seeded rotation per ring. Each ideal spot moves to the nearest
 * tile (spiral search) inside the world, not mountain or lake, and at least SITE_MIN_SPACING (Euclid) from every site placed before it.
 * Then, last (so every earlier site keeps its place and id), SIDE_SITE_COUNT Waymarks and Lookouts alternate (waymark, lookout, ...) on
 * one ring of SIDE_SITE_RING_RADIUS, 30 degrees apart with their own seeded rotation, ids from 10, through the same legal-tile search.
 * Order and ids are fixed (1 = Great Fire); a site that finds no tile (tiny world) is left out, the others keep their ids.
 */
export function generateSites(seed: number, radius: number, terrainAmount = 1): SiteDef[] {
  const r = Math.max(0, Math.floor(radius));
  const sites: SiteDef[] = [];
  const place = (id: number, kind: SiteKind, ideal: { x: number; y: number }): void => {
    const clamped = { x: Math.max(-r, Math.min(r, ideal.x)), y: Math.max(-r, Math.min(r, ideal.y)) };
    const spot = nearestLegalTile(clamped, seed, terrainAmount, r, sites);
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
  // The ring of Waymarks and Lookouts: a seeded start angle in [0, 30 degrees), then turned by 30 degrees (cos = sqrt(3)/2, sin = 1/2).
  const start = mulberry32(hashSeed(seed, SIDE_SITE_SEED_SALT, 0))() * (Math.PI / 6);
  const first = sinCos(start);
  const turnCos = Math.sqrt(3) / 2;
  const turnSin = 0.5;
  let ux = first.cos;
  let uy = first.sin;
  for (let k = 0; k < SIDE_SITE_COUNT; k++) {
    place(id++, k % 2 === 0 ? 'waymark' : 'lookout', { x: Math.round(SIDE_SITE_RING_RADIUS * ux), y: Math.round(SIDE_SITE_RING_RADIUS * uy) });
    [ux, uy] = [ux * turnCos - uy * turnSin, ux * turnSin + uy * turnCos];
  }
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

/** Population of the militia (the keepers) of an unheld site at full strength (doubled while awake); `fraction` (0..1) is how much of them stands now. */
export function siteMilitiaPopulation(kind: SiteKind, awake: boolean, fraction = 1): number {
  // Waymarks and Lookouts never wake.
  const wakes = kind === 'fire_shrine' || kind === 'great_fire';
  return SITE_MILITIA[kind] * (awake && wakes ? SHRINE_AWAKE_MILITIA_FACTOR : 1) * Math.max(0, Math.min(1, fraction));
}

/** Militia of an unheld site: half the population as pikemen, the rest as shieldbearers (POP_PER_UNIT sizes the counts). `fraction` as above. */
export function siteMilitia(kind: SiteKind, awake: boolean, fraction = 1): Units {
  const pop = siteMilitiaPopulation(kind, awake, fraction);
  const u = emptyUnits();
  u.pikeman = Math.floor(pop / 2 / POP_PER_UNIT.pikeman);
  u.guard = Math.floor((pop - u.pikeman * POP_PER_UNIT.pikeman) / POP_PER_UNIT.guard);
  return u;
}

// ---- Keepers that grow back, the site Wall that builds itself -----------------------------------

/** Length of the keepers' regrowth in ms: SITE_KEEPERS_REGROW_HOURS divided by world speed. */
export function keepersRegrowMs(s: Speed): number {
  return Math.round((SITE_KEEPERS_REGROW_HOURS * MS_PER_HOUR) / s.speed);
}

/**
 * Share (0..1) of the keepers standing at time `now`, given the stored `base` share at `since` (set to 0 when the holding tribe's last troops leave
 * and after a fight that killed keepers). Rises linearly to 1 over keepersRegrowMs. A site never held and never fought is `{ base: 1, since: 0 }`.
 * A held site has no keepers; the caller does not ask then. A clock before `since` gives `base`.
 */
export function keepersFraction(state: { base: number; since: number }, now: number, s: Speed): number {
  const grown = now > state.since ? (now - state.since) / keepersRegrowMs(s) : 0;
  return Math.max(0, Math.min(1, state.base + grown));
}

/** Length of one site Wall step in ms: SITE_WALL_STEP_HOURS divided by world speed. */
export function siteWallStepMs(s: Speed): number {
  return Math.round((SITE_WALL_STEP_HOURS * MS_PER_HOUR) / s.speed);
}

/** The top Wall level of a site: the top Wall level of the game. */
export function siteWallMax(): number {
  return BUILDINGS.wall.maxLevel;
}

/** Wall level of a site at `now`, given its stored `level` as of `at` (a clock before `at` gives `level`). Rises one level per step, up to siteWallMax. */
export function siteWallLevel(state: { level: number; at: number }, now: number, s: Speed): number {
  const steps = now > state.at ? Math.floor((now - state.at) / siteWallStepMs(s)) : 0;
  return Math.min(siteWallMax(), Math.max(0, state.level) + steps);
}

/** Ms until the next Wall level at `now`, or null at the top level. */
export function siteWallNextMs(state: { level: number; at: number }, now: number, s: Speed): number | null {
  if (siteWallLevel(state, now, s) >= siteWallMax()) return null;
  const step = siteWallStepMs(s);
  return step - (now > state.at ? (now - state.at) % step : 0);
}

/** Most population that can be stationed at a site. */
export function siteMaxPopulation(kind: SiteKind): number {
  return SITE_MAX_POPULATION[kind];
}

/** Renown per 24 game hours (before world speed) each member of the holding tribe earns from one held site. Waymarks and Lookouts give none. */
export function siteRenownPerDay(kind: SiteKind, awake: boolean): number {
  return SITE_RENOWN_PER_DAY[awake ? 'awake' : 'dormant'][kind];
}

/** Sum of siteRenownPerDay over the sites a tribe holds, at one moment (before world speed). No cap: holding more is worth more. */
export function tribeRenownPerDay(heldKinds: readonly SiteKind[], awake: boolean): number {
  let sum = 0;
  for (const k of heldKinds) sum += siteRenownPerDay(k, awake);
  return sum;
}

/**
 * Renown one member earns from `from` to `to` (ms) while their tribe holds `heldKinds` the whole time: the daily rate scaled by world speed,
 * split at `wakesAt` where the sites wake and the rate changes. 0 for an empty or backwards span (a clock that moved back never pays).
 */
export function siteRenownAccrued(heldKinds: readonly SiteKind[], from: number, to: number, wakesAt: number, s: Speed): number {
  if (!(to > from) || heldKinds.length === 0) return 0;
  const dormantMs = Math.max(0, Math.min(to, wakesAt) - from);
  const awakeMs = Math.max(0, to - Math.max(from, wakesAt));
  const perMs = (awake: boolean): number => (tribeRenownPerDay(heldKinds, awake) * s.speed) / (24 * MS_PER_HOUR);
  return perMs(false) * dormantMs + perMs(true) * awakeMs;
}

// ---- Waymarks and Lookouts ----------------------------------------------------------------------

/** Tiles of the Waymarks held by `tribeId` (travel time for that tribe's members: pass the result to travelRoute and friends). Empty without a tribe. */
export function tribeWaymarks(
  sites: ReadonlyArray<{ kind: SiteKind; x: number; y: number; holder: { tribeId: number } | null }>,
  tribeId: number | null,
): Coords[] {
  if (tribeId === null) return [];
  return sites.filter((s) => s.kind === 'waymark' && s.holder !== null && s.holder.tribeId === tribeId).map((s) => ({ x: s.x, y: s.y }));
}

/** Distance (tiles) from point `p` to the segment a-b. */
function segmentDistance(p: Coords, a: Coords, b: Coords): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A Lookout sees a march when the straight line from `from` to `to` passes within LOOKOUT_RADIUS (inclusive) of it. */
export function lookoutSees(lookout: Coords, from: Coords, to: Coords): boolean {
  return segmentDistance(lookout, from, to) <= LOOKOUT_RADIUS;
}

/** The size band a Lookout shows for an army of this population: never the real numbers. */
export function sightingSize(population: number): SightingSize {
  if (population < LOOKOUT_SIZE_BANDS.smallBelow) return 'small';
  if (population < LOOKOUT_SIZE_BANDS.mediumBelow) return 'medium';
  return 'large';
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
  /** Defence factor for the defending side (Wards of the holding tribe, GAME_DESIGN 18.5). Default 1. */
  defenceMultiplier?: number;
  /** The site's Wall level now (default 0): Log Rams lower it, and whatever is left adds its percentage bonus for everyone standing at the site. */
  wall?: number;
}

/**
 * A battle at a site: resolveBattle against a defender with no buildings (wall 0), no resources and no loot, the militia as its own
 * troops and no Bulwark on it. Only Log Rams do damage, to the site's Wall (`wall`). The village Wall militia does not apply (the keepers are the militia).
 * The result is the usual BattleResult: `defenderLosses` is the militia's, `supportLosses[i]` the contingents'. Apply the losses to
 * the site's stored garrison yourself (the engine keeps no site state).
 */
export function resolveSiteBattle(input: SiteBattleInput): BattleResult {
  const buildings = {} as BuildingLevels;
  for (const b of BUILDING_IDS) buildings[b] = 0;
  buildings.wall = Math.max(0, Math.floor(input.wall ?? 0));
  const defender: VillageState = {
    resources: emptyResources(),
    lastUpdate: 0,
    buildings,
    troops: { ...input.militia },
    away: emptyUnits(),
    buildQueue: [],
    trainQueues: { barracks: [], stables: [], wrightyard: [], bannerhall: [] },
    // The keepers are the militia: the Wall's own village militia does not apply (resolveBattle gives `npc` villages none), only its percentage bonus.
    npc: { tier: 1, growthSteps: 0, createdAt: 0 },
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
    defenceMultiplier: input.defenceMultiplier,
  });
  // Only the Wall can be hit (a Firecart finds no building to burn).
  return { ...result, siege: (result.siege ?? []).filter((h) => h.building === 'wall') };
}
