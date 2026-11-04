// World: terrain, abandoned-village placement, player spawn, protection, points.

import {
  EXPAND_CORE_RADIUS,
  EXPAND_START_RINGS,
  EXPAND_TILES_PER_PLAYER,
  NPC_RING_BASE,
  NPC_RING_EXTRA_CHANCE,
  NPC_RING_EXTRA_MAX,
  NPC_RING_MAX_RADIUS,
  NPC_RING_MIN_RADIUS,
  CHIEFTAINS,
  BUILDING_POINTS_BASE,
  POINTS_GROWTH,
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
import type { BuildingId, Coords, Terrain, VillageState, WorldSettings } from './types.ts';
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

/**
 * Can a new village (found mission, restart) stand on integer tile (x, y)? Inside the world, buildable ground, and at least
 * SPAWN_MIN_SPACING (Chebyshev) from every village. `isOccupied(x, y)` reports a village standing exactly on that tile.
 */
export function isFreeBuildSite(x: number, y: number, s: WorldSettings, isOccupied: (x: number, y: number) => boolean): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  const radius = Math.max(0, Math.floor(s.radius));
  if (Math.abs(x) > radius || Math.abs(y) > radius) return false;
  return isBuildableTerrain(terrainAt(x, y, s.seed)) && !villageNearby(x, y, SPAWN_MIN_SPACING, radius, isOccupied);
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

// ---- Expanding layout ---------------------------------------------------------------------------

/** Radius of the populated disc when the world holds `playerVillages` player villages and one more is about to land. */
export function expandingRadius(playerVillages: number): number {
  return EXPAND_CORE_RADIUS + Math.sqrt(((Math.max(0, playerVillages) + 1) * EXPAND_TILES_PER_PLAYER) / Math.PI);
}

/**
 * Spawn tile for a new player village in the 'expanding' layout: random point of the disc that grows with the
 * player count (so early players cluster around the centre and later ones ring outward). Falls back to a wider disc,
 * then to the plain scan of findSpawnLocation. Throws GameError('not_found') only if the whole world is full.
 */
export function findExpandingSpawn(
  isOccupied: (x: number, y: number) => boolean,
  rng: () => number,
  s: WorldSettings,
  playerVillages: number,
  /** Land within `edgeBand` tiles inside the edge of the disc instead of anywhere in it (restart placement). */
  edgeBand?: number,
): Coords {
  const radius = Math.max(0, Math.floor(s.radius));
  const fits = (x: number, y: number): boolean =>
    Math.abs(x) <= radius &&
    Math.abs(y) <= radius &&
    isBuildableTerrain(terrainAt(x, y, s.seed)) &&
    !villageNearby(x, y, SPAWN_MIN_SPACING, radius, isOccupied);
  let reach = Math.min(expandingRadius(playerVillages), radius);
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < 300; i++) {
      const angle = rng() * 2 * Math.PI;
      const r = edgeBand === undefined ? Math.sqrt(rng()) * reach : Math.max(0, reach - rng() * edgeBand);
      const x = Math.round(Math.cos(angle) * r);
      const y = Math.round(Math.sin(angle) * r);
      if (fits(x, y)) return { x, y };
    }
    reach = Math.min(reach * 1.3, radius);
  }
  return findSpawnLocation(isOccupied, rng, s);
}

/**
 * Abandoned villages in a ring around `center`: `count` at evenly spaced angles (random phase, jittered) plus, when
 * `extras` is set, up to NPC_RING_EXTRA_MAX more each with chance NPC_RING_EXTRA_CHANCE. Skips unbuildable or crowded tiles.
 * Tiers use the normal weights, so they match the abandoned villages of a classic world.
 */
export function generateNpcRing(
  center: Coords,
  count: number,
  minRadius: number,
  maxRadius: number,
  extras: boolean,
  isOccupied: (x: number, y: number) => boolean,
  rng: () => number,
  s: WorldSettings,
): Array<Coords & { tier: number }> {
  const radius = Math.max(0, Math.floor(s.radius));
  const chosen = new Set<string>();
  const taken = (x: number, y: number): boolean => isOccupied(x, y) || chosen.has(`${x},${y}`);
  const out: Array<Coords & { tier: number }> = [];
  const place = (angle: number, r: number): void => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const jitter = attempt === 0 ? 0 : 2;
      const x = Math.round(center.x + Math.cos(angle) * r + (rng() * 2 - 1) * jitter);
      const y = Math.round(center.y + Math.sin(angle) * r + (rng() * 2 - 1) * jitter);
      if (Math.abs(x) > radius || Math.abs(y) > radius) continue;
      if (villageNearby(x, y, NPC_MIN_SPACING, radius, taken)) continue;
      if (!isBuildableTerrain(terrainAt(x, y, s.seed))) continue;
      chosen.add(`${x},${y}`);
      out.push({ x, y, tier: pickTier(rng()) });
      return;
    }
  };
  const phase = rng() * 2 * Math.PI;
  const n = Math.max(0, Math.floor(count));
  for (let i = 0; i < n; i++) {
    place(phase + (i * 2 * Math.PI) / n + (rng() - 0.5) * 0.7, minRadius + rng() * (maxRadius - minRadius));
  }
  if (extras) {
    for (let e = 0; e < NPC_RING_EXTRA_MAX && rng() < NPC_RING_EXTRA_CHANCE; e++) {
      place(rng() * 2 * Math.PI, minRadius + rng() * (maxRadius - minRadius));
    }
  }
  return out;
}

/** The abandoned villages a newcomer at `spot` brings in the 'expanding' layout. */
export function generateNpcsForSpawn(
  spot: Coords,
  isOccupied: (x: number, y: number) => boolean,
  rng: () => number,
  s: WorldSettings,
): Array<Coords & { tier: number }> {
  return generateNpcRing(spot, NPC_RING_BASE, NPC_RING_MIN_RADIUS, NPC_RING_MAX_RADIUS, true, isOccupied, rng, s);
}

/** Abandoned villages at the creation of an 'expanding' world: rings around the empty centre. */
export function generateExpandingStartNpcs(s: WorldSettings): Array<Coords & { tier: number }> {
  const rng = mulberry32(hashSeed(s.seed, SEED_SALT.npcPlacement));
  const out: Array<Coords & { tier: number }> = [];
  const has = new Set<string>();
  for (const [count, minR, maxR] of EXPAND_START_RINGS) {
    for (const p of generateNpcRing({ x: 0, y: 0 }, count, minR, maxR, true, (x, y) => has.has(`${x},${y}`), rng, s)) {
      has.add(`${p.x},${p.y}`);
      out.push(p);
    }
  }
  return out;
}

// ---- Protection and points ----------------------------------------------------------------------

/** When beginner protection of a player created at `createdAt` ends. */
export function protectionEndsAt(createdAt: number, s: WorldSettings): number {
  return Math.round(createdAt + (s.protectionHours * MS_PER_HOUR) / s.speed);
}

/** Points the single level `level` (1-based) of a building adds. */
export function levelPoints(id: BuildingId, level: number): number {
  if (level < 1) return 0;
  return Math.round(BUILDING_POINTS_BASE[id] * POINTS_GROWTH ** (level - 1));
}

/** Points a building is worth at `level` (sum of its levels' points). */
export function buildingPoints(id: BuildingId, level: number): number {
  let total = 0;
  for (let l = 1; l <= level; l++) total += levelPoints(id, l);
  return total;
}

/** Points = sum over buildings of `buildingPoints` (higher levels are worth more). */
export function villagePoints(state: VillageState): number {
  let total = 0;
  for (const b of BUILDING_IDS) total += buildingPoints(b, state.buildings[b]);
  return total;
}

/** Map picture stage 1..6 for a player village's points. */
export function mapStage(points: number): number {
  let stage = 1;
  for (let i = 0; i < MAP_STAGE_MIN_POINTS.length; i++) if (points >= MAP_STAGE_MIN_POINTS[i]!) stage = i + 1;
  return stage;
}

/** Abandoned-village picture 1..6 for its points (same steps as `mapStage`). */
export function ruinStage(points: number): number {
  let stage = 1;
  for (let i = 0; i < RUIN_STAGE_MIN_POINTS.length; i++) if (points >= RUIN_STAGE_MIN_POINTS[i]!) stage = i + 1;
  return stage;
}

export function isChieftainId(x: unknown): x is ChieftainId {
  return typeof x === 'string' && CHIEFTAINS.some((c) => c.id === x);
}
