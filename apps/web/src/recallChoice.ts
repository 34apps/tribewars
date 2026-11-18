// What a "Call back" / "Recall" form asks for: the typed amounts per unit type, cut to whole numbers between 0 and what stands there.

import { UNIT_IDS } from '@clanfire/engine';
import type { UnitId, Units } from '@clanfire/engine';

export function recallChoice(have: Units, counts: Partial<Record<UnitId, string>>): { chosen: Partial<Units>; total: number } {
  const chosen: Partial<Units> = {};
  let total = 0;
  for (const u of UNIT_IDS) {
    if (!(have[u] > 0)) continue;
    const n = Number(counts[u] ?? '');
    const v = Number.isInteger(n) ? Math.max(0, Math.min(have[u], n)) : 0;
    if (v > 0) {
      chosen[u] = v;
      total += v;
    }
  }
  return { chosen, total };
}
