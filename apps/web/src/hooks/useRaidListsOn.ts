import { useGame } from '../game.ts';

/** Is the raid-list extra switched on in this world? Read from the rules that arrive with the game state (no extra request). */
export function useRaidListsOn(): boolean {
  return useGame().settings?.config?.features.raidLists === true;
}
