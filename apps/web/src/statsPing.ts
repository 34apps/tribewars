// The one analytics call of the browser (docs/ANALYTICS.md): "this page was opened for the first time this session".
// The SERVER decides whether anything is sent (tracking on, player not opted out); nothing is stored on this device.

import { useEffect, useRef } from 'react';
import { isStatsPage } from '@clanfire/engine';
import { api } from './api.ts';

/** Tell the server once per page and session. A failed ping is ignored: analytics must never get in the player's way. */
export function usePageOpenPing(page: string): void {
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!isStatsPage(page) || seen.current.has(page)) return;
    seen.current.add(page);
    void api.statsPage(page).catch(() => {});
  }, [page]);
}
