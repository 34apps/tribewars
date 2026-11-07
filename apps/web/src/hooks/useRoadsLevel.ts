import { useEffect, useState } from 'react';
import { applyRoads } from '@clanfire/engine';
import { api } from '../api.ts';
import { useGame } from '../game.ts';

// My tribe's finished Roads level (0-3) for travel-time previews. Read from GET /api/tribe (TribeDto.projectLevels) and
// cached for a minute; 0 without a tribe or while loading. The server applies the real bonus on send.

const CACHE_MS = 60_000;
let cache: { tribe: number; level: number; at: number } | null = null;

/** Travel time of a trip between two villages of the same tribe's members, with the Roads bonus (rounded up to the millisecond). */
export function withRoads(ms: number, level: number): number {
  return applyRoads(ms, level); // the same engine rule the server uses
}

/** `enabled`: only fetch when a tribe-mate's village is the target. */
export function useRoadsLevel(enabled: boolean): number {
  const { player } = useGame();
  const tribe = player.tribe?.id ?? null;
  const [level, setLevel] = useState(() => (cache && cache.tribe === tribe ? cache.level : 0));
  useEffect(() => {
    if (!enabled || tribe === null) return;
    if (cache && cache.tribe === tribe && Date.now() - cache.at < CACHE_MS) {
      setLevel(cache.level);
      return;
    }
    let live = true;
    api
      .myTribe()
      .then((res) => {
        const l = res.tribe?.projectLevels?.roads ?? 0;
        cache = { tribe, level: l, at: Date.now() };
        if (live) setLevel(l);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [enabled, tribe]);
  return enabled && tribe !== null ? level : 0;
}
