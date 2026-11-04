// World list helpers: validation of what the operator types (ids, names, public paths) and the /lobby URL prefix.

import { LOBBY_PREFIX, WORLD_ID_PATTERN } from '@clanfire/engine';

/** Throws unless `id` is 1-32 letters, digits or dashes (same rule as the world's WORLD_ID). */
export function checkWorldId(id: string): string {
  if (!WORLD_ID_PATTERN.test(id)) throw new Error(`Invalid world id "${id}": expected 1-32 letters, digits or dashes.`);
  return id;
}

export function checkWorldName(name: string): string {
  const n = name.trim();
  if (n === '' || n.length > 40 || /[\u0000-\u001f\u007f]/.test(n)) throw new Error('Invalid world name: expected 1-40 characters, no control characters.');
  return n;
}

/** Public URL path of a world's page. Players are redirected here, so it must never be able to leave this site. */
export const WORLD_PATH_PATTERN = /^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*\/$/;
export const WORLD_PATH_MAX = 100;

/**
 * Throws unless `path` is an absolute path on this site: starts with one slash, ends with one slash, safe characters only.
 * So never "//host" (protocol-relative), never a scheme ("javascript:x", "https://..."), never "." or ".." segments.
 */
export function checkWorldPath(path: string): string {
  const bad = (): never => {
    throw new Error(`Invalid world path "${path.slice(0, 40)}": expected something like /w/w1/ (letters, digits and . _ ~ - between slashes, ending with a slash).`);
  };
  if (path.length > WORLD_PATH_MAX || !WORLD_PATH_PATTERN.test(path)) return bad();
  if (path.split('/').some((seg) => /^\.+$/.test(seg))) return bad();
  return path;
}

/** The default page path of a world: "/w/<id>/". */
export const defaultWorldPath = (id: string): string => `/w/${id}/`;

/**
 * Fastify `rewriteUrl`: "/lobby/api/x?y" -> "/api/x?y", "/lobby" and "/lobby/" -> "/". Everything else (bare "/api/..."
 * included) passes unchanged, so routes are registered once as "/api/...".
 */
export function rewriteLobbyUrl(url: string): string {
  if (!url.startsWith(LOBBY_PREFIX)) return url;
  const rest = url.slice(LOBBY_PREFIX.length);
  if (rest === '') return '/';
  if (rest.startsWith('/')) return rest;
  if (rest.startsWith('?')) return `/${rest}`;
  return url; // "/lobbyist/..." is not the lobby
}
