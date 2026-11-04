// Village landscape "Map tiles" (the default). The land around the walls is built from the world map's terrain tiles
// (design/sprites/terrain, copied to ./terrain-sprites) at scale 0.875, so a tile is 39 grid units wide and the plate is twelve
// tiles across; tile outlines are drawn thinner and softer than on the map. The tile grid is shifted sideways so that one tile
// column is centred exactly on the gate (u = 8): the road leaves the gate straight along that column, tile by tile, crosses the
// river on the bridge tile and runs to the edge.
//
// The layout is meant, not random: groves (forest tiles in irregular patches) on the Lumber Camp side (left, back left); hill,
// rock and mountain clusters on the Iron Mine side (back right); a few small furrowed crop fields (one or two tiles each, grass
// tiles between them, a lane, scarecrows, haystacks) along the front right, a tile or more off the wall; one meadow with a few
// sheep inside a fence in front of the left wall; a river that rises in the hills and bends round the front. The grass next to
// the walls stays calm; trees, stones and flowers get denser towards the edges. Same contract as `Landscape` (landscape.tsx):
// one <g className="vv-land"> drawn BEFORE the plate. Growth: `tier` 0..3 (tier 0 is complete; each tier adds fields, hay, sheep).
//
// Tall tiles (forest, hills, mountains) only stand where the plate and its walls cannot cut them: behind the back walls or
// clear of the plate on screen; in front of the walls only low things (grass, fields, props) are drawn.
// Deterministic (hashed), built once; sprites are inlined as <g> markup in one <defs> and placed with <use> (no fetch).

import { memo } from 'react';
import type { ReactNode } from 'react';
import { WALL_RING, iso } from './buildings.ts';
import { landBox } from './landscape.tsx';

const SPRITE_FILES = import.meta.glob('./terrain-sprites/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const INK = '#2B211C';
const TILE = 39;
/** Tile art scale: the map tile diamond is 44.6 wide per side; 39 / 44.6 makes one tile 39 grid units. */
const K = TILE / 44.6;
const PLATE = WALL_RING.plate;
const GATE_U = WALL_RING.gateU;
/** Ground height of the tile tops: the foot of the plate's earth sides, so the plate stands proud of the land. */
const TZ = -24;
const BASE_FILL = '#3A5E27';

/** Tile column a is centred on u = GATE_U + 39 a (a = 0 holds the road); row j on v = -214.5 + 39 j (rows 0..11 lie under the plate). */
const uOf = (a: number) => GATE_U + TILE * a;
const vOf = (j: number) => -PLATE + TILE / 2 + TILE * j;
/** The tile index holding a ground point. */
const aOf = (u: number) => Math.round((u - GATE_U) / TILE);
const jOf = (v: number) => Math.round((v + PLATE - TILE / 2) / TILE);

/** Size of dressing props (sheep, hay, bushes, stones) against the village's own pines, oaks and houses. */
const PROP = 0.9;
/** Mountains are far away and may be bigger than the tiles around them. */
const MOUNT = 1.7;
const MASSIF_SCALE = 1.5;
/** Forest tiles are drawn a little larger so their trees are as tall as the pines inside the walls. */
const FOREST = 1.3;

const RIVER_A = 14; // river column (u = 554)
const RIVER_J = 16; // river row (v = 409.5)
/** The massif far behind the Iron Mine: centre of its 2x2 base (grid units); drawn at 1.5 times the tile scale (far away, big). */
const MASSIF_AT = [250, -570] as const;

// ---- Sprites -----------------------------------------------------------------------------------------------------------------

const CROP = {
  wheat: { base: '#EBC862', row: '#B5781A', glint: '#FFE9A0' },
  green: { base: '#9CC858', row: '#3F8A30', glint: '#7BD05A' },
  plough: { base: '#B88050', row: '#5A3A1C', glint: '#D5A878' },
} as const;
type Crop = keyof typeof CROP;
/** Crop tile sprites are named crop-<kind>-<n|pv|mv|b>: pv / mv run into the next tile along +v / -v (two-tile fields), b both. */
const cropName = (kind: Crop, ext: string) => `crop-${kind}-${ext}`;

const LEADING_BLOCK = /^(?:\s*<path\b[^>]*><\/path>){3}/;
/** Thinner, softer outline for a tile's three block faces (the map draws them bolder). */
const soften = (inner: string) => inner.replace(LEADING_BLOCK, (m) => m.replace(/stroke="#2B211C" stroke-width="1\.5"/g, 'stroke="#2B211C" stroke-opacity="0.55" stroke-width="1"'));

/** A crop field tile: the map's grass tile with a furrowed field inside a grass border. Rows run along v. */
function cropMarkup(kind: Crop, ext: string): string {
  const grass = SPRITE_FILES['./terrain-sprites/grass-2.svg'] ?? '';
  const block = (grass.replace(/^<svg[^>]*>/, '').replace(/<title>.*?<\/title>/, '').match(LEADING_BLOCK) ?? [''])[0];
  const c = CROP[kind];
  const P = (u: number, v: number) => `${Math.round((u - v) * 446) / 10} ${Math.round((u + v) * 223) / 10}`;
  const back = ext === 'mv' || ext === 'b';
  const front = ext === 'pv' || ext === 'b';
  const v0 = back ? -0.5 : -0.42;
  const v1 = front ? 0.5 : 0.42;
  const u0 = -0.42;
  const u1 = 0.42;
  const poly = `M${P(u0, v0)}L${P(u1, v0)}L${P(u1, v1)}L${P(u0, v1)}Z`;
  let edge = `M${P(u0, v0)}L${P(u0, v1)}M${P(u1, v0)}L${P(u1, v1)}`;
  if (!back) edge += `M${P(u0, v0)}L${P(u1, v0)}`;
  if (!front) edge += `M${P(u0, v1)}L${P(u1, v1)}`;
  let rows = '';
  for (let u = -0.33; u < 0.34; u += 0.11) rows += `M${P(u, back ? -0.5 : v0 + 0.06)}L${P(u, front ? 0.5 : v1 - 0.06)}`;
  return (
    soften(block) +
    `<path d="${poly}" fill="${c.base}"></path>` +
    `<path d="${rows}" fill="none" stroke="${c.row}" stroke-width="2.3" opacity="0.9"></path>` +
    `<path d="${rows}" fill="none" stroke="${c.glint}" stroke-width="0.7" stroke-dasharray="1.6 2.4" stroke-linecap="round" transform="translate(0.9 0)"></path>` +
    `<path d="${edge}" fill="none" stroke="#2B211C" stroke-opacity="0.6" stroke-width="0.9" stroke-linejoin="round"></path>`
  );
}

const SCARECROW = `<ellipse cx="1" cy="1" rx="6" ry="2.2" fill="${INK}" opacity="0.2"></ellipse><path d="M0 0V-17M-8 -12H8" stroke="${INK}" stroke-width="4.4" fill="none" stroke-linecap="round"></path><path d="M0 0V-17M-8 -12H8" stroke="#B07D46" stroke-width="2.2" fill="none" stroke-linecap="round"></path><path d="M-5 -9L-9 -4M5 -9L9 -4" stroke="#E4B67C" stroke-width="2" fill="none" stroke-linecap="round"></path><circle cx="0" cy="-20" r="3.6" fill="#F1E1C2" stroke="${INK}" stroke-width="1.4"></circle><path d="M-6 -22.5H6L0 -31Z" fill="#C4623A" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"></path>`;

// ---- Small toy buildings and animals, drawn in the village's style (foot at 0,0; ink outlines, flat fills) -------------------

const lp = (du: number, dv: number, z = 0) => `${Math.round((du - dv) * 10) / 10} ${Math.round(((du + dv) / 2 - z) * 10) / 10}`;
const face = (pts: readonly (readonly [number, number, number])[], fill: string, sw = 1.3) =>
  `<path d="M${pts.map(([du, dv, z]) => lp(du, dv, z)).join('L')}Z" fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"></path>`;
const shadow = (rx: number) => `<ellipse cx="2" cy="1" rx="${rx}" ry="${rx / 2.4}" fill="${INK}" opacity="0.2"></ellipse>`;

/** A tiny farmhouse (a small hut next to the village's own buildings): walls, gable roof, door and window. */
function house(wall: string, wallR: string, roof: string): string {
  const [hu, hv, hh, r] = [10, 8, 11, 8];
  return (
    shadow(18) +
    face([[-hu, hv, 0], [hu, hv, 0], [hu, hv, hh], [-hu, hv, hh]], wall) +
    face([[hu, -hv, 0], [hu, hv, 0], [hu, hv, hh], [hu, -hv, hh]], wallR) +
    face([[hu, -hv, hh], [hu, hv, hh], [hu, 0, hh + r]], wallR) +
    face([[-3, hv, 0], [3, hv, 0], [3, hv, 7], [-3, hv, 7]], '#714B29', 1) +
    face([[hu, -3, 4], [hu, 3, 4], [hu, 3, 9], [hu, -3, 9]], '#9BD0D4', 1) +
    face([[-hu - 2, hv + 2, hh - 1], [hu + 2, hv + 2, hh - 1], [hu + 2, 0, hh + r], [-hu - 2, 0, hh + r]], roof, 1.4)
  );
}

const WELL =
  shadow(11) +
  face([[-6, 6, 0], [6, 6, 0], [6, 6, 5], [-6, 6, 5]], '#CFC6B2') +
  face([[6, -6, 0], [6, 6, 0], [6, 6, 5], [6, -6, 5]], '#A99F8B') +
  face([[-6, -6, 5], [6, -6, 5], [6, 6, 5], [-6, 6, 5]], '#2F9AA0', 1.2) +
  `<path d="M${lp(-5, 5, 5)}L${lp(-5, 5, 17)}M${lp(5, 5, 5)}L${lp(5, 5, 17)}" stroke="${INK}" stroke-width="3.6" fill="none" stroke-linecap="round"></path>` +
  `<path d="M${lp(-5, 5, 5)}L${lp(-5, 5, 17)}M${lp(5, 5, 5)}L${lp(5, 5, 17)}" stroke="#B07D46" stroke-width="1.8" fill="none" stroke-linecap="round"></path>` +
  face([[-7, 6, 17], [7, 6, 17], [0, 6, 24]], '#C4623A', 1.2);

const MINE =
  shadow(30) +
  `<path d="M-26 2C-26 -20 -12 -32 0 -32C12 -32 26 -20 26 2Z" fill="#9A948A" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"></path>` +
  `<path d="M-8 -26C-14 -22 -20 -14 -22 -4L-8 -4Z" fill="#B9B3A6"></path>` +
  `<path d="M-9 2V-12Q0 -21 9 -12V2Z" fill="${INK}"></path>` +
  `<path d="M-11 2V-13M11 2V-13M-12 -13H12" stroke="${INK}" stroke-width="4.6" fill="none" stroke-linecap="round"></path>` +
  `<path d="M-11 2V-13M11 2V-13M-12 -13H12" stroke="#B07D46" stroke-width="2.4" fill="none" stroke-linecap="round"></path>` +
  `<path d="M-5 4L-9 14M5 4L9 14" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round"></path>`;

const CART =
  shadow(13) +
  face([[-6, 5, 2], [6, 5, 2], [6, 5, 9], [-6, 5, 9]], '#B07D46') +
  face([[6, -5, 2], [6, 5, 2], [6, 5, 9], [6, -5, 9]], '#714B29') +
  face([[-6, -5, 9], [6, -5, 9], [6, 5, 9], [-6, 5, 9]], '#6F6B64', 1.2) +
  `<circle cx="${(-3 - 5).toFixed(1)}" cy="${((-3 + 5) / 2 - 1).toFixed(1)}" r="3" fill="#E4B67C" stroke="${INK}" stroke-width="1.2"></circle>` +
  `<circle cx="${(4 - 5).toFixed(1)}" cy="${((4 + 5) / 2 - 1).toFixed(1)}" r="3" fill="#E4B67C" stroke="${INK}" stroke-width="1.2"></circle>` +
  `<path d="M${lp(-3, 0, 10)}l2 -3l3 2l2 -3" stroke="#F2B33D" stroke-width="1.6" fill="none" stroke-linecap="round"></path>`;

const DUCK =
  `<ellipse cx="0" cy="1" rx="6" ry="2" fill="#FFFFFF" opacity="0.5"></ellipse>` +
  `<path d="M5 -3L8 -6L7 -2Z" fill="#FFF8E8" stroke="${INK}" stroke-width="1" stroke-linejoin="round"></path>` +
  `<ellipse cx="0" cy="-3" rx="5.2" ry="3.2" fill="#FFF8E8" stroke="${INK}" stroke-width="1.2"></ellipse>` +
  `<path d="M-1 -3.4Q2 -1 4 -3.6" stroke="#CDBF9F" stroke-width="1" fill="none"></path>` +
  `<circle cx="-4.4" cy="-6.6" r="2.4" fill="#4E8A44" stroke="${INK}" stroke-width="1.1"></circle>` +
  `<path d="M-6.4 -6.6L-9.4 -5.8L-6.4 -5Z" fill="#F2A33D" stroke="${INK}" stroke-width="0.8" stroke-linejoin="round"></path>`;

const FRUIT_TREE =
  shadow(12) +
  `<path d="M-2.2 1V-9H2.2V1Z" fill="#8A5A2B" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"></path>` +
  ['-7 -15 7.5', '7 -15 7.5', '0 -21 9.5'].map((c) => { const [x, y, r] = c.split(' '); return `<circle cx="${x}" cy="${y}" r="${r}" fill="#68A042" stroke="${INK}" stroke-width="1.4"></circle>`; }).join('') +
  `<ellipse cx="-3" cy="-24" rx="4" ry="2.4" fill="#9CCB5C" transform="rotate(-25 -3 -24)"></ellipse>` +
  [[-8, -14], [6, -17], [1, -11], [9, -12], [-2, -22]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.9" fill="#D9483B" stroke="${INK}" stroke-width="0.8"></circle>`).join('');

const CUSTOM: Record<string, string> = {
  scarecrow: SCARECROW,
  'house-a': house('#F1E1C2', '#D5BC93', '#C4623A'),
  'house-b': house('#F6E8C8', '#DCC59B', '#B7553A'),
  hut: house('#B58A55', '#8E6539', '#7A5A34'),
  well: WELL,
  mine: MINE,
  cart: CART,
  duck: DUCK,
  'fruit-tree': FRUIT_TREE,
};

const TILE_ART = /^(grass|meadow|forest|hills|mountain|massif-base|rocky)/;

function spriteMarkup(name: string): string {
  const crop = /^crop-(wheat|green|plough)-(n|pv|mv|b)$/.exec(name);
  if (crop) return cropMarkup(crop[1] as Crop, crop[2]!);
  const custom = CUSTOM[name];
  if (custom) return custom;
  const raw = SPRITE_FILES[`./terrain-sprites/${name}.svg`];
  if (!raw) throw new Error(`Missing terrain sprite ${name}.svg`);
  let inner = raw.replace(/^<svg[^>]*>/, '').replace(/<title>.*?<\/title>/, '').replace(/<\/svg>\s*$/, '');
  if (TILE_ART.test(name)) inner = soften(inner);
  // Ids inside a sprite (masks) must not clash between sprites.
  return inner
    .replace(/id="(x_\d+)"/g, `id="tl-${name}-$1"`)
    .replace(/url\(#(x_\d+)\)/g, `url(#tl-${name}-$1)`)
    .replace(/href="#(x_\d+)"/g, `href="#tl-${name}-$1"`);
}

// ---- Deterministic hashing ---------------------------------------------------------------------------------------------------

/** A hashed number in [0, 1) for a tile and a purpose k. */
function h(a: number, j: number, k = 0): number {
  let x = (Math.imul(a + 101, 73856093) ^ Math.imul(j + 131, 19349663) ^ Math.imul(k + 7, 83492791)) | 0;
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
  const p = h(x0, y0, seed);
  const q = h(x0 + 1, y0, seed);
  const r = h(x0, y0 + 1, seed);
  const t = h(x0 + 1, y0 + 1, seed);
  return p + (q - p) * sx + (r - p) * sy + (p - q - r + t) * sx * sy;
}

// ---- Layout ------------------------------------------------------------------------------------------------------------------

interface Prop {
  sprite: string;
  u: number;
  v: number;
  scale: number;
  flip: boolean;
  tier: number;
}
interface Tile {
  a: number;
  j: number;
  sprite: string;
  tier: number;
  scale: number;
  props: Prop[];
}

/** Does a tall sprite standing on this tile reach the plate (which is drawn on top of the land)? */
function hitsPlate(u: number, v: number, height: number): boolean {
  const [x, y] = iso(u, v, TZ);
  for (const dx of [-55, 0, 55]) {
    for (let up = 0; up <= height; up += 10) {
      const px = x + dx;
      const py = y - up;
      const inDiamond = (yy: number) => Math.abs(px - WALL_RING.cx) / (PLATE * 2) + Math.abs(yy - WALL_RING.cy) / PLATE <= 1.02;
      if (inDiamond(py) || inDiamond(py - 26)) return true;
    }
  }
  return false;
}


/**
 * Crop fields beside the Farm (tile column, row, crop, extent, tier). Columns 8 and 10 either side of a lane in column 9; column
 * 8 starts 66 units off the wall. Two-tile fields run along +v (pv then mv).
 */
const FIELD_LIST: readonly (readonly [number, number, Crop, 'n' | 'pv' | 'mv', number])[] = [
  [8, 6, 'wheat', 'pv', 0], [8, 7, 'wheat', 'mv', 0],
  [8, 10, 'green', 'n', 0],
  [10, 5, 'wheat', 'n', 0],
  [8, 3, 'plough', 'pv', 1], [8, 4, 'plough', 'mv', 1],
  [8, 11, 'wheat', 'pv', 1], [8, 12, 'wheat', 'mv', 1],
  [10, 8, 'green', 'pv', 1], [10, 9, 'green', 'mv', 1],
  [8, 0, 'green', 'pv', 2], [8, 1, 'green', 'mv', 2],
  [10, 12, 'plough', 'n', 2],
  [10, 2, 'wheat', 'pv', 3], [10, 3, 'wheat', 'mv', 3],
];
const FIELDS = new Map(FIELD_LIST.map(([a, j, crop, ext, tier]) => [`${a},${j}`, { crop, ext, tier }]));

/** River: one continuous ribbon down the right side (rising in the hills far back) and along the front. */
const RIVER_U = uOf(RIVER_A);
const RIVER_V = vOf(RIVER_J);
const RIVER_W = 17;
const RIVER_PTS: readonly (readonly [number, number])[] = [[RIVER_U, -1100], [RIVER_U, RIVER_V], [-2200, RIVER_V]];
/** Main road: straight out of the gate along its centre line, as wide as the village's own paths; the bridge carries it over the river. */
const ROAD_W = 28;
const ROAD_FROM = PLATE - 6;
/** Side paths (narrower, no ink edge) from the main road to the places around the village. */
const LANE_U = uOf(9);
const TRACK_V = vOf(14);
const SIDE_W = 11;
const SIDE_PATHS: readonly (readonly (readonly [number, number])[])[] = [
  // the farm lane: from the quarry, down between the fields, then along the front to the road
  [[236, -338], [LANE_U, -338], [LANE_U, TRACK_V], [GATE_U, TRACK_V]],
  // hamlet and orchard
  [[LANE_U, 60], [473, 60]],
  [[473, 60], [473, 150]],
  // woodcutter's clearing on the Lumber Camp side
  [[-420, 78], [-420, 345], [GATE_U, 345]],
  // the pond beyond the river
  [[GATE_U, 455], [36, 455]],
];
/** Places: centre, radius (grid units) kept clear of trees and rocks, and the ground look under them. */
const PLACES: readonly { u: number; v: number; rx: number; ry: number; ground: string }[] = [
  { u: 470, v: 62, rx: 74, ry: 50, ground: '#CDB98A' }, // hamlet yard
  { u: -420, v: 60, rx: 52, ry: 38, ground: '#CDB98A' }, // woodcutter's clearing
  { u: 236, v: -340, rx: 56, ry: 38, ground: '#B9B29B' }, // quarry
  { u: 466, v: 190, rx: 52, ry: 40, ground: '#B9D67A' }, // orchard floor
];
const POND = { u: 62, v: 458, rx: 26, ry: 17 } as const;

/** Distance from a point to a polyline. */
function distToLine(u: number, v: number, pts: readonly (readonly [number, number])[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [u0, v0] = pts[i]!;
    const [u1, v1] = pts[i + 1]!;
    const du = u1 - u0;
    const dv = v1 - v0;
    const t = clamp01(((u - u0) * du + (v - v0) * dv) / (du * du + dv * dv || 1));
    best = Math.min(best, Math.hypot(u - (u0 + du * t), v - (v0 + dv * t)));
  }
  return best;
}
/** Is a ground point on a path, river, place or pond (so trees, rocks and props keep off)? */
function occupied(u: number, v: number, pad: number): boolean {
  if (Math.abs(u - GATE_U) < ROAD_W / 2 + pad && v > PLATE - 20) return true;
  if (distToLine(u, v, RIVER_PTS) < RIVER_W / 2 + 6 + pad) return true;
  if (SIDE_PATHS.some((p) => distToLine(u, v, p) < SIDE_W / 2 + pad)) return true;
  if (PLACES.some((p) => ((u - p.u) / (p.rx + pad)) ** 2 + ((v - p.v) / (p.ry + pad)) ** 2 < 1)) return true;
  if (((u - POND.u) / (POND.rx + 10 + pad)) ** 2 + ((v - POND.v) / (POND.ry + 10 + pad)) ** 2 < 1) return true;
  return false;
}

/** The sheep meadow in front of the left wall, between the open land and the road (grid units), and its fence. */
const PASTURE = { u0: -265, u1: -31, v0: PLATE, v1: PLATE + 78 } as const;
const inPasture = (u: number, v: number) => u > PASTURE.u0 && u < PASTURE.u1 && v > PASTURE.v0 && v < PASTURE.v1;
/** Haystacks (u, v, tier) on grass between the fields. */
const HAY: readonly (readonly [number, number, number])[] = [[322, 117, 1], [398, 22, 2], [322, 292, 3]];
const SCARECROWS: readonly (readonly [number, number, number])[] = [[320, 40, 0], [398, 117, 2]];

/** Plain ground by soft noise, so grass tones form patches. */
function grassName(u: number, v: number): string {
  const g = vnoise(u, v, 130, 5);
  return g < 0.34 ? 'grass-1' : g < 0.68 ? 'grass-2' : 'grass-3';
}

/** What one tile is: the ground sprite, the tier it appears from (lower tiers show plain grass there) and its scale. */
function terrain(a: number, j: number): { sprite: string; tier: number; tall: boolean; scale: number } {
  const u = uOf(a);
  const v = vOf(j);
  const grass = { sprite: grassName(u, v), tier: 0, tall: false, scale: K };
  const low = (sprite: string, tier = 0) => ({ sprite, tier, tall: false, scale: K });

  // The Farm: crop fields; and a meadow for the sheep.
  const fd = FIELDS.get(`${a},${j}`);
  if (fd) return low(cropName(fd.crop, fd.ext), fd.tier);
  if (inPasture(u, v)) return low('meadow');

  // Paths, the river and the places keep plain ground.
  if (occupied(u, v, 14)) return grass;

  const dpl = Math.max(Math.abs(u), Math.abs(v)) - PLATE; // grid units from the plate edge
  const xs = u - v; // across the screen: negative left (Lumber Camp), positive right (Iron Mine)
  if (dpl < 34) return grass;
  // Kinds of land come from smooth noise, so woods, hills and rocks form irregular patches with ragged edges.
  const wForest = smooth(-70, -260, xs);
  const wBack = smooth(-170, -320, v);
  const rightW = wBack * smooth(-60, 200, xs) + 0.45 * smooth(300, 480, xs) * smooth(200, 420, dpl);
  const backW = wBack * (1 - smooth(-60, 200, xs));
  const n1 = vnoise(u, v, 70, 3) + (h(a, j, 30) - 0.5) * 0.16;
  const n2 = vnoise(u, v, 90, 9) + (h(a, j, 31) - 0.5) * 0.16;
  let pick: string | null = null;
  const forestP = wForest * 0.55 * (1 - 0.7 * smooth(80, 420, v)) + backW * 0.16 + 0.04 * smooth(160, 460, dpl);
  const hillP = rightW * 0.36 + backW * 0.2;
  if (n1 < forestP) pick = `forest-${n1 < forestP * 0.3 ? 'dense' : 'light'}-${1 + Math.floor(h(a, j, 3) * 2)}`;
  else if (n2 < hillP) pick = n2 < hillP * 0.8 ? `hills-${1 + Math.floor(h(a, j, 5) * 2)}` : vnoise(u, v, 40, 11) < 0.34 ? 'rocky' : null;
  else if (dpl > 240 && wBack * smooth(60, 260, xs) > 0.4 && n2 < hillP + 0.1 && h(a, j, 32) < 0.35) pick = `mountain-${1 + Math.floor(h(a, j, 6) * 2)}`;
  else if (h(a, j, 33) < 0.05 * smooth(34, 160, dpl)) return low('meadow');
  if (pick === null) return grass;
  const big = pick.startsWith('mountain');
  const tall = pick !== 'rocky';
  const height = big ? 170 : pick.startsWith('hills') ? 55 : 90;
  if (tall && hitsPlate(u, v, height)) return grass;
  return { sprite: pick, tier: 0, tall, scale: big ? K * MOUNT : pick.startsWith('forest') ? K * FOREST : K };
}

const PROP_GRASS = ['bush', 'bush-berries', 'flowers', 'daisies', 'clover', 'tufts', 'pebbles', 'stump', 'rocks-pair'] as const;

/** Dressing for a grass tile: sparse near the walls, richer towards the edge. */
function dress(a: number, j: number, ground: string): Prop[] {
  const u = uOf(a);
  const v = vOf(j);
  const out: Prop[] = [];
  const d = (Math.max(Math.abs(u), Math.abs(v)) - PLATE) / 78;
  if (!ground.startsWith('grass')) return out;
  const p = Math.min(0.2, Math.max(0, (d - 0.9) * 0.06));
  const n = h(a, j, 11) < p ? 1 : 0;
  const n2 = h(a, j, 12) < p * 0.3 ? 1 : 0;
  for (let k = 0; k < n + n2; k++) {
    const pu = u + (h(a, j, 13 + k) - 0.5) * TILE * 0.6;
    const pv = v + (h(a, j, 15 + k) - 0.5) * TILE * 0.6;
    // Calm grass along the walls (the plate's side would cut things there).
    if ((pv > PLATE - 4 && pv < PLATE + 30 && Math.abs(pu) < PLATE + 40) || (pu > PLATE - 4 && pu < PLATE + 30 && Math.abs(pv) < PLATE + 40)) continue;
    const kind = PROP_GRASS[Math.floor(h(a, j, 17 + k) * PROP_GRASS.length)]!;
    out.push({ sprite: kind, u: pu, v: pv, scale: PROP, flip: h(a, j, 19 + k) < 0.5, tier: k === 0 ? (kind === 'bush' || kind === 'flowers' || kind === 'tufts' ? 0 : 1) : 2 });
  }
  return out;
}

/** The flock: positions in the meadow (u, v, sprite, mirrored, tier). 3 sheep at tier 0, up to 6. */
const SHEEP: readonly (readonly [number, number, string, boolean, number])[] = [
  [-200, 285, 'sheep', false, 0],
  [-150, 300, 'sheep-grazing', true, 0],
  [-105, 278, 'sheep', true, 0],
  [-70, 296, 'sheep-grazing', false, 1],
  [-230, 300, 'sheep-grazing', false, 2],
  [-125, 262, 'sheep', false, 3],
];
const PASTURE_FLOWERS: readonly (readonly [number, number, string])[] = [
  [-245, 268, 'daisies'],
  [-52, 306, 'flowers'],
];

/** A placed object: a drawing with a foot point, drawn with the raised tiles in depth order. */
interface Obj {
  u: number;
  v: number;
  sprite: string;
  scale: number;
  flip: boolean;
  tier: number;
}

interface Layout {
  tiles: Tile[];
  objs: Obj[];
  /** Sprite names that are used (defs are built for these only). */
  names: string[];
}

/** Hamlet, woodcutter, quarry, orchard, pond: purposeful places around the village (u, v, sprite, scale, tier). */
function places(): Obj[] {
  const o = (u: number, v: number, sprite: string, tier = 0, scale = 1, flip = false): Obj => ({ u, v, sprite, scale, flip, tier });
  const out: Obj[] = [
    // hamlet beside the fields
    o(440, 20, 'house-a'), o(440, 104, 'house-b', 1), o(508, 64, 'house-a', 2, 1, true), o(473, 66, 'well'),
    o(425, 62, 'vt-bush', 1, 0.9), o(500, 100, 'vt-bush', 2, 0.9), o(452, 84, 'vt-logs', 1, 0.8),
    // woodcutter's clearing
    o(-420, 40, 'hut'), o(-446, 72, 'vt-stump'), o(-398, 78, 'vt-stump', 0, 0.9), o(-444, 30, 'vt-stump', 1, 0.8),
    o(-394, 44, 'vt-logs'), o(-446, 98, 'vt-logs', 1), o(-384, 100, 'vt-logs', 2, 0.9), o(-404, 22, 'vt-stump', 2),
    // quarry in the rocks of the Iron Mine side
    o(236, -348, 'mine'), o(264, -326, 'cart', 1), o(204, -322, 'vt-rockC', 0, 1.1), o(284, -352, 'vt-rockA', 0, 1), o(198, -356, 'vt-rockA', 1, 0.9),
    o(288, -318, 'vt-rockB', 2), o(220, -300, 'vt-rockB', 3),
    // pond with ducks and reeds
    o(52, 452, 'duck', 0), o(70, 460, 'duck', 0, 1, true), o(60, 470, 'duck', 1, 0.9),
    o(40, 442, 'reeds', 0, 0.9), o(86, 450, 'reeds', 0, 0.9), o(76, 472, 'reeds', 1, 0.9), o(34, 466, 'reeds', 2, 0.9),
  ];
  // orchard: rows of fruit trees, a row more as the village grows
  for (let k = 0; k < 3; k++) for (let i = 0; i < 4; i++) out.push(o(436 + i * 24, 166 + k * 24, 'fruit-tree', k, 0.92));
  return out;
}

function buildTiles(wide: boolean): Layout {
  const box = landBox(wide);
  const tiles: Tile[] = [];
  const byKey = new Map<string, Tile>();
  const names = new Set<string>();
  for (let a = -60; a <= 60; a++) {
    for (let j = -60; j <= 60; j++) {
      const u = uOf(a);
      const v = vOf(j);
      // Tiles wholly under the plate are never seen.
      if (Math.abs(u) + TILE / 2 <= PLATE && Math.abs(v) + TILE / 2 <= PLATE) continue;
      const [x, y] = iso(u, v, TZ);
      if (x < box.x0 - TILE * 3 || x > box.x1 + TILE * 3 || y < box.y0 - TILE * 2 || y - TILE / 2 > box.y1 + 4) continue;
      let t = terrain(a, j);
      // Big mountains never stand at the box edge (half a mountain would show); plain ground there.
      if (t.scale > K * 1.5 && (x < box.x0 + 100 || x > box.x1 - 100)) t = { sprite: grassName(u, v), tier: 0, tall: false, scale: K };
      const tile: Tile = { a, j, sprite: t.sprite, tier: t.tier, scale: t.scale, props: t.tall ? [] : dress(a, j, t.sprite) };
      tiles.push(tile);
      byKey.set(`${a},${j}`, tile);
      names.add(t.sprite);
      if (t.tier > 0) names.add(grassName(u, v));
    }
  }
  // The massif is one item drawn in front of its own ground (sprite 'massif', see LandscapeTiles).
  tiles.push({ a: aOf(MASSIF_AT[0] + 30), j: jOf(MASSIF_AT[1] + 30), sprite: 'massif', tier: 0, scale: K * MASSIF_SCALE, props: [] });
  // Placed props: hay on the field, the flock and flowers in the meadow.
  const add = (u: number, v: number, sprite: string, flip: boolean, tier: number) => {
    byKey.get(`${aOf(u)},${jOf(v)}`)?.props.push({ sprite, u, v, scale: PROP, flip, tier });
  };
  for (const [u, v, tier] of HAY) add(u, v, 'haystack', false, tier);
  for (const [u, v, tier] of SCARECROWS) add(u, v, 'scarecrow', false, tier);
  for (const [u, v, sp, flip, tier] of SHEEP) add(u, v, sp, flip, tier);
  for (const [u, v, sp] of PASTURE_FLOWERS) add(u, v, sp, false, 0);
  for (const t of tiles) for (const p of t.props) names.add(p.sprite);
  const objs = places().filter((p) => {
    const [x, y] = iso(p.u, p.v, TZ);
    return x > box.x0 - 40 && x < box.x1 + 40 && y > box.y0 - 40 && y < box.y1 + 60;
  });
  for (const p of objs) names.add(p.sprite);
  names.add('massif-base');
  names.add('massif-peak');
  tiles.sort((p, q) => p.a + p.j - (q.a + q.j) || p.a - q.a);
  return { tiles, objs, names: [...names] };
}

// ---- Fence round the meadow --------------------------------------------------------------------------------------------------

const FENCE_POST = '#B07D46';
const FENCE_RAIL = '#E4B67C';
/** Posts and two rails along a closed ground outline (a fence only ever fully encloses something). */
function fence(corners: readonly (readonly [number, number])[], key: string): ReactNode {
  const pts: [number, number][] = [];
  corners.forEach(([u0, v0], i) => {
    const [u1, v1] = corners[(i + 1) % corners.length]!;
    const n = Math.max(1, Math.round(Math.hypot(u1 - u0, v1 - v0) / 14));
    for (let k = 0; k < n; k++) pts.push([u0 + ((u1 - u0) * k) / n, v0 + ((v1 - v0) * k) / n]);
  });
  const rail = (z: number) => `M${[...pts, pts[0]!].map(([u, v]) => iso(u, v, TZ + z).map((c) => Math.round(c * 10) / 10).join(' ')).join('L')}`;
  const posts = pts.map(([u, v]) => {
    const [x, y] = iso(u, v, TZ);
    return `M${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}v-8`;
  });
  return (
    <g key={key} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={posts.join('')} stroke={INK} strokeWidth={4} />
      <path d={rail(3.5)} stroke={INK} strokeWidth={3.4} />
      <path d={rail(7)} stroke={INK} strokeWidth={3.4} />
      <path d={posts.join('')} stroke={FENCE_POST} strokeWidth={2} />
      <path d={rail(3.5)} stroke={FENCE_RAIL} strokeWidth={1.4} />
      <path d={rail(7)} stroke={FENCE_RAIL} strokeWidth={1.4} />
    </g>
  );
}

// ---- Rendering ---------------------------------------------------------------------------------------------------------------

const LAYOUTS: Record<string, Layout> = {};
const layoutFor = (wide: boolean) => (LAYOUTS[wide ? 'w' : 'p'] ??= buildTiles(wide));

const r1 = (n: number) => Math.round(n * 10) / 10;
const place = (u: number, v: number, s: number, flip = false) => {
  const [x, y] = iso(u, v, TZ);
  return `translate(${r1(x)} ${r1(y)}) scale(${flip ? -s : s} ${s})`;
};

const RAISED = /^(forest|hills|mountain)/;
const symbolRef = (sprite: string) => (sprite.startsWith('vt-') ? `#${sprite}` : `#tl-${sprite}`);
/** Depth key of a ground point on the tile lattice (tile (a, j) has key a + j). */
const depthOf = (u: number, v: number) => (u + v - GATE_U + PLATE - TILE / 2 + 0) / TILE;

interface Drawn {
  key: number;
  node: ReactNode;
}

const grid = (pts: readonly (readonly [number, number])[]) => `M${pts.map(([u, v]) => `${r1(u)} ${r1(v)}`).join('L')}`;
const ellipsePath = (u: number, v: number, rx: number, ry: number) =>
  `M${r1(u - rx)} ${r1(v)}a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(2 * rx)} 0a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(-2 * rx)} 0Z`;
const GT = `matrix(1 0.5 -1 0.5 ${WALL_RING.cx} ${WALL_RING.cy - TZ})`;

/** The bridge where the road crosses the river: planks no wider than the road, a low rail each side. */
function bridge(): ReactNode {
  const hw = ROAD_W / 2 - 1;
  const l = RIVER_W / 2 + 7;
  const sc = (du: number, dv: number, z = 0) => iso(GATE_U + du, RIVER_V + dv, TZ + z);
  const rail = (side: number) => {
    const pts = [-l, 0, l].map((dv) => sc(side * hw, dv));
    const top = pts.map(([x, y]) => `${r1(x)} ${r1(y - 8)}`).join('L');
    const posts = pts.map(([x, y]) => `M${r1(x)} ${r1(y - 1)}V${r1(y - 8)}`).join('');
    return (
      <g key={side} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={`${posts}M${top}`} stroke={INK} strokeWidth={4.4} />
        <path d={posts} stroke="#B07D46" strokeWidth={2} />
        <path d={`M${top}`} stroke="#F2B33D" strokeWidth={2.2} />
      </g>
    );
  };
  const deck = [[-hw, -l], [hw, -l], [hw, l], [-hw, l]].map(([du, dv]) => sc(du!, dv!, 2));
  let planks = '';
  for (let dv = -l + 5; dv < l - 2; dv += 6) {
    const [ax, ay] = sc(-hw, dv, 2);
    const [bx, by] = sc(hw, dv, 2);
    planks += `M${r1(ax)} ${r1(ay)}L${r1(bx)} ${r1(by)}`;
  }
  return (
    <g key="bridge">
      {rail(-1)}
      <path d={`M${deck.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z`} fill="#E4B67C" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
      <path d={planks} stroke="#B07D46" strokeWidth={1.2} opacity={0.7} />
      {rail(1)}
    </g>
  );
}

export const LandscapeTiles = memo(function LandscapeTiles({ tier, wide }: { tier: number; wide: boolean }) {
  const { tiles, objs, names } = layoutFor(wide);
  const box = landBox(wide);
  const clip = `tl-clip-${wide ? 'w' : 'p'}`;
  const flat: ReactNode[] = [];
  const raised: Drawn[] = [];
  for (const t of tiles) {
    const key = t.a + t.j + t.a * 0.0001;
    if (t.sprite === 'massif') {
      const sp = TILE * MASSIF_SCALE;
      const parts: ReactNode[] = [];
      for (const [du, dv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        parts.push(<use key={`m${du}${dv}`} href="#tl-massif-base" transform={place(MASSIF_AT[0] + (du * sp) / 2, MASSIF_AT[1] + (dv * sp) / 2, t.scale)} />);
      }
      parts.push(<use key="peak" href="#tl-massif-peak" transform={place(MASSIF_AT[0] + sp / 2, MASSIF_AT[1] + sp / 2, t.scale)} />);
      raised.push({ key, node: <g key="massif">{parts}</g> });
      continue;
    }
    const grass = grassName(uOf(t.a), vOf(t.j));
    const sprite = t.tier <= tier ? t.sprite : grass;
    const node = <use key={`t${t.a},${t.j}`} href={`#tl-${sprite}`} transform={place(uOf(t.a), vOf(t.j), sprite === t.sprite ? t.scale : K)} />;
    if (RAISED.test(sprite)) raised.push({ key, node });
    else flat.push(node);
    for (let i = 0; i < t.props.length; i++) {
      const p = t.props[i]!;
      if (p.tier > tier || t.tier > tier) continue;
      raised.push({ key: key + 0.01 + i * 0.001, node: <use key={`p${t.a},${t.j},${i}`} href={symbolRef(p.sprite)} transform={place(p.u, p.v, p.scale, p.flip)} /> });
    }
    // The meadow fence encloses the pasture on all four sides; it goes up after the pasture's last tile.
    if (t.a === aOf(PASTURE.u1 - 10) && t.j === jOf(PASTURE.v1 - 10)) {
      const [u0, u1, v0, v1] = [PASTURE.u0 + 3, PASTURE.u1 - 4, PASTURE.v0 + 6, PASTURE.v1 - 5];
      raised.push({ key: key + 0.5, node: fence([[u0, v0], [u1, v0], [u1, v1], [u0, v1]], 'pen') });
    }
  }
  objs.forEach((o, i) => {
    if (o.tier <= tier) raised.push({ key: depthOf(o.u, o.v) + 0.3, node: <use key={`o${i}`} href={symbolRef(o.sprite)} transform={place(o.u, o.v, o.scale, o.flip)} /> });
  });
  raised.push({ key: depthOf(GATE_U, RIVER_V) + 0.3, node: bridge() });
  raised.sort((p, q) => p.key - q.key);

  const river = grid(RIVER_PTS);
  const roadA = grid([[GATE_U, ROAD_FROM], [GATE_U, RIVER_V - RIVER_W / 2 - 4]]);
  const roadB = grid([[GATE_U, RIVER_V + RIVER_W / 2 + 4], [GATE_U, 2400]]);
  return (
    <g className="vv-land" strokeLinejoin="round">
      <defs>
        <clipPath id={clip}>
          <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} />
        </clipPath>
        {names.filter((n) => !n.startsWith('vt-')).map((n) => (
          <g key={n} id={`tl-${n}`} dangerouslySetInnerHTML={{ __html: spriteMarkup(n) }} />
        ))}
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} fill={BASE_FILL} />
        {flat}
        {/* ground shapes drawn flat on the tiles: yards, the pond, the river, side paths and the main road (each one continuous band) */}
        <g transform={GT} fill="none" strokeLinecap="butt" strokeLinejoin="round">
          {PLACES.map((p, i) => (
            <path key={i} d={ellipsePath(p.u, p.v, p.rx * 0.8, p.ry * 0.8)} fill={p.ground} opacity={0.6} stroke="none" />
          ))}
          <g>
            <path d={ellipsePath(POND.u, POND.v, POND.rx + 3, POND.ry + 3)} fill={INK} stroke="none" />
            <path d={ellipsePath(POND.u, POND.v, POND.rx + 1.5, POND.ry + 1.5)} fill="#B08B5A" stroke="none" />
            <path d={ellipsePath(POND.u, POND.v, POND.rx, POND.ry)} fill="#2F9AA0" stroke="none" />
            <path d={ellipsePath(POND.u - 3, POND.v - 2, POND.rx * 0.55, POND.ry * 0.5)} fill="#7AD3CD" opacity={0.5} stroke="none" />
          </g>
          <path d={river} stroke={INK} strokeWidth={RIVER_W + 6} strokeLinecap="round" />
          <path d={river} stroke="#B08B5A" strokeWidth={RIVER_W + 2.6} strokeLinecap="round" />
          <path d={river} stroke="#2F9AA0" strokeWidth={RIVER_W} strokeLinecap="round" />
          <path d={river} stroke="#7AD3CD" strokeWidth={RIVER_W * 0.38} strokeLinecap="round" opacity={0.5} />
          <path d={river} stroke="#FFFFFF" strokeWidth={1.1} strokeDasharray="7 17" strokeLinecap="round" opacity={0.85} transform="translate(0 3)" />
          {SIDE_PATHS.map((p, i) => (
            <g key={i}>
              <path d={grid(p)} stroke="#C49A63" strokeWidth={SIDE_W + 2.6} />
              <path d={grid(p)} stroke="#D9B98A" strokeWidth={SIDE_W} />
            </g>
          ))}
          {[roadA, roadB].map((d, i) => (
            <g key={i}>
              <path d={d} stroke={INK} strokeWidth={ROAD_W + 3.4} />
              <path d={d} stroke="#D9B98A" strokeWidth={ROAD_W} />
              <path d={d} stroke="#E8D3A4" strokeWidth={ROAD_W * 0.5} strokeDasharray="10 12" opacity={0.8} />
            </g>
          ))}
        </g>
        {raised.map((r) => (
          <g key={(r.node as { key?: string }).key}>{r.node}</g>
        ))}
      </g>
    </g>
  );
});
