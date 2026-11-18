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

/** Dot radius in CSS px: grows a little with the zoom; own villages are bigger so they pop. */
export function dotRadius(tile: number, own: boolean): number {
  const base = Math.max(2.4, Math.min(5.5, tile * 0.18 + 1.4));
  return own ? base + 1.6 : base;
}

/** Tap radius (CSS px) around a dot: never smaller than a finger-friendly 9 px. */
export function dotHitRadius(radius: number): number {
  return Math.max(9, radius + 3);
}

export function chunkStaleMs(tile: number): number {
  return isDotMode(tile) ? CHUNK_STALE_DOT_MS : CHUNK_STALE_MS;
}
