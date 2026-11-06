// Pure helpers of the Command post (no React, unit-tested): coordinate parsing, search input checks and the mapping of
// search results / map rows to a send target. The server decides everything; these only keep the form honest.

import { SEARCH_VILLAGES_LIMIT, distance, villagePoints } from '@clanfire/engine';
import type { Coords, MapVillageDto, OwnVillageDto } from '@clanfire/engine';

export type TargetMode = 'coords' | 'village' | 'player';

/** The server's bounds for a name search (GameService.searchVillages). */
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 24;

/** Largest coordinate the map takes (the server query allows 7 digits; the world is far smaller). */
const COORD_LIMIT = 9_999_999;

export type CoordsParse = { ok: true; coords: Coords } | { ok: false; message: string };

/**
 * "12|-40", "12,-40", "12 -40", "12;-40" and "(12|-40)" (spaces anywhere) -> coordinates. Whole numbers only; a leading
 * "+" is fine. Anything else gets a plain sentence for the field's hint (empty input: no message).
 */
export function parseCoords(input: string): CoordsParse {
  const text = input.trim();
  if (text === '') return { ok: false, message: '' };
  const m = /^\(?\s*([+-]?\d+)\s*(?:[|,;]|\s)\s*([+-]?\d+)\s*\)?$/.exec(text);
  if (!m) return { ok: false, message: 'Write the coordinates like 12|-40.' };
  const x = Number(m[1]);
  const y = Number(m[2]);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || Math.abs(x) > COORD_LIMIT || Math.abs(y) > COORD_LIMIT) {
    return { ok: false, message: 'Those coordinates are out of range.' };
  }
  return { ok: true, coords: { x, y } };
}

/** The trimmed text to search for, or null while it is too short or too long for the server. */
export function searchText(input: string): string | null {
  const t = input.trim();
  return t.length >= SEARCH_MIN && t.length <= SEARCH_MAX ? t : null;
}

/** A hint under the name field: empty when nothing is wrong. */
export function searchHint(input: string): string {
  const n = input.trim().length;
  if (n === 0) return '';
  if (n < SEARCH_MIN) return `Type at least ${SEARCH_MIN} letters.`;
  if (n > SEARCH_MAX) return `At most ${SEARCH_MAX} characters.`;
  return '';
}

/** Search results as the list shows them: at most the server's limit, nearest to `from` first (the server already sorts; this is a safe net). */
export function resultRows(villages: readonly MapVillageDto[], from: Coords | null): Array<{ village: MapVillageDto; distance: number | null }> {
  const rows = villages.slice(0, SEARCH_VILLAGES_LIMIT).map((village) => ({ village, distance: from ? distance(from, village) : null }));
  if (from) rows.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  return rows;
}

/** What the send form aims at: a tile, and the village standing there (null = free land). */
export interface PickedTarget {
  tile: Coords;
  village: MapVillageDto | null;
}

/** A search result -> target (the tile is the village's own). */
export function targetOfVillage(v: MapVillageDto): PickedTarget {
  return { tile: { x: v.x, y: v.y }, village: v };
}

/** The village standing on `tile` in a map answer (null = free land). */
export function villageAt(villages: readonly MapVillageDto[], tile: Coords): MapVillageDto | null {
  return villages.find((v) => v.x === tile.x && v.y === tile.y) ?? null;
}

/** One of my own villages as a target. The map row is the source of truth when it is known; otherwise a minimal own row. */
export function targetOfOwn(own: OwnVillageDto, row: MapVillageDto | null): PickedTarget {
  return {
    tile: { x: own.x, y: own.y },
    village:
      row ?? {
        id: own.id,
        name: own.name,
        x: own.x,
        y: own.y,
        kind: 'own',
        ownerName: null,
        points: villagePoints(own.state),
        protected: false,
        tribeTag: null,
        tribeId: null,
        ownerChieftain: null,
        relation: 'self',
        ...(own.hearth ? { hearth: own.hearth } : {}),
      },
  };
}

/** Is a village standing on (x, y) in this (possibly partial) map answer? For the free-site rule of Found. */
export function occupiedIn(villages: readonly MapVillageDto[]): (x: number, y: number) => boolean {
  const taken = new Set(villages.map((v) => `${v.x}|${v.y}`));
  return (x, y) => taken.has(`${x}|${y}`);
}

/** The 5 x 5 block of the map around a tile: enough to see a village on it and the neighbours the Found spacing rule looks at. */
export function lookupWindow(tile: Coords): { x: number; y: number; w: number; h: number } {
  return { x: tile.x - 2, y: tile.y - 2, w: 5, h: 5 };
}
