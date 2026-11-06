// Building looks: four stages per building, the fourth only at the max level (apps/web/src/art/buildings.ts).

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { BUILDINGS, BUILDING_IDS } from '@clanfire/engine';
import type { BuildingId } from '@clanfire/engine';

let server: ViteDevServer;
let mod: {
  STAGE_TOPS: Record<BuildingId, readonly [number, number]>;
  buildingStage: (id: BuildingId, level: number) => number;
  wallLook: (level: number) => number;
  stageRange: (id: BuildingId, stage: 1 | 2 | 3 | 4) => string;
  spriteUrl: (id: BuildingId, stage: 0 | 1 | 2 | 3 | 4) => string;
  hasOwnStageArt: (id: BuildingId, stage: 1 | 2 | 3 | 4) => boolean;
};

before(async () => {
  server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  mod = (await server.ssrLoadModule('/src/art/buildings.ts')) as typeof mod;
});

after(async () => {
  await server.close();
});

test('all 13 buildings: stages 1..4 are non-empty, in order, and stage 4 is the max level only', () => {
  assert.equal(BUILDING_IDS.length, 13);
  for (const id of BUILDING_IDS) {
    const max = BUILDINGS[id].maxLevel;
    const [a, b] = mod.STAGE_TOPS[id];
    assert.ok(a >= 1 && a < b && b < max, `${id} tops`);
    assert.ok(b + 1 <= max - 1, `${id} stage 3 is not empty`);
    assert.equal(mod.buildingStage(id, 0), 0, id);
    assert.equal(mod.buildingStage(id, 1), 1, id);
    assert.equal(mod.buildingStage(id, a), 1, id);
    assert.equal(mod.buildingStage(id, a + 1), 2, id);
    assert.equal(mod.buildingStage(id, b), 2, id);
    assert.equal(mod.buildingStage(id, b + 1), 3, id);
    assert.equal(mod.buildingStage(id, max - 1), 3, id);
    assert.equal(mod.buildingStage(id, max), 4, id);
    // Stages never go backwards as the level rises.
    let prev = 0;
    for (let l = 1; l <= max; l++) {
      const s = mod.buildingStage(id, l);
      assert.ok(s >= prev, `${id} ${l}`);
      prev = s;
    }
    assert.equal(mod.stageRange(id, 4), `${max}`, id);
    assert.equal(mod.stageRange(id, 3), b + 1 === max - 1 ? `${max - 1}` : `${b + 1}–${max - 1}`, id);
  }
});

test('wallLook equals the wall stage; the grand look is the max level only', () => {
  const max = BUILDINGS.wall.maxLevel;
  for (let l = 0; l <= max; l++) assert.equal(mod.wallLook(l), mod.buildingStage('wall', l));
  assert.equal(mod.wallLook(18), 3);
  assert.equal(mod.wallLook(max - 1), 3);
  assert.equal(mod.wallLook(max), 4);
});

test('stageRange examples', () => {
  assert.equal(mod.stageRange('hall', 1), '1–5');
  assert.equal(mod.stageRange('hall', 2), '6–12');
  assert.equal(mod.stageRange('hall', 3), '13–19');
  assert.equal(mod.stageRange('hall', 4), '20');
  assert.equal(mod.stageRange('bannerhall', 3), '3');
  assert.equal(mod.stageRange('bannerhall', 4), '4');
});

test('spriteUrl falls back to the stage 3 drawing when there is no stage 4 file', () => {
  for (const id of BUILDING_IDS) {
    const url = mod.spriteUrl(id, 4);
    assert.ok(url, id);
    if (!mod.hasOwnStageArt(id, 4)) assert.equal(url, mod.spriteUrl(id, 3), id);
  }
});
