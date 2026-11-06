import { useCallback, useEffect, useRef, useState } from 'react';
import type { SiteDto, SitesResponse } from '@clanfire/engine';
import { api } from '../api.ts';
import { pollMs } from './live.ts';
import { publishSites } from './useWaymarks.ts';
import { useLiveConnected, useLiveTopic } from './useLive.tsx';

const POLL_MS = 30_000; // 60 s while live updates are connected

const NONE: SitesResponse = { sites: [], wakesAt: 0, myBonus: 0 };

export interface SitesStore extends SitesResponse {
  /** The first answer (or failure) has arrived. */
  loaded: boolean;
  reload: () => void;
}

/**
 * GET /api/sites on open, every 30 s (60 s with live updates) while visible, and on the live hints 'game' and 'tribe'.
 * A failing call (404 on an older server, a hiccup) means "no sites": the map and the tribe page work without them and
 * the last good answer is kept through a hiccup. `enabled: false` pauses it.
 */
export function useSites(enabled = true): SitesStore {
  const [data, setData] = useState<SitesResponse>(NONE);
  const [loaded, setLoaded] = useState(false);
  const seq = useRef(0);
  const applied = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const res = await api.sites();
      if (my < applied.current) return;
      applied.current = my;
      const list = Array.isArray(res.sites) ? (res.sites as SiteDto[]) : [];
      publishSites(list);
      setData({ sites: list, wakesAt: res.wakesAt ?? 0, myBonus: res.myBonus ?? 0 });
    } catch {
      // No sites route yet, or a hiccup: keep what we have (nothing at first).
    } finally {
      setLoaded(true);
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
    return () => window.clearInterval(id);
  }, [enabled, load, pollEvery]);

  useLiveTopic(['game', 'tribe'], () => {
    if (enabled) void load();
  });

  return { ...data, loaded, reload: () => void load() };
}
