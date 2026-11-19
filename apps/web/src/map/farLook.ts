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
}

/** Pole height of an ordinary player flag at this tile width: 5.5 px at the smallest zoom (a 500-field world squeezed onto a phone), 17 px just below the sprite zoom. */
export function flagPoleHeight(tile: number): number {
  return Math.max(5.5, Math.min(17, 5 + tile * 0.45));
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
    edgeW: abandoned ? 0.7 : own ? 1.6 : 1.2,
    poleW: abandoned ? (poleH < 5 ? 1.2 : 1.6) : poleH < 10 ? 2.2 : 3,
    footW: poleH * (abandoned ? 0.26 : 0.32),
    abandoned,
    own,
  };
}

/** Radius (CSS px) of the hit area / hover ring and how far above the foot its centre sits. */
export function flagHit(m: FlagMetrics): { radius: number; dy: number } {
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
  const topY = y - m.poleH;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  if (!m.abandoned || m.poleH >= 4.5) drawFoot(ctx, x, y, m);
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
