// Far-zoom villages (below DOT_TILE, zoomMode.ts): every village is a tiny toy flag on a pole.
// Player flags carry the relation colour (STRONG_COLOR), own villages are bigger and gold, abandoned villages are a bare
// short pole with a small pale rag so a crowded abandoned area reads as many small grey marks under the player flags.
// The numbers and the draw order are pure functions (tested in test/map-dots.test.tsx); only drawFlag touches a canvas.

import type { MapVillageDto } from '@clanfire/engine';
import type { MapAllegiance } from './allegiance.ts';
import { allegianceOf } from './allegiance.ts';
import { STRONG_COLOR } from './dots.ts';

const INK = '#2B211C';
const HALO = 'rgba(255, 248, 232, 0.9)';
const POLE_WOOD = '#D9B27A';
const RAG = '#CFCAC0';
const RAG_EDGE = '#8F897E';
const FOOT = '#B9AD98';
const SPECK = '#A29C90';

type Ctx = CanvasRenderingContext2D;

export interface FlagMetrics {
  /** Pole height in CSS px, from the foot (the village's tile centre) up. */
  poleH: number;
  /** Cloth width and height. */
  clothW: number;
  clothH: number;
  /** Outline width of the cloth / the pole's ink width (the coloured core is thinner). */
  edgeW: number;
  poleW: number;
  /** Foot (base) half width. */
  footW: number;
  abandoned: boolean;
  own: boolean;
  /** Abandoned and zoomed far out: drawn as a speck, no pole. */
  speck: boolean;
}

/** Tile widths of the "fully out" range: at or below SMALL_TILE flags are at their smallest (half size), from BIG_TILE up at full size. */
export const SMALL_TILE = 2.5;
export const BIG_TILE = 8;
export const SMALLEST_FLAG_FACTOR = 0.5;
/** Below this tile width abandoned villages are bare grey specks (no pole) and crowded groups carry a count badge. */
export const SPECK_TILE = 5;
export const BADGE_TILE = 5;

/** 0.5 at the furthest zoom, smoothly back to 1 at BIG_TILE. */
export function flagZoomFactor(tile: number): number {
  const u = Math.max(0, Math.min(1, (tile - SMALL_TILE) / (BIG_TILE - SMALL_TILE)));
  const e = u * u * (3 - 2 * u);
  return SMALLEST_FLAG_FACTOR + (1 - SMALLEST_FLAG_FACTOR) * e;
}

/** Pole height of an ordinary player flag at this tile width: about 3 px when the whole world is in view, 17 px just below the sprite zoom. */
export function flagPoleHeight(tile: number): number {
  return Math.max(5.5, Math.min(17, 5 + tile * 0.45)) * flagZoomFactor(tile);
}

/** Abandoned villages are a bare speck while fully zoomed out, a pole with a pennant from SPECK_TILE up. */
export function abandonedIsSpeck(tile: number): boolean {
  return tile < SPECK_TILE;
}

/** Speck radius in CSS px. */
export function speckRadius(tile: number): number {
  return Math.max(0.8, Math.min(1.5, 0.8 + tile * 0.14));
}

export const OWN_FLAG_SCALE = 1.5;
/** Abandoned: clearly smaller than a player flag (pole and rag), so players stand out and a ruin cluster stays countable. */
export const ABANDONED_FLAG_SCALE = 0.62;

export function flagMetrics(tile: number, a: MapAllegiance): FlagMetrics {
  const own = a === 'own';
  const abandoned = a === 'abandoned';
  const base = flagPoleHeight(tile);
  const poleH = base * (own ? OWN_FLAG_SCALE : abandoned ? ABANDONED_FLAG_SCALE : 1);
  return {
    poleH,
    clothW: poleH * (abandoned ? 0.5 : 0.86),
    clothH: poleH * (abandoned ? 0.3 : 0.52),
    edgeW: abandoned ? 0.7 : poleH < 6 ? 0.7 : own ? 1.6 : 1.2,
    poleW: abandoned ? 1.2 : Math.max(1.3, Math.min(3, poleH * 0.28)),
    footW: poleH * (abandoned ? 0.26 : 0.32),
    abandoned,
    own,
    speck: abandoned && abandonedIsSpeck(tile),
  };
}

/** Radius (CSS px) of the hit area / hover ring and how far above the foot its centre sits. */
export function flagHit(m: FlagMetrics): { radius: number; dy: number } {
  if (m.speck) return { radius: 3, dy: 0 };
  return { radius: Math.max(m.poleH * 0.5, 4), dy: m.poleH * 0.5 };
}

/**
 * Draw order, back to front: abandoned villages first, then the other players, own villages last, so a player flag is
 * never hidden under a ruin. Inside each layer by screen y (x + y, smaller = farther up the screen) so nearer flags
 * overlap farther ones; ties by x for a stable order.
 */
export function farDrawOrder<T extends Pick<MapVillageDto, 'kind' | 'x' | 'y'>>(villages: Iterable<T>): T[] {
  const layer = (v: T) => (v.kind === 'abandoned' ? 0 : v.kind === 'own' ? 2 : 1);
  return [...villages].sort((a, b) => layer(a) - layer(b) || a.x + a.y - (b.x + b.y) || a.x - b.x);
}

export function flagAllegiance(v: MapVillageDto): MapAllegiance {
  return allegianceOf(v);
}

function drawFoot(ctx: Ctx, x: number, y: number, m: FlagMetrics): void {
  ctx.beginPath();
  ctx.ellipse(x, y, m.footW, m.footW * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = m.abandoned ? FOOT : '#9C8F7A';
  ctx.fill();
  ctx.lineWidth = m.abandoned ? 0.7 : 1;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/** A toy flag whose foot stands on (x, y), the village's tile centre. */
export function drawFlag(ctx: Ctx, x: number, y: number, tile: number, a: MapAllegiance): void {
  const m = flagMetrics(tile, a);
  if (m.speck) {
    ctx.beginPath();
    ctx.arc(x, y - 0.5, speckRadius(tile), 0, Math.PI * 2);
    ctx.fillStyle = SPECK;
    ctx.fill();
    return;
  }
  const topY = y - m.poleH;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  if (m.poleH >= 4.5) drawFoot(ctx, x, y, m);
  if (m.own) {
    // Pale halo so the gold flag stays clear of any ground.
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, topY);
    ctx.lineWidth = m.poleW + 3.4;
    ctx.strokeStyle = HALO;
    ctx.stroke();
  }
  // Pole: ink outline with a wooden core (abandoned: thin, ink and pale grey).
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, topY);
  ctx.lineWidth = m.poleW;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = Math.max(0.8, m.poleW - 1.4);
  ctx.strokeStyle = m.abandoned ? RAG : POLE_WOOD;
  ctx.stroke();

  const x0 = x;
  const y0 = topY + 0.5;
  const cw = m.clothW;
  const ch = m.clothH;
  ctx.beginPath();
  if (m.abandoned) {
    // A small plain pennant hanging a little low: no tear, no swallow tail.
    ctx.moveTo(x0, y0 + ch * 0.1);
    ctx.lineTo(x0 + cw, y0 + ch * 0.6);
    ctx.lineTo(x0, y0 + ch * 1.1);
  } else {
    const wob = ch * 0.1;
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + cw * 0.5, y0 + wob);
    ctx.lineTo(x0 + cw, y0);
    ctx.lineTo(x0 + cw * 0.74, y0 + ch * 0.5);
    ctx.lineTo(x0 + cw, y0 + ch);
    ctx.lineTo(x0 + cw * 0.5, y0 + ch - wob);
    ctx.lineTo(x0, y0 + ch);
  }
  ctx.closePath();
  if (m.own) {
    ctx.lineWidth = m.edgeW + 3.2;
    ctx.strokeStyle = HALO;
    ctx.stroke();
  }
  ctx.lineWidth = m.edgeW;
  ctx.strokeStyle = m.abandoned ? RAG_EDGE : INK;
  ctx.stroke();
  ctx.fillStyle = m.abandoned ? RAG : STRONG_COLOR[a];
  ctx.fill();
  if (m.own) {
    ctx.beginPath();
    ctx.arc(x, topY - 0.5, m.poleW * 0.5 + 1, 0, Math.PI * 2);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
  }
  ctx.restore();
}

// ---- Count badges on crowded groups (fully zoomed out) ----

export interface FlagGroup {
  /** Screen position of the badge centre: over the group, just above its topmost flag. */
  x: number;
  y: number;
  count: number;
}

export const CLUSTER_CELL_PX = 16;
/** A grid cell is "crowded" from this many player villages; a group (touching crowded cells) needs BADGE_MIN_GROUP in all. */
export const CLUSTER_CELL_MIN = 4;
export const BADGE_MIN_GROUP = 8;

export function badgesVisible(tile: number): boolean {
  return tile < BADGE_TILE;
}

/**
 * Simple screen-space grid clustering of player villages: points are binned into `cell` px cells, cells with at least
 * CLUSTER_CELL_MIN points are crowded, touching crowded cells (8 neighbours) are one group, and groups below BADGE_MIN_GROUP
 * get no badge. Returns one badge per group, placed above the group's topmost point.
 */
export function clusterGroups(points: readonly { x: number; y: number }[], cell = CLUSTER_CELL_PX): FlagGroup[] {
  const bins = new Map<number, { n: number; minY: number; sx: number; k: number }>();
  const key = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);
  for (const p of points) {
    const k = key(Math.floor(p.x / cell), Math.floor(p.y / cell));
    const b = bins.get(k);
    if (b) {
      b.n++;
      b.sx += p.x;
      if (p.y < b.minY) b.minY = p.y;
    } else bins.set(k, { n: 1, minY: p.y, sx: p.x, k });
  }
  const crowded = new Set<number>();
  for (const [k, b] of bins) if (b.n >= CLUSTER_CELL_MIN) crowded.add(k);
  const seen = new Set<number>();
  const out: FlagGroup[] = [];
  for (const start of crowded) {
    if (seen.has(start)) continue;
    seen.add(start);
    const stack = [start];
    let count = 0;
    let sx = 0;
    let minY = Infinity;
    while (stack.length) {
      const k = stack.pop()!;
      const b = bins.get(k)!;
      count += b.n;
      sx += b.sx;
      if (b.minY < minY) minY = b.minY;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const nk = k + di * 8192 + dj;
          if (crowded.has(nk) && !seen.has(nk)) {
            seen.add(nk);
            stack.push(nk);
          }
        }
      }
    }
    if (count >= BADGE_MIN_GROUP) out.push({ x: sx / count, y: minY, count });
  }
  return out;
}

/** Badge radius from the number of digits. */
export function badgeRadius(count: number): number {
  return 6 + String(count).length * 1.9;
}

/** Cream round badge with an ink outline and ink digits, centred just above (g.x, g.y). */
export function drawBadge(ctx: Ctx, g: FlagGroup, font: string): void {
  const r = badgeRadius(g.count);
  const cy = g.y - r - 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(g.x, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#FFF8E8';
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.font = `700 10px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(g.count), g.x, cy + 0.5);
  ctx.restore();
}
