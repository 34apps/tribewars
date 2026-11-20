import { useEffect, useRef, useState } from 'react';
import { MAP_OVERVIEW_REFRESH_MS } from '@clanfire/engine';
import { api } from '../api.ts';
import { TIME_JUMP_EVENT } from './live.ts';
import { allegianceOfCode } from '../map/overview.ts';
import type { OverviewPoint } from '../map/overview.ts';

const CHECK_MS = 15_000;

/**
 * Premium overview rows (GET /api/map/overview): one light request for the whole world instead of every map chunk. Loaded when
 * `enabled` turns on and then at most every MAP_OVERVIEW_REFRESH_MS (5 minutes), and only while `enabled` (the Map tab is shown,
 * the overview is on a wide size) and the page is visible. A failure keeps the last rows and tries again after the next period.
 */
export function useOverviewRows(enabled: boolean): { rows: OverviewPoint[] | null; failed: boolean } {
  const [rows, setRows] = useState<OverviewPoint[] | null>(null);
  const [failed, setFailed] = useState(false);
  const lastTry = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    let dead = false;
    const load = () => {
      lastTry.current = Date.now();
      api.mapOverview().then(
        (res) => {
          if (dead) return;
          setRows(res.villages.map(([x, y, c]) => ({ x, y, a: allegianceOfCode(c) })));
          setFailed(false);
        },
        () => !dead && setFailed(true),
      );
    };
    const due = () => !document.hidden && Date.now() - lastTry.current >= MAP_OVERVIEW_REFRESH_MS;
    if (due()) load();
    const id = window.setInterval(() => due() && load(), CHECK_MS);
    const onVisible = () => due() && load();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(TIME_JUMP_EVENT, load);
    return () => {
      dead = true;
      window.removeEventListener(TIME_JUMP_EVENT, load);
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
  return { rows, failed };
}
