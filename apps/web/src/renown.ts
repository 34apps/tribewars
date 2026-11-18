// Client helpers for Renown and the Feast (docs/GAME_DESIGN.md section 18.2). Pure functions on engine numbers; the server
// decides everything, these only keep the buttons and steppers honest. No React, no art imports (unit-tested).

import { BUILDINGS, FEAST_LEVEL_DISCOUNT, FEAST_MAX_COUNT, RESOURCE_IDS, feastPrice } from '@clanfire/engine';
import type { RenownInfo, Resources } from '@clanfire/engine';

/** Price of one Feast at a Banner Hall of `level` (engine `feastPrice`: the level discount is already in). */
export { feastPrice };

/** Discount a Banner Hall of `level` gives on the Feast price, as a whole percent (0 at level 0-1, 30 at level 4). */
export function feastDiscountPercent(level: number): number {
  return Math.round(FEAST_LEVEL_DISCOUNT * 100 * Math.max(0, Math.floor(level) - 1));
}

/** Discount of the next Banner Hall level in percent, or null when the level is the highest. */
export function nextFeastDiscountPercent(level: number): number | null {
  const l = Math.max(1, Math.floor(level));
  return l >= BUILDINGS.bannerhall.maxLevel ? null : feastDiscountPercent(l + 1);
}

/** Most Feasts the village can pay for right now (0..FEAST_MAX_COUNT): limited only by the scarcest resource. */
export function feastMaxCount(resources: Resources, price: Resources): number {
  let n = FEAST_MAX_COUNT;
  for (const r of RESOURCE_IDS) {
    if (price[r] > 0) n = Math.min(n, Math.floor((resources[r] + 1e-9) / price[r]));
  }
  return Math.max(0, n);
}

/** Keep an amount inside 1..max (0 when nothing is possible); typed junk becomes 1. */
export function clampFeastCount(count: number, max: number): number {
  if (max < 1) return 0;
  if (!Number.isFinite(count)) return 1;
  return Math.min(max, Math.max(1, Math.floor(count)));
}

/** One Feast's price times `count`. */
export function feastTotal(count: number, price: Resources): Resources {
  const out = { ...price };
  for (const r of RESOURCE_IDS) out[r] = price[r] * Math.max(0, count);
  return out;
}

/** Renown still missing for the next village (0 when there is enough). */
export function renownToGo(info: Pick<RenownInfo, 'balance' | 'nextVillageCost'>): number {
  return Math.max(0, info.nextVillageCost - info.balance);
}

/** 0..1 progress of the balance towards the next village's price. */
export function renownProgress(info: Pick<RenownInfo, 'balance' | 'nextVillageCost'>): number {
  if (!(info.nextVillageCost > 0)) return 1;
  return Math.min(1, Math.max(0, info.balance / info.nextVillageCost));
}
