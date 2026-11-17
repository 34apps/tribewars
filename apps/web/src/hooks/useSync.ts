import { useCallback } from 'react';
import { useGame } from '../game.ts';
import { firstStepsOpen } from '../firstSteps.ts';

/**
 * What an action does after its response: the response is already applied (applyVillage / applySend), so no full state refetch.
 * Fetch anyway when the call failed (the screen may be stale), when the action changes data outside the village
 * (`outside`: Renown, a new village, the War Chest), or while the First steps card still shows an open step
 * (the server marks those from build, train and raid actions and only the state carries it).
 */
export function useSync(): (ok: boolean, outside?: boolean) => void {
  const { refresh, firstSteps } = useGame();
  const open = firstStepsOpen(firstSteps);
  return useCallback(
    (ok: boolean, outside = false) => {
      if (!ok || outside || open) void refresh();
    },
    [refresh, open],
  );
}
