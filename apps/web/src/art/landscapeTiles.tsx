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

const RIVER_A = 12; // river column (u = 476)
const RIVER_J = 16; // river row (v = 409.5)
const SOURCE_J = -11;
/** The massif far behind the Iron Mine: centre of its 2x2 base (grid units); drawn at 1.5 times the tile scale (far away, big). */
const MASSIF_AT = [330, -640] as const;

// ---- Sprites -----------------------------------------------------------------------------------------------------------------

const ROAD_NAME = 'road-ne-sw';
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
const TILE_ART = /^(grass|meadow|forest|hills|mountain|massif-base|rocky|river|road|lane)/;

function spriteMarkup(name: string): string {
  if (name === 'scarecrow') return SCARECROW;
  const crop = /^crop-(wheat|green|plough)-(n|pv|mv|b)$/.exec(name);
  if (crop) return cropMarkup(crop[1] as Crop, crop[2]!);
  const road = /^(road|lane)-(.+)$/.exec(name);
  const src = road ? `river-${road[2]}` : name;
  const raw = SPRITE_FILES[`./terrain-sprites/${src}.svg`];
  if (!raw) throw new Error(`Missing terrain sprite ${src}.svg`);
  let inner = raw.replace(/^<svg[^>]*>/, '').replace(/<title>.*?<\/title>/, '').replace(/<\/svg>\s*$/, '');
  if (road) {
    // The river tile recoloured to packed earth; the glints go. The road is as wide as the village's own paths, the lane narrower.
    const widen = road[1] === 'road' ? 1.6 : 1.15;
    inner = inner
      .replace(/#2F9AA0/g, '#D9B98A')
      .replace(/#7AD3CD/g, '#EBD8AF')
      .replace(/#B08B5A/g, '#C49A63')
      .replace(/<path[^>]*stroke="#FFFFFF" stroke-width="0\.035"[^>]*><\/path>/g, '')
      .replace(/stroke-width="(0\.45999999999999996|0\.36|0\.144)"/g, (_m, w: string) => `stroke-width="${(Number(w) * widen).toFixed(3)}"`);
  }
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
const LANE_A = 9;
const TRACK_J = 14;
/** The sheep meadow in front of the left wall, between the open land and the road (grid units), and its fence. */
const PASTURE = { u0: -265, u1: -31, v0: PLATE, v1: PLATE + 78 } as const;
const inPasture = (u: number, v: number) => u > PASTURE.u0 && u < PASTURE.u1 && v > PASTURE.v0 && v < PASTURE.v1;
/** Haystacks (u, v, tier) on grass between the fields. */
const HAY: readonly (readonly [number, number, number])[] = [[322, 117, 1], [398, 58, 2], [322, 292, 3]];
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

  // Road, river and bridge.
  if (a === RIVER_A && j === SOURCE_J) return low('river-source-sw');
  if (a === RIVER_A && j > SOURCE_J && j < RIVER_J) return low('river-ne-sw');
  if (a === RIVER_A && j === RIVER_J) return low('river-ne-nw');
  if (j === RIVER_J && a < RIVER_A) return low(a === 0 ? 'river-bridge-se-nw' : 'river-se-nw');
  if (a === 0 && j >= 12) return low(ROAD_NAME);

  // The Farm: lane and track (earth tiles), crop fields, and a meadow for the sheep.
  if (a === LANE_A && j >= 2 && j < TRACK_J) return low('lane-ne-sw');
  if (a === LANE_A && j === TRACK_J) return low('lane-ne-nw');
  if (j === TRACK_J && a >= 1 && a < LANE_A) return low('lane-se-nw');
  const fd = FIELDS.get(`${a},${j}`);
  if (fd) return low(cropName(fd.crop, fd.ext), fd.tier);
  if (inPasture(u, v)) return low('meadow');

  // Ground near the massif is left to it.
  if (Math.abs(u - MASSIF_AT[0]) < 90 && Math.abs(v - MASSIF_AT[1]) < 90) return grass;

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
  const hillP = rightW * 0.42 + backW * 0.24;
  if (n1 < forestP) pick = `forest-${n1 < forestP * 0.3 ? 'dense' : 'light'}-${1 + Math.floor(h(a, j, 3) * 2)}`;
  else if (n2 < hillP) pick = n2 < hillP * 0.55 ? `hills-${1 + Math.floor(h(a, j, 5) * 2)}` : 'rocky';
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

interface Layout {
  tiles: Tile[];
  /** Sprite names that are used (defs are built for these only). */
  names: string[];
}

function buildTiles(wide: boolean): Layout {
  const box = landBox(wide);
  const tiles: Tile[] = [];
  const byKey = new Map<string, Tile>();
  const names = new Set<string>();
  for (let a = -52; a <= 52; a++) {
    for (let j = -52; j <= 52; j++) {
      const u = uOf(a);
      const v = vOf(j);
      // Tiles wholly under the plate are never seen.
      if (Math.abs(u) + TILE / 2 <= PLATE && Math.abs(v) + TILE / 2 <= PLATE) continue;
      const [x, y] = iso(u, v, TZ);
      if (x < box.x0 - TILE * 2 || x > box.x1 + TILE * 2 || y < box.y0 - TILE || y - TILE / 2 > box.y1 + 4) continue;
      // The massif stands over its own patch of ground.
      if (Math.abs(u - MASSIF_AT[0]) < 90 && Math.abs(v - MASSIF_AT[1]) < 90) continue;
      const t = terrain(a, j);
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
  names.add('massif-base');
  names.add('massif-peak');
  tiles.sort((p, q) => p.a + p.j - (q.a + q.j) || p.a - q.a);
  return { tiles, names: [...names] };
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

export const LandscapeTiles = memo(function LandscapeTiles({ tier, wide }: { tier: number; wide: boolean }) {
  const { tiles, names } = layoutFor(wide);
  const box = landBox(wide);
  const nodes: ReactNode[] = [];
  for (const t of tiles) {
    if (t.sprite === 'massif') {
      const sp = TILE * MASSIF_SCALE;
      for (const [du, dv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        nodes.push(<use key={`m${du}${dv}`} href="#tl-massif-base" transform={place(MASSIF_AT[0] + (du * sp) / 2, MASSIF_AT[1] + (dv * sp) / 2, t.scale)} />);
      }
      nodes.push(<use key="peak" href="#tl-massif-peak" transform={place(MASSIF_AT[0] + sp / 2, MASSIF_AT[1] + sp / 2, t.scale)} />);
      continue;
    }
    const grass = grassName(uOf(t.a), vOf(t.j));
    const sprite = t.tier <= tier ? t.sprite : grass;
    nodes.push(<use key={`t${t.a},${t.j}`} href={`#tl-${sprite}`} transform={place(uOf(t.a), vOf(t.j), sprite === t.sprite ? t.scale : K)} />);
    for (let i = 0; i < t.props.length; i++) {
      const p = t.props[i]!;
      if (p.tier > tier || t.tier > tier) continue;
      nodes.push(<use key={`p${t.a},${t.j},${i}`} href={`#tl-${p.sprite}`} transform={place(p.u, p.v, p.scale, p.flip)} />);
    }
    // The meadow fence encloses the pasture on all four sides; it goes up after the pasture's last tile.
    if (t.a === aOf(PASTURE.u1 - 10) && t.j === jOf(PASTURE.v1 - 10)) {
      const [u0, u1, v0, v1] = [PASTURE.u0 + 3, PASTURE.u1 - 4, PASTURE.v0 + 6, PASTURE.v1 - 5];
      nodes.push(fence([[u0, v0], [u1, v0], [u1, v1], [u0, v1]], 'pen'));
    }
  }
  return (
    <g className="vv-land" strokeLinejoin="round">
      <defs>
        {names.map((n) => (
          <g key={n} id={`tl-${n}`} dangerouslySetInnerHTML={{ __html: spriteMarkup(n) }} />
        ))}
      </defs>
      <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} fill={BASE_FILL} />
      {nodes}
    </g>
  );
});
