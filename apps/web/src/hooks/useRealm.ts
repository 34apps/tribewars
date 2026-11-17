import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealmResponse } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { pollMs } from './live.ts';
import { useLiveConnected, useLiveTopic } from './useLive.tsx';

const POLL_MS = 10_000;

export interface RealmStore {
  data: RealmResponse | null;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * GET /api/realm when the page opens, every 10 s (60 s while the live socket is up; hints refetch sooner) and on a game hint.
 * Counters between polls are ticked by the page from the server-corrected clock (`now`), not by this hook.
 */
export function useRealm(): RealmStore {
  const [data, setData] = useState<RealmResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const applied = useRef(0);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const my = ++seq.current;
    try {
      const res = await api.realm();
      if (!alive.current || my < applied.current) return;
      applied.current = my;
      setData(res);
      setError(null);
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  const connected = useLiveConnected();
  const every = pollMs(POLL_MS, connected);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, every);
    return () => window.clearInterval(id);
  }, [refresh, every]);

  useLiveTopic(['game'], () => void refresh());
  return { data, error, refresh };
}
