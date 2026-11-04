// Pure parts of the live-update socket (no React, no I/O): frame guard, backoff, poll interval, support check.

import { LIVE_TOPICS } from '@clanfire/engine';
import type { LiveMessage, LiveTopic } from '@clanfire/engine';
import { apiBase } from '../api.ts';

export const RECONNECT_MIN_MS = 1000;
export const RECONNECT_MAX_MS = 30_000;
/** Polls slow down to this while the live socket is connected (hints do the real work). */
export const LIVE_POLL_MS = 60_000;
/** Hints arriving within this window are merged into one refetch per subscriber. */
export const COALESCE_MS = 150;

/** Poll interval: today's `baseMs` without a socket, 60 s with one (never faster than the base). */
export function pollMs(baseMs: number, connected: boolean): number {
  return connected ? Math.max(baseMs, LIVE_POLL_MS) : baseMs;
}

/** Reconnect delay for the n-th failed attempt (0 = first): 1 s, 2 s, 4 s ... capped at 30 s, with +-20 % jitter. */
export function backoffMs(attempt: number, random: number = Math.random()): number {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.max(0, Math.min(attempt, 16)));
  return Math.min(RECONNECT_MAX_MS, Math.round(base * (0.8 + 0.4 * random)));
}

const isTopic = (v: unknown): v is LiveTopic => typeof v === 'string' && (LIVE_TOPICS as readonly string[]).includes(v);

/** Parses one text frame; anything malformed or unknown yields null and is ignored. Unknown topics are dropped. */
export function parseLiveMessage(raw: unknown): LiveMessage | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const msg = value as { type?: unknown; topics?: unknown };
  if (msg.type === 'hello' || msg.type === 'pong') return { type: msg.type };
  if (msg.type === 'hint' && Array.isArray(msg.topics)) return { type: 'hint', topics: msg.topics.filter(isTopic) };
  return null;
}

/** Same-origin socket URL; under /w/<id>/ (several worlds, one domain) it goes to that world's API. */
export function liveUrl(loc: Pick<Location, 'protocol' | 'host'> & { pathname?: string }): string {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}${apiBase(loc.pathname ?? '')}/live`;
}

/** The single-file preview has no network: apps/preview sets this flag before the app mounts. */
export function liveSupported(): boolean {
  if (typeof WebSocket === 'undefined' || typeof window === 'undefined') return false;
  if ((window as unknown as { __CLANFIRE_PREVIEW__?: boolean }).__CLANFIRE_PREVIEW__) return false;
  return window.location.protocol === 'http:' || window.location.protocol === 'https:';
}
