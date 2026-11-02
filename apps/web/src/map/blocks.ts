// Far-zoom terrain: blocks of n x n tiles composited once into a canvas per zoom level, so a frame
// draws a few dozen block bitmaps instead of thousands of tiles. Near zoom draws tiles one by one
// (see render.ts) so villages can sit between rows.

import { TILE_VARIANTS, tileBitmap } from './sprites.ts';
import { GRASS } from './terrain.ts';
import type { TerrainCache } from './terrain.ts';

/** Small deterministic hash -> [0, 1). */
export function rand(x: number, y: number, k: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(k | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Terrain art variant for a tile (stable per tile). */
export function tileArt(code: number, x: number, y: number): string {
  const list = TILE_VARIANTS[code] ?? TILE_VARIANTS[GRASS]!;
  if (list.length === 1) return list[0]!;
  const r = rand(x, y, 3);
  if (code === GRASS) return list[r < 0.6 ? 0 : r < 0.84 ? 1 : r < 0.92 ? 2 : 3]!;
  return list[Math.floor(r * list.length)] ?? list[0]!;
}

/** Tile frame: 96 x 120 SVG px with the tile centre at (48, 80). */
const ABOVE = 80 / 96;
const BELOW = 40 / 96;

interface Level {
  px: number;
  n: number;
  blocks: Map<number, HTMLCanvasElement>;
  used: number;
}

const bkey = (bx: number, by: number) => (bx + 4096) * 8192 + (by + 4096);

export class TerrainBlocks {
  private readonly levels = new Map<number, Level>();
  private clock = 0;
  private pixels = 0;

  constructor(
    private readonly terrain: TerrainCache,
    private readonly radius: number,
  ) {}

  /**
   * Draw terrain for the view. `tileCss` = tile width in CSS px; `toCss(x, y)` = screen centre of tile (x, y).
   * In `quick` mode (mid-zoom) blocks of an already-cached level are reused, scaled.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    tileCss: number,
    dpr: number,
    quick: boolean,
    bounds: { x0: number; y0: number; x1: number; y1: number },
    toCss: (x: number, y: number) => { x: number; y: number },
    viewW: number,
    viewH: number,
  ): void {
    const level = this.pickLevel(Math.max(8, Math.round(tileCss * dpr)), quick);
    level.used = ++this.clock;
    const { n, px } = level;
    const k = tileCss / px; // level px -> CSS px
    const R = this.radius;
    const bx0 = Math.floor(Math.max(-R, bounds.x0) / n);
    const by0 = Math.floor(Math.max(-R, bounds.y0) / n);
    const bx1 = Math.floor(Math.min(R, bounds.x1) / n);
    const by1 = Math.floor(Math.min(R, bounds.y1) / n);
    const budget = Math.max(16e6, viewW * viewH * dpr * dpr * 4);
    const ox = n * (px / 2);
    const oy = Math.ceil(ABOVE * px) + 1;
    const w = n * px;
    const h = oy + Math.ceil((n - 1) * (px / 2) + BELOW * px) + 2;
    // Painter's order: blocks further back (smaller bx + by) first.
    for (let sum = bx0 + by0; sum <= bx1 + by1; sum++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const by = sum - bx;
        if (by < by0 || by > by1) continue;
        const origin = toCss(bx * n, by * n);
        const left = Math.round((origin.x - ox * k) * dpr) / dpr;
        const top = Math.round((origin.y - oy * k) * dpr) / dpr;
        if (left > viewW || top > viewH || left + w * k < 0 || top + h * k < 0) continue;
        let c = level.blocks.get(bkey(bx, by));
        if (!c) {
          const made = this.build(level, bx, by, w, h, ox, oy);
          if (!made) continue;
          c = made;
          level.blocks.set(bkey(bx, by), c);
          this.pixels += c.width * c.height;
          if (this.pixels > budget) this.evict(level, budget);
        }
        ctx.drawImage(c, left, top, w * k, h * k);
      }
    }
  }

  private pickLevel(target: number, quick: boolean): Level {
    let l = this.levels.get(target);
    if (!l && quick && this.levels.size > 0) {
      let best: Level | null = null;
      for (const c of this.levels.values()) if (!best || Math.abs(Math.log(c.px / target)) < Math.abs(Math.log(best.px / target))) best = c;
      if (best) return best;
    }
    if (!l) {
      // Blocks about 640 device px wide, 4..24 tiles a side.
      const n = Math.max(4, Math.min(24, Math.round(640 / target)));
      l = { px: target, n, blocks: new Map(), used: 0 };
      this.levels.set(target, l);
      // Keep at most two levels.
      if (this.levels.size > 2) {
        let oldest: Level | null = null;
        for (const c of this.levels.values()) if (c !== l && (!oldest || c.used < oldest.used)) oldest = c;
        if (oldest) this.dropLevel(oldest);
      }
    }
    return l;
  }

  private dropLevel(l: Level): void {
    for (const c of l.blocks.values()) this.pixels -= c.width * c.height;
    this.levels.delete(l.px);
  }

  private evict(current: Level, budget: number): void {
    for (const l of [...this.levels.values()]) if (l !== current) this.dropLevel(l);
    // Then the oldest blocks of the current level (Map keeps insertion order).
    for (const [key, c] of current.blocks) {
      if (this.pixels <= budget * 0.75) break;
      current.blocks.delete(key);
      this.pixels -= c.width * c.height;
    }
  }

  private build(level: Level, bx: number, by: number, w: number, h: number, ox: number, oy: number): HTMLCanvasElement | null {
    const { n, px } = level;
    const c = document.createElement('canvas');
    c.width = Math.ceil(w);
    c.height = Math.ceil(h);
    const g = c.getContext('2d');
    if (!g) return null;
    const R = this.radius;
    const hw = px / 2;
    const hh = px / 4;
    const fw = Math.ceil(px);
    const fh = Math.ceil((120 / 96) * px);
    const ax = Math.round((48 / 96) * px);
    const ay = Math.round(ABOVE * px);
    for (let s = 0; s <= 2 * (n - 1); s++) {
      for (let i = Math.max(0, s - (n - 1)); i <= Math.min(n - 1, s); i++) {
        const j = s - i;
        const x = bx * n + i;
        const y = by * n + j;
        if (Math.abs(x) > R || Math.abs(y) > R) continue;
        const bmp = tileBitmap(tileArt(this.terrain.get(x, y), x, y), px);
        if (!bmp) return null;
        g.drawImage(bmp, Math.round(ox + (i - j) * hw - ax), Math.round(oy + (i + j) * hh - ay), fw, fh);
      }
    }
    return c;
  }
}
