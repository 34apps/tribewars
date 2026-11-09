// Pure helpers of the unit info cards (components/UnitInfo.tsx, no React, unit-tested): bars against the strongest unit, the
// minutes-per-field text, flipping through the units, and the "in training" counts. Every number comes from the engine's UNITS.

import { UNITS, emptyUnits } from '@clanfire/engine';
import type { TrainJob, UnitId, Units } from '@clanfire/engine';

export type StatKey = 'attack' | 'defenseInfantry' | 'defenseCavalry';

export interface StatBar {
  key: StatKey;
  label: string;
  value: number;
  /** The best value over all units, and who has it (first in list order on a tie). */
  max: number;
  best: UnitId;
  /** Bar fill 0..100 (a small stub for zero so the bar never vanishes). */
  pct: number;
}

const LABELS: Record<StatKey, string> = { attack: 'Attack', defenseInfantry: 'Defence vs foot', defenseCavalry: 'Defence vs riders' };
export const STAT_KEYS: readonly StatKey[] = ['attack', 'defenseInfantry', 'defenseCavalry'];

/** The unit with the highest value of one stat. */
export function strongest(units: readonly UnitId[], key: StatKey): { unit: UnitId; value: number } {
  let best = units[0] as UnitId;
  for (const u of units) if (UNITS[u][key] > UNITS[best][key]) best = u;
  return { unit: best, value: UNITS[best][key] };
}

/** The three fighting bars of one unit measured against the strongest unit of `units`. */
export function statBars(unit: UnitId, units: readonly UnitId[]): StatBar[] {
  return STAT_KEYS.map((key) => {
    const top = strongest(units, key);
    const value = UNITS[unit][key];
    const pct = top.value > 0 ? Math.max(3, Math.min(100, Math.round((value / top.value) * 100))) : 0;
    return { key, label: LABELS[key], value, max: top.value, best: top.unit, pct };
  });
}

/** "10:00" for the time one field takes (minutes:seconds; hours roll into minutes like the card shows). */
export function perFieldText(ms: number): string {
  if (!Number.isFinite(ms)) return '–';
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** The next (dir 1) or previous (dir -1) unit in the list, wrapping round. A unit not in the list gives the first. */
export function flipUnit(units: readonly UnitId[], current: UnitId, dir: 1 | -1): UnitId {
  const i = units.indexOf(current);
  if (i < 0) return units[0] as UnitId;
  return units[(i + dir + units.length) % units.length] as UnitId;
}

/** Units still waiting in the training queues. */
export function inTraining(queues: Record<string, readonly TrainJob[]>): Units {
  const out = emptyUnits();
  for (const q of Object.values(queues)) for (const j of q) out[j.unit] += Math.max(0, j.count - j.done);
  return out;
}

/** "12 at home · 4 away · 5 training" (parts with zero are left out except home). */
export function stockLine(home: number, away: number, training: number): string {
  const parts = [`${home} at home`];
  if (away > 0) parts.push(`${away} away`);
  if (training > 0) parts.push(`${training} training`);
  return parts.join(' · ');
}
