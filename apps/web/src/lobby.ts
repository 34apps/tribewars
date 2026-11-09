// Lobby flow helpers: world labels and the "Play" handshake (pure of React, so it can be unit-tested).

import type { LobbyWorldDto, WorldStatus } from '@clanfire/engine';
import { ApiRequestError, api, safeWorldPath } from './api.ts';

/** Card button text: a finished world is only for looking at the results. */
export function worldButtonLabel(status: WorldStatus): string {
  return status === 'finished' ? 'View results' : 'Play';
}

const DAY_MS = 86_400_000;
/** A world counts as "New" for its first week. */
export const NEW_WORLD_DAYS = 7;

/** Whole days between two moments (never negative). */
function daysBetween(then: number, now: number): number {
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

/** "today", "1 day ago", "5 days ago". */
export function daysAgoLabel(then: number, now: number = Date.now()): string {
  const d = daysBetween(then, now);
  return d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`;
}

/** The small "New" tag: the world opened less than a week ago. */
export function isNewWorld(openedAt: number, now: number = Date.now()): boolean {
  return now - openedAt < NEW_WORLD_DAYS * DAY_MS;
}

/** The signed-in homepage's three groups. Closed worlds are left out. */
export interface WorldGroups {
  /** Entered before and still running (open or full), last played first. */
  yours: LobbyWorldDto[];
  /** Never entered: open ones can be joined, full ones are shown as Full. */
  join: LobbyWorldDto[];
  /** Ended worlds (read-only), for "View results". */
  results: LobbyWorldDto[];
}

export function groupWorlds(worlds: readonly LobbyWorldDto[]): WorldGroups {
  const yours = worlds.filter((w) => (w.status === 'open' || w.status === 'full') && w.lastPlayedAt !== null);
  yours.sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0));
  const join = worlds.filter((w) => (w.status === 'open' || w.status === 'full') && w.lastPlayedAt === null);
  const results = worlds.filter((w) => w.status === 'finished');
  return { yours, join, results };
}

const MANUAL_SIGN_OUT_KEY = 'clanfire.manualSignOut';
const LAST_REENTRY_KEY = 'clanfire.lastReentry';
/** At most one silent re-entry per minute: a world that refuses the pass again must not cause a loop. */
export const REENTRY_MIN_GAP_MS = 60_000;

function store(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** The visitor chose "Sign out" in a world: do not sign them straight back in through the lobby. */
export function markManualSignOut(): void {
  store()?.setItem(MANUAL_SIGN_OUT_KEY, '1');
}

/**
 * A lobby world's session is short on purpose (so "Sign out everywhere" and bans reach the worlds). When it ends and the
 * lobby session is still alive, go through the lobby again without asking: true when a new world session was opened.
 * Never after a deliberate sign-out, and at most once a minute. Any failure just means "show the lobby".
 */
export async function silentReenter(pathname: string, now: number = Date.now()): Promise<boolean> {
  const s = store();
  if (s?.getItem(MANUAL_SIGN_OUT_KEY)) {
    s.removeItem(MANUAL_SIGN_OUT_KEY);
    return false;
  }
  const last = Number(s?.getItem(LAST_REENTRY_KEY) ?? 0);
  if (Number.isFinite(last) && now - last < REENTRY_MIN_GAP_MS) return false;
  const here = /^\/w\/[A-Za-z0-9._~-]+\//.exec(pathname)?.[0];
  if (!here) return false;
  s?.setItem(LAST_REENTRY_KEY, String(now));
  try {
    const { worlds } = await api.lobbyWorlds();
    const world = worlds.find((w) => w.path === here);
    if (!world || world.status === 'closed') return false;
    await enterWorld(world, () => undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * Enter a world: ask the lobby for a short-lived pass, hand it to the world (same origin, request body only), then
 * go to the world's page. The address is checked before anything is sent and again for the lobby's answer; the pass
 * is never put in a URL, logged or stored. Throws ApiRequestError (message ready to show) when a step fails.
 */
export async function enterWorld(world: LobbyWorldDto, go: (path: string) => void): Promise<void> {
  const path = safeWorldPath(world.path);
  if (path === null) throw new ApiRequestError('server_error', 'This world has an invalid address.', 0);
  const entry = await api.lobbyEnter(world.id);
  if (safeWorldPath(entry.path) !== path || typeof entry.pass !== 'string' || entry.pass === '') {
    throw new ApiRequestError('server_error', 'The lobby sent an unexpected answer. Try again.', 0);
  }
  await api.worldEnter(path, entry.pass);
  go(path);
}
