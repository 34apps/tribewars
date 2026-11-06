// Owner decisions 2026-11-06: terrain amount per world, fair start spots, fewer abandoned villages per newcomer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  DEFAULT_WORLD,
  DEFAULT_WORLD_CONFIG,
  NPC_RING_BASE,
  NPC_RING_EXTRA_CHANCE,
  applyWorldConfig,
  findExpandingSpawn,
  findSpawnLocation,
  generateExpandingStartNpcs,
  generateNpcsForSpawn,
  isBuildableTerrain,
  mulberry32,
  restartPlacement,
  setWorldConfigValue,
  startGround,
  terrainAt,
  terrainThresholds,
  travelRoute,
  withLegacyPlacement,
  worldTerrainAt,
} from '../src/index.ts';
import type { WorldSettings } from '../src/index.ts';

const nobody = (): boolean => false;
const withConfig = (s: WorldSettings, edits: Array<[string, number]>): WorldSettings => {
  let c = structuredClone(DEFAULT_WORLD_CONFIG);
  for (const [path, v] of edits) c = setWorldConfigValue(c, path, v);
  return applyWorldConfig(s, c);
};
const share = (seed: number, amount: number): number => {
  let rough = 0;
  let n = 0;
  for (let y = -60; y <= 60; y++) for (let x = -60; x <= 60; x++, n++) if (terrainAt(x, y, seed, amount) !== 'grass') rough++;
  return rough / n;
};

describe('terrain amount', () => {
  it('amount 1 is exactly today\'s map (same seed, same map; hashes taken from the generator before the setting existed)', () => {
    const golden: Record<number, string> = { 20261102: '4c7d4a3af17751bc', 4242: '75814a20cc8d5bfe', 7: '546c1058807021dd' };
    for (const [seed, hash] of Object.entries(golden)) {
      let a = '';
      let b = '';
      for (let y = -60; y <= 60; y++) {
        for (let x = -60; x <= 60; x++) {
          a += terrainAt(x, y, Number(seed))[0];
          b += terrainAt(x, y, Number(seed), 1)[0];
        }
      }
      assert.equal(a, b);
      assert.equal(createHash('sha256').update(a).digest('hex').slice(0, 16), hash, `seed ${seed}`);
    }
    // A world with the default config reads the same map.
    const s = applyWorldConfig(DEFAULT_WORLD, DEFAULT_WORLD_CONFIG);
    assert.equal(worldTerrainAt(5, -9, s), terrainAt(5, -9, s.seed));
    assert.deepEqual(terrainThresholds(1), { mountain: 0.8, hills: 0.7, lake: 0.78, forest: 0.64 });
  });

  it('amount 0 is flat grass; more amount means more rough ground', () => {
    for (const seed of [1, 42, 20261102]) {
      assert.equal(share(seed, 0), 0);
      const a = share(seed, 0.5);
      const b = share(seed, 1);
      const c = share(seed, 1.5);
      assert.ok(a < b && b < c, `seed ${seed}: ${a} < ${b} < ${c}`);
    }
  });

  it('the route walks the same map as the world draws', () => {
    const flat = withConfig(DEFAULT_WORLD, [['terrain.amount', 0]]);
    const r0 = travelRoute({ x: -40, y: -40 }, { x: 40, y: 40 }, flat.seed, 0);
    assert.ok(Math.abs(r0.tiles.grass - r0.length) < 1e-6, 'all grass at amount 0');
    const wild = travelRoute({ x: -40, y: -40 }, { x: 40, y: 40 }, flat.seed, 1.5);
    assert.ok(wild.tiles.grass < wild.length);
  });
});

describe('fair start', () => {
  it('start spots meet the rule on many seeds (scattered and expanding), and the restart spot too', () => {
    let spots = 0;
    let fair = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s: WorldSettings = { ...DEFAULT_WORLD, seed, radius: 100, layout: 'expanding' };
      const picks = [
        findSpawnLocation(nobody, mulberry32(seed), s),
        findExpandingSpawn(nobody, mulberry32(seed + 1000), s, 10),
        restartPlacement(s, 10, seed, nobody).spot,
      ];
      for (const p of picks) {
        spots++;
        assert.ok(isBuildableTerrain(terrainAt(p.x, p.y, seed)));
        if (startGround(p.x, p.y, s).fair) fair++;
      }
    }
    assert.ok(fair / spots >= 0.97, `${fair} of ${spots} spots pass the fair-start rule`);
  });

  it('the rule is at least 70% buildable and at most 40% slow within radius 4', () => {
    const s = DEFAULT_WORLD;
    for (let seed = 1; seed <= 20; seed++) {
      const w = { ...s, seed };
      const p = findSpawnLocation(nobody, mulberry32(seed), w);
      const g = startGround(p.x, p.y, w);
      if (!g.fair) continue;
      assert.ok(g.open >= 0.7 && g.slow <= 0.4, `seed ${seed}: open ${g.open} slow ${g.slow}`);
    }
  });

  it('with a rule nothing can meet, the best spot found is taken and nothing throws; deterministic from the seed', () => {
    const impossible = withConfig({ ...DEFAULT_WORLD, radius: 60, layout: 'expanding' }, [
      ['start.minOpenShare', 1],
      ['start.maxSlowShare', 0],
      ['start.tries', 20],
      ['terrain.amount', 1.5],
    ]);
    for (let seed = 1; seed <= 10; seed++) {
      const a = findSpawnLocation(nobody, mulberry32(seed), impossible);
      assert.deepEqual(a, findSpawnLocation(nobody, mulberry32(seed), impossible));
      assert.ok(isBuildableTerrain(worldTerrainAt(a.x, a.y, impossible)));
      const e = findExpandingSpawn(nobody, mulberry32(seed), impossible, 5);
      assert.ok(isBuildableTerrain(worldTerrainAt(e.x, e.y, impossible)));
      const r = restartPlacement(impossible, 5, seed, nobody).spot;
      assert.ok(isBuildableTerrain(worldTerrainAt(r.x, r.y, impossible)));
    }
  });

  it('the best of the tries beats a plain first fit', () => {
    const strict = withConfig({ ...DEFAULT_WORLD, radius: 100 }, [['start.minOpenShare', 1], ['start.maxSlowShare', 0], ['start.tries', 40]]);
    const loose = withConfig({ ...DEFAULT_WORLD, radius: 100 }, [['start.minOpenShare', 0], ['start.maxSlowShare', 1]]);
    let strictSum = 0;
    let looseSum = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const a = findSpawnLocation(nobody, mulberry32(seed), strict);
      const b = findSpawnLocation(nobody, mulberry32(seed), loose);
      strictSum += startGround(a.x, a.y, strict).shortfall;
      looseSum += startGround(b.x, b.y, strict).shortfall;
    }
    assert.ok(strictSum < looseSum, `${strictSum} < ${looseSum}`);
  });

  it('the fair-start check respects the extra "allowed" rule', () => {
    const s: WorldSettings = { ...DEFAULT_WORLD, radius: 100 };
    for (let seed = 1; seed <= 10; seed++) {
      const p = findSpawnLocation(nobody, mulberry32(seed), s, (x, y) => x > 50);
      assert.ok(p.x > 50);
    }
  });
});

describe('abandoned villages per newcomer', () => {
  const world: WorldSettings = { ...DEFAULT_WORLD, radius: 250, layout: 'expanding' };
  const average = (s: WorldSettings): number => {
    let total = 0;
    const runs = 300;
    for (let i = 0; i < runs; i++) {
      const rng = mulberry32(i + 1);
      const spot = findExpandingSpawn(nobody, rng, s, 40);
      total += generateNpcsForSpawn(spot, nobody, rng, s).length;
    }
    return total / runs;
  };

  it('a new world brings about 2 per newcomer; the legacy numbers bring about 3.6', () => {
    const now = average(world);
    assert.ok(now > 1.7 && now < 2.4, `new default ${now}`);
    const legacy = average(applyWorldConfig(world, withLegacyPlacement(DEFAULT_WORLD_CONFIG)));
    assert.ok(legacy > 3.2 && legacy < 4.2, `legacy ${legacy}`);
    assert.equal(NPC_RING_BASE, 3);
    assert.equal(NPC_RING_EXTRA_CHANCE, 0.4);
  });

  it('perNewcomer and extraChance are settings', () => {
    const none = withConfig(world, [['npc.perNewcomer', 0], ['npc.extraChance', 0]]);
    assert.equal(average(none), 0);
    const five = withConfig(world, [['npc.perNewcomer', 5], ['npc.extraChance', 0]]);
    assert.ok(average(five) > 4.3 && average(five) <= 5, `${average(five)}`);
  });

  it('the start rings scale with startRingScale (legacy 1 = 22 asked for)', () => {
    const now = generateExpandingStartNpcs(world).length;
    const legacy = generateExpandingStartNpcs(applyWorldConfig(world, withLegacyPlacement(DEFAULT_WORLD_CONFIG))).length;
    assert.ok(now >= 10 && now <= 14, `${now}`);
    assert.ok(legacy >= 18, `${legacy}`);
    assert.equal(generateExpandingStartNpcs(withConfig(world, [['npc.startRingScale', 0], ['npc.extraChance', 0]])).length, 0);
  });
});
