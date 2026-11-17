import { useCallback, useRef } from 'react';
import type { ReportSummaryDto } from '@clanfire/engine';
import { useGame } from '../game.ts';
import { useSync } from './useSync.ts';

/**
 * Opening an unread report: the server marks it read, the client counts it down locally instead of refetching the state and the
 * whole list. `ownChange(n)` tells the list effect that the unread count `n` is our own local step (the list row is already marked).
 * The list reloads on the live "reports" hint, when the page opens, and when the count changes for any other reason.
 */
export function useReportRead(list: ReportSummaryDto[] | null) {
  const { unreadReports, applyReportRead } = useGame();
  const sync = useSync();
  const cur = useRef({ list, unreadReports, applyReportRead, sync });
  cur.current = { list, unreadReports, applyReportRead, sync };
  const expected = useRef<number | null>(null);

  const ownChange = useCallback((n: number) => {
    if (expected.current !== n) return false;
    expected.current = null;
    return true;
  }, []);

  const opened = useCallback((id: number) => {
    const c = cur.current;
    if (c.unreadReports > 0 && c.list?.find((r) => r.id === id)?.read === false) {
      expected.current = c.unreadReports - 1;
      c.applyReportRead();
    }
    // The First steps card has a "read a report" step: only the state says it is done, so refetch while that card is open.
    c.sync(true);
  }, []);

  return { ownChange, opened };
}
