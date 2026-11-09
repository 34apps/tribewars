import { useEffect, useState } from 'react';

/** The desktop frame is 900 px tall at minimum and grows with the window (frame.css). A paged list that fits N rows at 900 px shows
 *  this many MORE rows per page for every `rowHeight` px of extra window height, so a tall window never leaves a hole under the list. */
const MIN_FRAME_HEIGHT = 900;

export function useExtraRows(rowHeight: number): number {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? MIN_FRAME_HEIGHT : window.innerHeight));
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return Math.max(0, Math.floor((h - MIN_FRAME_HEIGHT) / rowHeight));
}
