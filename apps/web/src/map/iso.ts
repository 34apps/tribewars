// Isometric (2:1 diamond) projection for the world map. Pure math, no drawing.
//
// World tile (x, y) has its centre at world point (x, y). Screen x grows with (x - y), screen y with (x + y):
// +x runs down-right, +y runs down-left, so the board's bottom corner is (+radius, +radius).

import type { Coords } from '@clanfire/engine';

/**
 * Tile width in CSS px (the diamond is half as tall). The real minimum is `fitTile` (whole world fits the map area); MIN_TILE is
 * only the floor before the map area has a size. Below DOT_TILE (zoomMode.ts) villages are drawn as dots.
 */
export const MIN_TILE = 1;
export const MAX_TILE = 160;
export const DEFAULT_TILE = 84;

export interface View {
  /** World point at the centre of the viewport. */
  cx: number;
  cy: number;
  /** Tile (diamond) width in CSS px. */
  tile: number;
}

export interface Size {
  w: number;
  h: number;
}

/**
 * The tile width at which the whole board (with a small margin) fits the map area: the smallest zoom allowed, so the world
 * never floats as a small slab in an empty table. Capped so a tiny world still starts at a sensible size.
 */
export function fitTile(radius: number, size: Size): number {
  if (size.w <= 0 || size.h <= 0) return MIN_TILE;
  const span = 2 * radius + 1;
  const t = Math.min((size.w * 0.94) / span, (size.h * 0.86) / (span / 2));
  return Math.max(MIN_TILE, Math.min(t, DEFAULT_TILE / 2));
}

/** Smallest allowed tile width: "whole world fits" once the map area size is known. */
export function minTile(radius: number, size?: Size): number {
  return size ? fitTile(radius, size) : MIN_TILE;
}

export function clampView(view: View, radius: number, size?: Size): void {
  const lo = minTile(radius, size);
  view.tile = Math.max(lo, Math.min(MAX_TILE, view.tile));
  // Fully zoomed out the board is centred: nothing to pan.
  if (size && view.tile <= lo * 1.001) {
    view.cx = 0;
    view.cy = 0;
    return;
  }
  const lim = radius + 2;
  view.cx = Math.max(-lim, Math.min(lim, view.cx));
  view.cy = Math.max(-lim, Math.min(lim, view.cy));
}

/** World point -> screen (CSS px). */
export function toScreen(view: View, size: Size, wx: number, wy: number): { x: number; y: number } {
  const hw = view.tile / 2;
  const hh = view.tile / 4;
  const dx = wx - view.cx;
  const dy = wy - view.cy;
  return { x: size.w / 2 + (dx - dy) * hw, y: size.h / 2 + (dx + dy) * hh };
}

/** Screen (CSS px) -> continuous world point on the ground plane. */
export function toWorld(view: View, size: Size, px: number, py: number): { x: number; y: number } {
  const a = (px - size.w / 2) / (view.tile / 2);
  const b = (py - size.h / 2) / (view.tile / 4);
  return { x: view.cx + (a + b) / 2, y: view.cy + (b - a) / 2 };
}

/** Ground tile under a screen point, ignoring terrain height. */
export function groundTileAt(view: View, size: Size, px: number, py: number): Coords {
  const w = toWorld(view, size, px, py);
  return { x: Math.round(w.x), y: Math.round(w.y) };
}

/** Move the view by a screen-space drag (CSS px). */
export function panBy(view: View, dxPx: number, dyPx: number): void {
  const a = dxPx / (view.tile / 2);
  const b = dyPx / (view.tile / 4);
  view.cx -= (a + b) / 2;
  view.cy -= (b - a) / 2;
}

/** Zoom so the world point under (px, py) stays under it. */
export function zoomAround(view: View, size: Size, px: number, py: number, nextTile: number, radius: number): void {
  const before = toWorld(view, size, px, py);
  view.tile = Math.max(minTile(radius, size), Math.min(MAX_TILE, nextTile));
  const after = toWorld(view, size, px, py);
  view.cx += before.x - after.x;
  view.cy += before.y - after.y;
  clampView(view, radius, size);
}

/** Bounding box (in tiles) of everything the viewport shows, plus a margin. */
export function visibleTileBounds(view: View, size: Size, margin = 2): { x0: number; y0: number; x1: number; y1: number } {
  const corners = [toWorld(view, size, 0, 0), toWorld(view, size, size.w, 0), toWorld(view, size, 0, size.h), toWorld(view, size, size.w, size.h)];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of corners) {
    x0 = Math.min(x0, c.x);
    y0 = Math.min(y0, c.y);
    x1 = Math.max(x1, c.x);
    y1 = Math.max(y1, c.y);
  }
  return { x0: Math.floor(x0) - margin, y0: Math.floor(y0) - margin, x1: Math.ceil(x1) + margin, y1: Math.ceil(y1) + margin };
}

/** Does the world rectangle [x0..x1] x [y0..y1] (tile indices) touch the viewport (with a pixel margin)? */
export function rectOnScreen(view: View, size: Size, x0: number, y0: number, x1: number, y1: number, marginPx: number): boolean {
  // A world rectangle is a diamond on screen: its extremes are its four corners.
  const a = toScreen(view, size, x0 - 0.5, y0 - 0.5); // top
  const b = toScreen(view, size, x1 + 0.5, y0 - 0.5); // right
  const c = toScreen(view, size, x1 + 0.5, y1 + 0.5); // bottom
  const d = toScreen(view, size, x0 - 0.5, y1 + 0.5); // left
  return !(b.x < -marginPx || d.x > size.w + marginPx || c.y < -marginPx || a.y > size.h + marginPx);
}
