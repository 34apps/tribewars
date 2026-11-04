// Design preview (test mode only): steps the wall ("All buildings") or one picked building through its levels in the village
// scene. Client-only; nothing is sent to the server. The on/off switch is remembered in localStorage; level and building are not.

import { useSyncExternalStore } from 'react';
import { BUILDINGS } from '@clanfire/engine';
import type { BuildingId } from '@clanfire/engine';
import type { LandscapeChoice } from '../../art/landscapes.tsx';

const KEY = 'clanfire.designPreview';
export const PREVIEW_MAX_LEVEL = 20;

function readOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** The building being stepped alone, or null for "All buildings" (today's wall-only preview). */
export type PreviewBuilding = BuildingId | null;

/** Lowest and highest level the slider offers: "All buildings" runs 0..20 (wall look); one building runs 1..its max. */
export function previewRange(building: PreviewBuilding): { min: number; max: number } {
  return building ? { min: 1, max: BUILDINGS[building].maxLevel } : { min: 0, max: PREVIEW_MAX_LEVEL };
}

/** Landscape outside the walls: map tiles (default, chosen by the owner), the drawn one, or the options A, B, C. */
export type { LandscapeChoice };
export const LANDSCAPE_CHOICES: readonly { id: LandscapeChoice; label: string }[] = [
  { id: 'tiles', label: 'Map tiles (default)' },
  { id: 'current', label: 'Drawn' },
  { id: 'A', label: 'A · River valley' },
  { id: 'B', label: 'B · Farmland' },
  { id: 'C', label: 'C · Forest and hills' },
];

let state: { on: boolean; level: number; building: PreviewBuilding; landscape: LandscapeChoice } = {
  on: readOn(),
  level: 1,
  building: null,
  landscape: 'tiles',
};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setDesignPreview(on: boolean): void {
  state = { ...state, on };
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the switch just lasts for this page */
  }
  emit();
}

export function setPreviewLevel(level: number): void {
  const { min, max } = previewRange(state.building);
  const next = Math.max(min, Math.min(max, Math.round(level)));
  if (next === state.level) return;
  state = { ...state, level: next };
  emit();
}

/** Pick the building to step alone (null = All buildings). The level is kept, clamped to that building's range. */
export function setPreviewBuilding(building: PreviewBuilding): void {
  if (building === state.building) return;
  const { min, max } = previewRange(building);
  state = { ...state, building, level: Math.max(min, Math.min(max, state.level)) };
  emit();
}

export function setPreviewLandscape(landscape: LandscapeChoice): void {
  if (landscape === state.landscape) return;
  state = { ...state, landscape };
  emit();
}

export function useDesignPreview(): { on: boolean; level: number; building: PreviewBuilding; landscape: LandscapeChoice } {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
