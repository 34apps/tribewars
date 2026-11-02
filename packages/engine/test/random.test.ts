import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { distance, emptyResources, emptyUnits, hashSeed, mulberry32, totalUnits } from '../src/index.ts';

describe('random', () => {
  it('mulberry32 is deterministic, in [0,1) and matches the reference sequence', () => {
    const a = mulberry32(1);
    assert.equal(a(), 0.6270739405881613);
    assert.equal(a(), 0.002735721180215478);
    const x = mulberry32(12345);
    const y = mulberry32(12345);
    let sum = 0;
    for (let i = 0; i < 5000; i++) {
      const v = x();
      assert.equal(v, y());
      assert.ok(v >= 0 && v < 1);
      sum += v;
    }
    assert.ok(Math.abs(sum / 5000 - 0.5) < 0.03);
    assert.notEqual(mulberry32(1)(), mulberry32(2)());
  });

  it('hashSeed is a stable, order-sensitive unsigned 32-bit mix', () => {
    assert.equal(hashSeed(20261102, 5, -7), 503074579);
    assert.equal(hashSeed(1, 2, 3), 3832742900);
    assert.notEqual(hashSeed(1, 2, 3), hashSeed(3, 2, 1));
    assert.notEqual(hashSeed(1, 2), hashSeed(1, 2, 0));
    for (const h of [hashSeed(), hashSeed(-1), hashSeed(2 ** 31), hashSeed(0, 0, 0)]) {
      assert.ok(Number.isInteger(h) && h >= 0 && h < 2 ** 32);
    }
  });
});

describe('math helpers', () => {
  it('distance is Euclidean', () => {
    assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
    assert.equal(distance({ x: -2, y: -2 }, { x: -2, y: -2 }), 0);
  });
  it('empty containers have every key at zero', () => {
    assert.deepEqual(Object.values(emptyUnits()), [0, 0, 0, 0, 0]);
    assert.deepEqual(emptyResources(), { wood: 0, food: 0, iron: 0, gold: 0 });
    assert.equal(totalUnits({ pikeman: 1, guard: 2, raider: 3, outrider: 4, knight: 5 }), 15);
  });
});
