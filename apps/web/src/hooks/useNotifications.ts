import { useCallback, useEffect, useState } from 'react';
import type { NotificationDto, NotificationsResponse } from '@clanfire/engine';
import { api } from '../api.ts';
import { announceNew, browserAlertState, lastAnnouncedKey, requestBrowserAlerts } from '../notifications.ts';
import type { BrowserAlertState } from '../notifications.ts';
import { pollMs } from './live.ts';
import { useLiveConnected, useLiveTopic } from './useLive.tsx';

export interface NotificationsStore {
  items: NotificationDto[];
  unread: number;
  /** Unread rows that are attacks (the bell turns red for these). */
  unreadAttacks: number;
  markAllRead: () => Promise<void>;
  alerts: BrowserAlertState;
  /** Ask the browser for permission. Only call from a click. */
  enableAlerts: () => Promise<void>;
}

const POLL_MS = 30_000;

/**
 * GET /api/notifications on first load, on the live hint 'notifications', and on a slow poll as a safety net. Each fresh list is
 * run through the browser-alert decider (only shows alerts once the player has turned them on).
 */
export function useNotifications(): NotificationsStore {
  const [data, setData] = useState<NotificationsResponse>({ notifications: [], unread: 0 });
  const [alerts, setAlerts] = useState<BrowserAlertState>(() => browserAlertState());
  const connected = useLiveConnected();

  const load = useCallback(async () => {
    try {
      const res = await api.getNotifications();
      setData(res);
      const key = lastAnnouncedKey(typeof window === 'undefined' ? '/' : window.location.pathname);
      announceNew(res.notifications, { key });
    } catch {
      // Older server or a hiccup: keep what we have; the next hint or poll asks again.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveTopic('notifications', () => void load());
  useEffect(() => {
    const id = window.setInterval(() => void load(), pollMs(POLL_MS, connected));
    return () => window.clearInterval(id);
  }, [load, connected]);

  const markAllRead = useCallback(async () => {
    try {
      setData(await api.markNotificationsRead());
    } catch {
      // Leave the list as is; the player can press the button again.
    }
  }, []);

  const enableAlerts = useCallback(async () => {
    setAlerts(await requestBrowserAlerts());
  }, []);

  return {
    items: data.notifications,
    unread: data.unread,
    unreadAttacks: data.notifications.filter((n) => !n.read && n.kind === 'incoming_attack').length,
    markAllRead,
    alerts,
    enableAlerts,
  };
}
