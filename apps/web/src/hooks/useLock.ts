import { useCallback, useRef, useState } from 'react';

/**
 * A press guard for one action button. `busy` (state) greys the button on the next render; `begin()` is the synchronous guard:
 * it reads a ref, so a second press in the same tick (double click, two taps before React re-renders) is refused
 * instead of sending a second request. Call `end()` in a `finally`.
 */
export function useLock(): { busy: boolean; begin: () => boolean; end: () => void } {
  const held = useRef(false);
  const [busy, setBusy] = useState(false);
  const begin = useCallback(() => {
    if (held.current) return false;
    held.current = true;
    setBusy(true);
    return true;
  }, []);
  const end = useCallback(() => {
    held.current = false;
    setBusy(false);
  }, []);
  return { busy, begin, end };
}
