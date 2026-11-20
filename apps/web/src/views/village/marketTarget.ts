// Market "Send resources" target picker (no map selection here): my other villages as quick picks, or typed coordinates for a
// friend's village. Pure helpers, tested in test/market-send.test.tsx. The server re-checks the target on every send.

import type { Coords, MapVillageDto, OwnVillageDto } from '@clanfire/engine';
import { canShipTo } from '../../villages.ts';

/** "12|-5", "12 | -5", "12,-5", "12 -5" (also with a true minus sign) -> coordinates, or null. */
export function parseCoords(text: string): Coords | null {
  const m = /^\s*(−|-)?(\d{1,4})\s*(?:\||,|;|\s)\s*(−|-)?(\d{1,4})\s*$/.exec(text);
  if (!m) return null;
  return { x: (m[1] ? -1 : 1) * Number(m[2]), y: (m[3] ? -1 : 1) * Number(m[4]) };
}

/** My other villages (not the one I am in), in server order. */
export function ownPicks(villages: readonly OwnVillageDto[], currentId: number): OwnVillageDto[] {
  return villages.filter((v) => v.id !== currentId);
}

export type TypedTarget =
  | { kind: 'none' }
  | { kind: 'bad' }
  | { kind: 'self' }
  | { kind: 'loading'; at: Coords }
  | { kind: 'empty'; at: Coords }
  | { kind: 'blocked'; at: Coords }
  | { kind: 'ok'; at: Coords; village: MapVillageDto };

/** What the typed text means: `found` is the map answer for those coordinates (undefined while it is loading). */
export function typedTarget(text: string, current: Coords, found: MapVillageDto | null | undefined, currentId: number): TypedTarget {
  if (text.trim() === '') return { kind: 'none' };
  const at = parseCoords(text);
  if (!at) return { kind: 'bad' };
  if (at.x === current.x && at.y === current.y) return { kind: 'self' };
  if (found === undefined) return { kind: 'loading', at };
  if (found === null) return { kind: 'empty', at };
  return canShipTo(found, found.kind === 'own', found.id === currentId) ? { kind: 'ok', at, village: found } : { kind: 'blocked', at };
}

export function typedHint(t: TypedTarget): string | null {
  switch (t.kind) {
    case 'bad':
      return 'Type it like 12|-5';
    case 'self':
      return 'That is this village';
    case 'loading':
      return 'Looking…';
    case 'empty':
      return 'No village there';
    case 'blocked':
      return 'You cannot send there';
    default:
      return null;
  }
}
