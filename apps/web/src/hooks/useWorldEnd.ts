import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorldEndDto } from '@clanfire/engine';
import { api } from '../api.ts';
import { WORLD_ENDED_EVENT } from '../domination.ts';
import { useLiveTopic } from './useLive.tsx';

export interface WorldEndStore {
  /** The frozen result once the world has ended, else null. */
  end: WorldEndDto | null;
  /** True once the end was learned from the live hint or the first check (not from a refused order): the app may show the results screen. */
  fresh: boolean;
}

/**
 * GET /api/world-end at start, on the live hint 'world', and when any order is refused with "This world has ended."
 * (api.ts fires WORLD_ENDED_EVENT). Once ended nothing changes, so the check stops. A failing call counts as "not ended".
 */
export function useWorldEnd(): WorldEndStore {
  const [end, setEnd] = useState<WorldEndDto | null>(null);
  const [fresh, setFresh] = useState(false);
  const done = useRef(false);

  const check = useCallback((viaRefusal: boolean) => {
    if (done.current) return;
    api
      .worldEnd()
      .then((r) => {
        if (done.current || !r.ended) return;
        done.current = true;
        setEnd(r.ended);
        setFresh(!viaRefusal);
      })
      .catch(() => {
        // Older server or a hiccup: the world simply counts as running; the next hint or refusal asks again.
      });
  }, []);

  useEffect(() => {
    check(false);
    const onRefused = () => check(true);
    window.addEventListener(WORLD_ENDED_EVENT, onRefused);
    return () => window.removeEventListener(WORLD_ENDED_EVENT, onRefused);
  }, [check]);

  useLiveTopic('world', () => check(false));

  return { end, fresh };
}
