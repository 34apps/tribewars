// The originality pass in the client (2026-11-11): the Longhouse and Wrightyard have their own art and text, the Firecart replaces the
// two siege units in lists and art, "Vault" lost its "Hidden", and the Recruit lists follow the training buildings.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { BUILDINGS, BUILDING_IDS, UNITS, UNIT_IDS, createPlayerVillage, DEFAULT_WORLD } from '@clanfire/engine';
import type { BuildingId, UnitId } from '@clanfire/engine';
import { buildingEffects } from '../src/rules.ts';
import { UNIT_ROLE } from '../src/unitRole.ts';
import { tipFor } from '../src/views/village/tips.ts';

let server: ViteDevServer;
let art: {
  STAGE_TOPS: Record<BuildingId, readonly [number, number]>;
  hasOwnStageArt: (id: BuildingId, stage: 1 | 2 | 3 | 4) => boolean;
  PLACEMENT: Record<BuildingId, { x: number; y: number; scale: number }>;
};
let figures: { hasUnitFigure: (u: UnitId, pose?: 'idle' | 'march' | 'victory' | 'defeated' | 'icon') => boolean };

before(async () => {
  server = await createServer({ root: new URL('..', import.meta.url).pathname, configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
  art = (await server.ssrLoadModule('/src/art/buildings.ts')) as typeof art;
  figures = (await server.ssrLoadModule('/src/art/UnitFigure.tsx')) as typeof figures;
});
after(async () => {
  await server.close();
});

test('the Longhouse and the Wrightyard have all four looks and a place in the village', () => {
  for (const id of ['longhouse', 'wrightyard'] as const) {
    for (const stage of [1, 2, 3, 4] as const) assert.ok(art.hasOwnStageArt(id, stage), `${id} look ${stage}`);
    assert.ok(art.PLACEMENT[id], `${id} placed`);
  }
  assert.deepEqual(art.STAGE_TOPS.longhouse, [6, 15], '25-level buildings: 6 / 15');
  assert.deepEqual(art.STAGE_TOPS.wrightyard, art.STAGE_TOPS.vault, 'like the 12-level buildings');
});

test('the Firecart has all four poses and an icon; the Log Ram and Boulder Sling are gone from the lists', () => {
  for (const pose of ['idle', 'march', 'victory', 'defeated', 'icon'] as const) assert.ok(figures.hasUnitFigure('firecart', pose), pose);
  assert.deepEqual([...UNIT_IDS].filter((u) => UNIT_ROLE[u].tone === 'siege'), ['firecart']);
  assert.ok(!('logram' in UNIT_ROLE) && !('boulder' in UNIT_ROLE));
});

test('the Recruit lists: the Barracks shows no siege, the Wrightyard shows the Firecart', () => {
  const at = (b: string) => UNIT_IDS.filter((u) => UNITS[u].building === b);
  assert.ok(at('barracks').length > 0 && at('barracks').every((u) => !UNITS[u].siege));
  assert.deepEqual(at('wrightyard'), ['firecart']);
});

test('names and texts: Vault, Longhouse (room), Farm (food), Wrightyard (Firecarts)', () => {
  assert.equal(BUILDINGS.vault.name, 'Vault');
  for (const id of BUILDING_IDS) assert.ok(!/hidden/i.test(BUILDINGS[id].name), id);
  assert.match(BUILDINGS.farm.description, /food/i);
  assert.doesNotMatch(BUILDINGS.farm.description, /sets how many people/i);
  assert.match(BUILDINGS.longhouse.description, /how many people/i);
  const v = createPlayerVillage(0);
  const s = DEFAULT_WORLD;
  assert.match(tipFor('longhouse', v, s), /Longhouse/);
  assert.match(tipFor('farm', v, s), /food/i);
  assert.doesNotMatch(tipFor('farm', v, s), /population cap/i);
  assert.match(tipFor('vault', v, s), /Vault/);
  assert.doesNotMatch(tipFor('vault', v, s), /Hidden/);
  const w = { ...v, buildings: { ...v.buildings, barracks: 5 } };
  assert.match(tipFor('wrightyard', w, s), /Firecart/);
  const room = buildingEffects('longhouse', 1, 2, 1).find((l) => l.label === 'Population room');
  assert.ok(room, 'the Longhouse page shows the room it gives');
  assert.ok(!buildingEffects('farm', 1, 2, 1).some((l) => l.label === 'Population room'));
  assert.ok(buildingEffects('wrightyard', 1, 2, 1).some((l) => l.label === 'Training speed'));
});
