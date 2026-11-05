import { useEffect, useState } from 'react';
import { DEFAULT_WORLD_CONFIG, resolveWorldConfig } from '@clanfire/engine';
import type { WorldConfig, WorldConfigResponse } from '@clanfire/engine';
import { api } from '../api.ts';

/** What a screen knows about the published rules of this world. `config` is always complete: the defaults until the answer arrives or when it fails. */
export interface WorldConfigState {
  status: 'loading' | 'ready' | 'failed';
  config: WorldConfig;
  /** The whole answer (name, open or not, settings still editable); null until `ready`. */
  response: WorldConfigResponse | null;
}

const LOADING: WorldConfigState = { status: 'loading', config: DEFAULT_WORLD_CONFIG, response: null };
const FAILED: WorldConfigState = { status: 'failed', config: DEFAULT_WORLD_CONFIG, response: null };

let cached: Promise<WorldConfigResponse> | null = null;

/** One request per page load, shared by every caller; a failure is not cached so the next caller can retry. */
export function loadWorldConfig(): Promise<WorldConfigResponse> {
  if (cached === null) {
    const p = api.worldConfig();
    cached = p;
    p.catch(() => {
      if (cached === p) cached = null;
    });
  }
  return cached;
}

/** For tests. */
export function resetWorldConfigCache(): void {
  cached = null;
}

/** The answer made safe to read: a complete config even if the server sent a partial or damaged one. */
export function readyState(response: WorldConfigResponse): WorldConfigState {
  return { status: 'ready', config: resolveWorldConfig(response.config), response };
}

/** Rules with their load status, for the "World rules" page. Fetched once, cached; never throws. */
export function useWorldConfigState(): WorldConfigState {
  const [state, setState] = useState<WorldConfigState>(LOADING);
  useEffect(() => {
    let cancelled = false;
    let load: Promise<WorldConfigResponse>;
    try {
      load = loadWorldConfig();
    } catch {
      setState(FAILED);
      return;
    }
    load.then(
      (r) => {
        if (!cancelled) setState(readyState(r));
      },
      () => {
        if (!cancelled) setState(FAILED);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/**
 * The rules of this world for screens that have no game state (public pages). Returns the defaults until they are loaded and
 * when the request fails. Inside the game use `useRules()` instead: it reads the settings that arrive with every state.
 */
export function useWorldConfig(): WorldConfig {
  return useWorldConfigState().config;
}
