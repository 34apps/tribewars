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

/** Square size in px: own villages clearly the biggest, relation colours next, plain others, abandoned small. */
export function squareSize(a: MapAllegiance, scale: number): number {
  const base = Math.max(3, Math.min(5, scale * 1.4));
  switch (a) {
    case 'own':
      return base + 4;
    case 'abandoned':
      return Math.max(2, base * 0.6);
    case 'neutral':
      return base;
    default:
      return base + 1;
  }
}

/** Draw order: abandoned and plain players first, relations above them, own villages on top. */
export const OVERVIEW_ORDER: readonly MapAllegiance[] = ['abandoned', 'neutral', 'nap', 'ally', 'tribe', 'enemy', 'own'];

/** The main map's viewport as four world points (top, right, bottom, left corner on screen), for the frame on the overview. */
export function frameCorners(view: View, size: Size): Array<{ x: number; y: number }> {
  return [toWorld(view, size, 0, 0), toWorld(view, size, size.w, 0), toWorld(view, size, size.w, size.h), toWorld(view, size, 0, size.h)];
}
