// Which map chunks must be refetched when the player's own picture of the world changes (a village taken or lost, a hold
// started or ended, a tribe change). Pure: compare two snapshots, return what is stale. The map redraws from the cache,
// so only the chunks that hold a changed village are refetched (no refetch storm); a tribe change refetches everything
// that is visible, because relations (banner, tag) change for many villages at once.

import type { Coords } from '@clanfire/engine';

export interface MapRevisionInput {
  tribeId: number;
  tribeVersion: number;
  /** My villages. */
  villages: ReadonlyArray<Coords & { id: number; hearthOut?: boolean }>;
  /** Villages I am holding (hearth put out by me). */
  holds: ReadonlyArray<Coords & { villageId: number }>;
}

export interface MapRevision {
  tribeKey: string;
  /** village id -> tile and state key; a change in any entry makes that tile stale. */
  tiles: Map<number, { x: number; y: number; key: string }>;
}

export function mapRevision(input: MapRevisionInput): MapRevision {
  const tiles = new Map<number, { x: number; y: number; key: string }>();
  for (const v of input.villages) tiles.set(v.id, { x: v.x, y: v.y, key: v.hearthOut ? 'own-cold' : 'own' });
  for (const h of input.holds) tiles.set(h.villageId, { x: h.x, y: h.y, key: 'hold' });
  return { tribeKey: `${input.tribeId}:${input.tribeVersion}`, tiles };
}

export interface MapStale {
  /** Everything is stale (tribe or relations changed). */
  all: boolean;
  /** Tiles whose village changed owner, hold or hearth state (both the old and the new side). */
  tiles: Coords[];
}

/** What went stale between two revisions; `prev` null = first look (nothing to refetch beyond what is not loaded yet). */
export function staleSince(prev: MapRevision | null, next: MapRevision): MapStale {
  if (!prev) return { all: false, tiles: [] };
  if (prev.tribeKey !== next.tribeKey) return { all: true, tiles: [] };
  const tiles: Coords[] = [];
  for (const [id, t] of next.tiles) {
    const old = prev.tiles.get(id);
    if (!old || old.key !== t.key) tiles.push({ x: t.x, y: t.y });
  }
  for (const [id, t] of prev.tiles) if (!next.tiles.has(id)) tiles.push({ x: t.x, y: t.y });
  return { all: false, tiles };
}
