import { useGame } from '../game.ts';
import { autoTabOn } from '../auto.ts';

/** Show the Auto tab? True while the world has the premium tools (`features.premium`, from the rules that arrive with the game state).
 *  A player without the tools still sees the page, greyed with a note; the server enforces the entitlement on every call. */
export function useAutoTab(): boolean {
  return autoTabOn(useGame().settings?.config);
}
