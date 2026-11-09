// Tells the frame (FrameShell) whether the Tribe page is a fixed 900 px page (Overview, Members) or a growing one (the other
// sub-tabs, the finder, a public tribe page). A tiny external store so the shell and the page need no shared parent state.

import { useSyncExternalStore } from 'react';

let fixed = false;
const listeners = new Set<() => void>();

export function setTribeFixed(next: boolean): void {
  if (fixed === next) return;
  fixed = next;
  listeners.forEach((l) => l());
}

export function useTribeFixed(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    () => fixed,
    () => false,
  );
}
