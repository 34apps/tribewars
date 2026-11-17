import { useCallback, useEffect, useRef, useState } from 'react';
import type { TribeAlertDto, TribeHoldDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { useGame } from '../game.ts';
import { sortHolds } from '../villages.ts';
import { pollMs } from './live.ts';
import { useLiveConnected, useLiveTopic } from './useLive.tsx';

const ALERT_POLL_MS = 10_000;

/**
 * Attacks and cold villages of the tribe, like the Alerts section (same endpoint, same refresh rules). `enabled: false` (a player without a
 * tribe, or a form that has no use for it) makes no request and keeps no timer.
 */
export function useAlertFeed(enabled = true) {
  const { tribeAlerts } = useGame();
  const [alerts, setAlerts] = useState<TribeAlertDto[] | null>(null);
  const [holds, setHolds] = useState<TribeHoldDto[]>([]);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const applied = useRef(0);
  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const res = await api.tribeAlerts();
      if (my < applied.current) return;
      applied.current = my;
      setAlerts([...res.alerts].sort((a, b) => a.arriveAt - b.arriveAt));
      setHolds(sortHolds(res.holds ?? []));
      setLevel(res.watchtowerLevel ?? 0);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    if (enabled) void load();
  }, [load, tribeAlerts, enabled]);
  const every = pollMs(ALERT_POLL_MS, useLiveConnected());
  useEffect(() => {
    if (!enabled) return undefined;
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, every);
    return () => window.clearInterval(id);
  }, [load, every, enabled]);
  useLiveTopic('tribe', () => {
    if (enabled) void load();
  });
  return { alerts, holds, level, error, retry: () => void load() };
}
