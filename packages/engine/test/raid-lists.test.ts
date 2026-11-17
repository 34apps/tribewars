import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_WORLD_CONFIG,
  EXTRA_RAID_LISTS,
  MAX_UNIT_COUNT,
  RAID_LIST_NAME_MAX,
  checkRaidListName,
  checkRaidRowUnits,
  hasRaidListsExtra,
  planSendAgain,
} from '../src/index.ts';

describe('raid list rules', () => {
  it('the world switch is off by default', () => {
    assert.equal(DEFAULT_WORLD_CONFIG.features.raidLists, false);
  });
  it('entitlement is a bit of the old premium column', () => {
    assert.equal(hasRaidListsExtra(0), false);
    assert.equal(hasRaidListsExtra(EXTRA_RAID_LISTS), true);
    assert.equal(hasRaidListsExtra(EXTRA_RAID_LISTS | 2), true);
    assert.equal(hasRaidListsExtra(2), false);
    assert.equal(hasRaidListsExtra(-1), false);
    assert.equal(hasRaidListsExtra(1.5), false);
  });
  it('names: trimmed, 1..max characters, no control characters', () => {
    assert.deepEqual(checkRaidListName('  Ruins  '), { ok: true, name: 'Ruins' });
    assert.equal(checkRaidListName('   ').ok, false);
    assert.equal(checkRaidListName(5).ok, false);
    assert.equal(checkRaidListName('x'.repeat(RAID_LIST_NAME_MAX)).ok, true);
    assert.equal(checkRaidListName('x'.repeat(RAID_LIST_NAME_MAX + 1)).ok, false);
    assert.equal(checkRaidListName('a\nb').ok, false);
  });
  it('row troops: known units, whole counts, at least one, no chieftains', () => {
    assert.deepEqual(checkRaidRowUnits({ raider: 5, pikeman: 0 }), { ok: true, units: { raider: 5 } });
    assert.equal(checkRaidRowUnits({}).ok, false);
    assert.equal(checkRaidRowUnits({ raider: 0 }).ok, false);
    assert.equal(checkRaidRowUnits({ dragon: 3 }).ok, false);
    assert.equal(checkRaidRowUnits({ raider: -1 }).ok, false);
    assert.equal(checkRaidRowUnits({ raider: 1.5 }).ok, false);
    assert.equal(checkRaidRowUnits({ raider: MAX_UNIT_COUNT + 1 }).ok, false);
    assert.equal(checkRaidRowUnits({ chieftain: 1, raider: 5 }).ok, false);
    assert.equal(checkRaidRowUnits(null).ok, false);
    assert.equal(checkRaidRowUnits([1]).ok, false);
    assert.equal(checkRaidRowUnits('x').ok, false);
  });
});

describe('planSendAgain', () => {
  it('everything is at home: complete', () => {
    const p = planSendAgain({ raider: 10, pikeman: 4 }, { raider: 12, pikeman: 4, guard: 9 });
    assert.deepEqual(p.send, { raider: 10, pikeman: 4 });
    assert.deepEqual(p.missing, {});
    assert.equal(p.complete, true);
    assert.equal(p.empty, false);
  });
  it('some are missing: offers what is there and says what is short', () => {
    const p = planSendAgain({ raider: 120, pikeman: 4 }, { raider: 100 });
    assert.deepEqual(p.send, { raider: 100 });
    assert.deepEqual(p.missing, { raider: 20, pikeman: 4 });
    assert.equal(p.complete, false);
    assert.equal(p.empty, false);
  });
  it('nothing is there: empty', () => {
    const p = planSendAgain({ raider: 5 }, {});
    assert.deepEqual(p.send, {});
    assert.deepEqual(p.missing, { raider: 5 });
    assert.equal(p.empty, true);
  });
  it('ignores bad home counts and zero wants', () => {
    const p = planSendAgain({ raider: 5, guard: 0 }, { raider: Number.NaN as number, guard: 3 });
    assert.deepEqual(p.send, {});
    assert.deepEqual(p.missing, { raider: 5 });
  });
});
