// Lobby flow helpers: world labels and the "Play" handshake (pure of React, so it can be unit-tested).

import type { LobbyWorldDto, WorldStatus } from '@clanfire/engine';
import { ApiRequestError, api, safeWorldPath } from './api.ts';

/** Card button text: a finished world is only for looking at the results. */
export function worldButtonLabel(status: WorldStatus): string {
  return status === 'finished' ? 'View results' : 'Play';
}

const DAY_MS = 86_400_000;
/** Whole days between two moments (never negative). */
function daysBetween(then: number, now: number): number {
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

/** "today", "1 day ago", "5 days ago". */
export function daysAgoLabel(then: number, now: number = Date.now()): string {
  const d = daysBetween(then, now);
  return d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`;
}

/** How many unplayed worlds the "Join a world" strip shows (the newest open ones); the rest are on the All worlds page. */
export const JOIN_STRIP_MAX = 3;

/** Worlds the account has never entered, by state (closed worlds are never listed). Newest first. */
export interface OtherWorlds {
  open: LobbyWorldDto[];
  full: LobbyWorldDto[];
  finished: LobbyWorldDto[];
}

/** The signed-in page's lists. Closed worlds are left out. */
export interface WorldGroups {
  /** Entered before and still running (open or full), last played first. */
  yours: LobbyWorldDto[];
  /** Entered before and ended, last played first: "Results". */
  results: LobbyWorldDto[];
  /** The newest open worlds never entered (at most JOIN_STRIP_MAX). */
  join: LobbyWorldDto[];
  /** Every world never entered, for the All worlds page. */
  others: OtherWorlds;
  /** Size of `others`: the number in "All worlds (N)". */
  otherCount: number;
}

/** Newest first; a world with no start date (an older lobby) keeps its place at the end, in list order. */
function newestFirst(list: LobbyWorldDto[]): LobbyWorldDto[] {
  return list
    .map((w, i) => ({ w, i }))
    .sort((a, b) => (Number.isFinite(b.w.openedAt) ? b.w.openedAt : 0) - (Number.isFinite(a.w.openedAt) ? a.w.openedAt : 0) || a.i - b.i)
    .map((x) => x.w);
}

export function groupWorlds(worlds: readonly LobbyWorldDto[]): WorldGroups {
  const running = (w: LobbyWorldDto) => w.status === 'open' || w.status === 'full';
  const byLastPlayed = (a: LobbyWorldDto, b: LobbyWorldDto) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0);
  const yours = worlds.filter((w) => running(w) && w.lastPlayedAt !== null).sort(byLastPlayed);
  const results = worlds.filter((w) => w.status === 'finished' && w.lastPlayedAt !== null).sort(byLastPlayed);
  const unplayed = worlds.filter((w) => w.lastPlayedAt === null);
  const others: OtherWorlds = {
    open: newestFirst(unplayed.filter((w) => w.status === 'open')),
    full: newestFirst(unplayed.filter((w) => w.status === 'full')),
    finished: newestFirst(unplayed.filter((w) => w.status === 'finished')),
  };
  return { yours, results, join: others.open.slice(0, JOIN_STRIP_MAX), others, otherCount: others.open.length + others.full.length + others.finished.length };
}

/** "Started today", "Started 1 day ago", ... A lobby that sends no date gives null (the row shows no line). */
export function startedLabel(openedAt: number | undefined, now: number = Date.now()): string | null {
  return typeof openedAt === 'number' && Number.isFinite(openedAt) ? `Started ${daysAgoLabel(openedAt, now)}` : null;
}

/** The lobby page's screens, kept in the address after the "#" so Back, Forward and a reload land on the right one. */
export type LobbyRoute = 'home' | 'signin' | 'signup' | 'worlds';

/** "#signin", "#signup", "#worlds" (also without the "#"); anything else is the front page. Never throws. */
export function parseLobbyHash(hash: string): LobbyRoute {
  switch (hash.replace(/^#/, '')) {
    case 'signin':
      return 'signin';
    case 'signup':
      return 'signup';
    case 'worlds':
      return 'worlds';
    default:
      return 'home';
  }
}

/** The "#..." part for a route ('' for the front page). */
export function lobbyRouteHash(route: LobbyRoute): string {
  return route === 'home' ? '' : `#${route}`;
}

export type LobbyScreen = 'home' | 'form-login' | 'form-register' | 'your-worlds' | 'all-worlds';

/** Which screen a route shows. Signed in: the form routes lead to Your worlds. Signed out: #worlds falls back to the front page. */
export function lobbyScreen(route: LobbyRoute, signedIn: boolean): LobbyScreen {
  if (signedIn) return route === 'worlds' ? 'all-worlds' : 'your-worlds';
  if (route === 'signin') return 'form-login';
  if (route === 'signup') return 'form-register';
  return 'home';
}

/** The tent tile colours (Parchment-friendly toy palette; CSS variables of the raw palette). */
export const TENT_COLOURS = ['--c-moss', '--c-teal', '--c-terra', '--c-plum', '--c-sun'] as const;

/** A world always gets the same colour: a small hash of its id picks one. */
export function tentColour(worldId: string): (typeof TENT_COLOURS)[number] {
  let h = 0;
  for (let i = 0; i < worldId.length; i++) h = (h * 31 + worldId.charCodeAt(i)) >>> 0;
  return TENT_COLOURS[h % TENT_COLOURS.length]!;
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
