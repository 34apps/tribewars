// World: terrain, abandoned-village placement, player spawn, protection, points.

import {
  CHIEFTAINS,
  MAP_STAGE_MIN_POINTS,
  RUIN_STAGE_MIN_POINTS,
  type ChieftainId,
  NPC_MIN_SPACING,
  NPC_PLACEMENT_ATTEMPTS_PER_VILLAGE,
  NPC_TIER_WEIGHTS,
  SEED_SALT,
  SPAWN_MIN_SPACING,
  SPAWN_RANDOM_TRIES,
  TERRAIN,
} from './config.ts';
import { hashSeed, mulberry32 } from './random.ts';
import { BUILDING_IDS, GameError } from './types.ts';
import type { Coords, Terrain, VillageState, WorldSettings } from './types.ts';
import { MS_PER_HOUR } from './util.ts';

// ---- Terrain ------------------------------------------------------------------------------------

const TWO_POW_32 = 4294967296;

/** Smooth value noise in [0, 1): random lattice values, smoothstep-interpolated. */
function valueNoise(x: number, y: number, seed: number, salt: number, scale: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hashSeed(seed, salt, x0, y0) / TWO_POW_32;
  const b = hashSeed(seed, salt, x0 + 1, y0) / TWO_POW_32;
  const c = hashSeed(seed, salt, x0, y0 + 1) / TWO_POW_32;
  const d = hashSeed(seed, salt, x0 + 1, y0 + 1) / TWO_POW_32;
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
}

/** Two octaves of value noise, normalised back to [0, 1). */
function field(x: number, y: number, seed: number, salt: number, scale: number): number {
  const coarse = valueNoise(x, y, seed, salt, scale);
  const fine = valueNoise(x, y, seed, salt + 1, scale / TERRAIN.detailScaleDivisor);
  return (coarse + fine * TERRAIN.detailWeight) / (1 + TERRAIN.detailWeight);
}

/** Terrain of a tile; deterministic from (x, y, seed) so the client can draw it without the server. */
export function terrainAt(x: number, y: number, seed: number): Terrain {
  const elevation = field(x, y, seed, SEED_SALT.elevation, TERRAIN.elevationScale);
  if (elevation >= TERRAIN.mountain) return 'mountain';
  if (elevation >= TERRAIN.hills) return 'hills';
  const wetness = field(x, y, seed, SEED_SALT.wetness, TERRAIN.wetnessScale);
  if (wetness >= TERRAIN.lake) return 'lake';
  if (wetness >= TERRAIN.forest) return 'forest';
  return 'grass';
}

/** Villages can stand on everything except mountains and lakes. */
export function isBuildableTerrain(t: Terrain): boolean {
  return t !== 'mountain' && t !== 'lake';
}

// ---- Placement ----------------------------------------------------------------------------------

/** True when a village stands within Chebyshev distance < minSpacing of (x, y) (inside the world). */
function villageNearby(x: number, y: number, minSpacing: number, radius: number, isOccupied: (x: number, y: number) => boolean): boolean {
  const reach = Math.max(0, Math.ceil(minSpacing) - 1);
  for (let dx = -reach; dx <= reach; dx++) {
    const px = x + dx;
    if (px < -radius || px > radius) continue;
    for (let dy = -reach; dy <= reach; dy++) {
      const py = y + dy;
      if (py < -radius || py > radius) continue;
      if (isOccupied(px, py)) return true;
    }
  }
  return false;
}

function randomCoord(rng: () => number, radius: number): number {
  return Math.min(radius, Math.floor(rng() * (2 * radius + 1)) - radius);
}

function pickTier(u: number): number {
  let acc = 0;
  for (let i = 0; i < NPC_TIER_WEIGHTS.length; i++) {
    acc += NPC_TIER_WEIGHTS[i] ?? 0;
    if (u < acc) return i + 1;
  }
  return NPC_TIER_WEIGHTS.length;
}

/**
 * Positions and tiers of the abandoned villages created at world start: round((2r+1)^2 * density)
 * of them on buildable tiles at least NPC_MIN_SPACING apart (Chebyshev). Deterministic from the seed.
 * Returns fewer than the target only if the world is too crowded to fit them.
 */
export function generateNpcPlacements(s: WorldSettings): Array<Coords & { tier: number }> {
  const radius = Math.max(0, Math.floor(s.radius));
  const side = 2 * radius + 1;
  const target = Math.max(0, Math.round(side * side * s.npcDensity));
  const rng = mulberry32(hashSeed(s.seed, SEED_SALT.npcPlacement));
  const taken = new Set<number>();
  const key = (x: number, y: number): number => (x + radius) * side + (y + radius);
  const isTaken = (x: number, y: number): boolean => taken.has(key(x, y));
  const out: Array<Coords & { tier: number }> = [];
  const maxAttempts = target * NPC_PLACEMENT_ATTEMPTS_PER_VILLAGE + 100;
  for (let attempt = 0; out.length < target && attempt < maxAttempts; attempt++) {
    const x = randomCoord(rng, radius);
    const y = randomCoord(rng, radius);
    if (villageNearby(x, y, NPC_MIN_SPACING, radius, isTaken)) continue;
    if (!isBuildableTerrain(terrainAt(x, y, s.seed))) continue;
    taken.add(key(x, y));
    out.push({ x, y, tier: pickTier(rng()) });
  }
  return out;
}

/**
 * A free tile for a new player village: buildable and at least SPAWN_MIN_SPACING (Chebyshev) from every
 * village. Random tries first, then a scan outward from a random tile. `isOccupied(x, y)` reports a
 * village standing exactly on that tile. Throws GameError('not_found') if the whole world is full.
 */
export function findSpawnLocation(isOccupied: (x: number, y: number) => boolean, rng: () => number, s: WorldSettings): Coords {
  const radius = Math.max(0, Math.floor(s.radius));
  const fits = (x: number, y: number): boolean =>
    isBuildableTerrain(terrainAt(x, y, s.seed)) && !villageNearby(x, y, SPAWN_MIN_SPACING, radius, isOccupied);

  for (let i = 0; i < SPAWN_RANDOM_TRIES; i++) {
    const x = randomCoord(rng, radius);
    const y = randomCoord(rng, radius);
    if (fits(x, y)) return { x, y };
  }

  const cx = randomCoord(rng, radius);
  const cy = randomCoord(rng, radius);
  const inWorld = (x: number, y: number): boolean => x >= -radius && x <= radius && y >= -radius && y <= radius;
  const tryTile = (x: number, y: number): boolean => inWorld(x, y) && fits(x, y);
  for (let d = 0; d <= 2 * radius; d++) {
    if (d === 0) {
      if (tryTile(cx, cy)) return { x: cx, y: cy };
      continue;
    }
    for (let i = -d; i <= d; i++) {
      // Top and bottom rows of the ring, then the side columns without their corners.
      if (tryTile(cx + i, cy - d)) return { x: cx + i, y: cy - d };
      if (tryTile(cx + i, cy + d)) return { x: cx + i, y: cy + d };
      if (i > -d && i < d) {
        if (tryTile(cx - d, cy + i)) return { x: cx - d, y: cy + i };
        if (tryTile(cx + d, cy + i)) return { x: cx + d, y: cy + i };
      }
    }
  }
  throw new GameError('not_found', 'There is no free place left in this world.');
}

// ---- Protection and points ----------------------------------------------------------------------

/** When beginner protection of a player created at `createdAt` ends. */
export function protectionEndsAt(createdAt: number, s: WorldSettings): number {
  return Math.round(createdAt + (s.protectionHours * MS_PER_HOUR) / s.speed);
}

/** Points = sum of building levels. */
export function villagePoints(state: VillageState): number {
  let total = 0;
  for (const b of BUILDING_IDS) total += state.buildings[b];
  return total;
}

/** Map picture stage 1..6 for a player village's points. */
export function mapStage(points: number): number {
  let stage = 1;
  for (let i = 0; i < MAP_STAGE_MIN_POINTS.length; i++) if (points >= MAP_STAGE_MIN_POINTS[i]!) stage = i + 1;
  return stage;
}

/** Ruin picture 1..3 (hamlet, town, fort) for an abandoned village's points. */
export function ruinStage(points: number): number {
  let stage = 1;
  for (let i = 0; i < RUIN_STAGE_MIN_POINTS.length; i++) if (points >= RUIN_STAGE_MIN_POINTS[i]!) stage = i + 1;
  return stage;
}

export function isChieftainId(x: unknown): x is ChieftainId {
  return typeof x === 'string' && CHIEFTAINS.some((c) => c.id === x);
}
