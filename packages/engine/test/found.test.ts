import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BUILDINGS,
  BUILDING_IDS,
  FOUND_PROTECTION_HOURS,
  FOUND_START_RESOURCES,
  MAX_VILLAGES_PER_PLAYER,
  SPAWN_MIN_SPACING,
  checkFoundTarget,
  createFoundedVillage,
  createPlayerVillage,
  foundedVillageName,
  isAttackBlocked,
  isBuildableTerrain,
  populationCap,
  populationUsage,
  terrainAt,
  underVillageLimit,
} from '../src/index.ts';
import type { Coords, Terrain } from '../src/index.ts';
import { HOUR, S1, S10, units } from './helpers.ts';

const nobody = (): boolean => false;
/** First tile (scanning) whose terrain is `want`, or the first buildable one. */
function find(pred: (t: Terrain) => boolean, from = -40): Coords {
  for (let y = from; y < 40; y++) for (let x = from; x < 40; x++) if (pred(terrainAt(x, y, S1.seed))) return { x, y };
  throw new Error('no such tile');
}

describe('createFoundedVillage', () => {
  it('starts with the new-player levels and the small FOUND stock', () => {
    const { state } = createFoundedVillage(5000, S1);
    for (const b of BUILDING_IDS) assert.equal(state.buildings[b], BUILDINGS[b].startLevel, b);
    assert.deepEqual(state.resources, FOUND_START_RESOURCES);
    assert.deepEqual(state.resources, { wood: 300, food: 300, iron: 150, gold: 0 });
    assert.deepEqual(state.renownPaid, createPlayerVillage(0).renownPaid, 'start levels pay no Renown');
    assert.equal(state.npc, undefined);
    assert.equal(state.lastUpdate, 5000);
    assert.deepEqual(state.troops, units({}));
  });

  it('is protected for FOUND_PROTECTION_HOURS (÷ speed), to the exact ms', () => {
    assert.equal(createFoundedVillage(100, S1).state.protectedUntil, 100 + FOUND_PROTECTION_HOURS * HOUR);
    const v = createFoundedVillage(100, S10).state;
    assert.equal(v.protectedUntil, 100 + (FOUND_PROTECTION_HOURS * HOUR) / 10);
    assert.ok(isAttackBlocked(v, v.protectedUntil! - 1));
    assert.ok(!isAttackBlocked(v, v.protectedUntil!));
    assert.ok(!isAttackBlocked({}, 0));
  });

  it('the escort becomes the garrison up to the population cap; the Chieftain is never part of it', () => {
    const small = createFoundedVillage(0, S1, units({ pikeman: 10, raider: 5, chieftain: 1 }));
    assert.deepEqual([small.state.troops.pikeman, small.state.troops.raider, small.state.troops.chieftain], [10, 5, 0]);
    assert.deepEqual(small.overflow, units({}));
    const big = createFoundedVillage(0, S1, units({ pikeman: 1000 }));
    assert.equal(populationUsage(big.state).total, populationCap(big.state));
    assert.equal(big.state.troops.pikeman + big.overflow.pikeman, 1000);
    assert.ok(big.overflow.pikeman > 0);
  });

  it('is named after the player and capped at 20 villages', () => {
    assert.equal(foundedVillageName('Alice', 2), "Alice's village 2");
    assert.ok(underVillageLimit(MAX_VILLAGES_PER_PLAYER - 1));
    assert.ok(!underVillageLimit(MAX_VILLAGES_PER_PLAYER));
    assert.equal(MAX_VILLAGES_PER_PLAYER, 20);
  });
});

describe('checkFoundTarget', () => {
  const spot = find((t) => t === 'grass');

  it('accepts a free buildable tile', () => {
    assert.ok(checkFoundTarget(spot, S1, nobody).ok);
  });

  it('rejects a tile with a village on it and tiles closer than SPAWN_MIN_SPACING; accepts exactly the spacing', () => {
    const at = (c: Coords) => (x: number, y: number) => x === c.x && y === c.y;
    const bad = checkFoundTarget(spot, S1, at(spot));
    assert.ok(!bad.ok && bad.reason === 'invalid_target');
    for (let d = 1; d < SPAWN_MIN_SPACING; d++) {
      assert.ok(!checkFoundTarget(spot, S1, at({ x: spot.x + d, y: spot.y - d })).ok, `chebyshev ${d}`);
    }
    // a village exactly SPAWN_MIN_SPACING away does not block (other tiles may, so use an isolated buildable tile)
    assert.ok(checkFoundTarget(spot, S1, at({ x: spot.x + SPAWN_MIN_SPACING, y: spot.y })).ok);
  });

  it('rejects lakes, mountains, tiles outside the world and non-integers', () => {
    for (const t of ['lake', 'mountain'] as const) {
      const c = find((x) => x === t);
      assert.ok(!isBuildableTerrain(t));
      assert.ok(!checkFoundTarget(c, S1, nobody).ok, t);
    }
    assert.ok(!checkFoundTarget({ x: S1.radius + 1, y: 0 }, S1, nobody).ok);
    assert.ok(!checkFoundTarget({ x: 0, y: -S1.radius - 1 }, S1, nobody).ok);
    assert.ok(!checkFoundTarget({ x: 1.5, y: 2 }, S1, nobody).ok);
    assert.ok(!checkFoundTarget({ x: NaN, y: 2 }, S1, nobody).ok);
  });
});
