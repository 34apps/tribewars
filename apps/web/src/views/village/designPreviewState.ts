// Design preview (test mode only): shows every building at one chosen level in the village scene. Client-only; nothing
// is sent to the server. The on/off switch is remembered in localStorage; the level is not.

import { useSyncExternalStore } from 'react';

const KEY = 'clanfire.designPreview';
export const PREVIEW_MAX_LEVEL = 20;

function readOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let state = { on: readOn(), level: 1 };
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
  const next = Math.max(0, Math.min(PREVIEW_MAX_LEVEL, Math.round(level)));
  if (next === state.level) return;
  state = { ...state, level: next };
  emit();
}

export function useDesignPreview(): { on: boolean; level: number } {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
