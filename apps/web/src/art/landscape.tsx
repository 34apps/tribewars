// Village landscape (style D · Toy Diorama, but calm and a little muted): the country around the ground plate. It is
// drawn inside the scene's own <svg> BEFORE the plate, so it can never cover the walls, buildings or labels, and the svg
// ignores the pointer (.vv-svg), so it never catches a click. It paints outside the scene's box (the svg shows its overflow;
// the village board clips it), so the village itself keeps exactly the same size.
//
// What is out there: a forest edge (left and back), hills and crags (back, right), a stream that widens into a pond with a
// wooden dock and a rowboat, a dirt road that leaves the gate and crosses the stream on a small wooden bridge, farm fields
// and pastures along the right wall (sheep, cows), deer at the forest edge, ducks on the water.
//
// Growth: `tier` 0..3 comes from the village size (see villageTier). Tier 0 is a hamlet: stream, road, bridge, sparse
// forest, three fields. Higher tiers add trees, fields and pastures, haystacks, hedges, the dock and boat, more animals.
//
// Everything is placed in the plate's isometric grid (u, v), with the ground plane at the plate's foot (z = -24), so the
// plate stands on this ground. Layout is deterministic (seeded), nothing is random at run time.

import { memo } from 'react';
import type { ReactNode } from 'react';
import { iso, SCENE_VIEWBOX, WALL_RING } from './buildings.ts';

const RP = WALL_RING.plate;
/** Height of the plate's earth sides: the landscape's ground plane lies this far below the plate's top. */
const FOOT = 24;
const INK = '#4A3B31';
const LW = 1.4;

const K = {
  grass: '#8DAE62',
  grassLight: '#9DBB70',
  grassDark: '#7B9C55',
  tick: '#6A8E48',
  bloom: '#EFE9D6',
  sand: '#D8C79B',
  water: '#85B6C5',
  waterLight: '#C6DFE5',
  waterDark: '#6199AC',
  road: '#D2B386',
  roadMid: '#E3D0A6',
  wheat: '#DDC376',
  wheatRow: '#B88F36',
  greens: '#93B65F',
  greensRow: '#5F8A3A',
  plough: '#A97F52',
  ploughRow: '#85603A',
  meadow: '#A3C06C',
  woodLight: '#D9B07A',
  wood: '#B08457',
  woodDark: '#80603C',
  haze: '#D5E0B5',
};
const HILL = { light: '#B7CF88', mid: '#97B86B', dark: '#739652' };
const CRAG = { light: '#D5D0C4', mid: '#AFA999', dark: '#857F73' };

type UV = readonly [number, number];
const f = (n: number) => Math.round(n * 10) / 10;
/** Screen point of ground point (u, v) lifted by z above the landscape's ground plane. */
const gp = (u: number, v: number, z = 0): [number, number] => iso(u, v, z - FOOT);
const pt = (u: number, v: number, z = 0) => {
  const [x, y] = gp(u, v, z);
  return `${f(x)} ${f(y)}`;
};
const poly = (pts: readonly UV[]) => `M${pts.map(([u, v]) => pt(u, v)).join('L')}Z`;
const rectPath = (u0: number, u1: number, v0: number, v1: number) =>
  poly([
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ]);

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Extent ----------------------------------------------------------------------------------------------------------
// The scene's own box is SCENE_VIEWBOX. Desktop shows more around it (the board is wider than the stage); a phone can only
// pan to the stage's edge, so it needs just a margin (and the layer stays small to scroll).

const VB = SCENE_VIEWBOX;
export interface LandBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const FIT_BOX: LandBox = { x0: VB.x - 500, y0: VB.y - 300, x1: VB.x + VB.w + 500, y1: VB.y + VB.h + 300 };
const PAN_BOX: LandBox = { x0: VB.x - 50, y0: VB.y - 110, x1: VB.x + VB.w + 50, y1: VB.y + VB.h + 30 };
export const landBox = (wide: boolean): LandBox => (wide ? FIT_BOX : PAN_BOX);

/** Share of the ranked props (trees, bushes, rocks, hedges) shown at each tier. */
const SHARE = [0.4, 0.62, 0.82, 1] as const;

/** Village size 0..3 from the building levels: the larger of the wall's progress and the whole village's progress. */
export function villageTier(levels: Record<string, number>, maxes: Record<string, number>): 0 | 1 | 2 | 3 {
  let sum = 0;
  let max = 0;
  for (const id of Object.keys(maxes)) {
    sum += Math.min(levels[id] ?? 0, maxes[id]!);
    max += maxes[id]!;
  }
  const wall = maxes.wall ? Math.min(levels.wall ?? 0, maxes.wall) / maxes.wall : 0;
  const size = Math.max(wall, max > 0 ? sum / max : 0);
  return size >= 0.8 ? 3 : size >= 0.45 ? 2 : size >= 0.2 ? 1 : 0;
}

// ---- Geometry helpers -----------------------------------------------------------------------------------------------

interface Sample {
  u: number;
  v: number;
  nu: number;
  nv: number;
  s: number;
}

/** Catmull-Rom curve through grid points, sampled about every `step` units, with unit normals. */
function curve(pts: readonly UV[], step: number): Sample[] {
  const raw: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const c = (a: number, b: number, cc: number, d: number) =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      raw.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  raw.push([pts[pts.length - 1]![0], pts[pts.length - 1]![1]]);
  let s = 0;
  return raw.map(([u, v], i) => {
    const a = raw[Math.max(0, i - 1)]!;
    const b = raw[Math.min(raw.length - 1, i + 1)]!;
    const du = b[0] - a[0];
    const dv = b[1] - a[1];
    const len = Math.hypot(du, dv) || 1;
    if (i > 0) s += Math.hypot(u - raw[i - 1]![0], v - raw[i - 1]![1]);
    return { u, v, nu: -dv / len, nv: du / len, s };
  });
}

const wob = (s: number, k: number) => Math.sin(s * 0.05 + k) * 0.6 + Math.sin(s * 0.14 + k * 2.3) * 0.4;

/** Outline of a ribbon along a curve (half width `hw(s)`), as a grid polygon. */
function ribbon(sm: Sample[], hw: (s: number) => number): UV[] {
  const a = sm.map((q) => [q.u + q.nu * hw(q.s), q.v + q.nv * hw(q.s)] as UV);
  const b = sm.map((q) => [q.u - q.nu * hw(q.s), q.v - q.nv * hw(q.s)] as UV).reverse();
  return [...a, ...b];
}

/** Smooth closed blob around (cu, cv). */
function blob(cu: number, cv: number, ru: number, rv: number, seed: number, grow = 0): UV[] {
  const out: UV[] = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const k = 1 + 0.13 * Math.sin(a * 3 + seed) + 0.08 * Math.sin(a * 5 + seed * 2.1);
    out.push([cu + Math.cos(a) * (ru * k + grow), cv + Math.sin(a) * (rv * k + grow)]);
  }
  return out;
}

const pathOf = (pts: readonly UV[]) => `M${pts.map(([u, v]) => pt(u, v)).join('L')}Z`;

// ---- The lay of the land (grid units) --------------------------------------------------------------------------------

/** Stream: from the forest on the left, through the pond, under the bridge, out to the bottom right. */
const STREAM_PTS: UV[] = [
  [-420, 300],
  [-330, 296],
  [-240, 312],
  [-160, 306],
  [-90, 316],
  [-30, 308],
  [22, 312],
  [74, 324],
  [132, 310],
  [204, 328],
  [290, 338],
  [390, 332],
  [500, 352],
];
const STREAM = curve(STREAM_PTS, 8);
const streamHalf = (s: number) => 17 + 3.5 * wob(s, 1);

const POND = { u: -108, v: 326, ru: 54, rv: 34 };
const POND_PTS = blob(POND.u, POND.v, POND.ru, POND.rv, 2);

/** Dirt road: out of the gate (the plate's front-left wall at u = 8), down to the bridge and away to the bottom left. */
const ROAD_PTS: UV[] = [
  [8, RP - 12],
  [10, 262],
  [18, 292],
  [22, 330],
  [10, 374],
  [-8, 424],
  [-16, 480],
  [-10, 560],
];
const ROAD = curve(ROAD_PTS, 5);
const ROAD_HALF = 11;
/** The bridge deck: where the road crosses the stream. */
const BRIDGE = { u: 21, v: 314, hu: 14, hv: 34 };

const inWater = (u: number, v: number, pad: number) =>
  STREAM.some((q) => Math.hypot(q.u - u, q.v - v) < streamHalf(q.s) + 7 + pad) ||
  Math.pow((u - POND.u) / (POND.ru + 8 + pad), 2) + Math.pow((v - POND.v) / (POND.rv + 8 + pad), 2) < 1;
const onRoad = (u: number, v: number, pad: number) => ROAD.some((q) => Math.hypot(q.u - u, q.v - v) < ROAD_HALF + 3 + pad);

type Crop = 'wheat' | 'greens' | 'plough' | 'pasture';
interface Field {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  crop: Crop;
  tier: number;
}
/** Strips along the front-right wall; each strip is shorter than the one before (the corner of the view narrows). */
const FIELDS: Field[] = [
  { u0: 256, u1: 318, v0: -208, v1: -126, crop: 'wheat', tier: 0 },
  { u0: 256, u1: 318, v0: -116, v1: -34, crop: 'greens', tier: 0 },
  { u0: 256, u1: 318, v0: -24, v1: 58, crop: 'plough', tier: 0 },
  { u0: 256, u1: 318, v0: 68, v1: 150, crop: 'wheat', tier: 1 },
  { u0: 332, u1: 394, v0: -150, v1: -70, crop: 'pasture', tier: 1 },
  { u0: 332, u1: 394, v0: -60, v1: 20, crop: 'wheat', tier: 2 },
  { u0: 256, u1: 318, v0: 160, v1: 222, crop: 'greens', tier: 2 },
  { u0: 332, u1: 394, v0: 30, v1: 96, crop: 'plough', tier: 3 },
  { u0: 408, u1: 468, v0: -80, v1: 0, crop: 'pasture', tier: 3 },
];
const onField = (u: number, v: number, pad: number) => FIELDS.some((q) => u > q.u0 - pad && u < q.u1 + pad && v > q.v0 - pad && v < q.v1 + pad);

// ---- Prop pieces ---------------------------------------------------------------------------------------------------

type Pal = typeof HILL;

/** A chunky grass hill (dome with a lit side and a shaded side). */
function mound(x: number, y: number, w: number, h: number, pal: Pal = HILL): ReactNode {
  const top = y - h;
  const body = `M${f(x - w)} ${f(y)}C${f(x - w)} ${f(y - h * 1.15)} ${f(x - w * 0.5)} ${f(top)} ${f(x)} ${f(top)}C${f(x + w * 0.5)} ${f(top)} ${f(x + w)} ${f(y - h * 1.15)} ${f(x + w)} ${f(y)}A${f(w)} ${f(w * 0.36)} 0 0 1 ${f(x - w)} ${f(y)}Z`;
  const shade = `M${f(x + w * 0.22)} ${f(top + h * 0.04)}C${f(x + w * 0.7)} ${f(top + h * 0.12)} ${f(x + w)} ${f(y - h * 0.8)} ${f(x + w)} ${f(y)}A${f(w)} ${f(w * 0.36)} 0 0 1 ${f(x + w * 0.2)} ${f(y + w * 0.35)}C${f(x + w * 0.62)} ${f(y + w * 0.12)} ${f(x + w * 0.64)} ${f(y - h * 0.5)} ${f(x + w * 0.22)} ${f(top + h * 0.04)}Z`;
  return (
    <g strokeLinejoin="round">
      <ellipse cx={f(x + w * 0.12)} cy={f(y + w * 0.1)} rx={f(w * 1.08)} ry={f(w * 0.4)} fill={INK} opacity={0.16} />
      <path d={body} fill={pal.mid} />
      <path d={shade} fill={pal.dark} />
      <ellipse cx={f(x - w * 0.34)} cy={f(y - h * 0.6)} rx={f(w * 0.3)} ry={f(h * 0.26)} transform={`rotate(-26 ${f(x - w * 0.34)} ${f(y - h * 0.6)})`} fill={pal.light} opacity={0.85} />
      <path d={body} fill="none" stroke={INK} strokeWidth={LW} />
    </g>
  );
}

/** A rocky crag: two faceted faces and a light ridge. */
function crag(x: number, y: number, w: number, h: number): ReactNode {
  const ax = x + w * 0.08;
  const ay = y - h;
  const bm = [x + w * 0.1, y + w * 0.22] as const;
  return (
    <g strokeLinejoin="round" stroke={INK} strokeWidth={LW}>
      <ellipse cx={f(x + w * 0.1)} cy={f(y + w * 0.08)} rx={f(w * 1.1)} ry={f(w * 0.36)} fill={INK} opacity={0.16} stroke="none" />
      <path d={`M${f(x - w)} ${f(y)}L${f(x - w * 0.5)} ${f(y - h * 0.55)}L${f(ax)} ${f(ay)}L${f(bm[0])} ${f(bm[1])}Z`} fill={CRAG.mid} />
      <path d={`M${f(ax)} ${f(ay)}L${f(x + w * 0.55)} ${f(y - h * 0.5)}L${f(x + w)} ${f(y)}L${f(bm[0])} ${f(bm[1])}Z`} fill={CRAG.dark} />
      <path d={`M${f(x - w * 0.5)} ${f(y - h * 0.55)}L${f(ax)} ${f(ay)}L${f(x + w * 0.1)} ${f(y - h * 0.5)}L${f(x - w * 0.2)} ${f(y - h * 0.3)}Z`} fill={CRAG.light} strokeWidth={1} />
    </g>
  );
}

const sheep = (
  <g stroke={INK} strokeWidth={1.1} strokeLinejoin="round">
    <ellipse cx={1} cy={1} rx={11} ry={3.6} fill={INK} opacity={0.2} stroke="none" />
    <path d="M-5 0V3M4 0V3" strokeWidth={1.6} strokeLinecap="round" />
    <circle cx={-4.5} cy={-4.5} r={4.6} fill="#F6F0DE" />
    <circle cx={3.5} cy={-4.8} r={5} fill="#F6F0DE" />
    <circle cx={-0.5} cy={-7} r={4.6} fill="#FFFAEC" />
    <ellipse cx={8.6} cy={-5} rx={3} ry={2.8} fill="#5A4A40" />
  </g>
);

const cow = (
  <g stroke={INK} strokeWidth={1.1} strokeLinejoin="round">
    <ellipse cx={1} cy={1.5} rx={15} ry={4.4} fill={INK} opacity={0.2} stroke="none" />
    <path d="M-8 0V4M-3 0V4M5 0V4M9 0V4" strokeWidth={1.8} strokeLinecap="round" />
    <path d="M-12 -5Q-12 -12 -6 -12L8 -12Q12 -12 12 -6Q12 0 8 0L-8 0Q-12 0 -12 -5Z" fill="#F6F0DE" />
    <path d="M-5 -12Q-1 -12 0 -8Q-3 -5 -7 -7Z" fill="#8A6144" stroke="none" />
    <path d="M4 -3Q8 -4 10 -1Q7 0 4 -3Z" fill="#8A6144" stroke="none" />
    <path d="M10 -10L16 -9Q18 -6 16 -3L11 -3Z" fill="#F0E2C4" />
    <path d="M13 -10L14 -13" strokeWidth={1.2} strokeLinecap="round" />
    <circle cx={15} cy={-7} r={0.9} fill={INK} stroke="none" />
  </g>
);

const deer = (
  <g stroke={INK} strokeWidth={1.1} strokeLinejoin="round" strokeLinecap="round">
    <ellipse cx={1} cy={1.5} rx={13} ry={3.6} fill={INK} opacity={0.2} stroke="none" />
    <path d="M-6 -4V2M-2 -4V2M5 -4V2M8 -4V2" strokeWidth={1.7} />
    <path d="M-9 -9Q-9 -14 -3 -14L7 -14Q10 -14 10 -9Q10 -4 7 -4L-6 -4Q-9 -4 -9 -9Z" fill="#B98A5A" />
    <path d="M7 -13L11 -21L16 -20L16 -16L11 -13Z" fill="#B98A5A" />
    <path d="M-9 -10L-11 -11" strokeWidth={1.6} />
    <path d="M11 -21L10 -26L13 -24M14 -21L16 -26L18 -23" fill="none" strokeWidth={1.1} />
    <circle cx={14.5} cy={-18} r={0.8} fill={INK} stroke="none" />
    <ellipse cx={-1} cy={-8} rx={5} ry={2} fill="#E4C9A1" stroke="none" />
  </g>
);

const duck = (
  <g stroke={INK} strokeWidth={1} strokeLinejoin="round">
    <ellipse cx={0} cy={1.5} rx={9} ry={2.6} fill="#FFFFFF" opacity={0.55} stroke="none" />
    <path d="M-6 -1Q-6 -6 0 -6Q5 -6 6 -3Q4 0 -1 0Q-5 0 -6 -1Z" fill="#F6F0DE" />
    <circle cx={5.5} cy={-7} r={2.7} fill="#5E8C6A" />
    <path d="M8 -7.5L11 -6.5L8 -5.6Z" fill="#F2B33D" strokeWidth={0.8} />
  </g>
);

const haystack = (
  <g stroke={INK} strokeWidth={1.2} strokeLinejoin="round">
    <ellipse cx={2} cy={2} rx={13} ry={4.4} fill={INK} opacity={0.2} stroke="none" />
    <path d="M-10 0Q-11 -12 0 -15Q11 -12 10 0Q0 4 -10 0Z" fill="#E2C877" />
    <path d="M2 -14Q10 -11 10 0Q6 2 2 2.5Z" fill="#C49A3E" stroke="none" />
    <path d="M-6 -6Q0 -3 6 -6M-8 -2Q0 1 8 -2" fill="none" strokeWidth={0.8} opacity={0.5} />
  </g>
);

const reeds = (
  <g stroke="#5F8A3A" strokeWidth={1.6} strokeLinecap="round" fill="none">
    <path d="M-4 1Q-5 -6 -6 -12M0 1V-14M4 1Q5 -6 6 -11" />
    <path d="M0 -14V-9M-6 -12V-9M6 -11V-8" stroke="#8A5A3A" strokeWidth={2.6} />
  </g>
);

const lily = (
  <g stroke={INK} strokeWidth={0.8}>
    <ellipse cx={0} cy={0} rx={6.5} ry={2.8} fill="#7FA95B" />
    <circle cx={1.5} cy={-0.6} r={1.3} fill="#F0B5C0" stroke="none" />
  </g>
);

const scarecrow = (
  <g stroke={INK} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx={1} cy={1} rx={7} ry={2.4} fill={INK} opacity={0.2} stroke="none" />
    <path d="M0 0V-22M-9 -16H9" strokeWidth={2} stroke={K.woodDark} />
    <path d="M-5 -16L-6 -9H6L5 -16Z" fill="#C4623A" />
    <circle cx={0} cy={-24} r={3.6} fill="#E8D3A4" />
    <path d="M-6 -26H6L3 -31H-3Z" fill="#8E6539" />
  </g>
);

/** Symbols used with <use href="#vl-…">; rendered once, inside the landscape. */
function LandDefs() {
  return (
    <defs>
      <g id="vl-sheep">{sheep}</g>
      <g id="vl-cow">{cow}</g>
      <g id="vl-deer">{deer}</g>
      <g id="vl-duck">{duck}</g>
      <g id="vl-hay">{haystack}</g>
      <g id="vl-reeds">{reeds}</g>
      <g id="vl-lily">{lily}</g>
      <g id="vl-scarecrow">{scarecrow}</g>
    </defs>
  );
}

// ---- Wooden things (bridge, dock, fences, boat), drawn on the grid ----------------------------------------------------

interface Wood {
  top: string;
  left: string;
  right: string;
}
const PLANK: Wood = { top: K.woodLight, left: K.wood, right: K.woodDark };

/** Visible faces of a box: left (+v), right (+u) and top. */
function slab(key: string, u0: number, u1: number, v0: number, v1: number, z0: number, z1: number, c: Wood, sw = LW): ReactNode {
  const q = (pts: readonly (readonly [number, number, number])[]) => `M${pts.map(([u, v, z]) => pt(u, v, z)).join('L')}Z`;
  return (
    <g key={key} stroke={INK} strokeWidth={sw} strokeLinejoin="round">
      <path d={q([[u0, v1, z0], [u1, v1, z0], [u1, v1, z1], [u0, v1, z1]])} fill={c.left} />
      <path d={q([[u1, v1, z0], [u1, v0, z0], [u1, v0, z1], [u1, v1, z1]])} fill={c.right} />
      <path d={q([[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]])} fill={c.top} />
    </g>
  );
}

function Bridge() {
  const { u, v, hu, hv } = BRIDGE;
  const planks: string[] = [];
  for (let s = v - hv + 6; s < v + hv - 2; s += 7) planks.push(`M${pt(u - hu, s, 6)}L${pt(u + hu, s, 6)}`);
  const posts = (uu: number) => [v - hv + 3, v - hv / 3, v + hv / 3, v + hv - 3].map((s) => slab(`p${uu}${s}`, uu - 1.6, uu + 1.6, s - 1.6, s + 1.6, 0, 15, PLANK, 1.1));
  return (
    <g>
      {/* little abutments in the banks */}
      {slab('ab0', u - hu - 1, u + hu + 1, v - hv - 2, v - hv + 4, 0, 5, { top: '#CFC8B8', left: '#A8A294', right: '#807A6E' })}
      {slab('ab1', u - hu - 1, u + hu + 1, v + hv - 4, v + hv + 2, 0, 5, { top: '#CFC8B8', left: '#A8A294', right: '#807A6E' })}
      {/* back rail, deck, front rail */}
      {posts(u - hu + 1.6)}
      {slab('rail0', u - hu, u - hu + 3, v - hv, v + hv, 11, 14, PLANK, 1.1)}
      {slab('deck', u - hu, u + hu, v - hv, v + hv, 2, 6, PLANK, 1.5)}
      <path d={planks.join('')} stroke={INK} strokeWidth={0.8} opacity={0.4} fill="none" />
      {posts(u + hu - 1.6)}
      {slab('rail1', u + hu - 3, u + hu, v - hv, v + hv, 11, 14, PLANK, 1.1)}
    </g>
  );
}

function Dock() {
  const u = POND.u + 6;
  const vTop = POND.v - POND.rv - 12;
  const vEnd = POND.v - 6;
  const posts = [vTop + 2, (vTop + vEnd) / 2, vEnd - 2].flatMap((s) => [u - 7.5, u + 7.5].map((uu) => slab(`dp${uu}${s}`, uu - 1.4, uu + 1.4, s - 1.4, s + 1.4, -6, 8, PLANK, 1)));
  const planks: string[] = [];
  for (let s = vTop + 5; s < vEnd - 1; s += 6) planks.push(`M${pt(u - 9, s, 4)}L${pt(u + 9, s, 4)}`);
  return (
    <g>
      {slab('dk', u - 9, u + 9, vTop, vEnd, 0, 4, PLANK, 1.4)}
      <path d={planks.join('')} stroke={INK} strokeWidth={0.8} opacity={0.4} fill="none" />
      {posts}
    </g>
  );
}

/** A rowboat on the water at grid point (u, v). */
function Boat({ u, v }: { u: number; v: number }) {
  const [x, y] = gp(u, v);
  return (
    <g transform={`translate(${f(x)} ${f(y)})`} stroke={INK} strokeWidth={1.2} strokeLinejoin="round">
      <ellipse cx={1} cy={3} rx={17} ry={5} fill="#FFFFFF" opacity={0.45} stroke="none" />
      <path d="M-16 -3L16 -3Q13 5 0 6Q-13 5 -16 -3Z" fill="#B8603C" />
      <path d="M-16 -3L16 -3Q14 -1.5 0 -1.5Q-14 -1.5 -16 -3Z" fill="#E4B67C" />
      <path d="M-4 -4L8 -11M8 -11L10 -9" fill="none" strokeWidth={1.4} strokeLinecap="round" />
    </g>
  );
}

/** Wooden pasture fence round a field rectangle (posts and two rails), open at the wall side. */
function fence(fd: Field): ReactNode {
  const e = 1.5;
  const runs: [UV, UV][] = [
    [[fd.u0 - e, fd.v0 - e], [fd.u1 + e, fd.v0 - e]],
    [[fd.u1 + e, fd.v0 - e], [fd.u1 + e, fd.v1 + e]],
    [[fd.u0 - e, fd.v1 + e], [fd.u1 + e, fd.v1 + e]],
    [[fd.u0 - e, fd.v0 - e], [fd.u0 - e, fd.v1 + e]],
  ];
  let rails = '';
  let posts = '';
  for (const [a, b] of runs) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (const z of [5, 9]) rails += `M${pt(a[0], a[1], z)}L${pt(b[0], b[1], z)}`;
    const n = Math.max(1, Math.round(len / 14));
    for (let i = 0; i <= n; i++) {
      const u = a[0] + ((b[0] - a[0]) * i) / n;
      const v = a[1] + ((b[1] - a[1]) * i) / n;
      posts += `M${pt(u, v, 0)}L${pt(u, v, 11)}`;
    }
  }
  return (
    <g fill="none" strokeLinecap="round">
      <path d={posts} stroke={INK} strokeWidth={4} />
      <path d={posts} stroke={K.wood} strokeWidth={2.2} />
      <path d={rails} stroke={INK} strokeWidth={3.4} />
      <path d={rails} stroke={K.woodLight} strokeWidth={1.8} />
    </g>
  );
}

// ---- Ground layers -------------------------------------------------------------------------------------------------

function fieldNode(fd: Field, i: number): ReactNode {
  const a =
    fd.crop === 'wheat'
      ? [K.wheat, K.wheatRow]
      : fd.crop === 'greens'
        ? [K.greens, K.greensRow]
        : fd.crop === 'plough'
          ? [K.plough, K.ploughRow]
          : [K.meadow, K.grassDark];
  let rows = '';
  if (fd.crop === 'pasture') {
    for (let k = 0; k < 14; k++) {
      const u = fd.u0 + 6 + ((k * 37) % 100) * ((fd.u1 - fd.u0 - 12) / 100);
      const v = fd.v0 + 6 + ((k * 53) % 100) * ((fd.v1 - fd.v0 - 12) / 100);
      rows += `M${pt(u, v)}l-2 -4M${pt(u, v)}l0 -5M${pt(u, v)}l2 -4`;
    }
  } else {
    for (let v = fd.v0 + 6; v <= fd.v1 - 4; v += 6) rows += `M${pt(fd.u0 + 3, v)}L${pt(fd.u1 - 3, v)}`;
  }
  return (
    <g key={`fd${i}`}>
      <path d={rectPath(fd.u0, fd.u1, fd.v0, fd.v1)} fill={a[0]} stroke={INK} strokeWidth={LW} strokeLinejoin="round" />
      <path d={rows} fill="none" stroke={a[1]} strokeWidth={fd.crop === 'pasture' ? 1.4 : 2} strokeLinecap="round" opacity={0.7} />
    </g>
  );
}

function roadNode(): ReactNode {
  const line = ROAD.map((q) => pt(q.u, q.v)).join('L');
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={`M${line}`} stroke={INK} strokeWidth={ROAD_HALF * 2.1 + 3} />
      <path d={`M${line}`} stroke={K.road} strokeWidth={ROAD_HALF * 2.1} />
      <path d={`M${line}`} stroke={K.roadMid} strokeWidth={ROAD_HALF * 0.5} strokeDasharray="9 11" opacity={0.8} />
    </g>
  );
}

function waterNodes(): ReactNode {
  const streamPoly = ribbon(STREAM, streamHalf);
  const bank = ribbon(STREAM, (s) => streamHalf(s) + 6);
  const pondBank = blob(POND.u, POND.v, POND.ru, POND.rv, 2, 6);
  // Dashes of light on the water along the stream and on the pond.
  let glints = '';
  STREAM.forEach((q, i) => {
    if (i % 3 !== 0 || (q.u > BRIDGE.u - 40 && q.u < BRIDGE.u + 40)) return;
    const o = streamHalf(q.s) * 0.4 * (i % 2 ? 1 : -1);
    const u = q.u + q.nu * o;
    const v = q.v + q.nv * o;
    glints += `M${pt(u - 7, v)}L${pt(u + 7, v + 1)}`;
  });
  for (const [du, dv] of [[-22, -8], [10, 6], [-6, 14], [26, -10]] as const) glints += `M${pt(POND.u + du - 7, POND.v + dv)}L${pt(POND.u + du + 7, POND.v + dv + 1)}`;
  return (
    <g strokeLinejoin="round">
      <path d={pathOf(bank)} fill={K.sand} stroke={INK} strokeWidth={LW} />
      <path d={pathOf(pondBank)} fill={K.sand} stroke={INK} strokeWidth={LW} />
      <path d={pathOf(streamPoly)} fill={K.water} />
      <path d={pathOf(POND_PTS)} fill={K.water} />
      {/* the bank outlines inside the water were covered; draw a thin inner edge so the water reads as one body */}
      <path d={pathOf(streamPoly)} fill="none" stroke={K.waterDark} strokeWidth={1.2} opacity={0.5} />
      <path d={pathOf(POND_PTS)} fill="none" stroke={K.waterDark} strokeWidth={1.2} opacity={0.5} />
      <path d={glints} fill="none" stroke={K.waterLight} strokeWidth={2} strokeLinecap="round" opacity={0.85} />
    </g>
  );
}

/** Meadow texture: lighter and darker patches, grass ticks and white flowers across the whole box. */
function meadow(box: LandBox): ReactNode {
  const r = rng(31);
  const patches: ReactNode[] = [];
  for (let i = 0; i < 60; i++) {
    const x = box.x0 + r() * (box.x1 - box.x0);
    const y = box.y0 + r() * (box.y1 - box.y0);
    const rx = 40 + r() * 90;
    patches.push(<ellipse key={i} cx={f(x)} cy={f(y)} rx={f(rx)} ry={f(rx * 0.42)} fill={i % 3 ? K.grassLight : K.grassDark} opacity={0.5} />);
  }
  let ticks = '';
  let blooms = '';
  for (let i = 0; i < 520; i++) {
    const x = box.x0 + r() * (box.x1 - box.x0);
    const y = box.y0 + r() * (box.y1 - box.y0);
    ticks += `M${f(x)} ${f(y)}l-2 -4M${f(x)} ${f(y)}l0 -5M${f(x)} ${f(y)}l2 -4`;
    if (i % 5 === 0) blooms += `M${f(x + 6)} ${f(y + 3)}h0`;
  }
  return (
    <g>
      {patches}
      <path d={ticks} fill="none" stroke={K.tick} strokeWidth={1.4} strokeLinecap="round" opacity={0.7} />
      <path d={blooms} fill="none" stroke={K.bloom} strokeWidth={3.2} strokeLinecap="round" />
    </g>
  );
}

// ---- Props (trees, rocks, hills, animals), sorted by depth ----------------------------------------------------------

interface Item {
  key: string;
  /** Base point on screen. */
  x: number;
  y: number;
  node: ReactNode;
  /** Shown from this tier on (ranked props get theirs from SHARE). */
  tier: number;
  /** Rough height and half width on screen (for the plate overlap test). */
  h: number;
  w: number;
  /** Grid position and footprint radius (0: small things that others may overlap). */
  gu?: number;
  gv?: number;
  gr?: number;
}

type Kind = 'pineA' | 'pineB' | 'oak' | 'bush' | 'rockA' | 'rockB' | 'rockC';
/** Symbols come from the scene's SceneryDefs (#vt-…); size and a rough footprint radius. */
const KIND: Record<Kind, { rad: number; h: number; tall: boolean }> = {
  pineA: { rad: 8, h: 46, tall: true },
  pineB: { rad: 9, h: 38, tall: true },
  oak: { rad: 9, h: 38, tall: true },
  bush: { rad: 6, h: 12, tall: false },
  rockA: { rad: 8, h: 14, tall: false },
  rockB: { rad: 6, h: 10, tall: false },
  rockC: { rad: 8, h: 14, tall: false },
};

/** Point (x, y) on the plate top plane → grid coordinates relative to the plate. */
const plateUV = (x: number, y: number): UV => {
  const dx = x - WALL_RING.cx;
  const dy = y - WALL_RING.cy;
  return [(dx + 2 * dy) / 2, (2 * dy - dx) / 2];
};

/**
 * A prop may not reach over the plate (and its wall and towers) unless it stands behind it: the plate is painted after the
 * landscape, so a tall tree in front would be cut off by the plate's edge and look broken.
 */
function reachesPlate(u: number, v: number, x: number, y: number, w: number, h: number): boolean {
  const behind = (u < -RP || v < -RP) && u < RP && v < RP;
  if (behind) return false;
  const lim = RP + 16;
  return [[x - w, y - h], [x + w, y - h], [x, y - h], [x - w, y - h / 2], [x + w, y - h / 2], [x, y - h / 2]].some(([px, py]) => {
    const [pu, pv] = plateUV(px!, py!);
    return Math.max(Math.abs(pu), Math.abs(pv)) < lim;
  });
}

/** [kinds, centre u, centre v, spread u, spread v, count, min scale, max scale]. */
const ZONES: [Kind[], number, number, number, number, number, number, number][] = [
  // The forest edge: along the left and back-left of the village, thick near the wall, thinning out.
  [['pineA', 'pineB', 'pineA', 'oak'], -330, 10, 80, 250, 62, 1.1, 1.6],
  [['pineA', 'pineB', 'oak'], -300, -250, 90, 80, 22, 1.1, 1.5],
  [['bush', 'bush', 'oak'], -270, 150, 24, 90, 8, 1, 1.3],
  [['pineA', 'pineB', 'pineA'], -520, 120, 80, 280, 30, 1.2, 1.7],
  // Rocks and a few pines in the back-right, towards the Iron Mine corner.
  [['rockA', 'rockC', 'rockB', 'pineB'], 60, -330, 150, 50, 14, 1.2, 2],
  [['rockA', 'rockC', 'rockB', 'pineA'], 250, -250, 60, 140, 12, 1.2, 2],
  // The meadow between the stream and the trees, and the open ground beyond the stream: low things only.
  [['bush', 'oak', 'bush', 'rockB'], -250, 360, 140, 70, 12, 1, 1.4],
  [['bush', 'bush', 'oak'], 60, 420, 160, 70, 14, 1, 1.4],
  [['bush', 'oak', 'bush'], 300, 270, 90, 20, 5, 1, 1.3],
];

function build(): Item[] {
  const r = rng(77);
  const items: Item[] = [];
  const inBox = (x: number, y: number) => x > FIT_BOX.x0 + 14 && x < FIT_BOX.x1 - 14 && y > FIT_BOX.y0 + 40 && y < FIT_BOX.y1 - 6;
  const taken = (u: number, v: number, rad: number) => items.some((it) => (it.gr ?? 0) > 0 && Math.hypot(u - it.gu!, v - it.gv!) < rad + it.gr!);
  // Hills are placed by hand (screen look matters most there); each is a landmark that keeps the zones away from it.
  const hills: [number, number, number, number, number][] = [
    // u, v, width, height, minimum tier
    [-330, -360, 92, 62, 0],
    [-450, -250, 100, 66, 0],
    [-210, -440, 84, 54, 0],
    [-90, -420, 90, 58, 0],
    [-560, -90, 90, 56, 1],
    [30, -500, 96, 60, 1],
    [-420, -420, 80, 50, 2],
  ];
  hills.forEach(([u, v, w, h, tier], i) => {
    const [x, y] = gp(u, v);
    items.push({ key: `hill${i}`, x, y, tier, h: h + 10, w, gu: u, gv: v, gr: w * 0.7, node: mound(x, y, w, h) });
  });
  const crags: [number, number, number, number, number][] = [
    [60, -420, 70, 78, 0],
    [170, -470, 80, 100, 0],
    [-20, -380, 52, 52, 1],
    [270, -360, 66, 70, 1],
    [340, -250, 56, 56, 2],
    [130, -540, 70, 76, 2],
  ];
  crags.forEach(([u, v, w, h, tier], i) => {
    const [x, y] = gp(u, v);
    items.push({ key: `crag${i}`, x, y, tier, h, w, gu: u, gv: v, gr: w * 0.7, node: crag(x, y, w, h) });
  });

  for (const [kinds, cu, cv, su, sv, n, s0, s1] of ZONES) {
    const zone: Item[] = [];
    for (let i = 0, tries = 0; i < n && tries < n * 60; tries++) {
      const kind = kinds[Math.floor(r() * kinds.length)]!;
      const s = s0 + r() * (s1 - s0);
      const u = cu + (r() * 2 - 1) * su;
      const v = cv + (r() * 2 - 1) * sv;
      const k = KIND[kind];
      const rad = k.rad * s;
      const [x, y] = gp(u, v);
      if (Math.max(Math.abs(u), Math.abs(v)) < RP + 22 + rad) continue;
      if (!inBox(x, y) || inWater(u, v, rad) || onRoad(u, v, rad + 4) || onField(u, v, rad + 6)) continue;
      if (reachesPlate(u, v, x, y, rad * 1.2, k.h * s)) continue;
      if (taken(u, v, rad + 4)) continue;
      const it: Item = { key: `z${items.length}`, x, y, tier: 0, h: k.h * s, w: rad, gu: u, gv: v, gr: rad, node: <use href={`#vt-${kind}`} transform={`translate(${f(x)} ${f(y)}) scale(${f(s)})`} /> };
      zone.push(it);
      items.push(it);
      i++;
    }
    // Rank inside the zone: the first few are always there, the rest arrive as the village grows.
    zone.forEach((it, i) => (it.tier = SHARE.findIndex((sh) => i / zone.length < sh)));
  }

  // Reeds along the stream and pond; lily pads on the pond.
  STREAM.forEach((q, i) => {
    if (i % 4 !== 1) return;
    const side = i % 8 === 1 ? 1 : -1;
    const o = side * (streamHalf(q.s) + 4);
    const u = q.u + q.nu * o;
    const v = q.v + q.nv * o;
    if (Math.abs(q.u - BRIDGE.u) < 50 || Math.max(Math.abs(u), Math.abs(v)) < RP + 20) return;
    const [x, y] = gp(u, v);
    if (!inBox(x, y) || reachesPlate(u, v, x, y, 8, 16)) return;
    items.push({ key: `rd${i}`, x, y, tier: i % 8 === 1 ? 0 : 1, h: 16, w: 8, node: <use href="#vl-reeds" transform={`translate(${f(x)} ${f(y)})`} /> });
  });
  for (const [du, dv, t] of [[-24, -4, 0], [14, 10, 1], [-6, 14, 2]] as const) {
    const [x, y] = gp(POND.u + du, POND.v + dv);
    items.push({ key: `ly${du}`, x, y: y - 30, tier: t, h: 4, w: 7, node: <use href="#vl-lily" transform={`translate(${f(x)} ${f(y)})`} /> });
  }

  // Animals and farm bits.
  const put = (key: string, sym: string, u: number, v: number, tier: number, flip = false, sc = 1.15) => {
    const [x, y] = gp(u, v);
    items.push({ key, x, y, tier, h: 24, w: 14, node: <use href={`#vl-${sym}`} transform={`translate(${f(x)} ${f(y)}) scale(${flip ? -sc : sc} ${sc})`} /> });
  };
  put('duck0', 'duck', POND.u - 14, POND.v + 6, 0);
  put('duck1', 'duck', POND.u + 18, POND.v - 4, 0, true);
  put('duck2', 'duck', POND.u + 4, POND.v + 16, 2, true);
  put('duck3', 'duck', 150, 308, 3);
  put('deer0', 'deer', -296, 60, 1);
  put('deer1', 'deer', -318, 96, 2, true);
  put('deer2', 'deer', -286, -120, 3);
  // Sheep in the first pasture, cows in the second; a lone pair of sheep graze by the road from the start.
  put('sheepL0', 'sheep', 80, 276, 0);
  put('sheepL1', 'sheep', 110, 290, 0, true);
  const pas = FIELDS.filter((q) => q.crop === 'pasture');
  const flock = (fd: Field, sym: string, at: UV[], tier: number) =>
    at.forEach(([a, b], i) => put(`${sym}${fd.u0}${i}`, sym, fd.u0 + a * (fd.u1 - fd.u0), fd.v0 + b * (fd.v1 - fd.v0), tier, i % 2 === 0, sym === 'cow' ? 1.05 : 1.2));
  flock(pas[0]!, 'sheep', [[0.3, 0.25], [0.65, 0.45], [0.4, 0.7], [0.75, 0.8], [0.2, 0.55]], 1);
  flock(pas[1]!, 'cow', [[0.4, 0.3], [0.6, 0.7]], 3);
  // Haystacks beside the wheat, a scarecrow in the first wheat field.
  put('hay0', 'hay', 244, -170, 1, false, 1.1);
  put('hay1', 'hay', 244, 130, 2, true, 1.1);
  put('hay2', 'hay', 322, -80, 3, false, 1.1);
  put('scare', 'scarecrow', FIELDS[0]!.u0 + 30, FIELDS[0]!.v0 + 40, 2, false, 1.05);
  // Hedge between the strips, a row of bushes (from tier 1).
  for (let v = -140, i = 0; v <= 90; v += 17, i++) {
    const u = 325 + Math.sin(i) * 1.5;
    const [x, y] = gp(u, v);
    if (inBox(x, y)) items.push({ key: `hedge${i}`, x, y, tier: v > -60 ? 2 : 1, h: 12, w: 8, node: <use href="#vt-bush" transform={`translate(${f(x)} ${f(y)}) scale(1.15)`} /> });
  }
  return items;
}

let cached: Item[] | null = null;
const allItems = () => (cached ??= build().sort((a, b) => a.y - b.y));

// ---- The layer -----------------------------------------------------------------------------------------------------

/**
 * The landscape. `wide`: desktop (paints a wide margin around the scene) or phone (just a small margin). `tier`: village
 * size 0..3. Static: only changes when the tier or the mode does.
 */
export const Landscape = memo(function Landscape({ tier, wide }: { tier: number; wide: boolean }) {
  const box = landBox(wide);
  const shown = allItems().filter((it) => it.tier <= tier && it.x > box.x0 && it.x < box.x1 && it.y - it.h < box.y1 && it.y > box.y0);
  const fields = FIELDS.map((fd, i) => ({ fd, i })).filter(({ fd }) => fd.tier <= tier);
  const sh = RP + 7;
  return (
    <g className="vv-land" strokeLinejoin="round">
      <LandDefs />
      <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} fill={K.grass} />
      {meadow(box)}
      {fields.map(({ fd, i }) => fieldNode(fd, i))}
      {fields.filter(({ fd }) => fd.crop === 'pasture').map(({ fd, i }) => (
        <g key={`fn${i}`}>{fence(fd)}</g>
      ))}
      {roadNode()}
      {waterNodes()}
      {tier >= 1 && <Dock />}
      {tier >= 1 && <Boat u={POND.u - 34} v={POND.v + 4} />}
      <Bridge />
      {/* contact shadow under the plate, falling to the lower right */}
      <path d={poly([[-sh, -sh], [sh, -sh], [sh, sh], [-sh, sh]])} transform={`translate(9 7)`} fill={INK} opacity={0.18} />
      {shown.map((it) => (
        <g key={it.key}>{it.node}</g>
      ))}
      {/* a flat veil keeps everything out here a little softer than the village (no gradient) */}
      <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} fill={K.haze} opacity={0.14} />
    </g>
  );
});

// ---- Shared with the alternative landscapes (landscapeA/B/C.tsx) ------------------------------------------------------
export { RP, FOOT, INK, LW, K, SHARE, f, gp, pt, poly, rectPath, rng, curve, ribbon, wob, plateUV, reachesPlate, LandDefs, slab };
export type { UV, Sample, Item, Wood };
