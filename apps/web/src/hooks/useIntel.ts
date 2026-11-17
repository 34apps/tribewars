import { useEffect, useState } from 'react';
import { worldPrefixOf } from '@clanfire/engine';
import type { VillageIntelDto } from '@clanfire/engine';
import { api } from '../api.ts';

/** How long an answer is reused for the same village (the form is opened and closed often; reports rarely change). */
export const INTEL_TTL_MS = 60_000;

interface Cached {
  at: number;
  dto: VillageIntelDto;
}

const cache = new Map<string, Cached>();

/** The cache key: the world's path prefix keeps two worlds apart, the village id is the rest. */
const keyOf = (villageId: number): string => `${typeof window === 'undefined' ? '' : worldPrefixOf(window.location.pathname)}#${villageId}`;

/** A fresh cached answer, or null. Exported for tests. */
export function cachedIntel(villageId: number, now = Date.now()): VillageIntelDto | null {
  const hit = cache.get(keyOf(villageId));
  return hit && now - hit.at < INTEL_TTL_MS ? hit.dto : null;
}

export function clearIntelCache(): void {
  cache.clear();
}

export interface IntelState {
  intel: VillageIntelDto | null;
  loading: boolean;
}

/**
 * GET /api/intel/:id once per target, reused for ~60 s. `villageId: null` = nothing to look up (no request). An answer for a
 * target that is no longer the current one is ignored; a failing call leaves `intel` null (the form then shows no hint).
 */
export function useIntel(villageId: number | null): IntelState {
  const [state, setState] = useState<{ id: number | null; intel: VillageIntelDto | null; done: boolean }>({ id: null, intel: null, done: false });

  useEffect(() => {
    if (villageId === null) return undefined;
    const hit = cachedIntel(villageId);
    if (hit) {
      setState({ id: villageId, intel: hit, done: true });
      return undefined;
    }
    let current = true;
    setState({ id: villageId, intel: null, done: false });
    api
      .intel(villageId)
      .then((dto) => {
        cache.set(keyOf(villageId), { at: Date.now(), dto });
        if (current) setState({ id: villageId, intel: dto, done: true });
      })
      .catch(() => {
        if (current) setState({ id: villageId, intel: null, done: true });
      });
    return () => {
      current = false;
    };
  }, [villageId]);

  // Never hand out the answer of another village while the next one loads.
  if (villageId === null || state.id !== villageId) return { intel: null, loading: villageId !== null };
  return { intel: state.intel, loading: !state.done };
}
