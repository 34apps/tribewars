// Domination win condition (docs/GAME_DESIGN.md, "Winning the world"): a tribe that holds a big enough share of all
// player-owned village points, in a world that is old enough and has enough active players, for long enough, wins and the
// world ends. Pure rules only: the server collects the numbers (ranking queries, active players) and stores the streak start.

import { DOMINATION_DEFAULTS, DOMINATION_EVAL_INTERVAL_MINUTES, DOMINATION_LIMITS, DOMINATION_TOP_TRIBES } from './config.ts';
import type { CheckResult, DominationSettings } from './types.ts';
import { fail, MS_PER_HOUR } from './util.ts';

const MS_PER_DAY = 24 * MS_PER_HOUR;

export const DOMINATION_KEYS = Object.keys(DOMINATION_DEFAULTS) as Array<keyof DominationSettings>;

export function isDominationKey(v: unknown): v is keyof DominationSettings {
  return typeof v === 'string' && (DOMINATION_KEYS as readonly string[]).includes(v);
}

/** One value checked against its range; the operator tool reports the message. */
export function checkDominationValue(key: keyof DominationSettings, value: unknown): CheckResult<{ value: number }> {
  const lim = DOMINATION_LIMITS[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail('invalid_input', `${key} must be a number.`);
  if (value < lim.min || value > lim.max) return fail('invalid_input', `${key} must be between ${lim.min} and ${lim.max}.`);
  if (lim.integer && !Number.isInteger(value)) return fail('invalid_input', `${key} must be a whole number.`);
  return { ok: true, value };
}

/**
 * Stored settings (possibly missing, partial or damaged) -> a complete valid set. A missing or out-of-range key
 * falls back to its default, so a database from before this rule simply uses DOMINATION_DEFAULTS.
 */
export function mergeDominationSettings(raw: unknown): DominationSettings {
  const src = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const out = { ...DOMINATION_DEFAULTS };
  for (const key of DOMINATION_KEYS) {
    const v = src[key];
    if (v !== undefined && checkDominationValue(key, v).ok) out[key] = v as number;
  }
  return out;
}

// ---- durations: real time = days / world speed -------------------------------------------------------------------

const scaled = (days: number, speed: number): number => (days * MS_PER_DAY) / speed;

/** The world must be at least this old (ms) before a tribe can win. */
export const dominationMinAgeMs = (d: DominationSettings, speed: number): number => scaled(d.minAgeDays, speed);
/** The streak a tribe must keep (ms). */
export const dominationStreakMs = (d: DominationSettings, speed: number): number => scaled(d.streakDays, speed);
/** A player who played within this long (ms) counts as active. */
export const dominationActiveMs = (d: DominationSettings, speed: number): number => scaled(d.activeDays, speed);
/** The lazy evaluation runs at most this often (ms). */
export const dominationEvalIntervalMs = (speed: number): number => (DOMINATION_EVAL_INTERVAL_MINUTES * 60_000) / speed;

/** The settings in real days after speed scaling (what players see). Rounded to 2 decimals. */
export function dominationRealDays(d: DominationSettings, speed: number): { minAgeDays: number; streakDays: number; activeDays: number } {
  const r2 = (x: number): number => Math.round((x / speed) * 100) / 100;
  return { minAgeDays: r2(d.minAgeDays), streakDays: r2(d.streakDays), activeDays: r2(d.activeDays) };
}

/** Effective minimum of active players: the configured one, but at least `minPeakShare` of the peak (rounded up, exact integer maths). */
export function minActivePlayersNeeded(d: DominationSettings, peakActive: number): number {
  const share = Math.round(d.minPeakShare * 10_000);
  const fromPeak = Math.floor((Math.max(0, Math.floor(peakActive)) * share + 9_999) / 10_000);
  return Math.max(d.minActivePlayers, fromPeak);
}

/** points / total >= winShare, by integer cross-multiplication (winShare in whole 0.01% steps): exactly 75% qualifies, 74.99% does not. */
export function meetsWinShare(points: number, total: number, winShare: number): boolean {
  if (total <= 0) return false;
  return points * 10_000 >= total * Math.round(winShare * 10_000);
}

// ---- evaluation ---------------------------------------------------------------------------------------------------

export interface DominationTribeInput {
  tribeId: number;
  name: string;
  tag: string;
  /** Sum of the points of all villages owned by the tribe's members. */
  points: number;
}

export interface DominationStreak {
  tribeId: number;
  startedAt: number;
}

export interface DominationInput {
  now: number;
  speed: number;
  /** When the world was created (ms). */
  worldCreatedAt: number;
  settings: DominationSettings;
  /** Active players now (accounts sharing an IP counted once, banned and test accounts left out). */
  activePlayers: number;
  /** Highest number of active players seen before this evaluation. */
  peakActivePlayers: number;
  /** All tribes (any order). */
  tribes: readonly DominationTribeInput[];
  /** Points of all villages owned by players; abandoned villages are not in it. */
  totalPoints: number;
  /** The streak stored by the last evaluation, or null. */
  streak: DominationStreak | null;
}

export interface DominationTribeShare extends DominationTribeInput {
  /** points / totalPoints, 0..1. */
  share: number;
}

export interface DominationEvaluation {
  worldAgeMs: number;
  ageOk: boolean;
  activePlayers: number;
  /** max(previous peak, activePlayers): store it. */
  peakActivePlayers: number;
  /** Effective minimum of active players. */
  minActivePlayers: number;
  playersOk: boolean;
  /** The tribe with the most points (the running streak's tribe wins a tie), or null when nobody owns points. */
  leader: DominationTribeShare | null;
  topTribes: DominationTribeShare[];
  totalPoints: number;
  /** The leader holds at least the win share. */
  shareOk: boolean;
  /** Age, players and share all hold. */
  qualifies: boolean;
  /** The streak after this evaluation (store it; null clears it). */
  streak: DominationStreak | null;
  /** The streak has run long enough: that tribe wins. */
  won: boolean;
  /** startedAt + streak length: the exact moment the win happened (set when `won`). */
  wonAt: number | null;
  /** Real-time ms the streak must run. */
  streakNeededMs: number;
  /** Plain-language reasons the world does not count yet (empty when everything holds). */
  reasons: string[];
}

/** 1 decimal, no trailing ".0". */
function num(x: number): string {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** "1 day", "40 days", "0.3 days". */
function days(x: number): string {
  const n = num(x);
  return `${n} ${n === '1' ? 'day' : 'days'}`;
}

/** A share as text, rounded DOWN to 0.1% so "74.99%" never reads as the needed "75%". */
function pct(share: number): string {
  return num(Math.floor(share * 1000 + 1e-9) / 10);
}

export function evaluateDomination(input: DominationInput): DominationEvaluation {
  const { now, speed, settings: d } = input;
  const worldAgeMs = Math.max(0, now - input.worldCreatedAt);
  const minAgeMs = dominationMinAgeMs(d, speed);
  const ageOk = worldAgeMs >= minAgeMs;

  const peak = Math.max(input.peakActivePlayers, input.activePlayers);
  const minActive = minActivePlayersNeeded(d, peak);
  const playersOk = input.activePlayers >= minActive;

  const total = input.totalPoints;
  const streakTribe = input.streak?.tribeId ?? null;
  const ranked: DominationTribeShare[] = input.tribes
    .map((t) => ({ ...t, share: total > 0 ? t.points / total : 0 }))
    .sort((a, b) => b.points - a.points || (a.tribeId === streakTribe ? -1 : 0) - (b.tribeId === streakTribe ? -1 : 0) || a.tribeId - b.tribeId);
  const top = ranked[0];
  const leader = total > 0 && top && top.points > 0 ? top : null;
  const shareOk = leader !== null && meetsWinShare(leader.points, total, d.winShare);
  const qualifies = ageOk && playersOk && shareOk;

  let streak: DominationStreak | null = null;
  if (qualifies && leader) {
    streak = input.streak && input.streak.tribeId === leader.tribeId ? input.streak : { tribeId: leader.tribeId, startedAt: now };
  }
  const streakNeededMs = dominationStreakMs(d, speed);
  const won = streak !== null && now - streak.startedAt >= streakNeededMs;

  const reasons: string[] = [];
  if (!ageOk) reasons.push(`The world is ${days(worldAgeMs / MS_PER_DAY)} old; domination counts from day ${num(minAgeMs / MS_PER_DAY)}.`);
  if (!playersOk) {
    const activeDaysReal = num(dominationActiveMs(d, speed) / MS_PER_DAY);
    const window = activeDaysReal === '7' ? 'this week' : `in the last ${activeDaysReal} days`;
    reasons.push(`Only ${input.activePlayers} player${input.activePlayers === 1 ? ' was' : 's were'} active ${window}; at least ${minActive} ${minActive === 1 ? 'is' : 'are'} needed.`);
  }
  if (leader === null) reasons.push('No player owns a village yet.');
  else if (!shareOk) reasons.push(`${leader.name} hold${/s$/i.test(leader.name) ? '' : 's'} ${pct(leader.share)}% of village points; ${num(d.winShare * 100)}% is needed.`);

  return {
    worldAgeMs,
    ageOk,
    activePlayers: input.activePlayers,
    peakActivePlayers: peak,
    minActivePlayers: minActive,
    playersOk,
    leader,
    topTribes: ranked.slice(0, DOMINATION_TOP_TRIBES),
    totalPoints: total,
    shareOk,
    qualifies,
    streak,
    won,
    wonAt: won && streak ? streak.startedAt + streakNeededMs : null,
    streakNeededMs,
    reasons,
  };
}
