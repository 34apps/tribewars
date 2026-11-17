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
let SCENE_FIT_BOX: { x: number; y: number; w: number; h: number };
let SCENE_FOCUS: { x: number; y: number };
let labelAnchor: (id: BuildingId, stage: 1 | 2 | 3 | 4) => { x: number; y: number };
let plotUV: (id: BuildingId) => { u: number; v: number };
let doorUV: (id: BuildingId) => { u: number; v: number };
let roadEnd: (id: BuildingId, stage: number) => { u: number; v: number };
let DOOR_DEPTH: Record<string, readonly number[]>;
let DOOR_TUCK: number;
let yardHalf: (id: BuildingId, stage: number) => number;
let spriteUrl: (id: BuildingId, stage: 1 | 2 | 3 | 4) => string;
let Ground: (p: { built: string }) => unknown;
let SQUARE: number;
let network: (built: string) => { runs: { pts: (readonly [number, number])[]; s: number; capB: boolean; door: boolean }[] };

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
  ({ PLACEMENT, OUTSIDE, GATES, OUTER_ROADS, WALL_RING, SCENE_VIEWBOX, SCENE_FIT_BOX, SCENE_FOCUS, labelAnchor, plotUV, doorUV, spriteUrl, roadEnd, DOOR_DEPTH, DOOR_TUCK, yardHalf } = b);
  ({ PATHS, STREET_W, Ground, SQUARE, network } = s);
});

after(async () => {
  await server.close();
});

const BUILT = BUILDING_IDS.filter((id) => id !== 'wall');
const P = () => WALL_RING.plate;

test('every road is joined to the network and runs on to its door: no zero-length legs, no doubling back', () => {
  const main = PATHS.find((p) => p.key === 'main')!;
  const hall = plotUV('hall');
  const on = ([u, v]: readonly [number, number], a: readonly [number, number], b: readonly [number, number]) =>
    a[0] === b[0]
      ? Math.abs(u - a[0]) < 0.01 && v >= Math.min(a[1], b[1]) - 0.01 && v <= Math.max(a[1], b[1]) + 0.01
      : Math.abs(v - a[1]) < 0.01 && u >= Math.min(a[0], b[0]) - 0.01 && u <= Math.max(a[0], b[0]) + 0.01;
  for (const p of PATHS) {
    for (let i = 1; i < p.pts.length; i++) {
      const [a, b] = [p.pts[i - 1]!, p.pts[i]!];
      assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) > 1, `${p.key}: leg ${i} has no length`);
      if (i >= 2) {
        const z = p.pts[i - 2]!;
        const back = (a[0] - z[0]) * (b[0] - a[0]) + (a[1] - z[1]) * (b[1] - a[1]) < 0;
        assert.ok(!back, `${p.key}: leg ${i} doubles back (a loop)`);
      }
    }
    if (p === main) continue;
    const start = p.pts[0]!;
    const inSq = Math.abs(start[0] - hall.u) <= SQUARE && Math.abs(start[1] - hall.v) <= SQUARE;
    const onMain = on(start, main.pts[0]!, main.pts[1]!);
    assert.ok(inSq || onMain, `${p.key} starts at ${start}, neither on the main street nor on the square`);
  }
  // The drawn network (every building built, at every look) has a road piece that ends at each door.
  for (const look of [1, 2, 3, 4]) {
    const net = network(BUILDING_IDS.map((id) => `${id}:${look}`).join(','));
    for (const id of BUILT) {
      if (id === 'hall') continue;
      const d = roadEnd(id, look);
      assert.ok(
        net.runs.some((r) => r.capB && Math.hypot(r.pts[r.pts.length - 1]![0] - d.u, r.pts[r.pts.length - 1]![1] - d.v) < 0.1),
        `look ${look}: no drawn road reaches the ${id} door`,
      );
    }
  }
});

test('every road ends flush at its building: in under the front of the drawing, no grass gap, at every look', () => {
  // On the door line (u' = 0 in sprite units, the middle of the front-left face), walking in from the tile edge: the first
  // painted stretch (3+ units deep) must begin in front of the road's end, at most a few units, and cover the end itself.
  const painted = (e: { cell: number; mask: string[] }, x: number, y: number) => {
    const col = Math.floor((x + 70) / e.cell);
    const hex = e.mask[Math.floor((y + 122) / e.cell)];
    return !!hex && BigInt(`0x${hex}`).toString(2).slice(1)[col] === '1';
  };
  for (const id of BUILT) {
    if (id === 'hall') continue;
    for (const s of [1, 2, 3, 4] as const) {
      const file = spriteUrl(id, s).split('?')[0]!.split('/').pop()!;
      const e = BOXES[file]!;
      let first = 0;
      const on = (v: number) => painted(e, -v, 26 + v / 2);
      for (let v = 32; v >= -10; v -= 0.5)
        if ([0, 1, 2, 3].every((k) => on(v - k))) {
          first = v;
          break;
        }
      assert.equal(DOOR_DEPTH[id]![s - 1], first, `${id} look ${s}: DOOR_DEPTH is stale (measured ${first}); update it in buildings.ts`);
      const end = roadEnd(id, s);
      const at = (end.v - plotUV(id).v) / PLACEMENT[id].scale; // the road end in sprite units along the door line
      const yard = yardHalf(id, s) / PLACEMENT[id].scale;
      if (yard) {
        // A paved yard: the road runs just onto it, and the yard reaches in under the drawing (no grass between).
        assert.ok(at < yard && at > yard - 4, `${id} look ${s}: the road does not run onto its yard`);
        assert.ok(yard >= first, `${id} look ${s}: grass between the yard and the building`);
        assert.ok(yard * PLACEMENT[id].scale <= 28 * PLACEMENT[id].scale, `${id} look ${s}: the yard leaves its pad`);
        continue;
      }
      assert.ok(at <= first + 0.01, `${id} look ${s}: grass between the road end and the building`);
      assert.ok(first - at <= DOOR_TUCK + 4.5, `${id} look ${s}: the road runs too far in under the drawing`);
      assert.ok(first >= 30 || painted(e, -at, 26 + at / 2), `${id} look ${s}: the road end is not under the drawing`);
      assert.ok(Math.abs(end.u - plotUV(id).u) < 0.01, `${id}: the road comes straight in on the door line`);
    }
  }
  // Door ends are square (a doorstep), never a round blob.
  const net = network(BUILDING_IDS.map((id) => `${id}:2`).join(','));
  assert.ok(net.runs.filter((r) => r.door).length >= BUILT.length - 1);
});

test('a road shared by several buildings takes the best surface among them', () => {
  // Market at look 1 and Longhouse at look 4 share the lane inside the gate: that stretch is look 4; the Market's last leg is look 1.
  const net = network('hall:1,market:1,longhouse:4');
  const d = roadEnd('market', 1);
  const toMarket = net.runs.filter((r) => r.pts.some(([u, v]) => Math.abs(u - d.u) < 0.1 && Math.abs(v - d.v) < 0.1));
  assert.ok(toMarket.length > 0 && toMarket.every((r) => r.s === 1));
  assert.ok(net.runs.some((r) => r.s === 4 && r.pts[0]![0] === WALL_RING.gateU));
});

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

test('the desktop picture (SCENE_FIT_BOX) shows every drawing whole, with the old size on a 1440x900 desktop', () => {
  const vb = SCENE_FIT_BOX;
  for (const id of BUILT)
    for (const s of [1, 2, 3, 4] as const) {
      const b = drawnBox(id, s);
      assert.ok(b.x0 >= vb.x && b.x1 <= vb.x + vb.w && b.y0 >= vb.y && b.y1 <= vb.y + vb.h, `${id} look ${s} leaves the desktop picture`);
    }
  // The frame's picture is 648 x 410 px at 1440x900; at plate 273 the village showed at 648 / 1104 px per unit. Within 5%.
  assert.ok(Math.abs(vb.w / vb.h - 648 / 410) < 0.01, 'the fit box has the frame picture\'s shape');
  assert.ok(Math.min(648 / vb.w, 410 / vb.h) >= (648 / 1104) * 0.95, 'buildings at least 95% of their old desktop size');
  // Inside the scene box, so phones can pan to all of it.
  assert.ok(vb.x >= SCENE_VIEWBOX.x && vb.y >= SCENE_VIEWBOX.y && vb.x + vb.w <= SCENE_VIEWBOX.x + SCENE_VIEWBOX.w && vb.y + vb.h <= SCENE_VIEWBOX.y + SCENE_VIEWBOX.h);
});

test('no building stands behind the front corner tower or the gate towers (they are drawn in front of it)', () => {
  // Screen boxes the towers cover, relative to the ring centre (measured from the wall art at its grand look).
  const cx = WALL_RING.cx;
  const cy = WALL_RING.cy;
  const towers = [
    { x0: cx - 34, y0: cy + WALL_RING.plate - 162, x1: cx + 34, y1: cy + WALL_RING.plate + 30 },
    { x0: cx + WALL_RING.gateU - WALL_RING.plate - 46, y0: cy + 40, x1: cx + WALL_RING.gateU - WALL_RING.plate + 70, y1: cy + 210 },
  ];
  for (const id of BUILT) {
    const cells = paintedCells(id);
    for (const t of towers)
      for (const c of cells) {
        const [gx, gy] = c.split(',').map(Number) as [number, number];
        const inside = gx * GRID < t.x1 && gx * GRID + GRID > t.x0 && gy * GRID < t.y1 && gy * GRID + GRID > t.y0;
        assert.ok(!inside, `${id} is drawn behind a wall tower`);
      }
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
  const all = draw(BUILDING_IDS.map((id) => `${id}:3`).join(','));
  assert.ok(!/NaN|undefined|Infinity/.test(all));
  assert.ok(few.includes('vv-paths') && few.length < all.length);
});
