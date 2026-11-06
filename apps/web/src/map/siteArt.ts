// Shared drawing data for the Waymark and the Lookout (Toy Diorama: ink outlines, warm wood, grey stone). One list of SVG
// path ops per kind, used by the canvas map (render.ts, via Path2D) and the SVG glyph (SiteGlyph.tsx), so both match.
// Coordinates are in tile-centre px like the shrine art: base at (0, 0), top near y = -76.

export interface ArtOp {
  d: string;
  /** Fill colour; none when absent. */
  fill?: string;
  /** Stroke colour (default ink); 'none' for no outline. */
  stroke?: string;
  /** Stroke width (default 3). */
  sw?: number;
}

const WOOD = '#A9743F';
const WOOD_LO = '#8A5E36';
const WOOD_DK = '#6B4527';
const PLANK = '#D9A25B';
const STONE = '#BDB5A6';
const STONE_HI = '#D8D1C2';
const STONE_LO = '#8E8678';
const SUN = '#F2B33D';

/** Carved signpost on a small stone cairn: two arrow boards and a tiny pennant. */
export const WAYMARK_ART: readonly ArtOp[] = [
  { d: 'M-23 -2Q-25 -14 -14 -17L14 -17Q25 -14 23 -2Q0 7 -23 -2Z', fill: STONE_LO },
  { d: 'M-14 -17Q-15 -27 -6 -29L8 -29Q16 -27 14 -17Z', fill: STONE },
  { d: 'M-7 -29Q-7 -35 0 -36Q7 -35 7 -29Z', fill: STONE_HI },
  { d: 'M-3.2 -34L-3.2 -68L3.2 -68L3.2 -34Z', fill: WOOD },
  { d: 'M-10 -64L12 -64L20 -58.5L12 -53L-10 -53Z', fill: PLANK },
  { d: 'M10 -50L-12 -50L-20 -44.5L-12 -39L10 -39Z', fill: '#C58A47' },
  { d: 'M-6 -58.5L8 -58.5M-8 -44.5L6 -44.5', stroke: WOOD_DK, sw: 1.6 },
  { d: 'M0 -68L0 -77', sw: 2.4 },
  { d: 'M0 -77L12 -73L0 -69Z', fill: '#E0703F', sw: 2 },
];

/** Small wooden watchtower on four stilts with a ladder, a lantern under the eave and a flag on the roof. */
export const LOOKOUT_ART: readonly ArtOp[] = [
  { d: 'M-10 -31L-13 -6L-9 -6L-6 -31Z', fill: WOOD_DK, sw: 2.4 },
  { d: 'M10 -31L13 -6L9 -6L6 -31Z', fill: WOOD_DK, sw: 2.4 },
  { d: 'M-17 -31L-23 0L-18 0L-12 -31Z', fill: WOOD_LO },
  { d: 'M17 -31L23 0L18 0L12 -31Z', fill: WOOD_LO },
  { d: 'M-22 -14L22 -14L22 -10L-22 -10Z', fill: WOOD_LO, sw: 2.4 },
  { d: 'M-5 -2L-3 -31M5 -2L3 -31', sw: 2.6 },
  { d: 'M-4.4 -9L4.4 -9M-4.1 -16L4.1 -16M-3.8 -23L3.8 -23', sw: 2 },
  { d: 'M-25 -36L25 -36L25 -31L-25 -31Z', fill: WOOD },
  { d: 'M-16 -36L-16 -52L16 -52L16 -36Z', fill: PLANK },
  { d: 'M-6 -48L6 -48L6 -41L-6 -41Z', fill: '#3E3028', sw: 2.4 },
  { d: 'M-21 -52L0 -66L21 -52Z', fill: '#C4623A' },
  { d: 'M0 -66L0 -76', sw: 2.4 },
  { d: 'M0 -76L11 -72L0 -68Z', fill: SUN, sw: 2 },
  { d: 'M17.5 -51L17.5 -47', sw: 1.8 },
  { d: 'M14.4 -43.6a3.1 3.1 0 1 0 6.2 0a3.1 3.1 0 1 0 -6.2 0Z', fill: SUN, sw: 2 },
];

export const UTILITY_ART: Record<'waymark' | 'lookout', readonly ArtOp[]> = { waymark: WAYMARK_ART, lookout: LOOKOUT_ART };
