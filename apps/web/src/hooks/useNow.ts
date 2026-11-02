import { useEffect, useState } from 'react';

/** Server-corrected "now" in ms, re-rendered once per second (and when the tab becomes visible). */
export function useNow(serverOffset: number): number {
  const [local, setLocal] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setLocal(Date.now());
    const id = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return local + serverOffset;
}
