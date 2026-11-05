import { useCallback, useEffect, useRef, useState } from 'react';
import type { DominationStatusDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { pollMs } from './live.ts';
import { useLiveConnected, useLiveTopic } from './useLive.tsx';

/** The bar changes slowly (the server settles it every few minutes), so one poll a minute is plenty. */
const POLL_MS = 60_000;

export interface DominationStore {
  status: DominationStatusDto | null;
  error: string | null;
  reload: () => void;
}

/**
 * GET /api/domination on open, every minute while visible, on window focus, and on the live hints 'game' and 'world'.
 * `enabled: false` pauses it (a bar that is off screen).
 */
export function useDomination(enabled = true): DominationStore {
  const [status, setStatus] = useState<DominationStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const applied = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const res = await api.domination();
      if (my < applied.current) return;
      applied.current = my;
      setStatus(res);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  const pollEvery = pollMs(POLL_MS, useLiveConnected());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, pollEvery);
    const wake = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [enabled, load, pollEvery]);

  useLiveTopic(['game', 'world'], () => {
    if (enabled) void load();
  });

  return { status, error, reload: () => void load() };
}
