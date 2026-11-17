import { useEffect, useState } from 'react';
import { useGame } from '../game.ts';
import { loadRaidListsCached } from '../raidListsCache.ts';

/** Is the raid-list extra switched on in this world? Read from the rules that arrive with the game state (no extra request). */
export function useRaidListsOn(): boolean {
  return useGame().settings?.config?.features.raidLists === true;
}

/** Does this player have the extra (world switch on AND the entitlement)? One shared GET /api/raid-lists answer, reused for a minute;
 *  false until it has arrived and after a failure. The server enforces both on every call; this only decides which links to show. */
export function useRaidListsEntitled(): boolean {
  return useRaidListsAccess() === 'yes';
}

/** 'off' = the world does not have the feature; 'unknown' = not answered yet (or failed); 'yes' = tab and page; 'no' = the world has it but this
 *  player does not (the Army page then offers the "Raid lists (paid extra)" button). */
export type RaidListsAccess = 'off' | 'unknown' | 'yes' | 'no';
export function useRaidListsAccess(): RaidListsAccess {
  const on = useRaidListsOn();
  const [entitled, setEntitled] = useState<boolean | null>(null);
  useEffect(() => {
    if (!on) {
      setEntitled(null);
      return;
    }
    let dead = false;
    loadRaidListsCached().then(
      (r) => {
        if (!dead) setEntitled(r.entitled === true);
      },
      () => undefined,
    );
    return () => {
      dead = true;
    };
  }, [on]);
  return !on ? 'off' : entitled === null ? 'unknown' : entitled ? 'yes' : 'no';
}
