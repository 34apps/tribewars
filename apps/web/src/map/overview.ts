// World overview (flat top-down minimap): pure geometry and counting, no drawing.

import type { MapVillageDto } from '@clanfire/engine';
import { allegianceOf } from './allegiance.ts';
import type { MapAllegiance } from './allegiance.ts';
import { toWorld } from './iso.ts';
import type { Size, View } from './iso.ts';

/** Legend order and words: the owner's "Your villages · Tribe · Allies · Pact · Enemies · Others · Abandoned". */
export const OVERVIEW_ROWS: ReadonlyArray<{ key: MapAllegiance; label: string }> = [
  { key: 'own', label: 'Your villages' },
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

/** CSS px per world tile when the 2R+1 tile board fills `px`. */
export function overviewScale(radius: number, px: number): number {
  return px / (2 * radius + 1);
}

/** World tile centre -> overview px (x right, y down). */
export function worldToOverview(x: number, y: number, radius: number, px: number): { x: number; y: number } {
  const sc = overviewScale(radius, px);
  return { x: (x + radius + 0.5) * sc, y: (y + radius + 0.5) * sc };
}

/** Overview px -> the world tile under it, kept on the board. */
export function overviewToWorld(ox: number, oy: number, radius: number, px: number): { x: number; y: number } {
  const sc = overviewScale(radius, px);
  const clamp = (n: number) => Math.max(-radius, Math.min(radius, Math.floor(n / sc) - radius));
  return { x: clamp(ox), y: clamp(oy) };
}

/**
 * Square size in px, from the world scale (`scale` = overview px per tile): about one tile each, never under 2 px, so
 * neighbours stay apart. Own villages are 1.5x (thin white edge drawn by the caller), abandoned ones the smallest.
 * Readable at radius 30 (~5 px per tile, capped at 6) and radius 300 (~0.5 px per tile, floor of 2 px).
 */
export function squareSize(a: MapAllegiance, scale: number): number {
  const base = Math.max(2, Math.min(6, scale));
  switch (a) {
    case 'own':
      return Math.max(3, base * 1.5);
    case 'abandoned':
      return Math.max(2, base * 0.7);
    default:
      return base;
  }
}

/** Fire-site marker half-size in px: tiny, and smaller still on huge worlds. */
export function siteHalf(scale: number): number {
  return Math.max(1.5, Math.min(3, scale * 0.6));
}

/**
 * How to show the main view on the overview: a thin frame, or (when the view covers a big part of the world, so the
 * frame would be huge) only a small crosshair at the view centre.
 */
export function frameShape(corners: ReadonlyArray<{ x: number; y: number }>, px: number): { kind: 'frame' | 'cross'; cx: number; cy: number } {
  let area = 0;
  let cx = 0;
  let cy = 0;
  corners.forEach((p, i) => {
    const q = corners[(i + 1) % corners.length]!;
    area += p.x * q.y - q.x * p.y;
    cx += p.x / corners.length;
    cy += p.y / corners.length;
  });
  return { kind: Math.abs(area) / 2 > px * px * 0.35 ? 'cross' : 'frame', cx, cy };
}

/** Draw order: abandoned and plain players first, relations above them, own villages on top. */
export const OVERVIEW_ORDER: readonly MapAllegiance[] = ['abandoned', 'neutral', 'nap', 'ally', 'tribe', 'enemy', 'own'];

/** The main map's viewport as four world points (top, right, bottom, left corner on screen), for the frame on the overview. */
export function frameCorners(view: View, size: Size): Array<{ x: number; y: number }> {
  return [toWorld(view, size, 0, 0), toWorld(view, size, size.w, 0), toWorld(view, size, size.w, size.h), toWorld(view, size, 0, size.h)];
}
