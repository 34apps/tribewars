import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_UNIT_COUNT, TROOP_GROUP_MAX, TROOP_GROUP_NAME_MAX, checkTroopGroup } from '../src/index.ts';

describe('checkTroopGroup', () => {
  it('accepts a valid group, trims the name, drops zeros, orders units', () => {
    const r = checkTroopGroup('  Raid party ', { raider: 5, pikeman: 0, guard: 2 });
    assert.deepEqual(r, { ok: true, name: 'Raid party', units: { guard: 2, raider: 5 } });
  });
  it('limits: constants and name length in characters', () => {
    assert.equal(TROOP_GROUP_MAX, 12);
    assert.equal(TROOP_GROUP_NAME_MAX, 24);
    assert.equal(checkTroopGroup('x'.repeat(24), { raider: 1 }).ok, true);
    assert.equal(checkTroopGroup('x'.repeat(25), { raider: 1 }).ok, false);
    assert.equal(checkTroopGroup('é'.repeat(24), { raider: 1 }).ok, true);
  });
  it('refuses bad names', () => {
    for (const n of ['', '   ', 'a\nb', 'a\u0000b', 'tab\there', 5, null, undefined, {}]) assert.equal(checkTroopGroup(n, { raider: 1 }).ok, false, String(n));
  });
  it('refuses bad units', () => {
    const bad: unknown[] = [null, [], 'x', 5, {}, { raider: 0 }, { raider: 1.5 }, { raider: -1 }, { raider: '3' }, { raider: MAX_UNIT_COUNT + 1 }, { dragon: 3 }, { raider: 1, dragon: 1 }, { raider: NaN }];
    for (const u of bad) assert.equal(checkTroopGroup('ok', u).ok, false, JSON.stringify(u));
    assert.equal(checkTroopGroup('ok', { raider: MAX_UNIT_COUNT }).ok, true);
  });
  it('does not mutate its input', () => {
    const units = { raider: 3, guard: 0 };
    checkTroopGroup('ok', units);
    assert.deepEqual(units, { raider: 3, guard: 0 });
  });
});
