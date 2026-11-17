// Start-up work for the Village page, begun as early as the entry point can (while the game state is still on its way): fetch the
// building drawings the last visit used, and read + decode the kept still landscape picture. Both are heads-ups only: nothing waits
// for them, and a missing one just means the page does that work itself when it needs it.

import { warmRememberedSprites } from './art/buildings.ts';
import { restoreBackPics } from './views/village/backPics.ts';

export function warmVillage(): void {
  warmRememberedSprites();
  void restoreBackPics();
}
