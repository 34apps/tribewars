import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_WORLD,
  RESTART_EDGE_BAND,
  RESTART_PROTECTION_HOURS,
  SPAWN_MIN_SPACING,
  isBuildableTerrain,
  restartEdgeRadius,
  restartPlacement,
  restartProtectionMs,
  terrainAt,
} from '../src/index.ts';
import type { WorldSettings } from '../src/index.ts';
import { HOUR, S1, S10 } from './helpers.ts';

const expanding: WorldSettings = { ...DEFAULT_WORLD, layout: 'expanding', radius: 100 };
const nobody = (): boolean => false;

describe('restartPlacement', () => {
  it('expanding layout: lands at the outer edge of the current disc, on buildable ground', () => {
    for (const players of [1, 20, 60]) {
      const edge = restartEdgeRadius(expanding, players);
      for (let seed = 1; seed <= 25; seed++) {
        const { spot } = restartPlacement(expanding, players, seed, nobody);
        const r = Math.hypot(spot.x, spot.y);
        assert.ok(r <= edge + 0.75 && r >= edge - RESTART_EDGE_BAND - 0.75, `players ${players} seed ${seed}: r ${r} edge ${edge}`);
        assert.ok(isBuildableTerrain(terrainAt(spot.x, spot.y, expanding.seed)));
        assert.ok(Math.abs(spot.x) <= expanding.radius && Math.abs(spot.y) <= expanding.radius);
      }
    }
  });

  it('is deterministic for a seed and different seeds spread around the edge', () => {
    const a = restartPlacement(expanding, 40, 7, nobody).spot;
    assert.deepEqual(restartPlacement(expanding, 40, 7, nobody).spot, a);
    const distinct = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const p = restartPlacement(expanding, 40, seed, nobody).spot;
      distinct.add(`${p.x},${p.y}`);
    }
    assert.ok(distinct.size > 15);
  });

  it('keeps clear of existing villages (SPAWN_MIN_SPACING) at the edge', () => {
    const village = { x: 0, y: 0 };
    const edge = restartEdgeRadius(expanding, 5);
    // a village on every tile of the ring where the first tries land: the result must still be free
    const taken = (x: number, y: number): boolean => Math.abs(Math.hypot(x, y) - edge) < 1.5 && x > 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { spot } = restartPlacement(expanding, 5, seed, taken);
      for (let dx = -(SPAWN_MIN_SPACING - 1); dx < SPAWN_MIN_SPACING; dx++) {
        for (let dy = -(SPAWN_MIN_SPACING - 1); dy < SPAWN_MIN_SPACING; dy++) assert.ok(!taken(spot.x + dx, spot.y + dy));
      }
    }
    assert.ok(village);
  });

  it('scattered layout: a random free tile anywhere', () => {
    const blocked = (x: number, y: number): boolean => x >= 0;
    const { spot } = restartPlacement({ ...S1, layout: 'scattered' }, 10, 3, blocked);
    assert.ok(spot.x < -SPAWN_MIN_SPACING + 1);
    assert.ok(isBuildableTerrain(terrainAt(spot.x, spot.y, S1.seed)));
    assert.deepEqual(restartPlacement(S1, 10, 3, blocked).spot, spot, 'no layout = scattered');
  });

  it('gives RESTART_PROTECTION_HOURS of protection, divided by world speed', () => {
    assert.equal(restartPlacement(expanding, 3, 1, nobody).protectionMs, RESTART_PROTECTION_HOURS * HOUR);
    assert.equal(restartProtectionMs(S10), (RESTART_PROTECTION_HOURS * HOUR) / 10);
    assert.equal(RESTART_PROTECTION_HOURS, 48);
  });
});
