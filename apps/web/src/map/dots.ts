// Far-zoom village dots: the relation colour from ALLEGIANCE_STYLE, abandoned dark grey, own villages bigger with a white edge.

import type { MapVillageDto } from '@clanfire/engine';
import { ALLEGIANCE_STYLE, allegianceOf } from './allegiance.ts';
import type { MapAllegiance } from './allegiance.ts';
import { dotRadius } from './zoomMode.ts';

export interface VillageDot {
  allegiance: MapAllegiance;
  fill: string;
  /** Outline colour: white for own villages, the toy ink for the rest. */
  edge: string;
  /** Edge width in CSS px. */
  edgeWidth: number;
  radius: number;
  own: boolean;
}

export const DOT_INK = '#2B211C';
export const DOT_OWN_EDGE = '#FFFFFF';

export function villageDot(v: MapVillageDto, tile: number): VillageDot {
  const allegiance = allegianceOf(v);
  const own = allegiance === 'own';
  return {
    allegiance,
    fill: ALLEGIANCE_STYLE[allegiance].ring,
    edge: own ? DOT_OWN_EDGE : DOT_INK,
    edgeWidth: own ? 2 : 1,
    radius: dotRadius(tile, own),
    own,
  };
}
