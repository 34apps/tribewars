// World overview (an isometric diamond of the region round the main map's view, same orientation as the main map): pure geometry and counting, no drawing.

import type { MapVillageDto } from '@clanfire/engine';
import { allegianceOf } from './allegiance.ts';
import type { MapAllegiance } from './allegiance.ts';
import type { MapOverviewCode } from '@clanfire/engine';
import type { Size, View } from './iso.ts';

/** Legend order and words: the owner's "Mine · Tribe · Allies · Pact · Enemies · Others · Abandoned". */
export const OVERVIEW_ROWS: ReadonlyArray<{ key: MapAllegiance; label: string }> = [
  { key: 'own', label: 'Mine' },
  { key: 'tribe', label: 'Tribe' },
  { key: 'ally', label: 'Allies' },
  { key: 'nap', label: 'Pact' },
  { key: 'enemy', label: 'Enemies' },
  { key: 'neutral', label: 'Others' },
  { key: 'abandoned', label: 'Abandoned' },
];

export type OverviewCounts = Record<MapAllegiance, number>;

export function countVillages(villages: Iterable<MapVillageDto>): OverviewCounts {
  const c: OverviewCounts = { own: 0, tribe: 0, ally: 0, nap: 0, enemy: 0, neutral: 0, abandoned: 0 };
  for (const v of villages) c[allegianceOf(v)] += 1;
  return c;
}

/** Fields along one side of the free overview region (the one place this number lives). */
export const OVERVIEW_REGION = 100;
/** Region sizes the premium Expand offers: fields per side, 0 = the whole world. */
export const OVERVIEW_SIZES: ReadonlyArray<{ span: number; label: string }> = [
  { span: OVERVIEW_REGION, label: '100' },
  { span: 2 * OVERVIEW_REGION, label: '200' },
  { span: 0, label: 'World' },
];
/** Chunks of the region are refetched after this long (the main map keeps its own, shorter times). */
export const OVERVIEW_STALE_MS = 180_000;
/** The region centre moves in steps of this many fields, so the diamond is redrawn only now and then while the main map pans. */
export const OVERVIEW_STEP = 5;

/** Relation of a whole-world row (GET /api/map/overview) as the map's allegiance. */
export const OVERVIEW_CODE_ALLEGIANCE: readonly MapAllegiance[] = ['abandoned', 'own', 'tribe', 'ally', 'nap', 'enemy', 'neutral'];
export const allegianceOfCode = (c: MapOverviewCode): MapAllegiance => OVERVIEW_CODE_ALLEGIANCE[c] ?? 'neutral';

export interface OverviewPoint {
  x: number;
  y: number;
  a: MapAllegiance;
}

export function countPoints(points: Iterable<OverviewPoint>): OverviewCounts {
  const c: OverviewCounts = { own: 0, tribe: 0, ally: 0, nap: 0, enemy: 0, neutral: 0, abandoned: 0 };
  for (const p of points) c[p.a] += 1;
  return c;
}

/** The region: a world square of `span` fields (the whole world when `span` is 0 or covers it), centred near (cx, cy) but never off the board. */
export interface Region {
  span: number;
  cx: number;
  cy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  whole: boolean;
}

export function regionOf(choice: number, radius: number, viewCx: number, viewCy: number): Region {
  const worldSpan = 2 * radius + 1;
  const span = choice <= 0 || choice >= worldSpan ? worldSpan : choice;
  const whole = span === worldSpan;
  const half = (span - 1) / 2;
  const snap = (v: number) => Math.round(v / OVERVIEW_STEP) * OVERVIEW_STEP;
  const lim = Math.max(0, radius - half);
  const clamp = (v: number) => (whole ? 0 : Math.max(-lim, Math.min(lim, snap(v))));
  const cx = clamp(viewCx);
  const cy = clamp(viewCy);
  const x0 = Math.ceil(cx - half);
  const y0 = Math.ceil(cy - half);
  return { span, cx, cy, x0, y0, x1: x0 + span - 1, y1: y0 + span - 1, whole };
}

/** Extra fields drawn round the region's edge tiles (a tile fills 1 field). Region diamond width in tiles = span. */
export interface DiamondLayout {
  /** Diamond width in px (= the canvas width minus margins). */
  width: number;
  /** Px per field (diamond tile width). */
  tile: number;
  /** Screen centre of the region centre. */
  ox: number;
  oy: number;
}

export function diamondLayout(region: Region, width: number, top: number): DiamondLayout {
  const tile = width / region.span;
  return { width, tile, ox: width / 2, oy: top + width / 4 };
}

/** World point -> overview px (same isometry as the main map: +x runs down-right, +y down-left). */
export function worldToDiamond(l: DiamondLayout, region: Region, wx: number, wy: number): { x: number; y: number } {
  const dx = wx - region.cx;
  const dy = wy - region.cy;
  return { x: l.ox + ((dx - dy) * l.tile) / 2, y: l.oy + ((dx + dy) * l.tile) / 4 };
}

/** Overview px -> the world tile under it, kept on the board. */
export function diamondToWorld(l: DiamondLayout, region: Region, px: number, py: number, radius: number): { x: number; y: number } {
  const a = (px - l.ox) / (l.tile / 2);
  const b = (py - l.oy) / (l.tile / 4);
  const clamp = (n: number) => Math.max(-radius, Math.min(radius, Math.round(n)));
  return { x: clamp(region.cx + (a + b) / 2), y: clamp(region.cy + (b - a) / 2) };
}

/**
 * The main view as an upright rectangle on the overview: both use the same isometry, so the screen rectangle only scales
 * by (overview tile / main tile). A `cross` (just the centre) when the rectangle covers most of the diamond.
 */
export function frameRect(
  l: DiamondLayout,
  region: Region,
  view: View,
  size: Size,
): { kind: 'frame' | 'cross'; x0: number; y0: number; x1: number; y1: number; cx: number; cy: number } {
  const k = l.tile / view.tile;
  const c = worldToDiamond(l, region, view.cx, view.cy);
  const hw = (size.w * k) / 2;
  const hh = (size.h * k) / 2;
  const area = 4 * hw * hh; // unclipped; the diamond itself has an area of width^2 / 4
  return { kind: area > (l.width * l.width * 0.35) / 4 ? 'cross' : 'frame', x0: c.x - hw, y0: c.y - hh, x1: c.x + hw, y1: c.y + hh, cx: c.x, cy: c.y };
}

/** Smallest visible part of the view (px^2 on the board) worth drawing as a frame; below it only the centre cross is shown. */
export const MIN_FRAME_AREA = 140;

export interface ViewShape {
  kind: 'frame' | 'cross';
  /** The view clipped to the board diamond (convex polygon, px); empty for a cross. */
  poly: Array<{ x: number; y: number }>;
  /** Centre of the view, kept on the board (clamped in from the edge when the view centre lies outside the world). */
  cx: number;
  cy: number;
}

/** Keep a point on the diamond (scaled in towards its centre when outside, with a small margin). */
export function clampToDiamond(l: DiamondLayout, x: number, y: number, margin = 4): { x: number; y: number } {
  const hw = l.width / 2 - margin * 2;
  const hh = l.width / 4 - margin;
  const dx = x - l.ox;
  const dy = y - l.oy;
  const q = Math.abs(dx) / hw + Math.abs(dy) / hh;
  return q <= 1 ? { x, y } : { x: l.ox + dx / q, y: l.oy + dy / q };
}

/**
 * The main view on the board: its upright rectangle CLIPPED to the board diamond (Sutherland-Hodgman, so nothing outside the world
 * is ever drawn), or only a centre cross (clamped onto the board) when the view covers most of the board or hardly any of it is inside.
 */
export function viewShape(l: DiamondLayout, region: Region, view: View, size: Size): ViewShape {
  const f = frameRect(l, region, view, size);
  const c = clampToDiamond(l, f.cx, f.cy);
  if (f.kind === 'cross') return { kind: 'cross', poly: [], cx: c.x, cy: c.y };
  let poly: Array<{ x: number; y: number }> = [
    { x: f.x0, y: f.y0 },
    { x: f.x1, y: f.y0 },
    { x: f.x1, y: f.y1 },
    { x: f.x0, y: f.y1 },
  ];
  // Four half-planes of the diamond: |dx| / (w/2) + |dy| / (w/4) <= 1.
  const hw = l.width / 2;
  const hh = l.width / 4;
  const planes: Array<[number, number]> = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [sx, sy] of planes) {
    const inside = (p: { x: number; y: number }) => (sx * (p.x - l.ox)) / hw + (sy * (p.y - l.oy)) / hh <= 1;
    const out: typeof poly = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const ia = inside(a);
      const ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) {
        const da = (sx * (a.x - l.ox)) / hw + (sy * (a.y - l.oy)) / hh - 1;
        const db = (sx * (b.x - l.ox)) / hw + (sy * (b.y - l.oy)) / hh - 1;
        const t = da / (da - db);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    poly = out;
    if (poly.length === 0) break;
  }
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  area = Math.abs(area) / 2;
  if (poly.length < 3 || area < MIN_FRAME_AREA) return { kind: 'cross', poly: [], cx: c.x, cy: c.y };
  return { kind: 'frame', poly, cx: c.x, cy: c.y };
}

/** Token radius in px from the px-per-field scale: small and clear on a 3 px field, never a blob on a 0.4 px one. */
export function tokenRadius(a: MapAllegiance, tile: number): number {
  const base = Math.max(1, Math.min(4.2, tile * 0.62));
  switch (a) {
    case 'own':
      return Math.max(2.6, Math.min(7, base * 1.75));
    case 'abandoned':
      return Math.max(0.8, base * 0.8);
    default:
      return base;
  }
}

/** Tokens get a dark outline when a field is at least this many px wide. */
export const OUTLINE_TILE = 2.2;

/** Terrain patch size in fields: patches of about 2.5 px so the ground reads as soft colour areas, not pixels. */
export function patchSize(span: number, width: number): number {
  return Math.max(1, Math.ceil(2.5 / (width / span)));
}

/** Coordinate tick step (fields) so labels sit at least `minPx` apart along an edge. */
export function tickStep(tile: number, minPx: number): number {
  const steps = [5, 10, 20, 25, 50, 100, 200];
  return steps.find((s) => (s * tile) / Math.SQRT2 >= minPx) ?? 200;
}

/** Fire-site marker half-size in px. */
export function siteHalf(tile: number): number {
  return Math.max(1.8, Math.min(3.4, tile * 0.7));
}

/** Draw order: abandoned and plain players first, relations above them, own villages on top. */
export const OVERVIEW_ORDER: readonly MapAllegiance[] = ['abandoned', 'neutral', 'nap', 'ally', 'tribe', 'enemy', 'own'];

/** Touch area of an edge notch in px (a square; the visible arrow is much smaller). */
export const NOTCH_HIT = 44;
/** The hint under the board. */
export const OVERVIEW_HINT = 'Drag to move · tap to jump';

export interface Notch {
  key: 'up' | 'right' | 'down' | 'left';
  /** Centre of the arrow in canvas px, just outside the board edge. */
  x: number;
  y: number;
  /** Arrow direction in radians (screen). */
  angle: number;
  /** Which way the map moves, as a world step. */
  dx: number;
  dy: number;
}

/**
 * Four small arrow notches, one on each edge of the diamond (replacing the row of big arrow buttons). `rim` is the height of the wooden
 * slab: the two lower notches sit on its lower edge. Edge "up" is the top-right edge (world -y), "right" the bottom-right (+x), "down" the
 * bottom-left (+y), "left" the top-left (-x), so every arrow points the way the map moves on screen.
 */
export function notchSpots(l: DiamondLayout, region: Region, rim: number, gap = 8): Notch[] {
  const e = 0.5;
  const top = worldToDiamond(l, region, region.x0 - e, region.y0 - e);
  const right = worldToDiamond(l, region, region.x1 + e, region.y0 - e);
  const bottom = worldToDiamond(l, region, region.x1 + e, region.y1 + e);
  const left = worldToDiamond(l, region, region.x0 - e, region.y1 + e);
  const s = Math.SQRT1_2;
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }, ox: number, oy: number, down: number) => ({
    x: (a.x + b.x) / 2 + ox * gap,
    y: (a.y + b.y) / 2 + oy * gap + down,
  });
  return [
    { key: 'up', ...mid(top, right, s, -s, 0), angle: -Math.PI / 4, dx: 0, dy: -1 },
    { key: 'right', ...mid(right, bottom, s, s, rim * 0.5), angle: Math.PI / 4, dx: 1, dy: 0 },
    { key: 'down', ...mid(left, bottom, -s, s, rim * 0.5), angle: (3 * Math.PI) / 4, dx: 0, dy: 1 },
    { key: 'left', ...mid(left, top, -s, -s, 0), angle: (-3 * Math.PI) / 4, dx: -1, dy: 0 },
  ];
}
