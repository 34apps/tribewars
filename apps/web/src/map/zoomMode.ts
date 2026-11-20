// Zoom-dependent map decisions as plain numbers and pure functions (no drawing, no art), so they are easy to test.
//
// Zoom bands by tile width (CSS px): below DOT_TILE every village is a coloured dot; from DOT_TILE up the Toy Diorama
// sprites are drawn; the banner cloth shows the tribe tag from BANNER_TAG_MIN_TILE; labels start at LABEL_TILE (render.ts).

/** Below this tile width villages are drawn as dots (no sprites, rings or banners). */
export const DOT_TILE = 30;
/** From this tile width the banner cloth is big enough to read the tribe tag on it (text is ~8 px tall here). */
export const BANNER_TAG_MIN_TILE = 50;

/** Map data goes stale after this long; zoomed far out (dots) the whole world is on screen, so it is re-read less often. */
export const CHUNK_STALE_MS = 30_000;
export const CHUNK_STALE_DOT_MS = 120_000;

export function isDotMode(tile: number): boolean {
  return tile < DOT_TILE;
}

/** Does the banner cloth carry the tribe tag at this zoom? (Only when the owner is in a tribe.) */
export function bannerTagVisible(tile: number, tag: string | null | undefined): boolean {
  return !!tag && tile >= BANNER_TAG_MIN_TILE;
}

/** The `[TAG]` chip in the name label is only needed while the banner does not show the tag. */
export function labelChipVisible(tile: number, tag: string | null | undefined): boolean {
  return !!tag && !bannerTagVisible(tile, tag);
}

/**
 * What a village shows under it on the map (owner 2026-11-20: no coordinates under villages; the tile panel has them).
 * Own village: its name. Others: only the `[TAG]` chip while the banner does not show the tag, otherwise nothing.
 */
export function villageLabelText(own: boolean, name: string, tile: number, tag: string | null | undefined): string | null {
  if (own) return name;
  return labelChipVisible(tile, tag) ? `[${tag}]` : null;
}

/** Dot radius in CSS px: grows with the zoom (3 px on a phone-sized world, ~7 px at the top of the dot range); own villages are clearly the biggest. */
export function dotRadius(tile: number, own: boolean): number {
  const base = Math.max(3, Math.min(7, tile * 0.3 + 1.2));
  return own ? base + 3.5 : base;
}

/** Abandoned villages are drawn smaller (and hollow) so they never read as neutral players. */
export const ABANDONED_DOT_SCALE = 0.78;

/** Banner size against the village art, and the smallest text height (CSS px) the tribe tag may have. */
export const BANNER_K = 1.2;
export const BANNER_TEXT_PX = 12;
export const BANNER_MIN_TEXT_PX = 8;

/** Scale (screen px per SVG px) of the whole banner: follows the tile, but never so small that the tag is below 8 px tall. */
export function bannerScale(tile: number, withTag: boolean): number {
  const k = (tile / 96) * BANNER_K;
  return withTag ? Math.max(k, BANNER_MIN_TEXT_PX / BANNER_TEXT_PX) : k;
}

/** Tap radius (CSS px) around a dot: never smaller than a finger-friendly 9 px. */
export function dotHitRadius(radius: number): number {
  return Math.max(9, radius + 3);
}

export function chunkStaleMs(tile: number): number {
  return isDotMode(tile) ? CHUNK_STALE_DOT_MS : CHUNK_STALE_MS;
}
