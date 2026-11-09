import { useLayoutEffect, useState } from 'react';

/** Pixels from the top of the floating bottom dock to the bottom of the window (what a full-bleed screen must keep clear). */
export function useDockSpace(fallback = 96): number {
  const [space, setSpace] = useState(fallback);
  useLayoutEffect(() => {
    const dock = document.querySelector('.dock');
    const measure = () => {
      if (dock) setSpace(Math.max(0, Math.round(window.innerHeight - dock.getBoundingClientRect().top)));
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = dock && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (dock) ro?.observe(dock);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, []);
  return space;
}
