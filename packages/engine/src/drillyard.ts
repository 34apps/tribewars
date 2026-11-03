// Drillyard: unit research (once per village) and Training-Point ranks. See docs/GAME_DESIGN.md sections 4 and 15.

import {
  DRILLYARD_POINTS_PER_LEVEL,
  KEEN_BONUS,
  MAX_RESEARCH_QUEUE,
  RANK_BONUS,
  RANK_COST,
  RANK_MAX,
  SCOUT_APPROX_STEP,
  SCOUT_INTEL_KEEN,
  SCOUT_UNIT,
  UNITS,
} from './config.ts';
import { canAfford, storageCap } from './economy.ts';
import type { ScoutIntel } from './api.ts';
import { GameError, RANK_TRACKS, RESOURCE_IDS, UNIT_IDS } from './types.ts';
import type {
  BuildingLevels,
  CheckResult,
  RankTrack,
  Resources,
  UnitId,
  UnitRanks,
  Units,
  VillageRanks,
  VillageState,
  WorldSettings,
} from './types.ts';
import { emptyResources, fail, isUnitId } from './util.ts';
import { addRefund, refundOf, settleVillage } from './village.ts';

const isTrack = (x: unknown): x is RankTrack => typeof x === 'string' && (RANK_TRACKS as readonly string[]).includes(x);

// ---- Research -----------------------------------------------------------------------------------

/** May this unit be trained here? Units without a `research` rule are always open. */
export function isResearched(state: VillageState, u: UnitId): boolean {
  return !UNITS[u].research || (state.researched ?? []).includes(u);
}

/** Research time in ms (world speed applied). */
export function researchTimeMs(u: UnitId, s: WorldSettings): number {
  const rule = UNITS[u].research;
  return rule ? Math.max(1, Math.round((rule.timeSec / s.speed) * 1000)) : 0;
}

interface ResearchPlan {
  unit: UnitId;
  cost: Resources;
  timeMs: number;
}

function planResearch(v: VillageState, u: unknown, s: WorldSettings, queueLimit: number): CheckResult<ResearchPlan> {
  if (!isUnitId(u)) return fail('invalid_input', 'Unknown unit.');
  const rule = UNITS[u].research;
  if (!rule) return fail('invalid_input', `${UNITS[u].name} needs no research.`);
  if (isResearched(v, u)) return fail('invalid_input', `${UNITS[u].name} is already researched.`);
  const queue = v.researchQueue ?? [];
  if (queue.some((j) => j.unit === u)) return fail('invalid_input', `${UNITS[u].name} is already being researched.`);
  if (queue.length >= queueLimit) return fail('queue_full', 'The research queue is full.');
  if (v.buildings.drillyard < rule.drillyard) {
    return fail('requirements_not_met', `Requires Drillyard level ${rule.drillyard}.`);
  }
  const cap = storageCap(v);
  for (const r of RESOURCE_IDS) {
    if (rule.cost[r] > cap) return fail('exceeds_storage', 'The cost is more than the storehouse can hold. Upgrade the Storehouse first.');
  }
  if (!canAfford(v.resources, rule.cost)) return fail('not_enough_resources', 'Not enough resources.');
  return { ok: true, unit: u, cost: { ...rule.cost }, timeMs: researchTimeMs(u, s) };
}

/** Can research of `u` start at time t? Never throws. */
export function checkResearch(
  state: VillageState,
  u: UnitId | (string & {}),
  t: number,
  s: WorldSettings,
  queueLimit: number = MAX_RESEARCH_QUEUE,
): CheckResult<{ cost: Resources; timeMs: number }> {
  if (!Number.isFinite(t)) return fail('invalid_input', 'Invalid time.');
  const plan = planResearch(settleVillage(state, t, s), u, s, queueLimit);
  if (!plan.ok) return plan;
  return { ok: true, cost: plan.cost, timeMs: plan.timeMs };
}

/** Settle to t, pay and start the research. Throws GameError with the check's reason when invalid. */
export function applyResearch(
  state: VillageState,
  u: UnitId | (string & {}),
  t: number,
  s: WorldSettings,
  queueLimit: number = MAX_RESEARCH_QUEUE,
): VillageState {
  if (!Number.isFinite(t)) throw new GameError('invalid_input', 'Invalid time.');
  const v = settleVillage(state, t, s);
  const plan = planResearch(v, u, s, queueLimit);
  if (!plan.ok) throw new GameError(plan.reason, plan.message);
  for (const r of RESOURCE_IDS) v.resources[r] -= plan.cost[r];
  const queue = (v.researchQueue ??= []);
  const startAt = queue.length > 0 ? queue[queue.length - 1]!.finishAt : v.lastUpdate;
  queue.push({ unit: plan.unit, startAt, finishAt: startAt + plan.timeMs });
  return v;
}

/**
 * Settle to t and cancel the queued research at `index` (0 = running). CANCEL_REFUND_PERCENT of its cost comes
 * back (never above the storehouse); the unit stays unresearched. Later jobs move up: if the running one was
 * cancelled the next starts now, otherwise they start when the job before them ends.
 */
export function applyCancelResearch(
  state: VillageState,
  index: number,
  t: number,
  s: WorldSettings,
): { state: VillageState; refund: Resources } {
  if (!Number.isFinite(t)) throw new GameError('invalid_input', 'Invalid time.');
  const v = settleVillage(state, t, s);
  const queue = v.researchQueue ?? [];
  const job = Number.isInteger(index) ? queue[index] : undefined;
  if (!job) throw new GameError('invalid_input', 'No such research in the queue.');
  const rule = UNITS[job.unit].research;
  queue.splice(index, 1);
  let cursor = index === 0 ? v.lastUpdate : queue[0]!.startAt;
  for (const j of queue) {
    const dur = j.finishAt - j.startAt;
    j.startAt = cursor;
    j.finishAt = cursor + dur;
    cursor = j.finishAt;
  }
  if (queue.length === 0) delete v.researchQueue;
  const refund = refundOf(rule ? rule.cost : emptyResources());
  addRefund(v, refund);
  return { state: v, refund };
}

// ---- Ranks --------------------------------------------------------------------------------------

export const emptyRanks = (): UnitRanks => ({ might: 0, bulwark: 0, keen: 0 });

/** Rank of one track (0 when none). */
export function rankOf(ranks: VillageRanks | undefined, u: UnitId, track: RankTrack): number {
  const n = ranks?.[u]?.[track];
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(RANK_MAX, Math.floor(n))) : 0;
}

/** Attack multiplier from Might (1 when no rank). */
export function mightMultiplier(ranks: VillageRanks | undefined, u: UnitId): number {
  return 1 + RANK_BONUS * rankOf(ranks, u, 'might');
}

/** Multiplier for both defences from Bulwark (1 when no rank). */
export function bulwarkMultiplier(ranks: VillageRanks | undefined, u: UnitId): number {
  return 1 + RANK_BONUS * rankOf(ranks, u, 'bulwark');
}

/** Scout-strength multiplier from the pathfinder's Keen (1 when no rank). Used by the scout duel and the intel tiers. */
export function keenMultiplier(ranks: VillageRanks | undefined): number {
  return 1 + KEEN_BONUS * rankOf(ranks, SCOUT_UNIT, 'keen');
}

/** Rough troop count for Keen 1: rounded to SCOUT_APPROX_STEP, at least one step when any are there. */
export function approxCount(n: number): number {
  if (!(n > 0)) return 0;
  return Math.max(SCOUT_APPROX_STEP, Math.round(n / SCOUT_APPROX_STEP) * SCOUT_APPROX_STEP);
}

export interface IntelSource {
  /** The sending village's Keen rank (what its Pathfinders were trained to). */
  keen: number;
  /** Resources already floored by the caller. */
  resources: Resources;
  buildings: BuildingLevels;
  /** Troops at home plus stationed support. */
  troops: Units;
  /** The defending village's own ranks (shown only at the top tier). */
  ranks?: VillageRanks;
}

/**
 * What a *successful* scout reports, by the sender's Keen rank (SCOUT_INTEL_KEEN). Layers the rank does not
 * reach are null, never omitted, so clients can tell "not seen" from "none".
 */
export function buildScoutIntel(src: IntelSource): ScoutIntel {
  const keen = Math.max(0, Math.min(RANK_MAX, Math.floor(Number.isFinite(src.keen) ? src.keen : 0)));
  const exact = keen >= SCOUT_INTEL_KEEN.exactTroops;
  const rough = keen >= SCOUT_INTEL_KEEN.approxTroops;
  let troops: Units | null = null;
  if (rough) {
    troops = exact ? { ...src.troops } : (Object.fromEntries(UNIT_IDS.map((u) => [u, approxCount(src.troops[u])])) as Units);
  }
  const seeRanks = keen >= SCOUT_INTEL_KEEN.ranks;
  return {
    keen,
    resources: src.resources,
    troops,
    troopsApprox: rough && !exact,
    wallLevel: keen >= SCOUT_INTEL_KEEN.wall ? src.buildings.wall : null,
    buildings: keen >= SCOUT_INTEL_KEEN.buildings ? { ...src.buildings } : null,
    ranks: seeRanks ? (src.ranks ?? {}) : null,
    drillyardLevel: seeRanks ? src.buildings.drillyard : null,
  };
}

/** Total defending scout strength: each contingent's Pathfinders times its own home village's Keen multiplier. */
export function scoutStrength(groups: Array<{ count: number; ranks: VillageRanks | undefined }>): number {
  return groups.reduce((sum, g) => sum + g.count * keenMultiplier(g.ranks), 0);
}

/** Training Points a village has: DRILLYARD_POINTS_PER_LEVEL per Drillyard level. */
export function pointsTotal(state: VillageState): number {
  return DRILLYARD_POINTS_PER_LEVEL * Math.max(0, state.buildings.drillyard || 0);
}

/** Points already used: reaching rank r of a track cost 1 + 2 + .. + r. */
export function pointsSpent(state: VillageState): number {
  let spent = 0;
  for (const u of Object.keys(UNITS) as UnitId[]) {
    for (const track of RANK_TRACKS) {
      const r = rankOf(state.ranks, u, track);
      spent += (r * (r + 1)) / 2;
    }
  }
  return spent;
}

interface RankPlan {
  unit: UnitId;
  track: RankTrack;
  rank: number;
  points: number;
  cost: Resources;
}

function planRank(v: VillageState, u: unknown, track: unknown): CheckResult<RankPlan> {
  if (!isUnitId(u)) return fail('invalid_input', 'Unknown unit.');
  if (!isTrack(track)) return fail('invalid_input', 'Unknown rank track.');
  const name = UNITS[u].name;
  if (track === 'keen' && u !== SCOUT_UNIT) return fail('invalid_input', `Keen is only for ${UNITS[SCOUT_UNIT].name}s.`);
  if (track === 'might' && u === SCOUT_UNIT) return fail('invalid_input', `${name}s do not fight, so Might does not apply.`);
  if (!isResearched(v, u)) return fail('requirements_not_met', `Research ${name} first.`);
  const rank = rankOf(v.ranks, u, track) + 1;
  if (rank > RANK_MAX) return fail('max_level', `${name} is already at the top rank in this track.`);
  const free = pointsTotal(v) - pointsSpent(v);
  if (rank > free) return fail('requirements_not_met', `Not enough Training Points (need ${rank}, ${Math.max(0, free)} left).`);
  const cost = { ...(RANK_COST[rank - 1] ?? emptyResources()) };
  if (!canAfford(v.resources, cost)) return fail('not_enough_resources', 'Not enough resources.');
  return { ok: true, unit: u, track, rank, points: rank, cost };
}

/** Can the next rank of `track` for `u` be bought at time t? Never throws. */
export function checkRank(
  state: VillageState,
  u: UnitId | (string & {}),
  track: RankTrack | (string & {}),
  t: number,
  s: WorldSettings,
): CheckResult<{ rank: number; points: number; cost: Resources }> {
  if (!Number.isFinite(t)) return fail('invalid_input', 'Invalid time.');
  const plan = planRank(settleVillage(state, t, s), u, track);
  if (!plan.ok) return plan;
  return { ok: true, rank: plan.rank, points: plan.points, cost: plan.cost };
}

/** Settle to t, pay and raise the track by one rank (instant). Throws GameError when invalid. */
export function applyRank(state: VillageState, u: UnitId | (string & {}), track: RankTrack | (string & {}), t: number, s: WorldSettings): VillageState {
  if (!Number.isFinite(t)) throw new GameError('invalid_input', 'Invalid time.');
  const v = settleVillage(state, t, s);
  const plan = planRank(v, u, track);
  if (!plan.ok) throw new GameError(plan.reason, plan.message);
  for (const r of RESOURCE_IDS) v.resources[r] -= plan.cost[r];
  const ranks: VillageRanks = { ...(v.ranks ?? {}) };
  ranks[plan.unit] = { ...emptyRanks(), ...ranks[plan.unit], [plan.track]: plan.rank };
  v.ranks = ranks;
  return v;
}

function planRespec(v: VillageState, u: unknown, track: unknown): CheckResult<{ unit: UnitId; track: RankTrack; refund: number }> {
  if (!isUnitId(u)) return fail('invalid_input', 'Unknown unit.');
  if (!isTrack(track)) return fail('invalid_input', 'Unknown rank track.');
  const rank = rankOf(v.ranks, u, track);
  if (rank <= 0) return fail('invalid_input', 'Nothing to reset in this track.');
  return { ok: true, unit: u, track, refund: (rank * (rank + 1)) / 2 };
}

/** Can this track be reset at time t? `refund` is the Training Points returned. Never throws. */
export function checkRespec(
  state: VillageState,
  u: UnitId | (string & {}),
  track: RankTrack | (string & {}),
  t: number,
  s: WorldSettings,
): CheckResult<{ refund: number }> {
  if (!Number.isFinite(t)) return fail('invalid_input', 'Invalid time.');
  const plan = planRespec(settleVillage(state, t, s), u, track);
  if (!plan.ok) return plan;
  return { ok: true, refund: plan.refund };
}

/** Settle to t and reset one track to rank 0, free of charge (points return in full; the resources paid for the ranks do not). */
export function applyRespec(state: VillageState, u: UnitId | (string & {}), track: RankTrack | (string & {}), t: number, s: WorldSettings): VillageState {
  if (!Number.isFinite(t)) throw new GameError('invalid_input', 'Invalid time.');
  const v = settleVillage(state, t, s);
  const plan = planRespec(v, u, track);
  if (!plan.ok) throw new GameError(plan.reason, plan.message);
  v.ranks = { ...(v.ranks ?? {}), [plan.unit]: { ...emptyRanks(), ...v.ranks?.[plan.unit], [plan.track]: 0 } };
  return v;
}
