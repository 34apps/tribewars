// Village landscape "Map tiles" (the default): the map's toy style, made for the village. Ground is one continuous grass
// surface (soft patches of slightly different greens, speckles, meadow flowers) laid out on the village's isometric grid;
// only raised things have edges. Around it, in the map's terrain art but placed by meaning:
//   - a straight road leaves the gate along u = 8 (the gate's centre), crosses the river on a plank bridge and runs to the edge;
//   - the river rises in the back-right hills, runs down the right side and bends along the front;
//   - the Lumber Camp side (left, back left) has irregular groves of the village's own pines and oaks;
//   - the Iron Mine side (back right) has hill and rock clusters and, far back, mountains and a massif;
//   - the Farm side (front right) has a few small crop fields (furrow rows of wheat, greens, plough) with grass borders, a
//     lane, scarecrows and haystacks, and a strip of grass between the wall and the first field;
//   - one fenced meadow with a few sheep in front of the left wall.
// Grass next to the walls stays calm; trees, stones and flowers get denser towards the edges. Props are sized against the
// village (pines, oaks and rocks are the scene's own #vt- symbols from SceneryDefs, which VillageScene renders in its <defs>).
//
// Same contract as `Landscape` (landscape.tsx): one <g className="vv-land"> drawn BEFORE the plate. Growth: `tier` 0..3 (tier 0
// is complete; each tier adds fields, flowers, hay and sheep). Deterministic (hashed), built once per mode. Terrain sprites
// (design/sprites/terrain, copied to ./terrain-sprites) are inlined as <g> markup in one <defs> and placed with <use>.

import { memo } from 'react';
import type { ReactNode } from 'react';
import { WALL_RING, iso } from './buildings.ts';
import { landBox } from './landscape.tsx';

const SPRITE_FILES = import.meta.glob('./terrain-sprites/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const INK = '#2B211C';
const PLATE = WALL_RING.plate;
const GATE_U = WALL_RING.gateU;
/** Ground height: the foot of the plate's earth sides. */
const TZ = -24;
/** Terrain sprites are drawn at the map's tile scale halved, like the village's own props. */
const K = 0.875;
/** Ground-plane matrix: grid (u, v) to screen, so shapes can be drawn in grid units (widths squash like the plate's). */
const GT = `matrix(1 0.5 -1 0.5 ${WALL_RING.cx} ${WALL_RING.cy - TZ})`;

const RIVER_U = 398;
const RIVER_V = 331;
const RIVER_W = 17;
const ROAD_W = 28;
const MASSIF_AT = [340, -650] as const;
const PASTURE = { u0: -265, u1: -31, v0: PLATE + 6, v1: PLATE + 78 } as const;

// ---- Hashing and noise -------------------------------------------------------------------------------------------------------

/** A hashed number in [0, 1) for a cell (a, j) and a purpose k. */
function h(a: number, j: number, k = 0): number {
  let x = (Math.imul(Math.floor(a) + 101, 73856093) ^ Math.imul(Math.floor(j) + 131, 19349663) ^ Math.imul(k + 7, 83492791)) | 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** 0 at a, 1 at b, smooth between (a may be larger than b). */
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Smooth value noise in [0, 1] with features about `scale` grid units wide. */
function vnoise(u: number, v: number, scale: number, seed: number): number {
  const x = u / scale;
  const y = v / scale;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = h(x0, y0, seed);
  const b = h(x0 + 1, y0, seed);
  const c = h(x0, y0 + 1, seed);
  const d = h(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const scr = (u: number, v: number): [number, number] => iso(u, v, TZ);
const place = (u: number, v: number, s: number, flip = false) => {
  const [x, y] = scr(u, v);
  return `translate(${r1(x)} ${r1(y)}) scale(${flip ? -s : s} ${s})`;
};

// ---- Sprites -----------------------------------------------------------------------------------------------------------------

/** Raised terrain art whose map tile block is dropped, leaving the hill, peak or mountain on the continuous ground. */
const BLOCKLESS = /^(hills|mountain)-/;

function spriteMarkup(name: string): string {
  const raw = SPRITE_FILES[`./terrain-sprites/${name}.svg`];
  if (!raw) throw new Error(`Missing terrain sprite ${name}.svg`);
  let inner = raw.replace(/^<svg[^>]*>/, '').replace(/<title>.*?<\/title>/, '').replace(/<\/svg>\s*$/, '');
  if (BLOCKLESS.test(name)) {
    for (let i = 0; i < 3; i++) inner = inner.replace(/^\s*<path\b[^>]*><\/path>/, '');
    inner = inner
      .replace(/<circle\b[^>]*opacity="0\.(?:45|75)"[^>]*><\/circle>/g, '')
      .replace(/<path\b[^>]*stroke="#FFFFFF" stroke-width="1\.4"[^>]*><\/path>/g, '');
    const hill = name.startsWith('hills');
    inner = `<ellipse cx="2" cy="${hill ? 4 : 9}" rx="${hill ? 50 : 46}" ry="${hill ? 14 : 13}" fill="${INK}" opacity="0.16"></ellipse>${inner}`;
  }
  // Ids inside a sprite (masks, clips) must not clash between sprites.
  return inner
    .replace(/id="(x_\d+)"/g, `id="tl-${name}-$1"`)
    .replace(/url\(#(x_\d+)\)/g, `url(#tl-${name}-$1)`)
    .replace(/href="#(x_\d+)"/g, `href="#tl-${name}-$1"`);
}

// ---- Where things may stand --------------------------------------------------------------------------------------------------

interface Field {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  crop: 'wheat' | 'green' | 'plough';
  tier: number;
}
/** Small crop fields beside the Farm, in two columns either side of a lane at u = 333; the first is 48 units off the wall. */
const FIELDS: readonly Field[] = [
  { u0: 280, u1: 322, v0: 40, v1: 112, crop: 'wheat', tier: 0 },
  { u0: 280, u1: 322, v0: 120, v1: 190, crop: 'green', tier: 0 },
  { u0: 344, u1: 382, v0: 2, v1: 72, crop: 'wheat', tier: 0 },
  { u0: 280, u1: 322, v0: -36, v1: 32, crop: 'plough', tier: 1 },
  { u0: 280, u1: 322, v0: 198, v1: 262, crop: 'wheat', tier: 1 },
  { u0: 344, u1: 382, v0: 80, v1: 150, crop: 'green', tier: 1 },
  { u0: 280, u1: 322, v0: -110, v1: -44, crop: 'green', tier: 2 },
  { u0: 344, u1: 382, v0: 158, v1: 228, crop: 'plough', tier: 2 },
  { u0: 344, u1: 382, v0: -70, v1: -6, crop: 'wheat', tier: 3 },
];
const LANE = { u: 333, v0: -130, v1: 290, w: 11 } as const;
/** The farm track along v = 290 from the lane to the road. */
const TRACK = { v: 290, u0: GATE_U, u1: LANE.u, w: 10 } as const;
/** Haystacks and scarecrows (u, v, tier). */
const HAY: readonly (readonly [number, number, number])[] = [[301, 118, 1], [363, 78, 2], [301, 262, 3]];
const SCARECROWS: readonly (readonly [number, number, number])[] = [[301, 74, 0], [363, 116, 2]];

/** Is a ground point on something that dressing must keep off (road, river, fields, lane, meadow, massif)? */
function blocked(u: number, v: number, pad: number): boolean {
  if (Math.abs(u - GATE_U) < ROAD_W / 2 + 6 + pad && v > PLATE - 20) return true;
  if (Math.abs(u - RIVER_U) < RIVER_W / 2 + 8 + pad && v < RIVER_V + 20) return true;
  if (Math.abs(v - RIVER_V) < RIVER_W / 2 + 8 + pad && u < RIVER_U + 20) return true;
  if (Math.abs(u - LANE.u) < LANE.w / 2 + 4 + pad && v > LANE.v0 && v < LANE.v1 + 6) return true;
  if (Math.abs(v - TRACK.v) < TRACK.w / 2 + 4 + pad && u > TRACK.u0 && u < TRACK.u1) return true;
  if (FIELDS.some((f) => u > f.u0 - 7 - pad && u < f.u1 + 7 + pad && v > f.v0 - 7 - pad && v < f.v1 + 7 + pad)) return true;
  if (u > PASTURE.u0 - 6 - pad && u < PASTURE.u1 + 6 + pad && v > PASTURE.v0 - 6 - pad && v < PASTURE.v1 + 8 + pad) return true;
  if (Math.hypot(u - MASSIF_AT[0], v - MASSIF_AT[1]) < 95 + pad) return true;
  return false;
}

/** Does a tall thing standing here reach the plate (which is drawn on top of the land)? Then it is not drawn. */
function hitsPlate(u: number, v: number, height: number, halfWidth = 30): boolean {
  const [x, y] = scr(u, v);
  for (const dx of [-halfWidth, 0, halfWidth]) {
    for (let up = 0; up <= height; up += 8) {
      const px = x + dx;
      const inDiamond = (yy: number) => Math.abs(px - WALL_RING.cx) / (PLATE * 2) + Math.abs(yy - WALL_RING.cy) / PLATE <= 1.02;
      if (inDiamond(y - up) || inDiamond(y - up - 26)) return true;
    }
  }
  return false;
}
/** Grid units from the plate edge (negative under the plate). */
const dPlate = (u: number, v: number) => Math.max(Math.abs(u), Math.abs(v)) - PLATE;

// ---- Objects (screen-space things drawn back to front) -------------------------------------------------------------------------

interface Obj {
  y: number;
  x: number;
  tier: number;
  node: ReactNode;
}
interface Built {
  /** Soft ground patches and speckles, as grid-space path data. */
  tones: Record<string, string>;
  tick: string;
  tick2: string;
  flowers: { tier: number; node: ReactNode }[];
  objs: Obj[];
  /** Sprite names used (defs are built for these only). */
  names: string[];
}

const TREE = ['pineA', 'pineB', 'oak', 'bush'] as const;
const ROCK = ['rockA', 'rockB', 'rockC'] as const;

function scarecrow(key: string, u: number, v: number): ReactNode {
  const [x, y] = scr(u, v);
  return (
    <g key={key} transform={`translate(${r1(x)} ${r1(y)})`} strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx={1} cy={1} rx={6} ry={2.2} fill={INK} opacity={0.2} />
      <path d="M0 0V-17M-8 -12H8" stroke={INK} strokeWidth={4.4} fill="none" />
      <path d="M0 0V-17M-8 -12H8" stroke="#B07D46" strokeWidth={2.2} fill="none" />
      <path d="M-5 -9L-9 -4M5 -9L9 -4" stroke="#E4B67C" strokeWidth={2} fill="none" />
      <circle cx={0} cy={-20} r={3.6} fill="#F1E1C2" stroke={INK} strokeWidth={1.4} />
      <path d="M-6 -22.5H6L0 -31Z" fill="#C4623A" stroke={INK} strokeWidth={1.4} />
    </g>
  );
}

/** Bridge over the river on the road: planks on the ground and two low rails (a flat deck with raised side rails). */
function bridge(): Obj {
  const hw = 15;
  const l = RIVER_W / 2 + 8;
  const [x, y] = scr(GATE_U, RIVER_V);
  const rail = (side: number) => {
    const pts = [-l, -l / 2, 0, l / 2, l].map((dv) => scr(GATE_U + side * hw, RIVER_V + dv));
    const top = pts.map(([px, py]) => `${r1(px)} ${r1(py - 9)}`);
    const posts = pts.map(([px, py]) => `M${r1(px)} ${r1(py - 2)}V${r1(py - 9)}`).join('');
    return (
      <g key={side} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={`${posts}M${top.join('L')}`} stroke={INK} strokeWidth={4.6} />
        <path d={`${posts}`} stroke="#B07D46" strokeWidth={2.2} />
        <path d={`M${top.join('L')}`} stroke="#F2B33D" strokeWidth={2.4} />
      </g>
    );
  };
  const deck = [[-hw, -l], [hw, -l], [hw, l], [-hw, l]].map(([du, dv]) => scr(GATE_U + du!, RIVER_V + dv!));
  let planks = '';
  for (let dv = -l + 5; dv < l - 2; dv += 6) {
    const [ax, ay] = scr(GATE_U - hw, RIVER_V + dv);
    const [bx, by] = scr(GATE_U + hw, RIVER_V + dv);
    planks += `M${r1(ax)} ${r1(ay)}L${r1(bx)} ${r1(by)}`;
  }
  return {
    x,
    y: y + 14,
    tier: 0,
    node: (
      <g key="bridge">
        {rail(-1)}
        <path d={`M${deck.map(([px, py]) => `${r1(px)} ${r1(py - 3)}`).join('L')}Z`} fill="#E4B67C" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
        <path d={planks} stroke="#B07D46" strokeWidth={1.2} opacity={0.7} transform="translate(0 -3)" />
        {rail(1)}
      </g>
    ),
  };
}

function fence(u0: number, v0: number, u1: number, v1: number, key: string): Obj {
  const len = Math.hypot(u1 - u0, v1 - v0);
  const n = Math.max(1, Math.round(len / 14));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) pts.push(scr(u0 + ((u1 - u0) * i) / n, v0 + ((v1 - v0) * i) / n));
  const rail = (z: number) => `M${pts.map(([x, y]) => `${r1(x)} ${r1(y - z)}`).join('L')}`;
  const posts = pts.map(([x, y]) => `M${r1(x)} ${r1(y)}v-8`).join('');
  const [x, y] = pts[pts.length - 1]!;
  return {
    x,
    y,
    tier: 0,
    node: (
      <g key={key} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={posts} stroke={INK} strokeWidth={4} />
        <path d={rail(3.5)} stroke={INK} strokeWidth={3.4} />
        <path d={rail(7)} stroke={INK} strokeWidth={3.4} />
        <path d={posts} stroke="#B07D46" strokeWidth={2} />
        <path d={rail(3.5)} stroke="#E4B67C" strokeWidth={1.4} />
        <path d={rail(7)} stroke="#E4B67C" strokeWidth={1.4} />
      </g>
    ),
  };
}

const FLOWER_COLOURS = ['#FFFFFF', '#F7C948', '#F59AB0', '#C9B8F2'] as const;
const SHEEP: readonly (readonly [number, number, string, boolean, number])[] = [
  [-200, 288, 'sheep', false, 0],
  [-150, 303, 'sheep-grazing', true, 0],
  [-105, 281, 'sheep', true, 0],
  [-70, 299, 'sheep-grazing', false, 1],
  [-232, 302, 'sheep-grazing', false, 2],
  [-128, 266, 'sheep', false, 3],
];

function build(wide: boolean): Built {
  const box = landBox(wide);
  const names = new Set<string>(['sheep', 'sheep-grazing', 'haystack', 'massif-peak', 'flowers', 'daisies', 'tufts', 'clover', 'pebbles']);
  const objs: Obj[] = [];
  const inBox = (x: number, y: number, mx = 40, my = 40) => x > box.x0 - mx && x < box.x1 + mx && y > box.y0 - my && y < box.y1 + my;
  const push = (u: number, v: number, tier: number, node: ReactNode, mx = 60, my = 120) => {
    const [x, y] = scr(u, v);
    if (inBox(x, y, mx, 0) && y > box.y0 - my && y < box.y1 + 90) objs.push({ x, y, tier, node });
  };
  const sym = (key: string, id: string, u: number, v: number, s: number, tier = 0, flip = false) =>
    push(u, v, tier, <use key={key} href={id.startsWith('vt-') ? `#${id}` : `#tl-${id}`} transform={place(u, v, s, flip)} />);

  // Cells covering the box in grid space.
  const span = (step: number, fn: (cu: number, cv: number, a: number, b: number) => void) => {
    for (let a = -Math.ceil(1900 / step); a <= Math.ceil(1900 / step); a++) {
      for (let b = -Math.ceil(1900 / step); b <= Math.ceil(1900 / step); b++) {
        const cu = (a + 0.5) * step;
        const cv = (b + 0.5) * step;
        const [x, y] = scr(cu, cv);
        if (inBox(x, y, step * 2, step * 2) || (y > box.y0 - 260 && y < box.y1 + 60 && x > box.x0 - 140 && x < box.x1 + 140)) fn(cu, cv, a, b);
      }
    }
  };

  // Ground patches: soft ellipses of a lighter and a darker green over the base.
  const tones: Record<string, string> = { light: '', dark: '', mid: '' };
  span(46, (cu, cv, a, b) => {
    if (h(a, b, 40) > 0.62) return;
    const u = cu + (h(a, b, 41) - 0.5) * 40;
    const v = cv + (h(a, b, 42) - 0.5) * 40;
    if (Math.abs(u) < PLATE - 20 && Math.abs(v) < PLATE - 20) return;
    const rx = 22 + h(a, b, 43) * 34;
    const ry = rx * (0.55 + h(a, b, 44) * 0.35);
    const k = h(a, b, 45) < 0.45 ? 'light' : h(a, b, 45) < 0.8 ? 'dark' : 'mid';
    tones[k] += `M${r1(u - rx)} ${r1(v)}a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(2 * rx)} 0a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(-2 * rx)} 0Z`;
  });
  // Speckles.
  let tick = '';
  let tick2 = '';
  span(15, (cu, cv, a, b) => {
    if (h(a, b, 50) > 0.34) return;
    const u = cu + (h(a, b, 51) - 0.5) * 14;
    const v = cv + (h(a, b, 52) - 0.5) * 14;
    if (Math.abs(u) < PLATE - 10 && Math.abs(v) < PLATE - 10) return;
    if (h(a, b, 53) < 0.55) tick += `M${r1(u)} ${r1(v)}h0`;
    else tick2 += `M${r1(u)} ${r1(v)}h0`;
  });
  // Meadow flowers in small clumps; later tiers add clumps.
  const flowers: { tier: number; node: ReactNode }[] = [];
  span(52, (cu, cv, a, b) => {
    const u0 = cu + (h(a, b, 60) - 0.5) * 36;
    const v0 = cv + (h(a, b, 61) - 0.5) * 36;
    const dp = dPlate(u0, v0);
    if (h(a, b, 62) > 0.34 * smooth(30, 220, dp) + 0.02 || blocked(u0, v0, 8)) return;
    const tier = h(a, b, 63) < 0.55 ? 0 : h(a, b, 63) < 0.78 ? 1 : h(a, b, 63) < 0.92 ? 2 : 3;
    const n = 3 + Math.floor(h(a, b, 64) * 4);
    const paths = ['', '', '', ''];
    for (let i = 0; i < n; i++) {
      const [x, y] = scr(u0 + (h(a, b, 65 + i) - 0.5) * 22, v0 + (h(a, b, 75 + i) - 0.5) * 22);
      paths[(i + a + b) & 3] += `M${r1(x)} ${r1(y)}h0`;
    }
    const [sx, sy] = scr(u0, v0);
    if (!inBox(sx, sy, 20, 20)) return;
    flowers.push({
      tier,
      node: (
        <g key={`fl${a},${b}`} fill="none" strokeLinecap="round">
          {paths.map((d, i) => (d ? <path key={i} d={d} stroke={FLOWER_COLOURS[i]} strokeWidth={3.2} /> : null))}
        </g>
      ),
    });
  });

  // Trees: groves of the village's own pines and oaks, with clearings and soft edges (jittered lattice, thinned by noise).
  span(17, (cu, cv, a, b) => {
    const u = cu + (h(a, b, 1) - 0.5) * 17;
    const v = cv + (h(a, b, 2) - 0.5) * 17;
    const dp = dPlate(u, v);
    if (dp < 34) return;
    const xs = u - v;
    const wForest = smooth(-70, -260, xs);
    const wBack = smooth(-170, -320, v);
    const backLeft = wBack * (1 - smooth(0, 220, xs));
    const base = wForest * 0.55 * (1 - 0.7 * smooth(80, 420, v)) + backLeft * 0.22 + 0.06 * smooth(160, 460, dp) + 0.18 * smooth(300, 520, dp) * smooth(60, 260, xs) * smooth(-80, 40, -v);
    if (base <= 0.01) return;
    const grove = smooth(0.42, 0.62, vnoise(u, v, 130, 3)) * 0.9 + 0.1;
    const p = base * grove * smooth(34, 150, dp);
    if (h(a, b, 3) > p || blocked(u, v, 6)) return;
    if (hitsPlate(u, v, 52, 22)) return;
    const r = h(a, b, 4);
    const kind = wForest > 0.3 ? (r < 0.4 ? 'pineA' : r < 0.65 ? 'pineB' : r < 0.9 ? 'oak' : 'bush') : r < 0.55 ? 'pineB' : r < 0.8 ? 'oak' : r < 0.93 ? 'pineA' : 'bush';
    sym(`t${a},${b}`, `vt-${kind}`, u, v, 0.88 + h(a, b, 5) * 0.32, 0, h(a, b, 6) < 0.5);
  });

  // Hill clusters, rock clusters and mountains: the Iron Mine side (back right), a few straight back and far right.
  span(130, (cu, cv, a, b) => {
    const u = cu + (h(a, b, 10) - 0.5) * 90;
    const v = cv + (h(a, b, 11) - 0.5) * 90;
    const dp = dPlate(u, v);
    const xs = u - v;
    const wBack = smooth(-170, -330, v);
    const right = wBack * smooth(-60, 200, xs) + 0.45 * smooth(300, 480, xs) * smooth(200, 420, dp);
    const back = wBack * (1 - smooth(-60, 200, xs)) * 0.4;
    if (dp < 50 || blocked(u, v, 30)) return;
    if (h(a, b, 12) < right * 0.95 + back * 0.5) {
      const n = 2 + Math.floor(h(a, b, 13) * 3);
      for (let i = 0; i < n; i++) {
        const hu = u + (h(a, b, 14 + i) - 0.5) * 80;
        const hv = v + (h(a, b, 20 + i) - 0.5) * 80;
        if (blocked(hu, hv, 20) || hitsPlate(hu, hv, 56, 46)) continue;
        const nm = `hills-${1 + Math.floor(h(a, b, 26 + i) * 2)}`;
        names.add(nm);
        sym(`h${a},${b},${i}`, nm, hu, hv, 0.62 + h(a, b, 30 + i) * 0.4, 0, h(a, b, 34 + i) < 0.5);
      }
    }
    if (h(a, b, 40) < right * 0.8 + back * 0.3) {
      const n = 3 + Math.floor(h(a, b, 41) * 3);
      for (let i = 0; i < n; i++) {
        const ru = u + (h(a, b, 42 + i) - 0.5) * 70;
        const rv = v + (h(a, b, 48 + i) - 0.5) * 70;
        if (blocked(ru, rv, 16) || hitsPlate(ru, rv, 24, 20)) continue;
        sym(`r${a},${b},${i}`, `vt-${ROCK[Math.floor(h(a, b, 54 + i) * 3)]}`, ru, rv, 0.9 + h(a, b, 58 + i) * 0.7, 0, h(a, b, 62 + i) < 0.5);
      }
    }
  });
  span(240, (cu, cv, a, b) => {
    const u = cu + (h(a, b, 70) - 0.5) * 160;
    const v = cv + (h(a, b, 71) - 0.5) * 160;
    const dp = dPlate(u, v);
    const xs = u - v;
    const p = smooth(-300, -420, v) * smooth(60, 260, xs) * smooth(240, 420, dp);
    if (h(a, b, 72) > p * 0.8 || blocked(u, v, 60)) return;
    const n = 1 + Math.floor(h(a, b, 73) * 3);
    for (let i = 0; i < n; i++) {
      const nm = `mountain-${1 + Math.floor(h(a, b, 74 + i) * 2)}`;
      names.add(nm);
      sym(`m${a},${b},${i}`, nm, u + (h(a, b, 78 + i) - 0.5) * 70, v + (h(a, b, 82 + i) - 0.5) * 50, K * (1.2 + h(a, b, 86 + i) * 0.55), 0, h(a, b, 90 + i) < 0.5);
    }
  });
  sym('massif', 'massif-peak', MASSIF_AT[0], MASSIF_AT[1], K * 1.1);

  // Small dressing: sparse near the walls, richer towards the edge.
  span(53, (cu, cv, a, b) => {
    const u = cu + (h(a, b, 100) - 0.5) * 36;
    const v = cv + (h(a, b, 101) - 0.5) * 36;
    const dp = dPlate(u, v);
    if (dp < 50 || h(a, b, 102) > 0.16 * smooth(60, 420, dp) || blocked(u, v, 10) || hitsPlate(u, v, 26, 14)) return;
    const r = h(a, b, 103);
    const tier = h(a, b, 104) < 0.5 ? 0 : h(a, b, 104) < 0.8 ? 1 : 2;
    const id = r < 0.3 ? 'vt-bush' : r < 0.42 ? 'vt-rockB' : r < 0.5 ? 'vt-stump' : r < 0.55 ? 'vt-logs' : r < 0.68 ? 'flowers' : r < 0.78 ? 'daisies' : r < 0.9 ? 'tufts' : 'clover';
    sym(`d${a},${b}`, id, u, v, id.startsWith('vt-') ? 0.9 + h(a, b, 105) * 0.3 : 0.9, tier, h(a, b, 106) < 0.5);
  });

  // The farm: haystacks and scarecrows; the sheep and their fence; the bridge.
  HAY.forEach(([u, v, tier], i) => sym(`hay${i}`, 'haystack', u, v, 0.9, tier, i === 1));
  SCARECROWS.forEach(([u, v, tier], i) => {
    const [x, y] = scr(u, v);
    objs.push({ x, y, tier, node: scarecrow(`sc${i}`, u, v) });
  });
  SHEEP.forEach(([u, v, sp, flip, tier], i) => sym(`sh${i}`, sp, u, v, 0.9, tier, flip));
  objs.push(fence(PASTURE.u0 + 2, PLATE + 12, PASTURE.u0 + 2, PASTURE.v1 - 6, 'fw'));
  objs.push(fence(PASTURE.u1 - 4, PLATE + 12, PASTURE.u1 - 4, PASTURE.v1 - 6, 'fe'));
  objs.push(bridge());

  objs.sort((p, q) => p.y - q.y || p.x - q.x);
  const used = new Set<string>(names);
  for (const o of objs) {
    const href = (o.node as { props?: { href?: string } }).props?.href;
    if (href?.startsWith('#tl-')) used.add(href.slice(4));
  }
  return { tones, tick, tick2, flowers, objs, names: [...used] };
}

// ---- Ground drawn in grid space ----------------------------------------------------------------------------------------------

const grid = (pts: readonly (readonly [number, number])[]) => `M${pts.map(([u, v]) => `${r1(u)} ${r1(v)}`).join('L')}`;
const rect = (u0: number, u1: number, v0: number, v1: number) => `${grid([[u0, v0], [u1, v0], [u1, v1], [u0, v1]])}Z`;

const CROP = {
  wheat: { base: '#E8C468', row: '#C98E1F', glint: '#F6DC8E' },
  green: { base: '#A8CC62', row: '#5E9A3A', glint: '#8CCB5A' },
  plough: { base: '#B47E4A', row: '#6A4524', glint: '#CFA070' },
} as const;

function FieldShape({ f, i }: { f: Field; i: number }) {
  const c = CROP[f.crop];
  let rows = '';
  for (let u = f.u0 + 4; u < f.u1 - 1; u += 5.2) rows += `M${r1(u)} ${f.v0 + 3}L${r1(u)} ${f.v1 - 3}`;
  return (
    <g key={`f${i}`}>
      <path d={rect(f.u0 - 4, f.u1 + 4, f.v0 - 4, f.v1 + 4)} fill="#B9D67A" />
      <path d={rect(f.u0, f.u1, f.v0, f.v1)} fill={c.base} stroke={INK} strokeWidth={1.3} strokeLinejoin="round" />
      <path d={rows} fill="none" stroke={c.row} strokeWidth={2.6} strokeLinecap="butt" opacity={0.85} />
      <path d={rows} fill="none" stroke={c.glint} strokeWidth={1.1} strokeDasharray="2.5 4" strokeLinecap="round" opacity={0.9} transform="translate(1.6 0)" />
    </g>
  );
}

const BUILT: Record<string, Built> = {};
const builtFor = (wide: boolean) => (BUILT[wide ? 'w' : 'p'] ??= build(wide));

export const LandscapeTiles = memo(function LandscapeTiles({ tier, wide }: { tier: number; wide: boolean }) {
  const b = builtFor(wide);
  const box = landBox(wide);
  const clip = `tl-clip-${wide ? 'w' : 'p'}`;
  const riverPts: [number, number][] = [[RIVER_U, -700], [RIVER_U, RIVER_V], [-1900, RIVER_V]];
  const river = grid(riverPts);
  const roadA = grid([[GATE_U, PLATE - 4], [GATE_U, RIVER_V - 14]]);
  const roadB = grid([[GATE_U, RIVER_V + 14], [GATE_U, 1900]]);
  const lane = grid([[LANE.u, LANE.v0], [LANE.u, TRACK.v], [TRACK.u0, TRACK.v]]);
  return (
    <g className="vv-land" strokeLinejoin="round">
      <defs>
        <clipPath id={clip}>
          <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} />
        </clipPath>
        {b.names.map((n) => (
          <g key={n} id={`tl-${n}`} dangerouslySetInnerHTML={{ __html: spriteMarkup(n) }} />
        ))}
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} fill="#9FC45F" />
        <g transform={GT} stroke="none">
          <path d={b.tones.dark} fill="#8FB558" opacity={0.5} />
          <path d={b.tones.light} fill="#B2D26F" opacity={0.55} />
          <path d={b.tones.mid} fill="#C3DE86" opacity={0.4} />
          <path d={b.tick} stroke="#5E8C3A" strokeWidth={2.4} strokeLinecap="round" opacity={0.45} />
          <path d={b.tick2} stroke="#CBE393" strokeWidth={2.4} strokeLinecap="round" opacity={0.65} />
          {/* the sheep meadow */}
          <path d={rect(PASTURE.u0, PASTURE.u1, PASTURE.v0, PASTURE.v1)} fill="#B9D67A" opacity={0.85} />
          {FIELDS.map((f, i) => (f.tier <= tier ? <FieldShape key={i} f={f} i={i} /> : null))}
          {/* the farm lane and the track to the road: worn earth without an outline */}
          <g fill="none" strokeLinecap="butt" strokeLinejoin="round">
            <path d={lane} stroke="#C49A63" strokeWidth={LANE.w + 2.6} />
            <path d={lane} stroke="#D9B98A" strokeWidth={LANE.w} />
            <path d={grid([[TRACK.u0, TRACK.v], [LANE.u, TRACK.v]])} stroke="#C49A63" strokeWidth={TRACK.w + 2.6} />
            <path d={grid([[TRACK.u0, TRACK.v], [LANE.u, TRACK.v]])} stroke="#D9B98A" strokeWidth={TRACK.w} />
            {/* river: ink edge, bank, water, a lighter middle and glints */}
            <path d={river} stroke={INK} strokeWidth={RIVER_W + 6} strokeLinecap="round" />
            <path d={river} stroke="#B08B5A" strokeWidth={RIVER_W + 2.6} strokeLinecap="round" />
            <path d={river} stroke="#2F9AA0" strokeWidth={RIVER_W} strokeLinecap="round" />
            <path d={river} stroke="#7AD3CD" strokeWidth={RIVER_W * 0.38} strokeLinecap="round" opacity={0.5} />
            <path d={river} stroke="#FFFFFF" strokeWidth={1.1} strokeDasharray="7 17" strokeLinecap="round" opacity={0.85} transform="translate(0 3)" />
            {/* the road from the gate: the village's path look, straight on the gate's centre line */}
            {[roadA, roadB].map((d, i) => (
              <g key={i}>
                <path d={d} stroke={INK} strokeWidth={ROAD_W + 3.4} />
                <path d={d} stroke="#D9B98A" strokeWidth={ROAD_W} />
                <path d={d} stroke="#E8D3A4" strokeWidth={ROAD_W * 0.5} strokeDasharray="10 12" opacity={0.8} />
              </g>
            ))}
          </g>
        </g>
        {b.flowers.map((f) => (f.tier <= tier ? f.node : null))}
        {b.objs.map((o) => (o.tier <= tier ? <g key={(o.node as { key?: string }).key}>{o.node}</g> : null))}
      </g>
    </g>
  );
});
