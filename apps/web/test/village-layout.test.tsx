// Village street network and label anchors: every path runs in grid directions, the main street lines up with the gate,
// every branch ends at its building's front face, and labels attach to the roof, not to a flag pole high above it.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { BUILDING_IDS } from '@clanfire/engine';
import type { BuildingId } from '@clanfire/engine';

// The art modules use Vite-only features (import.meta.glob), so they are loaded through Vite's own SSR loader.
type Pt = readonly (readonly [number, number])[];
interface PathDef {
  key: string;
  pts: Pt;
  w: number;
  to: BuildingId | null;
}
interface Place {
  x: number;
  y: number;
  scale: number;
}
let server: ViteDevServer;
let PATHS: PathDef[];
let STREET_W: number;
let PLACEMENT: Record<BuildingId, Place>;
let WALL_RING: { cx: number; cy: number; plate: number; gateU: number };
let labelAnchor: (id: BuildingId, stage: 1 | 2 | 3 | 4) => { x: number; y: number };
let Ground: (p: { built: string }) => unknown;

before(async () => {
  server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const b = await server.ssrLoadModule('/src/art/buildings.ts');
  const s = await server.ssrLoadModule('/src/art/scenery.tsx');
  ({ PLACEMENT, WALL_RING, labelAnchor } = b);
  ({ PATHS, STREET_W, Ground } = s);
});

after(async () => {
  await server.close();
});

/** Ground point (u, v) of a plot's tile centre. */
function plotUV(id: BuildingId): { u: number; v: number } {
  const p = PLACEMENT[id];
  const dx = p.x - WALL_RING.cx;
  const s = 2 * (p.y + 26 * p.scale - WALL_RING.cy);
  return { u: (dx + s) / 2, v: (s - dx) / 2 };
}

test('every path runs along u or v only', () => {
  for (const p of PATHS)
    for (let i = 1; i < p.pts.length; i++) {
      const [u0, v0] = p.pts[i - 1]!;
      const [u1, v1] = p.pts[i]!;
      assert.ok(u0 === u1 || v0 === v1, `${p.key}: leg ${i} is not axis aligned`);
    }
});

test('the main street leaves the gate centre straight, as wide as the road outside', () => {
  const main = PATHS.find((p) => p.key === 'main')!;
  assert.equal(main.to, null);
  assert.ok(main.pts.every(([u]) => u === WALL_RING.gateU));
  assert.ok(main.pts[0]![1] > WALL_RING.plate);
  assert.ok(Math.abs(STREET_W - 12.1) < 0.01);
});

test('every building except the wall and the Town Hall has a branch that ends inside its own pad at the front', () => {
  for (const id of BUILDING_IDS) {
    if (id === 'wall' || id === 'hall') continue; // the Town Hall stands on the square itself
    const path = PATHS.find((p) => p.to === id);
    assert.ok(path, `${id} has no path`);
    const [lu, lv] = path.pts[path.pts.length - 1]!;
    const { u, v } = plotUV(id);
    const pad = 28 * PLACEMENT[id].scale;
    assert.ok(Math.abs(lu - u) < 1, `${id}: path ends beside the door`);
    assert.ok(lv > v + pad - 8 && lv < v + pad, `${id}: path ends at the front-left face (${lv} vs ${v + pad})`);
  }
});

test('label anchors sit on the roof, centred on the plot and clear of the ground', () => {
  for (const id of BUILDING_IDS) {
    if (id === 'wall') continue;
    for (const stage of [1, 2, 3, 4] as const) {
      const a = labelAnchor(id, stage);
      const p = PLACEMENT[id];
      assert.equal(a.x, p.x, `${id} ${stage}`);
      assert.ok(a.y < p.y + 26 * p.scale && a.y > p.y - 130 * p.scale, `${id} ${stage}`);
    }
  }
  // The Town Hall's flag pole reaches 108 units up; the label belongs on the dome (82), not on the pole tip.
  const hall = PLACEMENT.hall;
  assert.ok(labelAnchor('hall', 3).y > hall.y - 108 * hall.scale + 20);
});

test('the ground draws only the paths of buildings that stand, with clean numbers', () => {
  const draw = (built: string) => renderToString(createElement('svg', null, createElement(Ground as never, { built })));
  const few = draw('hall');
  const all = draw(BUILDING_IDS.join(','));
  assert.ok(!/NaN|undefined|Infinity/.test(all));
  assert.ok(few.includes('vv-paths') && few.length < all.length);
});
