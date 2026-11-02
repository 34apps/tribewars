import { useCallback, useEffect, useRef, useState } from 'react';
import type { MyTribeResponse } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { useGame } from '../game.ts';

const POLL_MS = 20_000;

export interface RunOptions {
  /** Toast shown on success. */
  ok?: string;
  /** Toast the error (default true). Forms pass false and show the returned message inline. */
  toastError?: boolean;
}

/** Runs one tribe action; resolves to an error message, or null on success. */
export type RunAction = (fn: () => Promise<MyTribeResponse>, options?: RunOptions) => Promise<string | null>;

export interface MyTribeStore {
  data: MyTribeResponse | null;
  /** Error from the latest load while there is nothing to show yet. */
  error: string | null;
  busy: boolean;
  reload: () => Promise<void>;
  run: RunAction;
}

/**
 * GET /api/tribe on open, every 20 s while the tab is visible, and whenever /api/state says my tribe,
 * role or invitation count changed. Every action returns the new MyTribeResponse, which replaces the data
 * (responses of older requests are dropped) and triggers a /api/state refresh plus a map refetch.
 */
export function useMyTribe(): MyTribeStore {
  const { player, tribeInvites, toast, tribeChanged } = useGame();
  const [data, setData] = useState<MyTribeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const applied = useRef(0);
  const busyRef = useRef(false);
  const changed = useRef(tribeChanged);
  const toastRef = useRef(toast);
  useEffect(() => {
    changed.current = tribeChanged;
    toastRef.current = toast;
  }, [tribeChanged, toast]);

  const reload = useCallback(async () => {
    const my = ++seq.current;
    try {
      const res = await api.myTribe();
      if (my < applied.current) return;
      applied.current = my;
      setData(res);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const run = useCallback<RunAction>(
    async (fn, options) => {
      if (busyRef.current) return 'Another action is still running.';
      busyRef.current = true;
      setBusy(true);
      const my = ++seq.current;
      try {
        const res = await fn();
        applied.current = Math.max(applied.current, my);
        setData(res);
        setError(null);
        changed.current();
        if (options?.ok) toastRef.current(options.ok);
        return null;
      } catch (e) {
        const message = errorMessage(e);
        if (options?.toastError !== false) toastRef.current(message, { kind: 'error' });
        void reload();
        return message;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [reload],
  );

  const tribeId = player.tribe?.id ?? 0;
  const role = player.tribe?.role ?? '';
  useEffect(() => {
    void reload();
  }, [reload, tribeId, role, tribeInvites]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden && !busyRef.current) void reload();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [reload]);

  return { data, error, busy, reload, run };
}
