import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_WORLD,
  GameError,
  NPC_MIN_SPACING,
  NPC_RING_BASE,
  NPC_RING_EXTRA_MAX,
  NPC_TIER_WEIGHTS,
  SPAWN_MIN_SPACING,
  createPlayerVillage,
  expandingRadius,
  findExpandingSpawn,
  findSpawnLocation,
  generateExpandingStartNpcs,
  generateNpcPlacements,
  generateNpcsForSpawn,
  isBuildableTerrain,
  mulberry32,
  protectionEndsAt,
  terrainAt,
  villagePoints,
} from '../src/index.ts';
import type { Terrain, WorldSettings } from '../src/index.ts';
import { HOUR, S1, S10 } from './helpers.ts';

const TERRAINS: Terrain[] = ['grass', 'forest', 'hills', 'mountain', 'lake'];
const chebyshev = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

describe('terrain', () => {
  it('is deterministic per seed and differs between seeds', () => {
    let differing = 0;
    for (let x = -20; x <= 20; x++) {
      for (let y = -20; y <= 20; y++) {
        assert.equal(terrainAt(x, y, 123), terrainAt(x, y, 123));
        if (terrainAt(x, y, 123) !== terrainAt(x, y, 124)) differing++;
      }
    }
    assert.ok(differing > 100);
  });

  it('uses all five terrains in sensible proportions and forms patches, not static', () => {
    const counts = new Map<Terrain, number>();
    let sameRight = 0;
    let total = 0;
    for (let x = -100; x <= 100; x++) {
      for (let y = -100; y <= 100; y++) {
        const t = terrainAt(x, y, DEFAULT_WORLD.seed);
        assert.ok(TERRAINS.includes(t));
        counts.set(t, (counts.get(t) ?? 0) + 1);
        if (terrainAt(x + 1, y, DEFAULT_WORLD.seed) === t) sameRight++;
        total++;
      }
    }
    for (const t of TERRAINS) assert.ok((counts.get(t) ?? 0) / total > 0.03, `${t} is too rare`);
    assert.ok((counts.get('grass') ?? 0) / total > 0.3, 'grass should dominate');
    const blocked = ((counts.get('mountain') ?? 0) + (counts.get('lake') ?? 0)) / total;
    assert.ok(blocked < 0.15, `room for many players: mountains + lakes are only ${(blocked * 100).toFixed(1)}% of tiles, want < 15%`);
    const forest = (counts.get('forest') ?? 0) / total;
    assert.ok(forest < 0.25, `forest is ${(forest * 100).toFixed(1)}% of tiles, want < 25%`);
    assert.ok(sameRight / total > 0.8, 'neighbouring tiles usually share terrain');
  });

  it('only mountains and lakes are unbuildable', () => {
    assert.deepEqual(TERRAINS.filter((t) => !isBuildableTerrain(t)), ['mountain', 'lake']);
  });

  it('handles negative and large coordinates', () => {
    for (const [x, y] of [[-1, -1], [0, 0], [-100, 100], [100000, -100000]] as const) {
      assert.ok(TERRAINS.includes(terrainAt(x, y, 1)));
    }
  });
});

describe('expanding layout', () => {
  const world: WorldSettings = { ...DEFAULT_WORLD, radius: 250, layout: 'expanding' };

  it('start rings are deterministic, spaced, buildable and near the centre', () => {
    const a = generateExpandingStartNpcs(world);
    assert.deepEqual(a, generateExpandingStartNpcs({ ...world }));
    assert.ok(a.length >= 15, `got ${a.length}`);
    for (const p of a) {
      assert.ok(isBuildableTerrain(terrainAt(p.x, p.y, world.seed)));
      assert.ok(Math.hypot(p.x, p.y) <= 30);
    }
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) assert.ok(chebyshev(a[i]!, a[j]!) >= NPC_MIN_SPACING);
  });

  it('spawns fill a disc that grows with the player count; newcomers bring spaced abandoned villages', () => {
    const rng = mulberry32(99);
    const occupied = new Set<string>();
    const isOcc = (x: number, y: number): boolean => occupied.has(`${x},${y}`);
    const spots: Array<{ x: number; y: number }> = [];
    let ringTotal = 0;
    for (let n = 0; n < 60; n++) {
      const spot = findExpandingSpawn(isOcc, rng, world, n);
      assert.ok(Math.hypot(spot.x, spot.y) <= expandingRadius(n) * 1.3 + 1);
      assert.ok(isBuildableTerrain(terrainAt(spot.x, spot.y, world.seed)));
      occupied.add(`${spot.x},${spot.y}`);
      spots.push(spot);
      const npcs = generateNpcsForSpawn(spot, isOcc, rng, world);
      ringTotal += npcs.length;
      for (const p of npcs) {
        assert.ok(chebyshev(p, spot) >= NPC_MIN_SPACING);
        assert.ok(!isOcc(p.x, p.y));
        occupied.add(`${p.x},${p.y}`);
      }
    }
    assert.ok(ringTotal >= 60 * 2, `about three abandoned villages per newcomer, got ${ringTotal} for 60`);
    assert.ok(ringTotal <= 60 * (NPC_RING_BASE + NPC_RING_EXTRA_MAX));
    const far = Math.max(...spots.map((s) => Math.hypot(s.x, s.y)));
    assert.ok(far < 80, `60 players stay within a small disc, farthest ${far.toFixed(1)}`);
  });

  it('expandingRadius grows with the count', () => {
    assert.ok(expandingRadius(0) < expandingRadius(10) && expandingRadius(10) < expandingRadius(100));
  });
});

describe('abandoned village placement', () => {
  const small: WorldSettings = { ...DEFAULT_WORLD, radius: 30, npcDensity: 0.03 };

  it('places round((2r+1)^2 * density) villages fast in the default world', () => {
    const start = performance.now();
    const placements = generateNpcPlacements(DEFAULT_WORLD);
    const elapsed = performance.now() - start;
    assert.equal(placements.length, Math.round(201 * 201 * DEFAULT_WORLD.npcDensity));
    assert.equal(placements.length, 808);
    assert.ok(elapsed < 500, `took ${elapsed} ms`);
  });

  it('keeps spacing, bounds, terrain and tiers valid', () => {
    const placements = generateNpcPlacements(DEFAULT_WORLD);
    const keys = new Set<string>();
    for (const p of placements) {
      assert.ok(Math.abs(p.x) <= DEFAULT_WORLD.radius && Math.abs(p.y) <= DEFAULT_WORLD.radius);
      assert.ok(isBuildableTerrain(terrainAt(p.x, p.y, DEFAULT_WORLD.seed)));
      assert.ok(Number.isInteger(p.tier) && p.tier >= 1 && p.tier <= NPC_TIER_WEIGHTS.length);
      keys.add(`${p.x},${p.y}`);
    }
    assert.equal(keys.size, placements.length);
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        assert.ok(chebyshev(placements[i]!, placements[j]!) >= NPC_MIN_SPACING);
      }
    }
  });

  it('tier mix follows the configured weights', () => {
    const placements = generateNpcPlacements(DEFAULT_WORLD);
    const tiers = NPC_TIER_WEIGHTS.map((_, i) => placements.filter((p) => p.tier === i + 1).length / placements.length);
    tiers.forEach((share, i) => assert.ok(Math.abs(share - NPC_TIER_WEIGHTS[i]!) < 0.06, `tier ${i + 1}: ${share}`));
  });

  it('is deterministic for a seed and changes with it', () => {
    assert.deepEqual(generateNpcPlacements(small), generateNpcPlacements({ ...small }));
    assert.notDeepEqual(generateNpcPlacements(small), generateNpcPlacements({ ...small, seed: small.seed + 1 }));
  });

  it('does not loop forever or overfill a world that is too crowded', () => {
    const crowded: WorldSettings = { ...DEFAULT_WORLD, radius: 3, npcDensity: 0.9 };
    const placements = generateNpcPlacements(crowded);
    assert.ok(placements.length < Math.round(49 * 0.9));
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) assert.ok(chebyshev(placements[i]!, placements[j]!) >= NPC_MIN_SPACING);
    }
    assert.deepEqual(generateNpcPlacements({ ...DEFAULT_WORLD, npcDensity: 0 }), []);
  });
});

describe('findSpawnLocation', () => {
  it('finds buildable tiles at least SPAWN_MIN_SPACING from every village, quickly', () => {
    const villages = generateNpcPlacements(DEFAULT_WORLD).map(({ x, y }) => ({ x, y }));
    const occupied = new Set(villages.map((v) => `${v.x},${v.y}`));
    const rng = mulberry32(2024);
    const start = performance.now();
    for (let i = 0; i < 200; i++) {
      const spot = findSpawnLocation((x, y) => occupied.has(`${x},${y}`), rng, DEFAULT_WORLD);
      assert.ok(Math.abs(spot.x) <= DEFAULT_WORLD.radius && Math.abs(spot.y) <= DEFAULT_WORLD.radius);
      assert.ok(isBuildableTerrain(terrainAt(spot.x, spot.y, DEFAULT_WORLD.seed)));
      for (const v of villages) assert.ok(chebyshev(v, spot) >= SPAWN_MIN_SPACING);
      villages.push(spot);
      occupied.add(`${spot.x},${spot.y}`);
    }
    assert.ok(performance.now() - start < 500);
  });

  it('is deterministic for a given rng', () => {
    const none = (): boolean => false;
    assert.deepEqual(findSpawnLocation(none, mulberry32(5), S1), findSpawnLocation(none, mulberry32(5), S1));
  });

  it('falls back to scanning outward when random tries all fail', () => {
    // Radius 5, everything within 2 tiles of x<=2 or y<=2 is crowded: only (5,5) can host a village.
    let world: WorldSettings | undefined;
    for (let seed = 1; seed < 200 && !world; seed++) {
      if (isBuildableTerrain(terrainAt(5, 5, seed))) world = { ...DEFAULT_WORLD, radius: 5, seed };
    }
    assert.ok(world);
    const isOccupied = (x: number, y: number): boolean => x <= 2 || y <= 2;
    // A constant rng picks the same (occupied) tile every time, so the 2000 random tries all fail.
    assert.deepEqual(findSpawnLocation(isOccupied, () => 0, world), { x: 5, y: 5 });
  });

  it('throws GameError when the world is full', () => {
    const world: WorldSettings = { ...DEFAULT_WORLD, radius: 4 };
    assert.throws(
      () => findSpawnLocation(() => true, mulberry32(1), world),
      (e: unknown) => e instanceof GameError && e.code === 'not_found',
    );
  });
});

describe('protection and points', () => {
  it('protection lasts protectionHours divided by speed', () => {
    assert.equal(protectionEndsAt(1000, S1), 1000 + 72 * HOUR);
    assert.equal(protectionEndsAt(1000, S10), 1000 + 7.2 * HOUR);
    assert.equal(protectionEndsAt(0, { ...S1, protectionHours: 0 }), 0);
  });

  it('points are the sum of building levels', () => {
    const v = createPlayerVillage(0);
    assert.equal(villagePoints(v), 5); // hall, lumber, farm, mine, storehouse
    v.buildings.wall = 3;
    v.buildings.hall = 4;
    assert.equal(villagePoints(v), 5 + 3 + 3);
  });
});
