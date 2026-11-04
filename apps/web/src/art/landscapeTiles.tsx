// Village landscape "Map tiles" (the default). The land around the walls is built from the same terrain tiles as the world
// map (design/sprites/terrain, copied to ./terrain-sprites) at scale 0.875, so a tile is 39 grid units wide and the plate is twelve
// tiles across (props are drawn at about the size of the village's own trees and animals). The tile grid is shifted sideways
// so that one tile column is centred exactly on the gate (u = 8):
// the road leaves the gate straight along that column, tile by tile, crosses the river on the bridge tile and runs to the edge.
//
// The layout is meant, not random: forest on the Lumber Camp side (left and back left), hills, rocks and mountains on the Iron
// Mine side (back right), wheat along the front right next to the Farm, one meadow with a few sheep in front of the left wall,
// a river that rises in the hills and bends round the front of the village. The grass next to the walls stays calm; trees, stones
// and flowers get denser towards the edges. Same contract as `Landscape` (landscape.tsx): one <g className="vv-land"> drawn
// BEFORE the plate. Growth: `tier` 0..3 (tier 0 is complete; each tier adds fields, hay and flocks).
//
// Tall tiles (forest, hills, mountains) only stand where the plate and its walls cannot cut them: behind the back walls or
// clear of the plate on screen; in front of the walls only low things (grass, wheat, props) are drawn.
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

const RIVER_A = 10; // river column (u = 398)
const RIVER_J = 14; // river row (v = 331)
const SOURCE_J = -11;
/** The massif far behind the Iron Mine: centre of its 2x2 base (grid units); drawn at 1.5 times the tile scale (far away, big). */
const MASSIF_AT = [330, -640] as const;

// ---- Sprites -----------------------------------------------------------------------------------------------------------------

const ROAD_NAME = 'road-ne-sw';

function spriteMarkup(name: string): string {
  const src = name === ROAD_NAME ? 'river-ne-sw' : name;
  const raw = SPRITE_FILES[`./terrain-sprites/${src}.svg`];
  if (!raw) throw new Error(`Missing terrain sprite ${src}.svg`);
  let inner = raw.replace(/^<svg[^>]*>/, '').replace(/<title>.*?<\/title>/, '').replace(/<\/svg>\s*$/, '');
  if (name === ROAD_NAME) {
    // The river tile recoloured to the village's packed-earth road; the glints go.
    inner = inner
      .replace(/#2F9AA0/g, '#D9B98A')
      .replace(/#7AD3CD/g, '#EBD8AF')
      .replace(/#B08B5A/g, '#C49A63')
      .replace(/<path[^>]*stroke="#FFFFFF" stroke-width="0\.035"[^>]*><\/path>/g, '')
      // as wide as the village's own paths (about 24 grid units), not as a river
      .replace(/stroke-width="(0\.45999999999999996|0\.36|0\.144)"/g, (_m, w: string) => `stroke-width="${(Number(w) * 1.6).toFixed(3)}"`);
  }
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

const GRASS = ['grass-1', 'grass-2', 'grass-3'];

/** Wheat beside the Farm (front right), by the tier it appears at. Tested on the point's cell of a 78-unit lattice. */
function wheatTier(u: number, v: number): number | null {
  if (u < 203 || u >= 359 || v < -195 || v >= 312) return null;
  const c = Math.floor((u + 31) / 78); // 3 or 4
  const r = Math.floor((v + 234) / 78); // old rows: -1..6
  const t: Record<string, number> = {
    '3,2': 0, '3,3': 0, '3,4': 0, '3,5': 0, '3,6': 0, '4,3': 0, '4,4': 0, '4,5': 0,
    '4,2': 1, '4,6': 1, '3,1': 1,
    '3,0': 2, '4,1': 2,
    '4,0': 3, '3,-1': 3,
  };
  const k = t[`${c},${r + 0}`];
  return k === undefined ? null : k;
}
/** The sheep meadow in front of the left wall, between the open land and the road (grid units). */
const PASTURE = { u0: -265, u1: -31, v0: PLATE, v1: PLATE + 78 } as const;
const inPasture = (u: number, v: number) => u > PASTURE.u0 && u < PASTURE.u1 && v > PASTURE.v0 && v < PASTURE.v1;
/** Haystacks on the wheat field (u, v, tier). */
const HAY: readonly (readonly [number, number, number])[] = [[268, 40, 1], [346, 190, 2], [268, 192, 3]];

/** What one tile is: the ground sprite, the tier it appears from (lower tiers show plain grass there) and its scale. */
function terrain(a: number, j: number): { sprite: string; tier: number; tall: boolean; scale: number } {
  const u = uOf(a);
  const v = vOf(j);
  const grass = { sprite: GRASS[Math.floor(h(a, j, 1) * 3)]!, tier: 0, tall: false, scale: K };
  const low = (sprite: string, tier = 0) => ({ sprite, tier, tall: false, scale: K });

  // Road, river and bridge.
  if (a === RIVER_A && j === SOURCE_J) return low('river-source-sw');
  if (a === RIVER_A && j > SOURCE_J && j < RIVER_J) return low('river-ne-sw');
  if (a === RIVER_A && j === RIVER_J) return low('river-ne-nw');
  if (j === RIVER_J && a < RIVER_A) return low(a === 0 ? 'river-bridge-se-nw' : 'river-se-nw');
  if (a === 0 && j >= 12) return low(ROAD_NAME);

  // Wheat beside the Farm, a meadow for the sheep.
  const w = wheatTier(u, v);
  if (w !== null) return low(`wheat-${1 + ((a + j) & 1)}`, w);
  if (inPasture(u, v)) return low('meadow');

  // Ground near the massif is left to it.
  if (Math.abs(u - MASSIF_AT[0]) < 90 && Math.abs(v - MASSIF_AT[1]) < 90) return grass;

  const d = (Math.max(Math.abs(u), Math.abs(v)) - PLATE) / 78; // 78-unit steps from the plate edge (negative: under it)
  const behind = v <= -PLATE - 20 || u <= -PLATE - 20;
  // The kind of land is decided per 2x2 block so patches read as woods and hills, not as noise; single tiles drop out.
  const roll = h(Math.floor(a / 2), Math.floor(j / 2), 2);
  const hole = h(a, j, 30) < 0.18;
  const far = Math.min(1, Math.max(0, (d - 1.2) / 4));
  let pick: string | null = null;
  const dense = () => `forest-dense-${1 + Math.floor(h(a, j, 3) * 2)}`;
  const light = () => `forest-light-${1 + Math.floor(h(a, j, 4) * 2)}`;
  const hills = () => `hills-${1 + Math.floor(h(a, j, 5) * 2)}`;
  const mount = () => `mountain-${1 + Math.floor(h(a, j, 6) * 2)}`;
  const xs = u - v; // across the screen: negative left (Lumber Camp), positive right (Iron Mine)
  if (d >= 0.3 || behind) {
    if (u <= -PLATE - 20 && v > -PLATE - 20) {
      // Left: the Lumber Camp's forest. Thin at the village, dense towards the edge.
      const p = 0.3 + 0.35 * far;
      if (roll < p) pick = roll < p * (0.2 + 0.6 * far) ? dense() : light();
      else if (roll < p + 0.06) pick = 'meadow';
    } else if (v <= -PLATE - 20 && xs <= -150) {
      // Back left: forest with a few hills.
      const p = 0.25 + 0.35 * far;
      if (roll < p) pick = roll < p * (0.2 + 0.5 * far) ? dense() : light();
      else if (roll < p + 0.14) pick = hills();
    } else if (v <= -PLATE - 20 && xs < 190) {
      // Straight back (the Gold Mine's rocks): low hills, rocks and a little wood.
      const p = 0.45 + 0.3 * far;
      if (roll < p * 0.45) pick = hills();
      else if (roll < p * 0.8) pick = 'rocky';
      else if (roll < p) pick = light();
    } else if (v <= -PLATE - 20) {
      // Back right: hills and rocks around the Iron Mine; mountains only well behind.
      const p = 0.55 + 0.35 * far;
      if (roll < p * 0.42) pick = hills();
      else if (roll < p * 0.75) pick = 'rocky';
      else if (roll < p + 0.04) pick = d > 3.2 && roll < p * 0.75 + 0.06 ? mount() : light();
    } else if (xs >= 330 && d > 2.4) {
      // The far right edge continues the hills.
      const p = 0.05 + 0.3 * far;
      if (roll < p * 0.55) pick = hills();
      else if (roll < p * 0.8) pick = 'rocky';
      else if (roll < p) pick = light();
    } else if (d > 2.6) {
      // Far front: a gentle forest edge.
      const p = 0.04 + 0.34 * far * far;
      if (roll < p) pick = roll < p * 0.3 ? dense() : light();
    }
  }
  if (pick === null || (hole && pick !== 'meadow')) return grass;
  const big = pick.startsWith('mountain');
  const tall = !pick.startsWith('meadow') && pick !== 'rocky';
  const height = big ? 170 : pick.startsWith('hills') ? 55 : 90;
  if (tall && hitsPlate(u, v, height)) return grass;
  return { sprite: pick, tier: 0, tall, scale: big ? K * MOUNT : pick.startsWith('forest') ? K * FOREST : K };
}

const PROP_GRASS = ['bush', 'bush-berries', 'flowers', 'daisies', 'clover', 'tufts', 'pebbles', 'stump', 'rocks-pair', 'log'] as const;

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
      if (t.tier > 0) names.add(GRASS[Math.floor(h(a, j, 1) * 3)]!);
    }
  }
  // The massif is one item drawn in front of its own ground (sprite 'massif', see LandscapeTiles).
  tiles.push({ a: aOf(MASSIF_AT[0] + 30), j: jOf(MASSIF_AT[1] + 30), sprite: 'massif', tier: 0, scale: K * MASSIF_SCALE, props: [] });
  // Placed props: hay on the field, the flock and flowers in the meadow.
  const add = (u: number, v: number, sprite: string, flip: boolean, tier: number) => {
    byKey.get(`${aOf(u)},${jOf(v)}`)?.props.push({ sprite, u, v, scale: PROP, flip, tier });
  };
  for (const [u, v, tier] of HAY) add(u, v, 'haystack', false, tier);
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
/** Posts and two rails along a ground line from (u0, v0) to (u1, v1). */
function fence(u0: number, v0: number, u1: number, v1: number, key: string): ReactNode {
  const len = Math.hypot(u1 - u0, v1 - v0);
  const n = Math.max(1, Math.round(len / 14));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) pts.push([u0 + ((u1 - u0) * i) / n, v0 + ((v1 - v0) * i) / n]);
  const rail = (z: number) => `M${pts.map(([u, v]) => iso(u, v, TZ + z).map((c) => Math.round(c * 10) / 10).join(' ')).join('L')}`;
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
    const grass = GRASS[Math.floor(h(t.a, t.j, 1) * 3)]!;
    const sprite = t.tier <= tier ? t.sprite : grass;
    nodes.push(<use key={`t${t.a},${t.j}`} href={`#tl-${sprite}`} transform={place(uOf(t.a), vOf(t.j), sprite === t.sprite ? t.scale : K)} />);
    for (let i = 0; i < t.props.length; i++) {
      const p = t.props[i]!;
      if (p.tier > tier || t.tier > tier) continue;
      nodes.push(<use key={`p${t.a},${t.j},${i}`} href={`#tl-${p.sprite}`} transform={place(p.u, p.v, p.scale, p.flip)} />);
    }
    // The meadow fence (west and east side) goes up after the tile at its front end.
    if (t.a === aOf(PASTURE.u0 + 2) && t.j === jOf(PASTURE.v1 - 6)) nodes.push(fence(PASTURE.u0 + 2, PLATE + 12, PASTURE.u0 + 2, PASTURE.v1 - 6, 'fw'));
    if (t.a === aOf(PASTURE.u1 - 4) && t.j === jOf(PASTURE.v1 - 6)) nodes.push(fence(PASTURE.u1 - 4, PLATE + 12, PASTURE.u1 - 4, PASTURE.v1 - 6, 'fe'));
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
