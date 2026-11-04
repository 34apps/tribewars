// Picks which landscape the village scene draws outside the walls. 'tiles' (map tiles, owner decision 2026-11-04) is the default
// for everyone; 'current' (the drawn one), A, B and C stay as options in the test-mode design preview (Landscape dropdown).

import { Landscape } from './landscape.tsx';
import { LandscapeA } from './landscapeA.tsx';
import { LandscapeB } from './landscapeB.tsx';
import { LandscapeC } from './landscapeC.tsx';
import { LandscapeTiles } from './landscapeTiles.tsx';

/** Map tiles (default), the drawn landscape or one of the three options. */
export type LandscapeChoice = 'tiles' | 'current' | 'A' | 'B' | 'C';

export function LandscapeLayer({ choice, tier, wide }: { choice: LandscapeChoice; tier: number; wide: boolean }) {
  switch (choice) {
    case 'current':
      return <Landscape tier={tier} wide={wide} />;
    case 'A':
      return <LandscapeA tier={tier} wide={wide} />;
    case 'B':
      return <LandscapeB tier={tier} wide={wide} />;
    case 'C':
      return <LandscapeC tier={tier} wide={wide} />;
    default:
      return <LandscapeTiles tier={tier} wide={wide} />;
  }
}
