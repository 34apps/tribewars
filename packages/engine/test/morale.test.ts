import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_WORLD_CONFIG,
  MORALE_ATTACK_FACTOR,
  MORALE_SMALL_SHARE,
  isSafeAfterOpen,
  moraleFactor,
  resolveBattle,
  withLegacyPlacement,
} from '../src/index.ts';
import { units, village } from './helpers.ts';

describe('morale', () => {
  it('constants are the owner-approved numbers', () => {
    assert.equal(MORALE_SMALL_SHARE, 1 / 3);
    assert.equal(MORALE_ATTACK_FACTOR, 0.75);
  });

  it('applies strictly below a third, not at exactly a third', () => {
    assert.equal(moraleFactor(3000, 999, true), 0.75);
    assert.equal(moraleFactor(3000, 1000, true), 1, 'exactly a third = no morale');
    assert.equal(moraleFactor(300_000, 100_000, true), 1, 'exactly a third, big numbers');
    assert.equal(moraleFactor(3000, 1001, true), 1);
    assert.equal(moraleFactor(1000, 3000, true), 1, 'a bigger defender never gives morale');
  });

  it('flag off = always 1', () => {
    assert.equal(moraleFactor(3000, 1, false), 1);
  });

  it('guards zero, negative and NaN points', () => {
    assert.equal(moraleFactor(100, 0, true), 0.75, 'defender with no points');
    assert.equal(moraleFactor(0, 0, true), 1, 'attacker with no points');
    assert.equal(moraleFactor(0, 50, true), 1);
    assert.equal(moraleFactor(-5, 10, true), 1);
    assert.equal(moraleFactor(100, -3, true), 0.75);
    assert.equal(moraleFactor(Number.NaN, 10, true), 1);
    assert.equal(moraleFactor(100, Number.NaN, true), 0.75);
  });

  it('the battle uses it on attack strength only', () => {
    const base = { attackerUnits: units({ raider: 100 }), defender: village({ troops: { pikeman: 20 } }), seed: 5, fixedLuck: 0 };
    const plain = resolveBattle(base);
    const weak = resolveBattle({ ...base, moraleFactor: 0.75 });
    assert.ok(Math.abs(weak.attackPower - plain.attackPower * 0.75) < 1e-9);
    assert.equal(weak.defensePower, plain.defensePower);
    assert.deepEqual(resolveBattle({ ...base, moraleFactor: 1 }), plain);
  });

  it('is clamped to [0.75, 1]', () => {
    const base = { attackerUnits: units({ raider: 100 }), defender: village(), seed: 5, fixedLuck: 0 };
    const plain = resolveBattle(base).attackPower;
    assert.equal(resolveBattle({ ...base, moraleFactor: 0.1 }).attackPower, plain * 0.75);
    assert.equal(resolveBattle({ ...base, moraleFactor: 5 }).attackPower, plain);
    assert.equal(resolveBattle({ ...base, moraleFactor: Number.NaN }).attackPower, plain);
  });

  it('the world flag: on for new worlds, off for worlds without it stored, fixed after opening', () => {
    assert.equal(DEFAULT_WORLD_CONFIG.features.morale, true);
    assert.equal(withLegacyPlacement(DEFAULT_WORLD_CONFIG).features.morale, false);
    assert.ok(!isSafeAfterOpen('features.morale'));
  });
});
