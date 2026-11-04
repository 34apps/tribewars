// Multi-world routing helpers (docs/MULTI_WORLD.md): a world answers under /w/<WORLD_ID>/... as well as the old paths.

import { WORLD_ID_PATTERN } from '@clanfire/engine';

/** Throws unless `id` is 1-32 letters, digits or dashes. Used for WORLD_ID and the buildApp option. */
export function checkWorldId(id: string, what = 'WORLD_ID'): string {
  if (!WORLD_ID_PATTERN.test(id)) throw new Error(`Invalid ${what}="${id}": expected 1-32 letters, digits or dashes.`);
  return id;
}

export function checkWorldName(name: string, what = 'WORLD_NAME'): string {
  const n = name.trim();
  if (n === '' || n.length > 40 || /[\u0000-\u001f\u007f]/.test(n)) throw new Error(`Invalid ${what}: expected 1-40 characters, no control characters.`);
  return n;
}

/**
 * Fastify `rewriteUrl`: "/w/<id>/api/x?y" -> "/api/x?y", "/w/<id>/" and "/w/<id>" -> "/". Other URLs (including another
 * world's prefix) pass unchanged. Routing, hooks and handlers then see one path shape; `req.originalUrl` keeps the prefix.
 */
export function makeWorldRewrite(worldId: string): (url: string) => string {
  const prefix = `/w/${worldId}`;
  return (url) => {
    if (!url.startsWith(prefix)) return url;
    const rest = url.slice(prefix.length);
    if (rest === '') return '/';
    if (rest.startsWith('/')) return rest;
    if (rest.startsWith('?')) return `/${rest}`;
    return url; // "/w/w10/..." is not world "w1"
  };
}

/** Cookie Path for this request: "/w/<id>/" when it came in under the world path, else "/". */
export function sessionCookiePath(originalUrl: string, worldId: string): string {
  const path = originalUrl.split('?', 1)[0] ?? '';
  return path === `/w/${worldId}` || path.startsWith(`/w/${worldId}/`) ? `/w/${worldId}/` : '/';
}
