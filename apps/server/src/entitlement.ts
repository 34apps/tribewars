// Paid extras of a player right now: the operator-set bits (players.premium) plus Premium bought with Flames in the lobby shop
// (players.premium_until, copied from the entry pass claim `prm`). Flames Premium counts as all three paid bits while it is active.
// Always pass the server clock, so expiry takes effect at the very next request.

import { EXTRA_PREMIUM_TOOLS, EXTRA_RAID_LISTS, EXTRA_WIDE_OVERVIEW } from '@clanfire/engine';

export const FLAMES_PREMIUM_BITS = EXTRA_PREMIUM_TOOLS | EXTRA_WIDE_OVERVIEW | EXTRA_RAID_LISTS;

/** The paid-extra bits in force for this player at `now` (ms). The world switches (features.*) are checked by the callers. */
export function effectivePremium(p: { premium: number; premiumUntil: number }, now: number): number {
  return p.premiumUntil > now ? p.premium | FLAMES_PREMIUM_BITS : p.premium;
}
