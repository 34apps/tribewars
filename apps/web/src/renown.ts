// Client helpers for Renown and the Feast (docs/GAME_DESIGN.md section 18.2). Pure functions on engine numbers; the server
// decides everything, these only keep the buttons and steppers honest. No React, no art imports (unit-tested).

import { FEAST_COST, FEAST_DAILY_PER_LEVEL, RESOURCE_IDS } from '@clanfire/engine';
import type { FeastAllowanceDto, RenownInfo, Resources } from '@clanfire/engine';

/**
 * The Feast allowance as it stands at `now` for a Banner Hall of `level`: the server's number can be a few seconds old, so a
 * window that has ended since counts as empty and a level that finished since raises the maximum. Only a preview.
 */
export function currentFeastAllowance(a: FeastAllowanceDto, level: number, now: number): FeastAllowanceDto {
  const max = FEAST_DAILY_PER_LEVEL * Math.max(0, Math.floor(level));
  const open = a.windowEnd !== null && now < a.windowEnd;
  const used = open ? Math.min(max, Math.max(0, a.used)) : 0;
  return { max, used, left: Math.max(0, max - used), windowEnd: open ? a.windowEnd : null };
}

/** Most Feasts the village can pay for right now and is still allowed today (>= 0). `left` is feastAllowance.left. */
export function feastMaxCount(resources: Resources, left: number, cost: Resources = FEAST_COST): number {
  let n = Number.isFinite(left) ? Math.max(0, Math.floor(left)) : 0;
  for (const r of RESOURCE_IDS) {
    if (cost[r] > 0) n = Math.min(n, Math.floor((resources[r] + 1e-9) / cost[r]));
  }
  return Math.max(0, n);
}

/** Keep a stepper value inside 1..max (0 when nothing is possible). */
export function clampFeastCount(count: number, max: number): number {
  if (max < 1) return 0;
  if (!Number.isFinite(count)) return 1;
  return Math.min(max, Math.max(1, Math.floor(count)));
}

/** The Feast bundle times `count`. */
export function feastTotal(count: number, cost: Resources = FEAST_COST): Resources {
  const out = { ...cost };
  for (const r of RESOURCE_IDS) out[r] = cost[r] * Math.max(0, count);
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
