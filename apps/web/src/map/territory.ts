// Territory map (the 200 x 200 and whole-world overview): the world cut into square cells, each tinted by the relation that holds the
// most player villages in it, with a hatch for abandoned villages. Pure counting and geometry, no drawing. The cells are computed once
// per data refresh (not per frame) and the board is cached as an offscreen canvas by the component.

import type { MapAllegiance } from './allegiance.ts';
import type { OverviewPoint } from './overview.ts';

/** Cell size in fields: the one place it lives. About 8 fields on the whole world, about 4 on the 200 x 200 region (on a large board). */
export const CELL_FIELDS = { whole: 8, wide: 4 } as const;
/** A cell diamond is never narrower than this many px: on a small board (the side panel, a phone) the cells grow instead of becoming a smear. */
export const MIN_CELL_PX = { whole: 6.5, wide: 10 } as const;

/** Fields per cell side for a region of `span` fields drawn `width` px wide (the whole world when `whole`). */
export function cellSize(span: number, width: number, whole: boolean): number {
  const key = whole ? 'whole' : 'wide';
  const tile = width / span;
  return Math.max(CELL_FIELDS[key], Math.ceil(MIN_CELL_PX[key] / Math.max(tile, 0.01)));
}

/** The relations that tint a cell. Own villages count as the tribe's (they are the viewer's own side). */
export type TintRelation = 'tribe' | 'ally' | 'nap' | 'enemy' | 'neutral';
/** Tie order: the relation that matters most for the viewer wins an equal count. */
export const TINT_PRIORITY: readonly TintRelation[] = ['enemy', 'tribe', 'ally', 'nap', 'neutral'];

export interface Cell {
  /** Cell index along x / y (absolute: field -radius is the start of cell 0). */
  i: number;
  j: number;
  /** Player villages per relation (own counted as tribe). */
  rel: Record<TintRelation, number>;
  /** All player villages, abandoned excluded. */
  players: number;
  abandoned: number;
  own: number;
  /** Tint of the cell, or null when no player village is in it (plain ground). */
  tint: TintRelation | null;
}

export interface CellGrid {
  size: number;
  radius: number;
  cells: Cell[];
  byKey: Map<number, Cell>;
}

const KEY = 65536;
export const cellKey = (i: number, j: number) => i * KEY + j;

/** The relation holding the most villages (ties by TINT_PRIORITY), or null for an empty count. */
export function majorityRelation(rel: Record<TintRelation, number>): TintRelation | null {
  let best: TintRelation | null = null;
  let top = 0;
  for (const r of TINT_PRIORITY) {
    if (rel[r] > top) {
      top = rel[r];
      best = r;
    }
  }
  return best;
}

export function buildCells(points: Iterable<OverviewPoint>, size: number, radius: number): CellGrid {
  const byKey = new Map<number, Cell>();
  for (const p of points) {
    const i = Math.floor((p.x + radius) / size);
    const j = Math.floor((p.y + radius) / size);
    const k = cellKey(i, j);
    let c = byKey.get(k);
    if (!c) {
      c = { i, j, rel: { tribe: 0, ally: 0, nap: 0, enemy: 0, neutral: 0 }, players: 0, abandoned: 0, own: 0, tint: null };
      byKey.set(k, c);
    }
    if (p.a === 'abandoned') c.abandoned += 1;
    else {
      c.rel[p.a === 'own' ? 'tribe' : p.a] += 1;
      c.players += 1;
      if (p.a === 'own') c.own += 1;
    }
  }
  const cells = [...byKey.values()];
  for (const c of cells) c.tint = majorityRelation(c.rel);
  return { size, radius, cells, byKey };
}

/** Abandoned villages a cell needs before it is hatched: a low threshold (1 on fine cells, 2 on coarse ones) so they stay visible on the whole world. */
export function hatchMin(size: number): number {
  return size <= 6 ? 1 : 2;
}

/** Hatch density 0 (none) to 3 (dense): follows the abandoned count, from the low threshold `hatchMin` upwards. */
export function hatchLevel(count: number, size: number): 0 | 1 | 2 | 3 {
  const m = hatchMin(size);
  if (count < m) return 0;
  return Math.min(3, Math.floor(count / m)) as 1 | 2 | 3;
}

/** Cells on the 200 region show their abandoned count from this many villages. */
export const COUNT_MIN = 3;
/** Count numbers only where the cells are fine (about 4 fields); on the whole world they would be unreadable. */
export const COUNT_MAX_SIZE = 8;
export const showsCount = (count: number, size: number): boolean => size <= COUNT_MAX_SIZE && count >= COUNT_MIN;

/** Tint opacity: a lone village is a pale wash, a busy cell is strong; plain "others" stay lighter than the relation colours. */
export function tintAlpha(tint: TintRelation, players: number): number {
  return tint === 'neutral' ? Math.min(0.5, 0.26 + 0.06 * players) : Math.min(0.9, 0.5 + 0.12 * players);
}

/** Cell border sides (0 top, 1 right, 2 bottom, 3 left in world axes) whose neighbour has a different tint: the soft area outline. */
export function borderSides(grid: CellGrid, c: Cell): number[] {
  const out: number[] = [];
  const nb: Array<[number, number]> = [
    [c.i, c.j - 1],
    [c.i + 1, c.j],
    [c.i, c.j + 1],
    [c.i - 1, c.j],
  ];
  nb.forEach(([i, j], side) => {
    if (grid.byKey.get(cellKey(i, j))?.tint !== c.tint) out.push(side);
  });
  return out;
}

/** Relations that get an outline (the "others" wash stays borderless). */
export const BORDERED: readonly TintRelation[] = ['tribe', 'ally', 'nap', 'enemy'];
export const tintOf = (a: MapAllegiance): TintRelation | null => (a === 'abandoned' ? null : a === 'own' ? 'tribe' : a);

/** The player's own villages: drawn as gold pins on top of the cells (never hidden by a tint or a hatch). */
export const ownPins = (points: Iterable<OverviewPoint>): OverviewPoint[] => [...points].filter((p) => p.a === 'own');
