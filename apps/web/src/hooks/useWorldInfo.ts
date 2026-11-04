import { useEffect, useState } from 'react';
import type { WorldInfoResponse } from '@clanfire/engine';
import { api } from '../api.ts';

/** Where a lobby world sends people to pick or switch worlds. */
export const LOBBY_URL = '/lobby/';

/** 'loading' until the public world info arrives; 'failed' when it cannot be fetched (treated as "no lobby"). */
export type WorldInfoState = WorldInfoResponse | 'loading' | 'failed';

let cached: Promise<WorldInfoResponse> | null = null;

/** One request per page load, shared by every caller; a failure is not cached so the next caller can retry. */
export function loadWorldInfo(): Promise<WorldInfoResponse> {
  if (cached === null) {
    const p = api.worldInfo();
    cached = p;
    p.catch(() => {
      if (cached === p) cached = null;
    });
  }
  return cached;
}

/** For tests. */
export function resetWorldInfoCache(): void {
  cached = null;
}

/** World info for this page (fetched once, cached). `enabled: false` skips the request. */
export function useWorldInfo(enabled = true): WorldInfoState {
  const [state, setState] = useState<WorldInfoState>('loading');
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadWorldInfo().then(
      (info) => {
        if (!cancelled) setState(info);
      },
      () => {
        if (!cancelled) setState('failed');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return state;
}

/** True only when the world info says this world is entered through the lobby. */
export function isLobbyWorld(state: WorldInfoState): boolean {
  return typeof state === 'object' && state.lobby === true;
}
