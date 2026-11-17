import { startTransition, useEffect, useState } from 'react';
import { ticksDeferred } from './tickLane.ts';

/** Server-corrected "now" in ms, re-rendered once per second (and when the tab becomes visible). */
export function useNow(serverOffset: number): number {
  const [local, setLocal] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => {
      if (document.hidden) return; // nothing to redraw in a hidden tab; the visibilitychange below catches up
      if (ticksDeferred()) startTransition(() => setLocal(Date.now()));
      else setLocal(Date.now());
    };
    const id = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return local + serverOffset;
}
