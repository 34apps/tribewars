import { useCallback, useEffect, useRef, useState } from 'react';
import type { LookoutSightingDto } from '@clanfire/engine';
import { api } from '../api.ts';

const POLL_MS = 30_000;
const NONE: readonly LookoutSightingDto[] = [];

export interface SightingsStore {
  /** Enemy armies my tribe's Lookouts see, soonest arrival first. */
  sightings: readonly LookoutSightingDto[];
  /** How many Lookouts the tribe holds. */
  lookouts: number;
  /** The first answer has arrived (or failed). */
  loaded: boolean;
}

/**
 * GET /api/tribe/sightings on open and every 30 s while visible; only when `enabled` (the player is in a tribe).
 * Errors are ignored quietly: the last good answer stays (nothing at first).
 */
export function useSightings(enabled: boolean): SightingsStore {
  const [data, setData] = useState<{ sightings: readonly LookoutSightingDto[]; lookouts: number }>({ sightings: NONE, lookouts: 0 });
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await api.sightings();
      if (!alive.current) return;
      const list = Array.isArray(res.sightings) ? [...res.sightings].sort((a, b) => a.arriveAt - b.arriveAt) : NONE;
      setData({ sightings: list, lookouts: res.lookouts ?? 0 });
    } catch {
      // No route on an older server, or a hiccup: keep what we have.
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setData((d) => (d.sightings.length === 0 && d.lookouts === 0 ? d : { sightings: NONE, lookouts: 0 }));
      return;
    }
    void load();
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [enabled, load]);

  return { ...data, loaded };
}
