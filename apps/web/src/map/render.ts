// Canvas drawing for the world map. Pure functions of (view, data); the caller decides when to redraw.

import type { Coords, MapVillageDto } from '@clanfire/engine';
import { RELATION_STYLE } from '../relations.ts';
import type { RelationKey } from '../relations.ts';
import { CHUNK } from './chunks.ts';
import type { MapChunks } from './chunks.ts';
import { FOREST, GRASS, HILLS, LAKE, MOUNTAIN } from './terrain.ts';
import type { TerrainCache } from './terrain.ts';

export const MIN_TILE = 12;
export const MAX_TILE = 64;

export interface View {
  /** Centre of the viewport in tile space; tile (x, y) covers [x, x+1) x [y, y+1). */
  cx: number;
  cy: number;
  /** Tile size in CSS px. */
  tile: number;
}

export interface Scene {
  ctx: CanvasRenderingContext2D;
  /** Viewport size in CSS px. */
  width: number;
  height: number;
  dpr: number;
  view: View;
  radius: number;
  terrain: TerrainCache;
  chunks: MapChunks;
  selected: Coords | null;
  hover: Coords | null;
  own: Coords | null;
}

const OUTSIDE = '#2f261b';
const GROUND = ['#aebd79', '#6e8c55', '#c9b27c', '#968e81', '#7ba9bf'] as const;
const DETAIL = { tree: '#4b6b3b', tuft: '#8fa45b', hill: '#a68c55', rock: '#6f685d', snow: '#f1eee6', wave: '#b3d6e6' };
const FONT = '600 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Smallest tile size (px) at which village names / tribe tags are drawn. */
const NAME_TILE = 36;
const TAG_TILE = 28;
const TAG_FONT = '700 10px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Colour key of a village: yours, abandoned, or its owner's relation to you (neutral when unknown). */
export function relationKey(v: MapVillageDto): RelationKey {
  if (v.kind === 'own') return 'self';
  if (v.kind === 'abandoned') return 'abandoned';
  return v.relation ?? 'neutral';
}

/** Small deterministic hash -> [0, 1) used for decoration placement. */
function rand(x: number, y: number, k: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(k | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function clampView(view: View, radius: number): void {
  view.tile = Math.max(MIN_TILE, Math.min(MAX_TILE, view.tile));
  view.cx = Math.max(-radius, Math.min(radius + 1, view.cx));
  view.cy = Math.max(-radius, Math.min(radius + 1, view.cy));
}

export function screenToTile(view: View, width: number, height: number, px: number, py: number): Coords {
  return {
    x: Math.floor(view.cx + (px - width / 2) / view.tile),
    y: Math.floor(view.cy + (py - height / 2) / view.tile),
  };
}

/** Pick an axis-label step so labels stay at least ~46 px apart. */
function labelStep(tile: number): number {
  for (const s of [1, 2, 5, 10, 20, 50, 100, 200]) if (s * tile >= 46) return s;
  return 500;
}

export function drawMap(sc: Scene): void {
  const { ctx, width: W, height: H, view, radius, terrain } = sc;
  const t = view.tile;
  ctx.setTransform(sc.dpr, 0, 0, sc.dpr, 0, 0);
  ctx.fillStyle = OUTSIDE;
  ctx.fillRect(0, 0, W, H);

  const sx = (wx: number) => Math.round((wx - view.cx) * t + W / 2);
  const sy = (wy: number) => Math.round((wy - view.cy) * t + H / 2);
  const left = view.cx - W / (2 * t);
  const top = view.cy - H / (2 * t);
  const x0 = Math.max(-radius, Math.floor(left));
  const x1 = Math.min(radius, Math.floor(left + W / t));
  const y0 = Math.max(-radius, Math.floor(top));
  const y1 = Math.min(radius, Math.floor(top + H / t));

  if (x0 <= x1 && y0 <= y1) {
    // Terrain: merge horizontal runs of the same type into one rectangle.
    for (let y = y0; y <= y1; y++) {
      const ry0 = sy(y);
      const rh = sy(y + 1) - ry0;
      let runStart = x0;
      let runCode = terrain.get(x0, y);
      for (let x = x0 + 1; x <= x1 + 1; x++) {
        const code = x <= x1 ? terrain.get(x, y) : -1;
        if (code !== runCode) {
          ctx.fillStyle = GROUND[runCode] ?? GROUND[GRASS];
          const rx0 = sx(runStart);
          ctx.fillRect(rx0, ry0, sx(x) - rx0, rh);
          runStart = x;
          runCode = code;
        }
      }
    }

    if (t >= 26) drawDetails(ctx, terrain, x0, x1, y0, y1, sx, sy, t);

    if (t >= 22) {
      ctx.beginPath();
      for (let x = x0; x <= x1 + 1; x++) {
        const px = sx(x) + 0.5;
        ctx.moveTo(px, sy(y0));
        ctx.lineTo(px, sy(y1 + 1));
      }
      for (let y = y0; y <= y1 + 1; y++) {
        const py = sy(y) + 0.5;
        ctx.moveTo(sx(x0), py);
        ctx.lineTo(sx(x1 + 1), py);
      }
      ctx.strokeStyle = 'rgba(58, 40, 12, 0.16)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    drawRoute(sc, sx, sy);
    drawVillages(sc, x0, x1, y0, y1, sx, sy);
    drawTileOutline(ctx, sc.hover, sx, sy, 'rgba(255, 255, 255, 0.75)', 2, radius);
    drawTileOutline(ctx, sc.selected, sx, sy, '#fff8dc', 3, radius, '#3b2a1a');
  }

  // World border.
  ctx.strokeStyle = '#7a2e1a';
  ctx.lineWidth = 3;
  ctx.strokeRect(sx(-radius), sy(-radius), sx(radius + 1) - sx(-radius), sy(radius + 1) - sy(-radius));

  drawAxes(sc, x0, x1, y0, y1, sx, sy);
}

function drawDetails(
  ctx: CanvasRenderingContext2D,
  terrain: TerrainCache,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  sx: (v: number) => number,
  sy: (v: number) => number,
  t: number,
): void {
  const trees = new Path2D();
  const tufts = new Path2D();
  const hills = new Path2D();
  const rocks = new Path2D();
  const snow = new Path2D();
  const waves = new Path2D();
  const u = t / 8;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const code = terrain.get(x, y);
      const px = sx(x);
      const py = sy(y);
      if (code === FOREST) {
        for (let i = 0; i < 3; i++) {
          const cx = px + t * (0.22 + 0.28 * i + (rand(x, y, i) - 0.5) * 0.12);
          const cy = py + t * (i === 1 ? 0.38 : 0.62) + (rand(x, y, i + 9) - 0.5) * u * 0.6;
          trees.moveTo(cx, cy - u * 1.9);
          trees.lineTo(cx - u * 1.15, cy + u * 0.9);
          trees.lineTo(cx + u * 1.15, cy + u * 0.9);
          trees.closePath();
        }
      } else if (code === HILLS) {
        for (let i = 0; i < 2; i++) {
          const cx = px + t * (0.3 + 0.4 * i);
          const cy = py + t * (0.5 + 0.1 * i) + (rand(x, y, i) - 0.5) * u;
          hills.moveTo(cx - u * 1.6, cy + u * 0.6);
          hills.arc(cx, cy + u * 0.6, u * 1.6, Math.PI, 0);
        }
      } else if (code === MOUNTAIN) {
        const cx = px + t * 0.5 + (rand(x, y, 1) - 0.5) * u;
        const cy = py + t * 0.62;
        rocks.moveTo(cx - u * 2.6, cy + u * 1.2);
        rocks.lineTo(cx - u * 0.2, cy - u * 2.4);
        rocks.lineTo(cx + u * 2.6, cy + u * 1.2);
        rocks.closePath();
        snow.moveTo(cx - u * 0.2, cy - u * 2.4);
        snow.lineTo(cx - u * 1.1, cy - u * 0.7);
        snow.lineTo(cx + u * 0.5, cy - u * 0.9);
        snow.closePath();
      } else if (code === LAKE) {
        for (let i = 0; i < 2; i++) {
          const cx = px + t * (0.28 + 0.34 * i);
          const cy = py + t * (0.35 + 0.32 * i) + (rand(x, y, i) - 0.5) * u;
          waves.moveTo(cx - u * 1.4, cy);
          waves.quadraticCurveTo(cx - u * 0.7, cy - u * 0.8, cx, cy);
          waves.quadraticCurveTo(cx + u * 0.7, cy + u * 0.8, cx + u * 1.4, cy);
        }
      } else if (code === GRASS && rand(x, y, 5) < 0.4) {
        const cx = px + t * (0.2 + rand(x, y, 6) * 0.6);
        const cy = py + t * (0.45 + rand(x, y, 7) * 0.4);
        tufts.moveTo(cx - u * 0.5, cy);
        tufts.lineTo(cx - u * 0.7, cy - u * 0.9);
        tufts.moveTo(cx, cy);
        tufts.lineTo(cx, cy - u * 1.1);
        tufts.moveTo(cx + u * 0.5, cy);
        tufts.lineTo(cx + u * 0.7, cy - u * 0.9);
      }
    }
  }
  ctx.fillStyle = DETAIL.tree;
  ctx.fill(trees);
  ctx.fillStyle = DETAIL.rock;
  ctx.fill(rocks);
  ctx.fillStyle = DETAIL.snow;
  ctx.fill(snow);
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, t / 22);
  ctx.strokeStyle = DETAIL.hill;
  ctx.stroke(hills);
  ctx.strokeStyle = DETAIL.tuft;
  ctx.stroke(tufts);
  ctx.strokeStyle = DETAIL.wave;
  ctx.stroke(waves);
  ctx.lineCap = 'butt';
}

function drawTileOutline(
  ctx: CanvasRenderingContext2D,
  tile: Coords | null,
  sx: (v: number) => number,
  sy: (v: number) => number,
  color: string,
  width: number,
  radius: number,
  shadow?: string,
): void {
  if (!tile || Math.abs(tile.x) > radius || Math.abs(tile.y) > radius) return;
  const x = sx(tile.x);
  const y = sy(tile.y);
  const w = sx(tile.x + 1) - x;
  const h = sy(tile.y + 1) - y;
  if (shadow) {
    ctx.strokeStyle = shadow;
    ctx.lineWidth = width + 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function drawRoute(sc: Scene, sx: (v: number) => number, sy: (v: number) => number): void {
  const { ctx, own, selected } = sc;
  if (!own || !selected || (own.x === selected.x && own.y === selected.y)) return;
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(47, 31, 14, 0.6)';
  ctx.beginPath();
  ctx.moveTo(sx(own.x + 0.5), sy(own.y + 0.5));
  ctx.lineTo(sx(selected.x + 0.5), sy(selected.y + 0.5));
  ctx.stroke();
  ctx.restore();
}

function drawVillages(
  sc: Scene,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  sx: (v: number) => number,
  sy: (v: number) => number,
): void {
  const { ctx, chunks, view } = sc;
  const t = view.tile;
  const visible: MapVillageDto[] = [];
  for (let ci = Math.floor(x0 / CHUNK); ci <= Math.floor(x1 / CHUNK); ci++) {
    for (let cj = Math.floor(y0 / CHUNK); cj <= Math.floor(y1 / CHUNK); cj++) {
      for (const v of chunks.villagesIn(ci, cj)) if (v.x >= x0 && v.x <= x1 && v.y >= y0 && v.y <= y1) visible.push(v);
    }
  }
  visible.sort((a, b) => a.y - b.y);
  for (const v of visible) drawVillage(ctx, v, sx(v.x), sy(v.y), t);

  if (t >= TAG_TILE) {
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (t >= NAME_TILE) {
      ctx.font = FONT;
      for (const v of visible) {
        const cx = sx(v.x) + t / 2;
        const by = sy(v.y) + t - 3;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(251, 246, 233, 0.92)';
        ctx.strokeText(v.name, cx, by, t * 2.2);
        ctx.fillStyle = '#2c2318';
        ctx.fillText(v.name, cx, by, t * 2.2);
      }
    }
    // Tribe tag: a small pill in the relation colour, under the name when names are shown, else at the tile bottom.
    ctx.font = TAG_FONT;
    for (const v of visible) {
      if (!v.tribeTag) continue;
      const label = `[${v.tribeTag}]`;
      const w = Math.min(ctx.measureText(label).width + 8, t * 2.2);
      const cx = sx(v.x) + t / 2;
      const top = sy(v.y) + (t >= NAME_TILE ? t + 1 : t - 14);
      ctx.fillStyle = RELATION_STYLE[relationKey(v)].roof;
      ctx.fillRect(Math.round(cx - w / 2), top, Math.round(w), 13);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, cx, top + 10, w - 4);
    }
  }
}

function drawVillage(ctx: CanvasRenderingContext2D, v: MapVillageDto, px: number, py: number, t: number): void {
  const style = RELATION_STYLE[relationKey(v)];
  const f = 0.42 + 0.5 * Math.min(1, Math.sqrt(Math.max(0, v.points) / 90));
  const s = Math.max(8, t * f);
  const cx = px + t / 2;
  const cy = py + t / 2;

  if (v.protected && v.kind !== 'abandoned') {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(t * 0.5, s * 0.82), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(130, 190, 245, 0.28)';
    ctx.fill();
    ctx.lineWidth = Math.max(2, t * 0.07);
    ctx.strokeStyle = '#2f86d6';
    ctx.stroke();
  }

  const bw = s * 0.86;
  const bh = s * 0.46;
  const bx = cx - bw / 2;
  const by = cy - bh / 2 + s * 0.16;
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = '#2a1d10';
  ctx.lineJoin = 'round';
  ctx.fillStyle = style.body;
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeRect(bx, by, bw, bh);
  ctx.beginPath();
  ctx.moveTo(bx - s * 0.08, by);
  ctx.lineTo(cx, by - s * 0.46);
  ctx.lineTo(bx + bw + s * 0.08, by);
  ctx.closePath();
  ctx.fillStyle = style.roof;
  ctx.fill();
  ctx.stroke();
  if (s >= 18) {
    ctx.fillStyle = '#3b2a1a';
    ctx.fillRect(cx - s * 0.08, by + bh - s * 0.22, s * 0.16, s * 0.22);
  }
  if (v.kind === 'own' && s >= 14) {
    // Little flag on the roof so your own village stands out.
    ctx.beginPath();
    ctx.moveTo(cx, by - s * 0.46);
    ctx.lineTo(cx, by - s * 0.8);
    ctx.lineTo(cx + s * 0.28, by - s * 0.7);
    ctx.lineTo(cx, by - s * 0.6);
    ctx.fillStyle = '#c0392b';
    ctx.fill();
    ctx.stroke();
  }
}

function drawAxes(
  sc: Scene,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  sx: (v: number) => number,
  sy: (v: number) => number,
): void {
  const { ctx, view, height: H } = sc;
  const t = view.tile;
  const step = labelStep(t);
  ctx.font = '600 10px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'middle';
  const pill = (text: string, cx: number, cy: number, align: CanvasTextAlign) => {
    ctx.textAlign = align;
    const w = ctx.measureText(text).width + 8;
    const rx = align === 'center' ? cx - w / 2 : cx;
    ctx.fillStyle = 'rgba(44, 35, 24, 0.62)';
    ctx.fillRect(rx, cy - 8, w, 16);
    ctx.fillStyle = '#fbf6e9';
    ctx.fillText(text, align === 'center' ? cx : cx + 4, cy);
  };
  if (x0 <= x1) {
    const start = Math.ceil(x0 / step) * step;
    for (let x = start; x <= x1; x += step) pill(String(x), sx(x) + t / 2, 10, 'center');
  }
  if (y0 <= y1) {
    const start = Math.ceil(y0 / step) * step;
    for (let y = start; y <= y1; y += step) {
      const cy = sy(y) + t / 2;
      if (cy > 22 && cy < H - 8) pill(String(y), 2, cy, 'left');
    }
  }
}
