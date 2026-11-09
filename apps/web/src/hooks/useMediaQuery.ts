import { useSyncExternalStore } from 'react';

/** True while the CSS media query matches; re-renders when it flips. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Lobby phone layout (launcher style): below 900 px. From 900 px the desktop lobby layouts are used. */
export const PHONE_QUERY = '(max-width: 899px)';
