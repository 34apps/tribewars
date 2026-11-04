// Picks which landscape the village scene draws outside the walls. 'current' is the default for everyone; A, B and C are
// options the owner switches between live in the test-mode design preview (Landscape dropdown) until one is chosen.

import { Landscape } from './landscape.tsx';
import { LandscapeA } from './landscapeA.tsx';
import { LandscapeB } from './landscapeB.tsx';
import { LandscapeC } from './landscapeC.tsx';

/** The current landscape (default) or one of the three options. */
export type LandscapeChoice = 'current' | 'A' | 'B' | 'C';

export function LandscapeLayer({ choice, tier, wide }: { choice: LandscapeChoice; tier: number; wide: boolean }) {
  switch (choice) {
    case 'A':
      return <LandscapeA tier={tier} wide={wide} />;
    case 'B':
      return <LandscapeB tier={tier} wide={wide} />;
    case 'C':
      return <LandscapeC tier={tier} wide={wide} />;
    default:
      return <Landscape tier={tier} wide={wide} />;
  }
}
