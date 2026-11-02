// Who a map village belongs to, from the viewer's side: banner, ring colour/pattern and words.
// Banner shape + ring pattern + colour together, so nothing relies on colour alone (MapVillageStages design).

import { MAP_STAGE_MIN_POINTS, MAP_STAGE_NAMES, mapStage, ruinStage } from '@clanfire/engine';
import type { MapVillageDto } from '@clanfire/engine';
import { RUIN_FILES, RUIN_NAMES, STAGE_FILES } from './sprites.ts';
import type { Allegiance } from './sprites.ts';

export type MapAllegiance = Allegiance | 'abandoned';

interface Style {
  /** Ring colour around the village footprint. */
  ring: string;
  /** Canvas dash pattern (SVG px at map scale); empty = solid. */
  dash: readonly number[];
  /** Short word for the legend. */
  label: string;
  /** How the panel describes the owner. */
  words: string;
  /** Banner description. */
  banner: string;
}

export const ALLEGIANCE_STYLE: Record<MapAllegiance, Style> = {
  own: { ring: '#F2B33D', dash: [], label: 'Own', words: 'Your village', banner: 'Swallowtail with a flame' },
  tribe: { ring: '#5E8C3A', dash: [], label: 'Tribe', words: 'Your tribe', banner: 'Square with a chevron' },
  ally: { ring: '#2F9AA0', dash: [], label: 'Ally', words: 'Ally', banner: 'Long pennant' },
  nap: { ring: '#B86C92', dash: [9, 5], label: 'NAP', words: 'Non-aggression pact', banner: 'Round tongue, dashed ring' },
  enemy: { ring: '#C4623A', dash: [], label: 'Enemy', words: 'Enemy', banner: 'Hanging war banner' },
  neutral: { ring: '#A39E94', dash: [3, 5], label: 'Neutral', words: 'Neutral', banner: 'Lozenge sign, dotted ring' },
  abandoned: { ring: '#6E675E', dash: [6, 6], label: 'Abandoned', words: 'Abandoned', banner: 'No banner, grey dashed ring' },
};

export function allegianceOf(v: MapVillageDto): MapAllegiance {
  if (v.kind === 'own') return 'own';
  if (v.kind === 'abandoned') return 'abandoned';
  switch (v.relation) {
    case 'self':
      return 'own';
    case 'tribe':
    case 'ally':
    case 'nap':
    case 'enemy':
      return v.relation;
    default:
      return 'neutral';
  }
}

/** Sprite file for a village: growth stage for players, ruin for abandoned villages. */
export function villageSprite(v: MapVillageDto): string {
  if (v.kind === 'abandoned') return RUIN_FILES[ruinStage(v.points) - 1] ?? RUIN_FILES[0];
  return STAGE_FILES[mapStage(v.points) - 1] ?? STAGE_FILES[0];
}

/** "Stockade town" / "Ruined fort". */
export function stageName(v: MapVillageDto): string {
  if (v.kind === 'abandoned') return RUIN_NAMES[ruinStage(v.points) - 1] ?? RUIN_NAMES[0];
  return MAP_STAGE_NAMES[mapStage(v.points) - 1] ?? MAP_STAGE_NAMES[0];
}

/** "0–14 pts", "150+ pts" for stage index 0..5. */
export function stageRange(i: number): string {
  const lo = MAP_STAGE_MIN_POINTS[i] ?? 0;
  const next = MAP_STAGE_MIN_POINTS[i + 1];
  return next === undefined ? `${lo}+ pts` : `${lo}–${next - 1} pts`;
}
