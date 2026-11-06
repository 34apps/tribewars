// Village layout: the street network (grid directions only, the main street on the gate's line, a road to every
// building's door), every pad inside the wall, no two building drawings touching at any look (painted shapes measured
// from the art), badges apart, the phone view on the Town Hall, and labels on the roof, not a flag pole.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
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
interface Gate {
  side: 'front-left' | 'front-right' | 'back-left' | 'back-right';
  at: number;
  half: number;
  main: boolean;
}
let server: ViteDevServer;
let PATHS: PathDef[];
let OUTER_ROADS: PathDef[];
let STREET_W: number;
let PLACEMENT: Record<BuildingId, Place>;
let OUTSIDE: ReadonlySet<BuildingId>;
let GATES: readonly Gate[];
let WALL_RING: { cx: number; cy: number; plate: number; gateU: number };
let SCENE_VIEWBOX: { x: number; y: number; w: number; h: number };
let SCENE_FOCUS: { x: number; y: number };
let labelAnchor: (id: BuildingId, stage: 1 | 2 | 3 | 4) => { x: number; y: number };
let plotUV: (id: BuildingId) => { u: number; v: number };
let doorUV: (id: BuildingId) => { u: number; v: number };
let spriteUrl: (id: BuildingId, stage: 1 | 2 | 3 | 4) => string;
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
  ({ PLACEMENT, OUTSIDE, GATES, OUTER_ROADS, WALL_RING, SCENE_VIEWBOX, SCENE_FOCUS, labelAnchor, plotUV, doorUV, spriteUrl } = b);
  ({ PATHS, STREET_W, Ground } = s);
});

after(async () => {
  await server.close();
});

const BUILT = BUILDING_IDS.filter((id) => id !== 'wall');
const P = () => WALL_RING.plate;

test('every path, inside and outside the wall, runs along u or v only', () => {
  for (const p of [...PATHS, ...OUTER_ROADS])
    for (let i = 1; i < p.pts.length; i++) {
      const [u0, v0] = p.pts[i - 1]!;
      const [u1, v1] = p.pts[i]!;
      assert.ok(u0 === u1 || v0 === v1, `${p.key}: leg ${i} is not axis aligned`);
    }
});

test('the main street leaves the main gate centre straight, as wide as the road outside', () => {
  const gate = GATES.find((g) => g.main)!;
  assert.equal(gate.side, 'front-left');
  assert.equal(gate.at, WALL_RING.gateU);
  const main = PATHS.find((p) => p.key === 'main')!;
  assert.equal(main.to, null);
  assert.ok(main.pts.every(([u]) => u === gate.at));
  assert.ok(main.pts[0]![1] > P());
  assert.ok(Math.abs(STREET_W - 12.1) < 0.01);
});

test('the village has one main gate in the front-left wall, on the main street', () => {
  assert.equal(GATES.length, 1);
  assert.equal(GATES[0]!.side, 'front-left');
  assert.ok(GATES[0]!.main);
  assert.equal(OUTER_ROADS.length, 0);
});

test('every building except the wall and the Town Hall has a road that ends at its door', () => {
  for (const id of BUILT) {
    if (id === 'hall') continue; // the Town Hall stands on the square itself
    const path = PATHS.find((p) => p.to === id);
    assert.ok(path, `${id} has no road`);
    const [lu, lv] = path.pts[path.pts.length - 1]!;
    const { u, v } = plotUV(id);
    const door = doorUV(id);
    const pad = 28 * PLACEMENT[id].scale;
    assert.ok(Math.abs(lu - door.u) < 0.01 && Math.abs(lv - door.v) < 0.01, `${id}: road ends at ${lu},${lv}, door at ${door.u},${door.v}`);
    assert.ok(Math.abs(door.u - u) < 0.01 && door.v > v + pad - 8 && door.v < v + pad, `${id}: door is the middle of the front-left face`);
  }
});

test('no road runs through a building lot (a branch only enters its own lot at the door)', () => {
  const hits: string[] = [];
  for (const p of PATHS)
    for (let i = 1; i < p.pts.length; i++) {
      const [u0, v0] = p.pts[i - 1]!;
      const [u1, v1] = p.pts[i]!;
      const n = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 2));
      for (let k = 0; k <= n; k++) {
        const u = u0 + ((u1 - u0) * k) / n;
        const v = v0 + ((v1 - v0) * k) / n;
        for (const id of BUILT) {
          if (id === 'hall') continue; // the hall stands on the paved square, where the streets end
          const c = plotUV(id);
          const h = 28 * PLACEMENT[id].scale + p.w - 2; // the road's edge may brush the lot, not cross it
          if (Math.abs(u - c.u) >= h || Math.abs(v - c.v) >= h) continue;
          const door = id === p.to && Math.abs(u - c.u) < 1 && v > c.v + 28 * PLACEMENT[id].scale - p.w - 4;
          if (!door && !hits.includes(`${p.key}/${id}`)) hits.push(`${p.key}/${id}`);
        }
      }
    }
  assert.deepEqual(hits, [], `roads through lots: ${hits.join(', ')}`);
});

test('every building stands inside the wall, its pad clear of the wall', () => {
  assert.equal(OUTSIDE.size, 0);
  for (const id of BUILT) {
    const { u, v } = plotUV(id);
    const pad = 28 * PLACEMENT[id].scale;
    const clear = P() - (Math.max(Math.abs(u), Math.abs(v)) + pad);
    assert.ok(clear >= 24, `${id}: pad ${clear.toFixed(1)} units from the plate edge`);
  }
});

// Drawn boxes of the sprites (measured in headless Chrome by scripts/measure-sprites.mjs, ground tile stripped).
const SPRITE_DIR = new URL('../src/art/buildings/', import.meta.url).pathname;
const BOXES = JSON.parse(readFileSync(new URL('./sprite-boxes.json', import.meta.url), 'utf8')) as Record<string, { sha1: string; cell: number; box: [number, number, number, number]; mask: string[] }>;

test('the measured sprite boxes are up to date (re-run node scripts/measure-sprites.mjs after changing art)', () => {
  const files = readdirSync(SPRITE_DIR).filter((f) => /-\d\.svg$/.test(f));
  for (const f of files) {
    const e = BOXES[f];
    assert.ok(e, `${f} was never measured`);
    assert.equal(createHash('sha1').update(readFileSync(SPRITE_DIR + f, 'utf8')).digest('hex'), e.sha1, `${f} changed since it was measured`);
  }
});

/** Scene box of a building's drawing at a look. */
function drawnBox(id: BuildingId, stage: 1 | 2 | 3 | 4) {
  const file = spriteUrl(id, stage).split('?')[0]!.split('/').pop()!;
  const e = BOXES[file];
  assert.ok(e, `no measured box for ${file}`);
  const [bx, by, bw, bh] = e.box;
  const { x, y, scale } = PLACEMENT[id];
  return { x0: x + bx * scale, y0: y + by * scale, x1: x + (bx + bw) * scale, y1: y + (by + bh) * scale };
}

/** Scene cells (GRID units) painted by a building at any of its four looks, from the measured sprite masks. */
const GRID = 4;
function paintedCells(id: BuildingId): Set<string> {
  const { x, y, scale } = PLACEMENT[id];
  const out = new Set<string>();
  for (const s of [1, 2, 3, 4] as const) {
    const file = spriteUrl(id, s).split('?')[0]!.split('/').pop()!;
    const e = BOXES[file]!;
    e.mask.forEach((hex, row) => {
      const bits = BigInt(`0x${hex}`).toString(2).slice(1);
      for (let col = 0; col < bits.length; col++) {
        if (bits[col] !== '1') continue;
        const x0 = x + (-70 + col * e.cell) * scale;
        const y0 = y + (-122 + row * e.cell) * scale;
        const x1 = x0 + e.cell * scale;
        const y1 = y0 + e.cell * scale;
        for (let gx = Math.floor(x0 / GRID); gx < Math.ceil(x1 / GRID); gx++)
          for (let gy = Math.floor(y0 / GRID); gy < Math.ceil(y1 / GRID); gy++) out.add(`${gx},${gy}`);
      }
    });
  }
  return out;
}

test('no two building drawings touch or hide each other, whatever look each one has', () => {
  // Each building can be at any of its four looks independently, so compare what any of its looks paints (the real
  // painted shape from the measured masks, soft shadows excluded), not the rectangles round them.
  const cells = Object.fromEntries(BUILT.map((id) => [id, paintedCells(id)])) as Record<BuildingId, Set<string>>;
  const touching: string[] = [];
  for (let i = 0; i < BUILT.length; i++)
    for (let j = i + 1; j < BUILT.length; j++) {
      const a = cells[BUILT[i]!]!;
      let shared = 0;
      for (const c of cells[BUILT[j]!]!) if (a.has(c)) shared++;
      if (shared) touching.push(`${BUILT[i]}/${BUILT[j]} (${shared} shared ${GRID}-unit cells)`);
    }
  assert.deepEqual(touching, [], `drawings touch: ${touching.join(', ')}`);
});

test('every drawing at every look fits inside the scene box', () => {
  const vb = SCENE_VIEWBOX;
  for (const id of BUILT)
    for (const s of [1, 2, 3, 4] as const) {
      const b = drawnBox(id, s);
      assert.ok(b.x0 >= vb.x && b.x1 <= vb.x + vb.w && b.y0 >= vb.y && b.y1 <= vb.y + vb.h, `${id} look ${s} leaves the scene box`);
    }
});

test('the level badges never cover each other, at any look', () => {
  // The badge (22 px) sits on the anchor; on the smallest desktop scene (about 1 px per unit) it is about 26 units wide
  // and tall. The name pill only shows for the selected or hovered building, so it may overlap others.
  for (const s of [1, 2, 3, 4] as const)
    for (let i = 0; i < BUILT.length; i++)
      for (let j = i + 1; j < BUILT.length; j++) {
        const a = labelAnchor(BUILT[i]!, s);
        const b = labelAnchor(BUILT[j]!, s);
        assert.ok(Math.abs(a.x - b.x) > 30 || Math.abs(a.y - b.y) > 30, `${BUILT[i]} and ${BUILT[j]} badges collide at look ${s}`);
      }
});

test('the phone view first looks at the Town Hall', () => {
  const b = drawnBox('hall', 4);
  assert.ok(SCENE_FOCUS.x > b.x0 && SCENE_FOCUS.x < b.x1 && SCENE_FOCUS.y > b.y0 && SCENE_FOCUS.y < b.y1);
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
