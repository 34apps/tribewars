// Terrain on the road (docs/GAME_DESIGN.md 18.4a): the route between two villages is the straight line, sampled every
// TERRAIN_SAMPLE_STEP tiles; each sample is a stretch of ground with its terrain. Pure and deterministic from
// (from, to, seed): the client previews exactly what the server will compute. Nothing here reads a client time or choice.

import { TERRAIN_MAX_SLOWDOWN, TERRAIN_SAMPLE_STEP, TERRAIN_SPEED, UNITS, UNIT_TERRAIN_FAMILY } from './config.ts';
import type { TerrainFamily } from './config.ts';
import { TERRAINS } from './types.ts';
import type { Coords, Terrain, Units, WorldSettings } from './types.ts';
import { MS_PER_HOUR, distance } from './util.ts';
import { terrainAt } from './world.ts';

/** One stretch of the route: where its middle is and what ground it crosses. */
export interface RouteSample {
  x: number;
  y: number;
  terrain: Terrain;
}

export interface Route {
  /** Straight-line distance in tiles. */
  length: number;
  /** Length of every sample in tiles (length / samples.length). */
  step: number;
  /** In order from `from` to `to` as asked. */
  samples: RouteSample[];
  /** Tiles of each terrain along the route (sums to `length`, up to float rounding). */
  tiles: Record<Terrain, number>;
}

function emptyTiles(): Record<Terrain, number> {
  const out = {} as Record<Terrain, number>;
  for (const t of TERRAINS) out[t] = 0;
  return out;
}

/**
 * The terrain along the straight line from `from` to `to`. The sample points are computed from the endpoints in a fixed
 * order (lower x, then lower y first), so the route back is exactly the same stretches reversed: a return trip takes
 * as long as the way out.
 */
export function travelRoute(from: Coords, to: Coords, seed: number): Route {
  const swap = from.x > to.x || (from.x === to.x && from.y > to.y);
  const a = swap ? to : from;
  const b = swap ? from : to;
  const length = distance(a, b);
  const tiles = emptyTiles();
  if (!(length > 0)) return { length: 0, step: 0, samples: [], tiles };
  const n = Math.max(1, Math.ceil(length / TERRAIN_SAMPLE_STEP));
  const step = length / n;
  const samples: RouteSample[] = [];
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    const terrain = terrainAt(Math.round(x), Math.round(y), seed);
    samples.push({ x, y, terrain });
    tiles[terrain] += step;
  }
  if (swap) samples.reverse();
  return { length, step, samples, tiles };
}

/**
 * The distance a walker of `family` effectively covers: every tile counts 1 / factor, so slow ground is "longer". Equal to
 * the plain distance over grass, never more than TERRAIN_MAX_SLOWDOWN times it, never less.
 */
export function effectiveDistance(route: Route, family: TerrainFamily): number {
  if (!(route.length > 0)) return 0;
  const speed = TERRAIN_SPEED[family];
  let slowed = false;
  let sum = 0;
  for (const t of TERRAINS) {
    if (route.tiles[t] > 0 && t !== 'grass') slowed = true;
    sum += route.tiles[t] / speed[t];
  }
  if (!slowed) return route.length; // all grass: exactly the old distance, no float noise
  return Math.min(route.length * TERRAIN_MAX_SLOWDOWN, Math.max(route.length, sum));
}

/**
 * Travel time in ms for a walker of `family` at `speed` tiles per hour (before world speed) over `route`.
 * `worldSpeed` is the MOVEMENT speed: callers pass `moveSpeed(settings)` (world speed times the world's unit speed).
 */
export function routeTimeMs(route: Route, family: TerrainFamily, speed: number, worldSpeed: number): number {
  if (!(speed > 0)) return Infinity;
  // Multiply before dividing so exact results (e.g. 5 tiles at 6 tiles/h) don't pick up float noise.
  return Math.ceil((effectiveDistance(route, family) * MS_PER_HOUR) / (speed * worldSpeed));
}

/**
 * Slowest unit's time over the route: each unit's family walks the terrain at its own pace, the army arrives with the
 * last one. `Infinity` for an empty army. `worldSpeed`: pass `moveSpeed(settings)`, not `settings.speed`.
 */
export function armyRouteTimeMs(route: Route, units: Units, worldSpeed: number): number {
  let slowest = 0;
  let any = false;
  for (const id of Object.keys(UNITS) as Array<keyof Units>) {
    if (!(units[id] > 0)) continue;
    any = true;
    slowest = Math.max(slowest, routeTimeMs(route, UNIT_TERRAIN_FAMILY[id], UNITS[id].speed, worldSpeed));
  }
  return any ? slowest : Infinity;
}

/** What the send dialog shows: the time on flat ground, the real time, and how much of the way is slow ground. */
export interface TravelPreview {
  flatMs: number;
  ms: number;
  route: Route;
}

/** Terrain tiles of the route that slow `family` down (everything except grass), for "3 tiles of hills" texts. */
export function slowTiles(route: Route): number {
  return route.length - route.tiles.grass;
}
