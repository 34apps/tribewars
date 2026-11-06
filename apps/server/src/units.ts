// Small unit-count arithmetic for the movement code (the engine's Units maps always carry every UnitId).

import { UNIT_IDS, emptyUnits, type Units } from '@clanfire/engine';

export function addUnits(a: Units, b: Units): Units {
  const out = emptyUnits();
  for (const u of UNIT_IDS) out[u] = a[u] + b[u];
  return out;
}

/** a - b, never below zero. */
export function subtractUnits(a: Units, b: Units): Units {
  const out = emptyUnits();
  for (const u of UNIT_IDS) out[u] = Math.max(0, a[u] - b[u]);
  return out;
}

export function sumUnits(list: readonly Units[]): Units {
  return list.reduce(addUnits, emptyUnits());
}

/** True when every count in `want` is available in `have`. */
export function isWithin(want: Units, have: Units): boolean {
  return UNIT_IDS.every((u) => want[u] <= have[u]);
}

/** Pathfinders and nothing else (at least one): such an attack is a scouting march. */
export function isScoutArmy(army: Units): boolean {
  return army.pathfinder > 0 && UNIT_IDS.every((u) => u === 'pathfinder' || army[u] === 0);
}

/** Units with only `unit` set to `count`. */
export function only(unit: (typeof UNIT_IDS)[number], count: number): Units {
  const out = emptyUnits();
  out[unit] = count;
  return out;
}

/**
 * Spread `loss` defending Pathfinders over the village's own and the stationed contingents: the village's own
 * go first, whatever is left is split between contingents in proportion to how many they hold (largest
 * remainder; ties go to the older contingent). Never takes more than a group has.
 */
export function splitScoutLosses(own: number, contingents: readonly number[], loss: number): { own: number; support: number[] } {
  const ownLoss = Math.min(own, Math.max(0, loss));
  const total = contingents.reduce((a, b) => a + b, 0);
  const rest = Math.min(Math.max(0, loss) - ownLoss, total);
  const support = contingents.map(() => 0);
  if (rest === 0 || total === 0) return { own: ownLoss, support };

  const exact = contingents.map((c) => (rest * c) / total);
  let given = 0;
  exact.forEach((x, i) => {
    support[i] = Math.floor(x);
    given += support[i] ?? 0;
  });
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (given >= rest) break;
    if ((support[i] ?? 0) < (contingents[i] ?? 0)) {
      support[i] = (support[i] ?? 0) + 1;
      given++;
    }
  }
  return { own: ownLoss, support };
}
