// Map art: the approved Toy Diorama SVGs (src/art/map), loaded once as Images and rasterised into
// cached canvases per zoom level so a frame is only cheap bitmap blits.
//
// Frames (SVG px, a map tile is 96 px wide in every frame):
// - terrain tiles 96 x 120, anchor (48, 80) = tile centre at ground height;
// - villages and ruins 128 x 156, anchor (64, 116) = tile centre (design/sprites/map/anchors.json);
// - banners 48 x 56, anchor (14, 50) = foot of the pole.

const FILES = import.meta.glob('../art/map/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const BADGES = import.meta.glob('../art/map/badge/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

function url(name: string): string {
  const u = FILES[`../art/map/${name}.svg`];
  if (!u) throw new Error(`missing map art ${name}`);
  return u;
}

interface Frame {
  w: number;
  h: number;
  ax: number;
  ay: number;
}

const TILE_FRAME: Frame = { w: 96, h: 120, ax: 48, ay: 80 };
const VILLAGE_FRAME: Frame = { w: 128, h: 156, ax: 64, ay: 116 };
const BANNER_FRAME: Frame = { w: 48, h: 56, ax: 14, ay: 50 };

export const STAGE_FILES = [
  'stage-1-hamlet',
  'stage-2-palisade-village',
  'stage-3-stockade-town',
  'stage-4-stone-walled-town',
  'stage-5-fortified-town',
  'stage-6-castle-with-moat',
] as const;
export const RUIN_FILES = [
  'abandoned-stage-1-hamlet',
  'abandoned-stage-2-palisade-village',
  'abandoned-stage-3-stockade-town',
  'abandoned-stage-4-stone-walled-town',
  'abandoned-stage-5-fortified-town',
  'abandoned-stage-6-castle',
] as const;
export const RUIN_NAMES = [
  'Abandoned hamlet',
  'Abandoned palisade village',
  'Abandoned stockade town',
  'Abandoned stone-walled town',
  'Abandoned fortified town',
  'Abandoned castle',
] as const;

/** Banner pole foot per stage in tile-centre units (anchors.json bannerPoleBase minus the anchor). */
export const BANNER_BASE: ReadonlyArray<readonly [number, number]> = [
  [25, -6],
  [18.2, -26.4],
  [0, -57.8],
  [15.4, -54.4],
  [3.4, -66.5],
  [0, -63.4],
];

/** Top of each stage's art (banner included) above the tile centre, SVG px: where the selection pointer sits. */
export const STAGE_TOP = [-52, -60, -86, -86, -100, -98] as const;
export const RUIN_TOP = [-38, -47, -74, -61, -76, -100] as const;

export type Allegiance = 'own' | 'tribe' | 'ally' | 'nap' | 'enemy' | 'neutral';
export const ALLEGIANCES: readonly Allegiance[] = ['own', 'tribe', 'ally', 'nap', 'enemy', 'neutral'];

/** Terrain art per terrain code (terrain.ts order: grass, forest, hills, mountain, lake) and variant. */
export const TILE_VARIANTS: ReadonlyArray<readonly string[]> = [
  ['tile-grass-0', 'tile-grass-1', 'tile-grass-2', 'tile-grass-3'],
  ['tile-forest-0', 'tile-forest-1'],
  ['tile-hills-0'],
  ['tile-mountain-0', 'tile-mountain-1'],
  ['tile-lake-0', 'tile-lake-1'],
];
/** Terrain under a village: trees and hill tops cleared away. */
export const CLEARED_TILE: readonly string[] = ['tile-grass-0', 'tile-forest-clear', 'tile-hills-clear', 'tile-grass-0', 'tile-grass-0'];
/** Height of the tile's top face above (negative = below) the standard ground, SVG px. */
export const TILE_LIFT = [0, 0, 12, 14, -8] as const;

interface Art {
  img: HTMLImageElement;
  frame: Frame;
  ready: boolean;
  failed: boolean;
}

const arts = new Map<string, Art>();
const listeners = new Set<() => void>();

function register(name: string, frame: Frame): void {
  if (arts.has(name)) return;
  const img = new Image();
  img.decoding = 'async';
  const art: Art = { img, frame, ready: false, failed: false };
  arts.set(name, art);
  img.onload = () => {
    art.ready = true;
    for (const l of listeners) l();
  };
  img.onerror = () => {
    art.failed = true;
  };
  img.src = url(name);
}

let started = false;
/** Start loading every map sprite (once); `onChange` fires whenever another sprite becomes ready. */
export function loadMapArt(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!started) {
    started = true;
    for (const list of TILE_VARIANTS) for (const n of list) register(n, TILE_FRAME);
    for (const n of CLEARED_TILE) register(n, TILE_FRAME);
    for (const n of STAGE_FILES) register(n, VILLAGE_FRAME);
    for (const n of RUIN_FILES) register(n, VILLAGE_FRAME);
    for (const a of ALLEGIANCES) register(`banner-${a}`, BANNER_FRAME);
  }
  return () => listeners.delete(onChange);
}

/** Every terrain tile is loaded (or failed), so tiles can be drawn from bitmaps. */
export function allTilesReady(): boolean {
  return TILE_VARIANTS.every((l) => l.every((n) => arts.get(n)?.ready || arts.get(n)?.failed));
}

/** Public URL of a map sprite, for <img> in the legend and panel. */
export function artUrl(name: string): string {
  return url(name);
}

const BADGE_FILE: Record<string, string> = {
  'old-orm': 'orm-the-elder',
  ysra: 'ysra-the-firebrand',
  brannoc: 'brannoc-one-eye',
  hild: 'hild-ironveil',
  'barley-tam': 'barley-tam',
  maelis: 'seer-maelis',
  corwen: 'corwen-the-heir',
  khorza: 'khorza-longmane',
  saffi: 'saffi-goldhand',
  wren: 'wren-the-huntress',
};

/** Small round chieftain badge for a chieftain id; null when unknown or missing. */
export function badgeUrl(chieftain: string | null | undefined): string | null {
  if (!chieftain) return null;
  const file = BADGE_FILE[chieftain] ?? chieftain;
  return BADGES[`../art/map/badge/${file}.svg`] ?? null;
}

// ---- Raster cache -------------------------------------------------------------------------------------

/** Device-pixel tile widths we rasterise at (~19% apart); drawing scales down to the exact zoom. */
export function levelFor(deviceTile: number): number {
  const k = Math.ceil(4 * Math.log2(Math.max(8, deviceTile) / 16) - 1e-9);
  return Math.round(16 * 2 ** (k / 4));
}

interface Level {
  bitmaps: Map<string, HTMLCanvasElement>;
  used: number;
}

const levels = new Map<number, Level>();
const MAX_LEVELS = 3;
let clock = 0;

function rasterise(art: Art, level: number): HTMLCanvasElement {
  const s = level / 96;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(art.frame.w * s));
  c.height = Math.max(1, Math.ceil(art.frame.h * s));
  const g = c.getContext('2d');
  if (g) g.drawImage(art.img, 0, 0, art.frame.w * s, art.frame.h * s);
  return c;
}

function getLevel(level: number): Level {
  let l = levels.get(level);
  if (!l) {
    l = { bitmaps: new Map(), used: 0 };
    levels.set(level, l);
    if (levels.size > MAX_LEVELS) {
      let oldest = -1;
      let oldestUse = Infinity;
      for (const [k, v] of levels) {
        if (k !== level && v.used < oldestUse) {
          oldestUse = v.used;
          oldest = k;
        }
      }
      levels.delete(oldest);
    }
  }
  return l;
}

/** Terrain tile `name` rasterised for a tile `level` px wide (frame 96 x 120 scaled), or null while loading. */
export function tileBitmap(name: string, level: number): HTMLCanvasElement | null {
  const art = arts.get(name);
  if (!art || !art.ready) return null;
  const l = getLevel(level);
  l.used = ++clock;
  let c = l.bitmaps.get(name);
  if (!c) {
    c = rasterise(art, level);
    l.bitmaps.set(name, c);
  }
  return c;
}

/**
 * Blits sprites for one frame. `quick` (during pinch/wheel) reuses whichever level is already
 * rasterised instead of building a new one; MapView redraws without it once zooming settles.
 */
export class ArtPainter {
  private level: Level | null = null;
  private readonly levelPx: number;
  /** True when a bitmap came from another zoom level. */
  stale = false;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly tile: number,
    dpr: number,
    quick: boolean,
  ) {
    // Rasterise at the exact device size so blits are 1:1 (no resampling); mid-zoom reuses another level.
    this.levelPx = Math.max(8, Math.round(tile * dpr));
    if (!quick || levels.has(this.levelPx)) {
      this.level = getLevel(this.levelPx);
      this.level.used = ++clock;
    }
  }

  private bitmap(name: string): { canvas: HTMLCanvasElement; frame: Frame } | null {
    const art = arts.get(name);
    if (!art || !art.ready) return null;
    if (this.level) {
      let c = this.level.bitmaps.get(name);
      if (!c) {
        c = rasterise(art, this.levelPx);
        this.level.bitmaps.set(name, c);
      }
      return { canvas: c, frame: art.frame };
    }
    // Quick mode: nearest level that has this bitmap.
    let best: HTMLCanvasElement | null = null;
    let bestD = Infinity;
    for (const [px, l] of levels) {
      const c = l.bitmaps.get(name);
      const d = Math.abs(Math.log(px / this.levelPx));
      if (c && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    if (best) {
      this.stale = true;
      return { canvas: best, frame: art.frame };
    }
    // Nothing cached yet: build at the target level after all.
    this.level = getLevel(this.levelPx);
    this.level.used = ++clock;
    return this.bitmap(name);
  }

  /** Draw sprite `name` with its anchor at CSS (x, y); `scale` multiplies the zoom (1 = map scale). */
  draw(name: string, x: number, y: number, scale = 1): boolean {
    const b = this.bitmap(name);
    if (!b) return false;
    const s = (this.tile / 96) * scale;
    this.ctx.drawImage(b.canvas, x - b.frame.ax * s, y - b.frame.ay * s, b.frame.w * s, b.frame.h * s);
    return true;
  }
}

// ---- Hit masks ----------------------------------------------------------------------------------------

const MASK_SCALE = 0.25;
const masks = new Map<string, { w: number; h: number; bits: Uint8Array } | null>();

/** Is SVG-frame point (fx, fy) (relative to the anchor, SVG px) on an opaque part of sprite `name`? */
export function hitSprite(name: string, fx: number, fy: number): boolean {
  const art = arts.get(name);
  if (!art || !art.ready) return false;
  let m = masks.get(name);
  if (m === undefined) {
    const w = Math.ceil(art.frame.w * MASK_SCALE);
    const h = Math.ceil(art.frame.h * MASK_SCALE);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    m = null;
    if (g) {
      g.drawImage(art.img, 0, 0, w, h);
      try {
        const data = g.getImageData(0, 0, w, h).data;
        const bits = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) bits[i] = (data[i * 4 + 3] ?? 0) > 40 ? 1 : 0;
        m = { w, h, bits };
      } catch {
        m = null;
      }
    }
    masks.set(name, m);
  }
  const px = (fx + art.frame.ax) * MASK_SCALE;
  const py = (fy + art.frame.ay) * MASK_SCALE;
  if (!m) return px >= 0 && py >= 0 && px < art.frame.w * MASK_SCALE && py < art.frame.h * MASK_SCALE;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  if (ix < 0 || iy < 0 || ix >= m.w || iy >= m.h) return false;
  // Forgive a one-cell miss around thin parts (towers, poles) so taps feel generous.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = ix + dx;
      const y = iy + dy;
      if (x >= 0 && y >= 0 && x < m.w && y < m.h && m.bits[y * m.w + x]) return true;
    }
  }
  return false;
}
