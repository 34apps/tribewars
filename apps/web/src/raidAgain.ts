// "Raid again" / "Scout again" on a report: opens the normal troop-sending screen (the map's tile panel) on the report's target with
// every troop field empty. Nothing is sent by the button. The send form then offers "Same as last time", which fills in what the
// report sent, capped by the troops at home (fillFromGroup). The player picks the amounts and presses the normal Send; the server
// still runs every normal send check.

import type { SendAgainDto } from '@clanfire/engine';
import type { LastTime } from './game.ts';

/** Button text: "Raid again" for an attack, "Scout again" for scouting. */
export function againLabel(again: Pick<SendAgainDto, 'mission'>): string {
  return again.mission === 'scout' ? 'Scout again' : 'Raid again';
}

/** What the send form gets: the earlier troops (offered, never filled by themselves) and the village they left from. */
export function lastTimeOf(again: Pick<SendAgainDto, 'units' | 'fromVillageId'>): LastTime {
  const units: LastTime['units'] = {};
  for (const [u, n] of Object.entries(again.units)) if (n > 0) units[u as keyof typeof units] = n;
  return { units, fromVillageId: again.fromVillageId };
}
