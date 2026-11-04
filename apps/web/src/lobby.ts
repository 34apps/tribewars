// Lobby flow helpers: world labels and the "Play" handshake (pure of React, so it can be unit-tested).

import type { LobbyWorldDto, WorldStatus } from '@clanfire/engine';
import { ApiRequestError, api, safeWorldPath } from './api.ts';

export const WORLD_STATUS_LABEL: Record<WorldStatus, string> = {
  open: 'Open',
  full: 'Full: returning players only',
  closed: 'Closed',
};

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
