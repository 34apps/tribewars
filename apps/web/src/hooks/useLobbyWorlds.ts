// The signed-in lobby screens' shared world logic: the list call (a 401 means the session ended) and "enter a world"
// (busy flag, per-world error, Back-button restore). Used by Your worlds and All worlds.

import { useCallback, useEffect, useState } from 'react';
import type { LobbyWorldDto } from '@clanfire/engine';
import { ApiRequestError, api, errorMessage } from '../api.ts';
import { enterWorld } from '../lobby.ts';

export type WorldList = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; worlds: LobbyWorldDto[] };

export function useLobbyWorlds(onSignedOut: () => void): { list: WorldList; retry: () => void } {
  const [list, setList] = useState<WorldList>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setList({ state: 'loading' });
    api
      .lobbyWorlds()
      .then((r) => {
        if (!cancelled) setList({ state: 'ready', worlds: r.worlds });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // The lobby session ended (expired or signed out elsewhere): back to the signed-out page.
        if (e instanceof ApiRequestError && e.status === 401) onSignedOut();
        else setList({ state: 'error', message: errorMessage(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, onSignedOut]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { list, retry };
}

export function useEnterWorld(onSignedOut: () => void): { busyId: string | null; errors: Record<string, string>; play: (world: LobbyWorldDto) => Promise<void> } {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Coming back with the browser's Back button can restore the page frozen mid-"Opening…".
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusyId(null);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const play = useCallback(
    async (world: LobbyWorldDto) => {
      setBusyId(world.id);
      setErrors((prev) => ({ ...prev, [world.id]: '' }));
      try {
        await enterWorld(world, (path) => window.location.assign(path));
        // Navigating away: stay busy so a button cannot be pressed twice.
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) {
          onSignedOut();
          return;
        }
        setErrors((prev) => ({ ...prev, [world.id]: errorMessage(e) }));
        setBusyId(null);
      }
    },
    [onSignedOut],
  );

  return { busyId, errors, play };
}
