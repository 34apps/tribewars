// Village landscape "Map tiles" (the default). The land around the walls is built from the same terrain tiles as the world
// map (design/sprites/terrain, copied to ./terrain-sprites) at scale 1.75, so a tile is 78 grid units wide and the plate is six
// tiles across. The tile grid is shifted sideways by 31 units so that one tile column is centred exactly on the gate (u = 8):
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
const TILE = 78;
/** Tile art scale: the map tile diamond is 44.6 wide per side; 78 / 44.6 makes one tile 78 grid units. */
const K = TILE / 44.6;
const PLATE = WALL_RING.plate;
const GATE_U = WALL_RING.gateU;
/** Ground height of the tile tops: the foot of the plate's earth sides, so the plate stands proud of the land. */
const TZ = -24;
const BASE_FILL = '#3A5E27';

/** Tile column a is centred on u = GATE_U + 78 a (a = 0 holds the road); row j on v = -195 + 78 j (rows 0..5 lie under the plate). */
const uOf = (a: number) => GATE_U + TILE * a;
const vOf = (j: number) => -PLATE + TILE / 2 + TILE * j;

const RIVER_A = 5;
const RIVER_J = 7;
const SOURCE_J = -5;
const MASSIF: readonly (readonly [number, number])[] = [[2, -4], [3, -4], [2, -3], [3, -3]];
const MASSIF_FRONT = [3, -3] as const;

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
      .replace(/<path[^>]*stroke="#FFFFFF" stroke-width="0\.035"[^>]*><\/path>/g, '');
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
const WHEAT_TIER: Record<string, number> = {
  // tier 0: the field next to the Farm
  '3,2': 0, '3,3': 0, '3,4': 0, '3,5': 0, '3,6': 0, '4,3': 0, '4,4': 0, '4,5': 0,
  '4,2': 1, '4,6': 1, '3,1': 1, '2,6': 1,
  '3,0': 2, '4,1': 2, '1,6': 2,
  '4,0': 3, '3,-1': 3,
};
/** The sheep meadow: three tiles in front of the left wall, between the road and the open land (a, j). */
const PASTURE = [[-3, 6], [-2, 6], [-1, 6]] as const;
/** Haystacks stand on these field tiles from the tier given. */
const HAY: Record<string, number> = { '3,3': 1, '4,5': 2, '3,5': 3 };

/** What one tile is: the ground sprite and the tier it appears from (lower tiers show plain grass there). */
function terrain(a: number, j: number): { sprite: string; tier: number; tall: boolean } {
  const u = uOf(a);
  const v = vOf(j);
  const grass = { sprite: GRASS[Math.floor(h(a, j, 1) * 3)]!, tier: 0, tall: false };

  // Road, river and bridge.
  if (a === RIVER_A && j === SOURCE_J) return { sprite: 'river-source-sw', tier: 0, tall: false };
  if (a === RIVER_A && j > SOURCE_J && j < RIVER_J) return { sprite: 'river-ne-sw', tier: 0, tall: false };
  if (a === RIVER_A && j === RIVER_J) return { sprite: 'river-ne-nw', tier: 0, tall: false };
  if (j === RIVER_J && a < RIVER_A) return { sprite: a === 0 ? 'river-bridge-se-nw' : 'river-se-nw', tier: 0, tall: false };
  if (a === 0 && j >= 6) return { sprite: ROAD_NAME, tier: 0, tall: false };

  // Wheat beside the Farm (front right), a meadow for the sheep (front left).
  const w = WHEAT_TIER[`${a},${j}`];
  if (w !== undefined) return { sprite: `wheat-${1 + ((a + j) & 1)}`, tier: w, tall: false };
  if (PASTURE.some(([pa, pj]) => pa === a && pj === j)) return { sprite: 'meadow', tier: 0, tall: false };

  // The massif behind the Iron Mine.
  if (MASSIF.some(([ma, mj]) => ma === a && mj === j)) return { sprite: 'massif-base', tier: 0, tall: true };

  const d = (Math.max(Math.abs(u), Math.abs(v)) - PLATE) / TILE; // tiles from the plate edge (negative: under it)
  const behind = v <= -PLATE - 39 || u <= -PLATE - 39;
  const roll = h(a, j, 2);
  const far = Math.min(1, Math.max(0, (d - 1.2) / 4));
  let pick: string | null = null;
  const dense = () => `forest-dense-${1 + Math.floor(h(a, j, 3) * 2)}`;
  const light = () => `forest-light-${1 + Math.floor(h(a, j, 4) * 2)}`;
  const hills = () => `hills-${1 + Math.floor(h(a, j, 5) * 2)}`;
  const mount = () => `mountain-${1 + Math.floor(h(a, j, 6) * 2)}`;

  const xs = u - v; // across the screen: negative left (Lumber Camp), positive right (Iron Mine)
  if (d >= 0.4 || behind) {
    if (u <= -PLATE - 39 && v > -PLATE - 39) {
      // Left: the Lumber Camp's forest. Thin at the village, dense towards the edge.
      const p = 0.3 + 0.35 * far;
      if (roll < p) pick = roll < p * (0.2 + 0.6 * far) ? dense() : light();
      else if (roll < p + 0.06) pick = 'meadow';
    } else if (v <= -PLATE - 39 && xs <= -150) {
      // Back left: forest with a few hills.
      const p = 0.25 + 0.35 * far;
      if (roll < p) pick = roll < p * (0.2 + 0.5 * far) ? dense() : light();
      else if (roll < p + 0.14) pick = hills();
    } else if (v <= -PLATE - 39 && xs < 190) {
      // Straight back (the Gold Mine's rocks): low hills, rocks and a little wood.
      const p = 0.45 + 0.3 * far;
      if (roll < p * 0.45) pick = hills();
      else if (roll < p * 0.8) pick = 'rocky';
      else if (roll < p) pick = light();
    } else if (v <= -PLATE - 39) {
      // Back right: hills, rocks and mountains around the Iron Mine and the massif.
      const p = 0.55 + 0.35 * far;
      if (roll < p * 0.42) pick = hills();
      else if (roll < p * 0.7) pick = 'rocky';
      else if (roll < p * 0.7 + 0.07 * far + 0.05) pick = mount();
      else if (roll < p + 0.04) pick = light();
    } else if (xs >= 330 && d > 2.4) {
      // The far right edge continues the hills.
      const p = 0.05 + 0.3 * far;
      if (roll < p * 0.55) pick = hills();
      else if (roll < p * 0.8) pick = 'rocky';
      else if (roll < p) pick = mount();
    } else if (d > 2.6) {
      // Far front: a gentle forest edge.
      const p = 0.04 + 0.34 * far * far;
      if (roll < p) pick = roll < p * 0.3 ? dense() : light();
    }
  }
  if (pick === null) return grass;
  const tall = !pick.startsWith('meadow') && pick !== 'rocky';
  if (tall && hitsPlate(u, v, pick.startsWith('mountain') ? 170 : pick.startsWith('hills') ? 105 : 130)) return grass;
  return { sprite: pick, tier: 0, tall };
}

const PROP_GRASS = ['bush', 'bush-berries', 'flowers', 'daisies', 'clover', 'tufts', 'pebbles', 'stump', 'rocks-pair', 'log'] as const;
const PROP_FIELD = ['haystack'] as const;

/** Dressing for a grass tile: sparse near the walls, richer towards the edge. */
function dress(a: number, j: number, ground: string): Prop[] {
  const u = uOf(a);
  const v = vOf(j);
  const out: Prop[] = [];
  const d = (Math.max(Math.abs(u), Math.abs(v)) - PLATE) / TILE;
  const baseGrass = ground.startsWith('grass');
  if (!baseGrass) return out;
  const p = Math.min(0.55, Math.max(0, (d - 0.9) * 0.16));
  const n = h(a, j, 11) < p ? 1 : 0;
  const n2 = h(a, j, 12) < p * 0.35 ? 1 : 0;
  for (let k = 0; k < n + n2; k++) {
    const du = (0.24 + 0.52 * h(a, j, 13 + k)) * TILE - TILE / 2;
    const dv = (0.24 + 0.52 * h(a, j, 15 + k)) * TILE - TILE / 2;
    const pu = u + du;
    const pv = v + dv;
    // Calm grass along the walls (the plate's side would cut things there).
    if ((pv > PLATE - 4 && pv < PLATE + 36 && Math.abs(pu) < PLATE + 40) || (pu > PLATE - 4 && pu < PLATE + 36 && Math.abs(pv) < PLATE + 40)) continue;
    const kind = PROP_GRASS[Math.floor(h(a, j, 17 + k) * PROP_GRASS.length)]!;
    out.push({ sprite: kind, u: pu, v: pv, scale: 1.8, flip: h(a, j, 19 + k) < 0.5, tier: k === 0 ? (kind === 'bush' || kind === 'flowers' || kind === 'tufts' ? 0 : 1) : 2 });
  }
  return out;
}

/** The sheep: one flock in the meadow (a, j, position in the tile 0..1, sprite, mirrored, tier). */
const SHEEP: readonly (readonly [number, number, number, number, string, boolean, number])[] = [
  [-3, 6, 0.4, 0.6, 'sheep', false, 0],
  [-2, 6, 0.62, 0.55, 'sheep-grazing', true, 0],
  [-2, 6, 0.3, 0.82, 'sheep', true, 0],
  [-1, 6, 0.5, 0.7, 'sheep-grazing', false, 1],
  [-3, 6, 0.74, 0.84, 'sheep-grazing', false, 2],
  [-1, 6, 0.22, 0.58, 'sheep', false, 3],
];
const PASTURE_FLOWERS: readonly (readonly [number, number, number, number, string])[] = [
  [-3, 6, 0.16, 0.34, 'daisies'],
  [-1, 6, 0.8, 0.84, 'flowers'],
];

interface Layout {
  tiles: Tile[];
  /** Sprite names that are used (defs are built for these only). */
  names: string[];
}

function buildTiles(wide: boolean): Layout {
  const box = landBox(wide);
  const tiles: Tile[] = [];
  const names = new Set<string>();
  for (let a = -26; a <= 26; a++) {
    for (let j = -26; j <= 26; j++) {
      const u = uOf(a);
      const v = vOf(j);
      // Tiles wholly under the plate are never seen.
      if (Math.abs(u) + TILE / 2 <= PLATE && Math.abs(v) + TILE / 2 <= PLATE) continue;
      const [x, y] = iso(u, v, TZ);
      if (x < box.x0 - TILE * 2 || x > box.x1 + TILE * 2 || y < box.y0 - TILE || y - TILE / 2 > box.y1 + 4) continue;
      const t = terrain(a, j);
      const props = t.tall ? [] : dress(a, j, t.sprite);
      // Props of the field tiles and the meadow.
      if (t.sprite.startsWith('wheat') && HAY[`${a},${j}`] !== undefined) {
        props.push({ sprite: PROP_FIELD[0], u: u + 24, v: v - 4, scale: 1.8, flip: false, tier: HAY[`${a},${j}`]! });
      }
      for (const [sa, sj, fu, fv, sp, flip, tier] of SHEEP) {
        if (sa === a && sj === j) props.push({ sprite: sp, u: u + (fu - 0.5) * TILE, v: v + (fv - 0.5) * TILE, scale: 1.9, flip, tier });
      }
      for (const [sa, sj, fu, fv, sp] of PASTURE_FLOWERS) {
        if (sa === a && sj === j) props.push({ sprite: sp, u: u + (fu - 0.5) * TILE, v: v + (fv - 0.5) * TILE, scale: 1.8, flip: false, tier: 0 });
      }
      tiles.push({ a, j, sprite: t.sprite, tier: t.tier, props });
      names.add(t.sprite);
      if (t.tier > 0) names.add(GRASS[Math.floor(h(a, j, 1) * 3)]!);
      for (const p of props) names.add(p.sprite);
    }
  }
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
  const n = Math.max(1, Math.round(len / 24));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) pts.push([u0 + ((u1 - u0) * i) / n, v0 + ((v1 - v0) * i) / n]);
  const rail = (z: number) => `M${pts.map(([u, v]) => iso(u, v, TZ + z).map((c) => Math.round(c * 10) / 10).join(' ')).join('L')}`;
  const posts = pts.map(([u, v]) => {
    const [x, y] = iso(u, v, TZ);
    return `M${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}v-15`;
  });
  return (
    <g key={key} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={posts.join('')} stroke={INK} strokeWidth={6} />
      <path d={rail(6)} stroke={INK} strokeWidth={5} />
      <path d={rail(12)} stroke={INK} strokeWidth={5} />
      <path d={posts.join('')} stroke={FENCE_POST} strokeWidth={3} />
      <path d={rail(6)} stroke={FENCE_RAIL} strokeWidth={2.2} />
      <path d={rail(12)} stroke={FENCE_RAIL} strokeWidth={2.2} />
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
    const grass = GRASS[Math.floor(h(t.a, t.j, 1) * 3)]!;
    const sprite = t.tier <= tier ? t.sprite : grass;
    nodes.push(<use key={`t${t.a},${t.j}`} href={`#tl-${sprite}`} transform={place(uOf(t.a), vOf(t.j), K)} />);
    for (let i = 0; i < t.props.length; i++) {
      const p = t.props[i]!;
      if (p.tier > tier || t.tier > tier) continue;
      nodes.push(<use key={`p${t.a},${t.j},${i}`} href={`#tl-${p.sprite}`} transform={place(p.u, p.v, p.scale, p.flip)} />);
    }
    if (t.a === MASSIF_FRONT[0] && t.j === MASSIF_FRONT[1]) {
      nodes.push(<use key="peak" href="#tl-massif-peak" transform={place(uOf(t.a), vOf(t.j), K)} />);
    }
    // The meadow fence goes up right after the meadow's own tiles.
    if (t.a === -3 && t.j === 6) nodes.push(fence(uOf(-3) - TILE / 2 + 2, PLATE + 16, uOf(-3) - TILE / 2 + 2, vOf(6) + TILE / 2 - 8, 'fw'));
    if (t.a === -1 && t.j === 6) nodes.push(fence(uOf(-1) + TILE / 2 - 4, PLATE + 16, uOf(-1) + TILE / 2 - 4, vOf(6) + TILE / 2 - 8, 'fe'));
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
