import { useEffect, useRef } from 'react';
import { TIME_JUMP_EVENT } from './live.ts';

/** Runs `cb` when game time jumped (the preview's skip control; see TIME_JUMP_EVENT). For polls that no live topic covers. */
export function useTimeJump(cb: () => void): void {
  const latest = useRef(cb);
  useEffect(() => {
    latest.current = cb;
  }, [cb]);
  useEffect(() => {
    const on = () => latest.current();
    window.addEventListener(TIME_JUMP_EVENT, on);
    return () => window.removeEventListener(TIME_JUMP_EVENT, on);
  }, []);
}
