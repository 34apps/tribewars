// Hearth: Strike and Hold (docs/GAME_DESIGN.md 18.2). Pure rules; the server owns the claim records, movements and reports.
//
// Flow: a winning attack with Chieftains puts the hearth out (`checkStrike`, `applyStrike`). The claimant's occupiers are
// stationed at the village; `updateHold` runs the hold clock from the occupiers' population; when it ends the village
// changes owner (`applyOwnerChange`). While the hearth is out `settleVillage` freezes production and growth.
// Player villages can be struck since step 4 (HEARTH_PLAYERS_ENABLED); the pair cap (`pairCapReached`) limits repeat takes.

import {
  HEARTH_MAX_CHIEFTAINS,
  HEARTH_PLAYERS_ENABLED,
  HEARTH_POINTS_PER_CHIEFTAIN,
  HOLD_FAIL_HOURS,
  HOLD_HOURS,
  HOLD_HOURS_ABANDONED,
  HOLD_MIN_POPULATION,
  PAIR_CONQUEST_CAP,
  PAIR_CONQUEST_WINDOW_DAYS,
  POP_PER_UNIT,
  STRIKE_LOCK_HOURS,
  TAKE_KEEP_RESOURCE_SHARE,
} from './config.ts';
import { storageCap } from './economy.ts';
import { BUILDING_IDS, RESOURCE_IDS, UNIT_IDS } from './types.ts';
import type { BattleResult, HearthState, Units, VillageState, WorldSettings } from './types.ts';
import { MS_PER_HOUR, cloneVillage, emptyUnits, normalizeUnits } from './util.ts';
import { admitTroops, settleVillage } from './village.ts';

const hoursMs = (hours: number, s: WorldSettings): number => Math.round((hours * MS_PER_HOUR) / s.speed);

/** Population the occupiers take (POP_PER_UNIT per unit); this is what the hold clock looks at. */
export function occupierPopulation(units: Partial<Units>): number {
  const u = normalizeUnits(units);
  let pop = 0;
  for (const id of UNIT_IDS) pop += u[id] * POP_PER_UNIT[id];
  return pop;
}

// ---- Strike -------------------------------------------------------------------------------------

/** Chieftains a Strike needs: 1 for an abandoned village, else 1 + floor(points / HEARTH_POINTS_PER_CHIEFTAIN), at most HEARTH_MAX_CHIEFTAINS. */
export function chieftainsNeeded(abandoned: boolean, points: number): number {
  if (abandoned) return 1;
  const p = Number.isFinite(points) ? Math.max(0, points) : 0;
  return Math.min(HEARTH_MAX_CHIEFTAINS, 1 + Math.floor(p / HEARTH_POINTS_PER_CHIEFTAIN));
}

export interface StrikeTarget {
  abandoned: boolean;
  /** Village points (only matters for player villages). */
  points: number;
  now: number;
  lockUntil?: number;
  protectedUntil?: number;
}

export type StrikeFailReason = 'lost' | 'players_disabled' | 'protected' | 'locked' | 'too_few_chieftains';

export type StrikeCheck =
  | { ok: true; need: number; chieftains: number }
  | { ok: false; reason: StrikeFailReason; need: number; chieftains: number };

/**
 * Does this finished battle put the hearth out? Needs a won battle (every defender dead), a village that is not locked or
 * protected at `target.now`, and at least `need` surviving Chieftains. `survivors` is the attacking army after the battle
 * (`result.attackerSurvivors`). Player villages only when `HEARTH_PLAYERS_ENABLED` (or `opts.playersEnabled`). Never throws.
 */
export function checkStrike(
  result: Pick<BattleResult, 'attackerWon'>,
  survivors: Partial<Units>,
  target: StrikeTarget,
  opts: { playersEnabled?: boolean } = {},
): StrikeCheck {
  const need = chieftainsNeeded(target.abandoned, target.points);
  const chieftains = normalizeUnits(survivors).chieftain;
  const no = (reason: StrikeFailReason): StrikeCheck => ({ ok: false, reason, need, chieftains });
  if (!result.attackerWon) return no('lost');
  if (!target.abandoned && !(opts.playersEnabled ?? HEARTH_PLAYERS_ENABLED)) return no('players_disabled');
  if (target.protectedUntil !== undefined && target.now < target.protectedUntil) return no('protected');
  if (target.lockUntil !== undefined && target.now < target.lockUntil) return no('locked');
  if (chieftains < need) return no('too_few_chieftains');
  return { ok: true, need, chieftains };
}

/**
 * Put the hearth out at `now`: the village is settled to `now`, then gets a `hearth` for `claimBy` with the full hold time
 * (HOLD_HOURS_ABANDONED for an abandoned village, else HOLD_HOURS, divided by speed). `occupiers` are the troops that stay
 * (the surviving Chieftains and anything else stationed): the clock starts running at once only if they reach
 * HOLD_MIN_POPULATION, else it waits (and the claim fails after HOLD_FAIL_HOURS unless more occupiers arrive).
 * A hearth that was already out (another claimant) is replaced.
 */
export function applyStrike(
  state: VillageState,
  args: { claimBy: number; now: number; settings: WorldSettings; occupiers?: Partial<Units> },
): VillageState {
  const v = settleVillage(state, args.now, args.settings);
  const enough = occupierPopulation(args.occupiers ?? emptyUnits()) >= HOLD_MIN_POPULATION;
  v.hearth = {
    status: 'out',
    claimBy: args.claimBy,
    outAt: args.now,
    holdMs: hoursMs(v.npc ? HOLD_HOURS_ABANDONED : HOLD_HOURS, args.settings),
    runningSince: enough ? args.now : null,
    underSince: enough ? null : args.now,
  };
  return v;
}

// ---- Hold clock ---------------------------------------------------------------------------------

export type HoldOutcome = 'running' | 'paused' | 'taken' | 'failed' | 'relit';

export interface HoldUpdate {
  /** The hearth after the update; null when the claim ended ('taken', 'failed', 'relit'). */
  hearth: HearthState | null;
  outcome: HoldOutcome;
  /** When the outcome happened: the exact end time for 'taken'/'failed' (may be before `now`), else `now`. */
  at: number;
}

/**
 * Bring the hold clock to `now` and apply the occupiers' population `occupierPop` from `now` on. Call it at every event that
 * changes the occupiers (arrival, battle, recall) with the NEW population, and when a due time passes (`holdDueAt`).
 *  - Until `now` the clock followed the previous state: running hearths lose the elapsed time (exactly), paused ones wait.
 *  - The clock reaching zero exactly at `now` ends the claim ('taken'); a claim under the minimum for HOLD_FAIL_HOURS (÷ speed)
 *    ends 'failed' (exactly at underSince + that). An end that falls at or before `now` wins over any change at `now`.
 *  - Then: 0 population = 'relit' at once; >= HOLD_MIN_POPULATION = running; in between = paused (the "under" timer starts
 *    when the clock stopped and is reset when it runs again).
 * Pure: returns a new hearth.
 */
export function updateHold(hearth: HearthState, occupierPop: number, now: number, s: WorldSettings): HoldUpdate {
  let holdMs = hearth.holdMs;
  let underSince = hearth.underSince;
  if (hearth.runningSince !== null) {
    const end = hearth.runningSince + holdMs;
    if (end <= now) return { hearth: null, outcome: 'taken', at: end };
    holdMs = end - Math.max(now, hearth.runningSince);
  } else {
    underSince = underSince ?? now;
    const end = underSince + hoursMs(HOLD_FAIL_HOURS, s);
    if (end <= now) return { hearth: null, outcome: 'failed', at: end };
  }
  const pop = Number.isFinite(occupierPop) ? occupierPop : 0;
  if (pop <= 0) return { hearth: null, outcome: 'relit', at: now };
  if (pop >= HOLD_MIN_POPULATION) {
    return { hearth: { ...hearth, holdMs, runningSince: now, underSince: null }, outcome: 'running', at: now };
  }
  return {
    hearth: { ...hearth, holdMs, runningSince: null, underSince: hearth.runningSince !== null ? now : underSince },
    outcome: 'paused',
    at: now,
  };
}

/**
 * The next time the hold needs attention: when the clock reaches zero (running: `runningSince !== null`, outcome 'taken') or
 * when the claim fails for too long under the minimum (paused, outcome 'failed'). Both are exact; the server sets its due
 * event to this and calls `updateHold` at or after it.
 */
export function holdDueAt(hearth: HearthState, s: WorldSettings): number {
  if (hearth.runningSince !== null) return hearth.runningSince + hearth.holdMs;
  return (hearth.underSince ?? hearth.outAt) + hoursMs(HOLD_FAIL_HOURS, s);
}

// ---- Change of owner ----------------------------------------------------------------------------

/**
 * The hold ended: the village changes owner at `now`. Returns the village as the new owner's and the troops that did not fit.
 *  - Buildings keep ALL their levels (no level loss); stock is cut to TAKE_KEEP_RESOURCE_SHARE per resource.
 *  - The old owner's troops, units away, and build/training/research queues are gone (nothing refunded); researched units,
 *    ranks, Feast window and the hearth are reset; `npc` is removed (it is a player village now).
 *  - `renownPaid` is kept (raised to the current levels), so levels already paid for pay no Renown a second time.
 *  - `lockUntil` = now + STRIKE_LOCK_HOURS / speed: no Strike before it, raids stay possible.
 *  - The occupiers move in as the village's own troops up to its population cap. One Chieftain is used up (his ember lights the
 *    new hearth); further Chieftains and everyone who does not fit are returned as `overflow` (the server sends them home).
 * The village is settled to `now` first (it was frozen while the hearth was out).
 */
export function applyOwnerChange(
  state: VillageState,
  args: { newOwnerOccupiers: Partial<Units>; now: number; settings: WorldSettings },
): { state: VillageState; overflow: Units; chieftainUsed: number } {
  const { now, settings } = args;
  let v = settleVillage(state, now, settings);
  const paid = { ...(v.renownPaid as VillageState['buildings']) };
  for (const b of BUILDING_IDS) paid[b] = Math.max(paid[b], v.buildings[b]);
  delete v.hearth;
  delete v.npc;
  delete v.researched;
  delete v.researchQueue;
  delete v.ranks;
  delete v.feast;
  delete v.protectedUntil;
  v.renownPaid = paid;
  v.buildQueue = [];
  v.trainQueues = { barracks: [], stables: [], bannerhall: [] };
  v.troops = emptyUnits();
  v.away = emptyUnits();
  const cap = storageCap(v);
  for (const r of RESOURCE_IDS) v.resources[r] = Math.min(cap, Math.floor(v.resources[r] * TAKE_KEEP_RESOURCE_SHARE));
  v.lastUpdate = now;
  v.lockUntil = now + hoursMs(STRIKE_LOCK_HOURS, settings);
  v.defenceMark = { at: now, strength: 0 };
  const moved = admitTroops(cloneVillage(v), args.newOwnerOccupiers);
  v = moved.state;
  const chieftainUsed = moved.overflow.chieftain >= 1 ? 1 : 0;
  moved.overflow.chieftain -= chieftainUsed;
  return { state: v, overflow: moved.overflow, chieftainUsed };
}

/** Length of the pair-cap window in ms (PAIR_CONQUEST_WINDOW_DAYS divided by world speed). */
export function pairConquestWindowMs(s: WorldSettings): number {
  return hoursMs(PAIR_CONQUEST_WINDOW_DAYS * 24, s);
}

/** May the attacker take one more village from this victim? `takenInWindow` = villages already taken from them in the window. */
export function pairCapReached(takenInWindow: number): boolean {
  return takenInWindow >= PAIR_CONQUEST_CAP;
}

/** True while `v` may not be struck at `now` (locked after a change of owner, or protected). Raids are not affected by `lockUntil`. */
export function isStrikeBlocked(v: Pick<VillageState, 'lockUntil' | 'protectedUntil'>, now: number): boolean {
  return (v.lockUntil !== undefined && now < v.lockUntil) || (v.protectedUntil !== undefined && now < v.protectedUntil);
}

/** True while `v` cannot be attacked at all (founded or restarted village inside its protection time). */
export function isAttackBlocked(v: Pick<VillageState, 'protectedUntil'>, now: number): boolean {
  return v.protectedUntil !== undefined && now < v.protectedUntil;
}
