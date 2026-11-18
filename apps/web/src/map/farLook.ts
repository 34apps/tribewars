// PROTOTYPE (design proposal only): far-zoom village pieces as tiny toy houses or tiny flags instead of dots.
// Switch with ?farlook=houses | flags | dots in the page URL (default dots = the current look).

import type { MapAllegiance } from './allegiance.ts';
import { STRONG_COLOR } from './dots.ts';

export type FarLook = 'dots' | 'houses' | 'flags';

export function farLook(): FarLook {
  try {
    const v = new URLSearchParams(window.location.search).get('farlook');
    return v === 'houses' || v === 'flags' ? v : 'dots';
  } catch {
    return 'dots';
  }
}

const INK = '#2B211C';
const WALL = '#F3E3C0';
const RUIN = '#B3ABA0';
const RUIN_DARK = '#7E776C';
const HALO = 'rgba(255, 248, 232, 0.9)';

type Ctx = CanvasRenderingContext2D;

function path(ctx: Ctx, pts: [number, number][]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

function piece(ctx: Ctx, pts: [number, number][], fill: string, lw: number, halo = 0): void {
  path(ctx, pts);
  if (halo) {
    ctx.lineWidth = lw + halo;
    ctx.strokeStyle = HALO;
    ctx.stroke();
  }
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Piece size (CSS px, house width) from the dot radius. */
function unit(radius: number): number {
  return radius * 2.1;
}

function shadow(ctx: Ctx, x: number, y: number, w: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, w * 0.62, w * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(43, 33, 28, 0.28)';
  ctx.fill();
}

/** A toy house centred on (cx, cy); roof in the relation colour. */
export function drawHouse(ctx: Ctx, cx: number, cy: number, radius: number, a: MapAllegiance): void {
  const own = a === 'own';
  const abandoned = a === 'abandoned';
  const w = unit(radius) * (abandoned ? 0.92 : 1);
  const lw = own ? 1.7 : 1.3;
  const bodyH = w * 0.5;
  const roofH = w * 0.55;
  const baseY = cy + (bodyH + roofH * 0.2) / 2 + 1;
  const bx = cx - w * 0.42;
  const bx1 = cx + w * 0.42;
  const topY = baseY - bodyH;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  shadow(ctx, cx, baseY + 0.5, w);
  if (abandoned) {
    // Roofless ruin: two broken wall stumps, no roof.
    const h = bodyH * 1.05;
    const ty = baseY - h;
    piece(ctx, [[bx, baseY], [bx, ty + h * 0.15], [bx + w * 0.16, ty + h * 0.4], [bx + w * 0.3, ty], [bx + w * 0.42, ty + h * 0.35], [cx + w * 0.05, ty + h * 0.55], [cx + w * 0.1, baseY]], RUIN, lw);
    piece(ctx, [[cx + w * 0.1, baseY], [cx + w * 0.12, ty + h * 0.45], [cx + w * 0.3, ty + h * 0.1], [bx1, ty + h * 0.5], [bx1, baseY]], RUIN_DARK, lw);
    ctx.restore();
    return;
  }
  const roof = STRONG_COLOR[a];
  const halo = own ? 3.2 : 0;
  piece(ctx, [[bx, baseY], [bx, topY], [bx1, topY], [bx1, baseY]], WALL, lw, halo);
  piece(ctx, [[bx - w * 0.1, topY + 0.5], [cx, topY - roofH], [bx1 + w * 0.1, topY + 0.5]], roof, lw, halo);
  ctx.fillStyle = INK;
  ctx.fillRect(cx - w * 0.07, baseY - bodyH * 0.55, w * 0.14, bodyH * 0.55);
  if (own) {
    // A small flame above the roof marks the player's own village.
    const fx = cx;
    const fy = topY - roofH - 1;
    const fh = w * 0.34;
    ctx.beginPath();
    ctx.moveTo(fx, fy - fh);
    ctx.quadraticCurveTo(fx + fh * 0.55, fy - fh * 0.35, fx, fy);
    ctx.quadraticCurveTo(fx - fh * 0.55, fy - fh * 0.35, fx, fy - fh);
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = '#FF8A1F';
    ctx.fill();
  }
  ctx.restore();
}

/** A toy flag on a short pole with a little base; cloth in the relation colour. */
export function drawFlag(ctx: Ctx, cx: number, cy: number, radius: number, a: MapAllegiance): void {
  const own = a === 'own';
  const abandoned = a === 'abandoned';
  const s = unit(radius) * 1.2 * (abandoned ? 0.92 : 1);
  const lw = own ? 1.7 : 1.3;
  const poleH = s * 1.05;
  const baseY = cy + poleH / 2;
  const px = cx - s * 0.12;
  const cloth = STRONG_COLOR[a];
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  shadow(ctx, px, baseY + 0.5, s * 0.8);
  const topY = baseY - poleH;
  const poleTopX = abandoned ? px - s * 0.06 : px;
  if (own) {
    ctx.beginPath();
    ctx.moveTo(px, baseY);
    ctx.lineTo(poleTopX, topY);
    ctx.lineWidth = 6.4;
    ctx.strokeStyle = HALO;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(px, baseY);
  ctx.lineTo(poleTopX, topY);
  ctx.lineWidth = 3.4;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#D9B27A';
  ctx.stroke();
  const cw = s * 0.9;
  const ch = s * 0.55;
  const x0 = poleTopX;
  const y0 = topY + 0.5;
  if (abandoned) {
    // Torn: it droops and the loose end is ragged.
    piece(ctx, [[x0, y0], [x0 + cw * 0.5, y0 + ch * 0.12], [x0 + cw * 0.8, y0 + ch * 0.1], [x0 + cw * 0.62, y0 + ch * 0.4], [x0 + cw * 0.78, y0 + ch * 0.62], [x0 + cw * 0.4, y0 + ch * 0.55], [x0 + cw * 0.3, y0 + ch * 0.95], [x0 + cw * 0.12, y0 + ch * 0.6], [x0, y0 + ch * 0.8]], RUIN, lw);
  } else {
    const halo = own ? 3.2 : 0;
    const wob = ch * 0.1;
    piece(ctx, [[x0, y0], [x0 + cw * 0.5, y0 + wob], [x0 + cw, y0], [x0 + cw * 0.72, y0 + ch * 0.5], [x0 + cw, y0 + ch], [x0 + cw * 0.5, y0 + ch - wob], [x0, y0 + ch]], cloth, lw, halo);
  }
  const bw = s * 0.34;
  piece(ctx, [[px - bw, baseY + 0.5], [px - bw * 0.7, baseY - s * 0.14], [px + bw * 0.7, baseY - s * 0.14], [px + bw, baseY + 0.5]], '#B9AD98', lw);
  if (own) {
    ctx.beginPath();
    ctx.arc(poleTopX, topY - 0.5, s * 0.1 + 0.8, 0, Math.PI * 2);
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = '#FFC21A';
    ctx.fill();
  }
  ctx.restore();
}

/** Screenshot helper (?farmix): turns about a third of the abandoned villages into players of every relation, so a thin test world looks lived in. */
export function mixVillage<T extends { kind: string; relation: unknown; x: number; y: number }>(v: T): T {
  try {
    if (!new URLSearchParams(window.location.search).has('farmix')) return v;
  } catch {
    return v;
  }
  if (v.kind !== 'abandoned') return v;
  const h = Math.abs((v.x * 73856093) ^ (v.y * 19349663)) % 13;
  const rel = ['tribe', 'tribe', 'ally', 'nap', 'enemy', 'enemy', 'none'][h];
  if (!rel) return v;
  return { ...v, kind: 'player', relation: rel === 'none' ? 'neutral' : rel };
}
