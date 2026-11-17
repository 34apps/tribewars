// One shared GET /api/raid-lists answer for the small places that only need to know "is the extra on for me, and which lists exist"
// (the map's "Add to raid list" action). The Raid lists page itself always loads fresh.

import type { RaidListsResponse } from '@clanfire/engine';
import { api } from './api.ts';

const MAX_AGE_MS = 60_000;
let cached: { at: number; promise: Promise<RaidListsResponse> } | null = null;

/** The answer, reused for a minute; a failure is not kept. */
export function loadRaidListsCached(now = Date.now()): Promise<RaidListsResponse> {
  if (cached && now - cached.at < MAX_AGE_MS) return cached.promise;
  const promise = api.raidLists();
  const entry = { at: now, promise };
  cached = entry;
  promise.catch(() => {
    if (cached === entry) cached = null;
  });
  return promise;
}

/** Forget the answer (after a change that the next reader must see). */
export function resetRaidListsCache(): void {
  cached = null;
}
