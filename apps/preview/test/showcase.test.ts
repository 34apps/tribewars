import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, BUILDING_IDS } from '@clanfire/engine';
import { showcaseLevels, type StageTops } from '../src/showcase.ts';

// Same shape as STAGE_TOPS in apps/web/src/art/buildings.ts (that file needs Vite, so the test carries its own copy).
const TOPS: StageTops = {
  hall: [5, 12], lumber: [5, 12], farm: [5, 12], mine: [5, 12], storehouse: [5, 12], barracks: [5, 12], wall: [5, 12],
  goldmine: [5, 10], stables: [5, 10], vault: [3, 7], market: [3, 6], drillyard: [3, 6], bannerhall: [1, 2],
};

test('showcaseLevels covers all buildings and each stage', () => {
  assert.equal(BUILDING_IDS.length, 13);
  const s1 = showcaseLevels(1, TOPS);
  const s2 = showcaseLevels(2, TOPS);
  const s3 = showcaseLevels(3, TOPS);
  const s4 = showcaseLevels(4, TOPS);
  for (const id of BUILDING_IDS) {
    const max = BUILDINGS[id].maxLevel;
    const [a, b] = TOPS[id];
    assert.equal(s1[id], 1, id);
    assert.equal(s2[id], a + 1, id);
    assert.ok(s2[id] <= b, id);
    assert.equal(s3[id], b + 1, id);
    assert.ok(s3[id] < max, id);
    assert.equal(s4[id], max, id);
  }
});
