import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { LIVE_CLOSE_SESSION_ENDED, LIVE_TOPICS } from '@clanfire/engine';
import type { LiveTopic } from '@clanfire/engine';
import { COALESCE_MS, backoffMs, liveSupported, liveUrl, parseLiveMessage } from './live.ts';

const PING_EVERY_MS = 25_000;
const DEAD_AFTER_MS = 10_000;

type Callback = () => void;
interface LiveApi {
  /** True while the socket is up and the server said hello; polls slow down then. */
  connected: boolean;
  /** Run `cb` (a refetch) when any of `topics` is hinted. Returns the unsubscribe function. */
  subscribe: (topics: readonly LiveTopic[], cb: Callback) => () => void;
}

const NO_LIVE: LiveApi = { connected: false, subscribe: () => () => undefined };
const LiveContext = createContext<LiveApi>(NO_LIVE);

/**
 * One push-only WebSocket for the signed-in app (mount once, inside the signed-in tree). The client never sends:
 * hints carry no data, subscribers refetch through the normal GET endpoints. Hints within a short window are merged and
 * each subscriber runs once. Reconnects with backoff; stops for good on "session ended" until the provider remounts.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Map<Callback, readonly LiveTopic[]>());

  const subscribe = useCallback<LiveApi['subscribe']>((topics, cb) => {
    listeners.current.set(cb, topics);
    return () => void listeners.current.delete(cb);
  }, []);
  const api = useMemo<LiveApi>(() => ({ connected, subscribe }), [connected, subscribe]);

  useEffect(() => {
    if (!liveSupported()) return;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let flushTimer: number | undefined;
    let attempt = 0;
    let stopped = false;
    let ready = false;
    const pending = new Set<LiveTopic>();

    const flush = () => {
      flushTimer = undefined;
      const calls = new Set<Callback>();
      for (const [cb, topics] of listeners.current) if (topics.some((t) => pending.has(t))) calls.add(cb);
      pending.clear();
      for (const cb of calls) cb();
    };
    const fire = (topics: readonly LiveTopic[]) => {
      for (const t of topics) pending.add(t);
      if (flushTimer === undefined) flushTimer = window.setTimeout(flush, COALESCE_MS);
    };
    const setReady = (value: boolean) => {
      ready = value;
      setConnected(value);
    };

    let pingTimer: number | undefined;
    let deadTimer: number | undefined;
    const stopWatchdog = () => {
      window.clearInterval(pingTimer);
      window.clearTimeout(deadTimer);
      pingTimer = deadTimer = undefined;
    };

    const open = () => {
      retry = undefined;
      if (stopped || socket) return;
      const ws = new WebSocket(liveUrl(window.location));
      socket = ws;
      // Silently dead socket (network gone, no close event): ping now and then; if no frame comes back, give up on
      // this socket and reconnect. Browsers answer the server's own heartbeat pings themselves, invisibly to us.
      const handleClose = (code: number) => {
        if (socket !== ws) return;
        socket = null;
        stopWatchdog();
        setReady(false);
        if (stopped) return;
        if (code === LIVE_CLOSE_SESSION_ENDED) {
          stopped = true;
          return;
        }
        retry = window.setTimeout(open, backoffMs(attempt++));
      };
      ws.onopen = () => {
        pingTimer = window.setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send('ping');
          if (deadTimer === undefined) {
            deadTimer = window.setTimeout(() => {
              ws.onmessage = null;
              ws.onclose = null;
              ws.close();
              handleClose(1006);
            }, DEAD_AFTER_MS);
          }
        }, PING_EVERY_MS);
      };
      ws.onmessage = (ev: MessageEvent) => {
        window.clearTimeout(deadTimer);
        deadTimer = undefined;
        const msg = parseLiveMessage(ev.data);
        if (!msg || msg.type === 'pong') return;
        if (!ready) {
          // First valid frame (hello): the server accepted the session. Catch up on anything missed while down.
          attempt = 0;
          setReady(true);
          fire(LIVE_TOPICS);
        }
        if (msg.type === 'hint') fire(msg.topics);
      };
      ws.onclose = (ev: CloseEvent) => handleClose(ev.code);
      // Errors always end in a close event, which schedules the retry.
    };

    const onVisible = () => {
      if (document.hidden || stopped || ready) return;
      // Back on screen with the socket down: reconnect right away and refetch everything once.
      if (retry !== undefined) window.clearTimeout(retry);
      attempt = 0;
      if (!socket) open();
      fire(LIVE_TOPICS);
    };
    document.addEventListener('visibilitychange', onVisible);
    open();

    return () => {
      stopped = true;
      stopWatchdog();
      document.removeEventListener('visibilitychange', onVisible);
      if (retry !== undefined) window.clearTimeout(retry);
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      const ws = socket;
      socket = null;
      if (ws) {
        ws.onmessage = null;
        ws.onclose = null;
        ws.close();
      }
    };
  }, []);

  return <LiveContext.Provider value={api}>{children}</LiveContext.Provider>;
}

/** True while live updates are on (polls should run at the slow interval). */
export function useLiveConnected(): boolean {
  return useContext(LiveContext).connected;
}

/** Calls `cb` (usually a refetch) when the server hints that any of `topics` changed. `cb` may change every render. */
export function useLiveTopic(topics: LiveTopic | readonly LiveTopic[], cb: Callback): void {
  const { subscribe } = useContext(LiveContext);
  const latest = useRef(cb);
  useEffect(() => {
    latest.current = cb;
  }, [cb]);
  const key = typeof topics === 'string' ? topics : topics.join(',');
  useEffect(() => {
    const list = key.split(',') as LiveTopic[];
    return subscribe(list, () => latest.current());
  }, [subscribe, key]);
}
