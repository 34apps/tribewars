// Lobby flow helpers: world labels and the "Play" handshake (pure of React, so it can be unit-tested).

import type { LobbyWorldDto, WorldStatus } from '@clanfire/engine';
import { ApiRequestError, api, safeWorldPath } from './api.ts';

export const WORLD_STATUS_LABEL: Record<WorldStatus, string> = {
  open: 'Open',
  full: 'Full · returning only',
  closed: 'Closed',
  finished: 'Finished',
};

/** Card button text: a finished world is only for looking at the results. */
export function worldButtonLabel(status: WorldStatus): string {
  return status === 'finished' ? 'View results' : 'Play';
}

/** Running worlds first, finished ones below; the lobby's own order is kept inside each group (stable sort). */
export function sortWorlds(worlds: readonly LobbyWorldDto[]): LobbyWorldDto[] {
  const rank = (w: LobbyWorldDto): number => (w.status === 'finished' ? 1 : 0);
  return [...worlds].sort((a, b) => rank(a) - rank(b));
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
