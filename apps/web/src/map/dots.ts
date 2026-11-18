// Far-zoom village dots: saturated relation colours, a pale stone for neutral players, abandoned villages small and hollow,
// own villages clearly the biggest (gold with a white ring).

import type { MapVillageDto } from '@clanfire/engine';
import { allegianceOf } from './allegiance.ts';
import type { MapAllegiance } from './allegiance.ts';
import { ABANDONED_DOT_SCALE, dotRadius } from './zoomMode.ts';

export interface VillageDot {
  allegiance: MapAllegiance;
  /** Fill colour (hollow dots: the ring colour). */
  fill: string;
  /** Hollow ring (abandoned): the terrain shows through. */
  hollow: boolean;
  /** Inner edge colour: white for own villages, the toy ink for the rest. */
  edge: string;
  /** Edge width in CSS px. */
  edgeWidth: number;
  radius: number;
  own: boolean;
}

export const DOT_INK = '#2B211C';
export const DOT_OWN_EDGE = '#FFFFFF';
/** Pale halo round every dot so a green dot stays visible on green ground. */
export const DOT_HALO = 'rgba(255, 248, 232, 0.92)';

/** One strong palette for the far-zoom dots and the world overview: every relation clearly apart, neutral a plain tan. */
export const STRONG_COLOR: Record<MapAllegiance, string> = {
  own: '#FFC21A',
  tribe: '#22A83A',
  ally: '#13A7D0',
  nap: '#D6479E',
  enemy: '#E5352B',
  neutral: '#BDAE8E',
  abandoned: '#4A4640',
};

export function dotFill(a: MapAllegiance): string {
  return STRONG_COLOR[a];
}

export function villageDot(v: MapVillageDto, tile: number): VillageDot {
  const allegiance = allegianceOf(v);
  const own = allegiance === 'own';
  const abandoned = allegiance === 'abandoned';
  return {
    allegiance,
    fill: dotFill(allegiance),
    hollow: abandoned,
    edge: own ? DOT_OWN_EDGE : DOT_INK,
    edgeWidth: own ? 2.4 : 1.2,
    radius: dotRadius(tile, own) * (abandoned ? ABANDONED_DOT_SCALE : 1),
    own,
  };
}
