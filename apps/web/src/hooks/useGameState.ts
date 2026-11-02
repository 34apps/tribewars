import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameStateResponse, OwnVillageDto, SendResponse } from '@tribewars/engine';
import { ApiRequestError, api, errorMessage } from '../api.ts';

const POLL_MS = 10_000;
/** Ignore offset changes smaller than this so countdowns do not wobble with network latency. */
const OFFSET_DEADBAND_MS = 250;

export interface GameStateStore {
  data: GameStateResponse | null;
  /** serverTime - Date.now(), measured at the middle of the last state request. */
  serverOffset: number;
  /** Last network/server error while polling; null when the latest poll worked. */
  error: string | null;
  refresh: () => Promise<void>;
  /** Replace one of my villages with an action response (build/train). */
  applyVillage: (village: OwnVillageDto) => void;
  /** Apply a send response: updated village plus the new movement. */
  applySend: (res: SendResponse) => void;
}

/**
 * GET /api/state on load, every 10 s, on window focus and after every action.
 * Responses that started before a newer one was applied are dropped.
 */
export function useGameState(onUnauthorized: () => void): GameStateStore {
  const [data, setData] = useState<GameStateResponse | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const applied = useRef(0);
  const lastStart = useRef(0);
  const unauthorized = useRef(onUnauthorized);
  const offsetRef = useRef<number | null>(null);

  useEffect(() => {
    unauthorized.current = onUnauthorized;
  }, [onUnauthorized]);

  const refresh = useCallback(async () => {
    const my = ++seq.current;
    const t0 = Date.now();
    lastStart.current = t0;
    try {
      const res = await api.state();
      const t1 = Date.now();
      if (my < applied.current) return;
      applied.current = my;
      const measured = res.serverTime - (t0 + t1) / 2;
      if (offsetRef.current === null || Math.abs(measured - offsetRef.current) > OFFSET_DEADBAND_MS) {
        offsetRef.current = measured;
        setServerOffset(measured);
      }
      setData(res);
      setError(null);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) {
        unauthorized.current();
        return;
      }
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    const wake = () => {
      if (!document.hidden && Date.now() - lastStart.current > 1000) void refresh();
    };
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [refresh]);

  // Refresh just after the next movement lands so reports and troops appear without waiting for the poll.
  useEffect(() => {
    if (!data) return;
    const serverNow = Date.now() + (offsetRef.current ?? 0);
    let next = Infinity;
    for (const m of data.movements) if (m.arriveAt > serverNow) next = Math.min(next, m.arriveAt);
    const delay = next - serverNow + 1500;
    if (!Number.isFinite(delay) || delay > POLL_MS) return;
    const id = window.setTimeout(() => void refresh(), delay);
    return () => window.clearTimeout(id);
  }, [data, refresh]);

  const applyVillage = useCallback((village: OwnVillageDto) => {
    applied.current = ++seq.current;
    setData((d) => (d ? { ...d, villages: d.villages.map((v) => (v.id === village.id ? village : v)) } : d));
  }, []);

  const applySend = useCallback((res: SendResponse) => {
    applied.current = ++seq.current;
    setData((d) =>
      d
        ? {
            ...d,
            villages: d.villages.map((v) => (v.id === res.village.id ? res.village : v)),
            movements: [...d.movements.filter((m) => m.id !== res.movement.id), res.movement],
          }
        : d,
    );
  }, []);

  return { data, serverOffset, error, refresh, applyVillage, applySend };
}
