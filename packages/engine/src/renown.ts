// Renown: the score that limits how many villages a player may own (docs/GAME_DESIGN.md section 18.2).
// Pure maths only. Who earns what, anti-abuse by account (IP group, tribe, allies) and where Renown is stored
// is the server's job; the order of the combat rules is documented at `battleRenown`.

import {
  CHIEFTAIN_RENOWN_REFUND_SHARE,
  DEFENDER_RENOWN_DAILY_CAP,
  DEFENDER_RENOWN_PER_DEFENCE,
  FEAST_COST,
  FEAST_DAILY_PER_LEVEL,
  FEAST_RENOWN,
  FEAST_WINDOW_HOURS,
  RENOWN_BUILD_EXP,
  RENOWN_BUILD_SCALE,
  RENOWN_MIN_BATTLE_VALUE,
  RENOWN_PAIR_CAP,
  RENOWN_PAIR_WINDOW_HOURS,
  RENOWN_PER_KILL_VALUE,
  RENOWN_PER_LOOT_VALUE,
  RENOWN_SMALL_FLOOR,
  RENOWN_SMALL_RATIO,
  RENOWN_VALUE_WEIGHT,
  RENOWN_VILLAGE_BASE,
  RENOWN_VILLAGE_GROWTH,
  UNITS,
} from './config.ts';
import type { RenownInfo } from './api.ts';
import { bulwarkMultiplier, mightMultiplier } from './drillyard.ts';
import { canAfford } from './economy.ts';
import { BUILDING_IDS, GameError, RESOURCE_IDS, UNIT_IDS } from './types.ts';
import type { BattleResult, BuildingId, CheckResult, Resources, Units, VillageRanks, VillageState, WorldSettings } from './types.ts';
import { MS_PER_HOUR, cloneVillage, emptyResources, fail, ipow, normalizeUnits } from './util.ts';
import { settleVillage } from './village.ts';
import { protectionEndsAt } from './world.ts';

// ---- Value ----------------------------------------------------------------------------------------

/** Value of a resource bundle for Renown: sum of amount * RENOWN_VALUE_WEIGHT (gold counts 10). Also used by scripts/sim. */
export function resourceValue(r: Partial<Resources>): number {
  let v = 0;
  for (const id of RESOURCE_IDS) v += (r[id] || 0) * RENOWN_VALUE_WEIGHT[id];
  return v;
}

/** Value of troops: sum of unit cost (resourceValue of UNITS[u].cost) * count. */
export function troopValue(units: Partial<Units>): number {
  let v = 0;
  for (const u of UNIT_IDS) v += (units[u] || 0) * resourceValue(UNITS[u].cost);
  return v;
}

// ---- Renown from buildings ------------------------------------------------------------------------

/** Renown the single level `level` (1-based) of a building pays once: round(RENOWN_BUILD_SCALE * level ^ RENOWN_BUILD_EXP). */
export function buildingRenown(_building: BuildingId, level: number): number {
  if (!(level >= 1)) return 0;
  // At least 1, so every finished level counts even when the scale is below 1.
  return Math.max(1, Math.round(RENOWN_BUILD_SCALE * Math.pow(level, RENOWN_BUILD_EXP)));
}

/**
 * Pay the Renown of every finished building level above `renownPaid`, then remember it (a level is never paid twice,
 * also not after the building was reset to a lower level, e.g. the Wall after a takeover). Settle the village first:
 * only finished levels count. Abandoned (npc) villages pay nothing. Returns a new state and the Renown earned (integer).
 */
export function collectBuildRenown(state: VillageState): { state: VillageState; renown: number } {
  const v = cloneVillage(state);
  const paid = { ...(v.renownPaid as VillageState['buildings']) };
  let renown = 0;
  for (const b of BUILDING_IDS) {
    const level = v.buildings[b];
    if (!v.npc) for (let l = paid[b] + 1; l <= level; l++) renown += buildingRenown(b, l);
    paid[b] = Math.max(paid[b], level);
  }
  v.renownPaid = paid;
  return { state: v, renown };
}

/**
 * Mark every current building level as paid without paying anything. For villages that must not pay for what is
 * already built: new villages from the sandbox, villages founded or captured later, abandoned villages.
 */
export function markRenownPaid(state: VillageState): VillageState {
  const v = cloneVillage(state);
  const paid = { ...(v.renownPaid as VillageState['buildings']) };
  for (const b of BUILDING_IDS) paid[b] = Math.max(paid[b], v.buildings[b]);
  v.renownPaid = paid;
  return v;
}

// ---- Price of a new village -----------------------------------------------------------------------

/** Renown the next village costs for a player who owns `villagesOwned` (>= 1): round(BASE * GROWTH^(owned - 1)). */
export function villageRenownCost(villagesOwned: number): number {
  const owned = Number.isFinite(villagesOwned) ? Math.max(1, Math.floor(villagesOwned)) : 1;
  return Math.round(RENOWN_VILLAGE_BASE * ipow(RENOWN_VILLAGE_GROWTH, owned - 1));
}

/** Renown that comes back when a Chieftain who reserved `cost` dies on the way (rounded down). */
export function chieftainRefund(cost: number): number {
  return Math.floor(Math.max(0, cost) * CHIEFTAIN_RENOWN_REFUND_SHARE);
}

/** The numbers a player sees (everything floored). `total` and `spent` may be fractional in the database. */
export function makeRenownInfo(total: number, spent: number, villagesOwned: number): RenownInfo {
  return {
    total: Math.floor(total + 1e-9),
    spent: Math.floor(spent + 1e-9),
    balance: Math.max(0, Math.floor(total - spent + 1e-9)),
    nextVillageCost: villageRenownCost(villagesOwned),
    villages: villagesOwned,
  };
}

// ---- Feast ----------------------------------------------------------------------------------------

/** Length of the Feast window in ms (FEAST_WINDOW_HOURS divided by world speed). */
export function feastWindowMs(s: WorldSettings): number {
  return (FEAST_WINDOW_HOURS * MS_PER_HOUR) / s.speed;
}

/** Feasts a village may still hold now. `windowEnd` is when the current window ends (null when no window is open). */
export interface FeastAllowance {
  /** Most Feasts per window: FEAST_DAILY_PER_LEVEL * Banner Hall level. */
  max: number;
  used: number;
  /** max - used, never below 0. */
  left: number;
  windowEnd: number | null;
}

/** Feast allowance of a village at `now` (settles first, so a finished Banner Hall level counts). */
export function feastAllowance(state: VillageState, now: number, s: WorldSettings): FeastAllowance {
  const v = settleVillage(state, now, s);
  return allowanceOf(v, now, s);
}

function allowanceOf(v: VillageState, now: number, s: WorldSettings): FeastAllowance {
  const max = FEAST_DAILY_PER_LEVEL * Math.max(0, v.buildings.bannerhall);
  const end = v.feast ? v.feast.windowStart + feastWindowMs(s) : 0;
  const open = !!v.feast && now < end;
  const used = open ? (v.feast as { count: number }).count : 0;
  return { max, used, left: Math.max(0, max - used), windowEnd: open ? end : null };
}

interface FeastPlan {
  count: number;
  cost: Resources;
  renown: number;
}

function planFeast(v: VillageState, count: unknown, now: number, s: WorldSettings): CheckResult<FeastPlan> {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 1_000_000) {
    return fail('invalid_input', 'Count must be a whole number of at least 1.');
  }
  if (v.npc) return fail('invalid_input', 'Abandoned villages cannot hold a Feast.');
  if (v.buildings.bannerhall < 1) return fail('requirements_not_met', 'Requires Banner Hall level 1.');
  const allowance = allowanceOf(v, now, s);
  if (count > allowance.left) {
    return fail('queue_full', allowance.left > 0 ? `Only ${allowance.left} more Feast(s) allowed in this window.` : 'No more Feasts allowed in this window.');
  }
  const cost = emptyResources();
  for (const r of RESOURCE_IDS) cost[r] = FEAST_COST[r] * count;
  if (!canAfford(v.resources, cost)) return fail('not_enough_resources', 'Not enough resources.');
  return { ok: true, count, cost, renown: FEAST_RENOWN * count };
}

/** Can `count` Feasts be held at `now`? Never throws. Result carries the total cost and Renown. */
export function checkFeast(
  state: VillageState,
  count: number,
  now: number,
  s: WorldSettings,
): CheckResult<{ cost: Resources; renown: number }> {
  if (!Number.isFinite(now)) return fail('invalid_input', 'Invalid time.');
  const plan = planFeast(settleVillage(state, now, s), count, now, s);
  if (!plan.ok) return plan;
  return { ok: true, cost: plan.cost, renown: plan.renown };
}

/**
 * Settle to `now`, then hold `count` Feasts: pay FEAST_COST * count from the village and start the 24 h window at the first
 * one (it resets after it ends). Returns the new state and the Renown earned; the caller adds it to the player's total.
 * Throws GameError with the check's reason when invalid.
 */
export function applyFeast(
  state: VillageState,
  count: number,
  now: number,
  s: WorldSettings,
): { state: VillageState; renown: number; cost: Resources } {
  if (!Number.isFinite(now)) throw new GameError('invalid_input', 'Invalid time.');
  const v = settleVillage(state, now, s);
  const plan = planFeast(v, count, now, s);
  if (!plan.ok) throw new GameError(plan.reason, plan.message);
  for (const r of RESOURCE_IDS) v.resources[r] -= plan.cost[r];
  const open = allowanceOf(v, now, s).windowEnd !== null;
  v.feast = open && v.feast ? { windowStart: v.feast.windowStart, count: v.feast.count + plan.count } : { windowStart: now, count: plan.count };
  return { state: v, renown: plan.renown, cost: plan.cost };
}

// ---- Defender Renown (docs/GAME_DESIGN.md 18.2, source 4) ---------------------------------------

const DAY_MS = 24 * MS_PER_HOUR;

/**
 * Defence strength of a village's own troops at home: sum of count x average of the infantry and cavalry defence of each
 * unit. Support troops (they belong to their owners) and troops away are not part of `troops`, so they never count; the Wall
 * and ranks are left out on purpose (the trickle rewards real troops, not buildings or points).
 */
export function stationedDefence(troops: Partial<Units>): number {
  let sum = 0;
  for (const u of UNIT_IDS) sum += (troops[u] || 0) * ((UNITS[u].defenseInfantry + UNITS[u].defenseCavalry) / 2);
  return sum;
}

/** Renown per 24 h at a defence strength, before world speed: min(DEFENDER_RENOWN_DAILY_CAP, strength x DEFENDER_RENOWN_PER_DEFENCE). */
export function defenderRenownPerDay(strength: number): number {
  if (!(strength > 0)) return 0;
  return Math.min(DEFENDER_RENOWN_DAILY_CAP, strength * DEFENDER_RENOWN_PER_DEFENCE);
}

/**
 * Pay the defender Renown earned since the village's mark (`defenceMark`) up to its settled time `state.lastUpdate`, then move
 * the mark there. Settle the village first. Lazy, like resources: the span is counted when something saves the village.
 * - The rate uses the SMALLER of the stationed defence at the mark and now, so troops that left (or were sent away) never
 *   count for the time they were gone, and a batch that only just finished does not count before it existed.
 * - `eligibleFrom` is the time beginner protection ends (the server knows the player): nothing is paid before it.
 * - The rate per 24 h is divided by world speed like every duration. Abandoned (npc) villages pay nothing.
 * Returns a new state and the Renown earned (fractional; 0 when the village had no mark yet - the first call only sets it).
 */
export function collectDefenderRenown(state: VillageState, eligibleFrom: number, s: WorldSettings): { state: VillageState; renown: number } {
  const v = cloneVillage(state);
  if (v.npc) return { state: v, renown: 0 };
  const now = v.lastUpdate;
  const strength = stationedDefence(v.troops);
  const mark = v.defenceMark;
  let renown = 0;
  if (mark && now > mark.at) {
    const from = Math.max(mark.at, Number.isFinite(eligibleFrom) ? eligibleFrom : now);
    if (now > from) renown = defenderRenownPerDay(Math.min(mark.strength, strength)) * s.speed * ((now - from) / DAY_MS);
  }
  // A mark in the future (clock moved back) is replaced, never paid.
  if (!mark || now >= mark.at) v.defenceMark = { at: now, strength };
  return { state: v, renown };
}

/** Move the mark to now without paying (sandbox accounts, a village that changes owner). */
export function markDefenceCollected(state: VillageState): VillageState {
  const v = cloneVillage(state);
  if (!v.npc) v.defenceMark = { at: v.lastUpdate, strength: stationedDefence(v.troops) };
  return v;
}

/**
 * The time from which a player's defence earns Renown: when beginner protection ends. The natural end (account creation +
 * protection hours) counts even when the player ended protection early by attacking someone (`protectedUntil` 0), so the
 * protected time is never paid retroactively.
 */
export function defenderEligibleFrom(protectedUntil: number, createdAt: number, s: WorldSettings): number {
  return Math.max(protectedUntil, protectionEndsAt(createdAt, s));
}

// ---- Renown from fighting -------------------------------------------------------------------------

/** Length of the pair window in ms (RENOWN_PAIR_WINDOW_HOURS divided by world speed). The server keeps one window per (earner, opponent). */
export function renownPairWindowMs(s: WorldSettings): number {
  return (RENOWN_PAIR_WINDOW_HOURS * MS_PER_HOUR) / s.speed;
}

/** What a pair has been paid in a window after raw Renown `raw` (units: Renown): F(R) = RENOWN_PAIR_CAP * (1 - exp(-R / RENOWN_PAIR_CAP)). */
export function pairRenownTotal(raw: number): number {
  if (!(raw > 0)) return 0;
  return -RENOWN_PAIR_CAP * Math.expm1(-raw / RENOWN_PAIR_CAP);
}

/**
 * Renown paid for a battle of raw Renown `addRaw` when the pair already counted `prevRaw` in this window (both in raw-Renown
 * units): F(prev + add) - F(prev). Path independent: one big battle pays what many small ones add up to (within float
 * rounding). Slope 1 at small amounts; the window never pays more than RENOWN_PAIR_CAP in total.
 */
export function pairRenown(prevRaw: number, addRaw: number): number {
  if (!(addRaw > 0)) return 0;
  const prev = prevRaw > 0 ? prevRaw : 0;
  // Same as F(prev + add) - F(prev) but without subtracting two nearly equal numbers.
  return -RENOWN_PAIR_CAP * Math.exp(-prev / RENOWN_PAIR_CAP) * Math.expm1(-addRaw / RENOWN_PAIR_CAP);
}

/**
 * Multiplier for hitting far smaller players: clamp((opponentPoints / ownPoints / RENOWN_SMALL_RATIO)^2, RENOWN_SMALL_FLOOR, 1).
 * Own points 0 (or unknown) gives 1.
 */
export function sizeFactor(opponentPoints: number, ownPoints: number): number {
  if (!(ownPoints > 0)) return 1;
  const ratio = Math.max(0, opponentPoints) / ownPoints / RENOWN_SMALL_RATIO;
  return Math.min(1, Math.max(RENOWN_SMALL_FLOOR, ratio * ratio));
}

/** One earner's side of a battle. `index` is the support contingent's position (same order as BattleInput.support). */
export interface RenownEarner {
  side: 'attacker' | 'defender' | 'support';
  index?: number;
}

/** Value one earner gets credit for in a battle, before any anti-abuse rule. value = lootValue + killValue. */
export interface RenownShare extends RenownEarner {
  value: number;
  /** Value of the loot taken (attacker only). */
  lootValue: number;
  /** Value of the enemy troops destroyed. */
  killValue: number;
}

/** The parts of the BattleInput that decide who carried how much of the defence (needed for the support split). */
export interface BattleShareContext {
  /** Support troops that fought, same order as `result.supportLosses`. Omitted = none. */
  support?: Units[];
  attackerRanks?: VillageRanks;
  defenderRanks?: VillageRanks;
  supportRanks?: Array<VillageRanks | undefined>;
}

/**
 * Value each side earns Renown for in a battle (docs/GAME_DESIGN.md 18.2):
 * - attacker: loot value + value of the defender's and every support contingent's losses;
 * - defender (village owner) and each support contingent: the attacking army's losses, split by the share of the
 *   defence strength each brought (count * defence against the attack's infantry/cavalry mix, with Bulwark; wall
 *   militia and the Wall itself belong to nobody and are left out of the split).
 * Always returns the attacker, the defender and one entry per support contingent (value may be 0); the shares of the
 * defending side add up to the value of the attacker's losses.
 */
export function battleValueShares(result: BattleResult, ctx: BattleShareContext = {}): RenownShare[] {
  const support = (ctx.support ?? []).map((c) => normalizeUnits(c));
  const losses = result.supportLosses ?? [];
  const lootValue = resourceValue(result.loot);
  let attackerKills = troopValue(result.defenderLosses);
  for (const l of losses) attackerKills += troopValue(l);

  // Attack mix, like resolveBattle: share of attack power that is infantry.
  const attackers = normalizeUnits(addUnits(result.attackerLosses, result.attackerSurvivors));
  let attackInf = 0;
  let attackCav = 0;
  for (const u of UNIT_IDS) {
    const power = attackers[u] * UNITS[u].attack * mightMultiplier(ctx.attackerRanks, u);
    if (UNITS[u].unitClass === 'infantry') attackInf += power;
    else attackCav += power;
  }
  const raw = attackInf + attackCav;
  const infShare = raw > 0 ? attackInf / raw : 1;
  const strength = (units: Units, ranks: VillageRanks | undefined): number => {
    let sum = 0;
    for (const u of UNIT_IDS) {
      sum += units[u] * bulwarkMultiplier(ranks, u) * (UNITS[u].defenseInfantry * infShare + UNITS[u].defenseCavalry * (1 - infShare));
    }
    return sum;
  };
  const own = strength(normalizeUnits(result.defenderUnits), ctx.defenderRanks);
  const parts = support.map((c, i) => strength(c, ctx.supportRanks?.[i]));
  const total = own + parts.reduce((a, b) => a + b, 0);

  const defendersValue = troopValue(result.attackerLosses);
  const shareOf = (part: number, fallback: number): number => (total > 0 ? part / total : fallback);
  const kill = (side: 'defender' | 'support', share: number, index?: number): RenownShare => ({
    side,
    ...(index !== undefined ? { index } : {}),
    value: defendersValue * share,
    lootValue: 0,
    killValue: defendersValue * share,
  });
  const out: RenownShare[] = [
    { side: 'attacker', value: lootValue + attackerKills, lootValue, killValue: attackerKills },
    kill('defender', shareOf(own, 1)),
  ];
  parts.forEach((p, i) => out.push(kill('support', shareOf(p, 0), i)));
  return out;
}

/**
 * Raw Renown of a share before the pair window and the size factor:
 * lootValue * RENOWN_PER_LOOT_VALUE + killValue * RENOWN_PER_KILL_VALUE.
 */
export function rawRenown(share: { lootValue: number; killValue: number }): number {
  return share.lootValue * RENOWN_PER_LOOT_VALUE + share.killValue * RENOWN_PER_KILL_VALUE;
}

function addUnits(a: Units, b: Units): Units {
  const out = normalizeUnits(a);
  const nb = normalizeUnits(b);
  for (const u of UNIT_IDS) out[u] += nb[u];
  return out;
}

/** Who may earn and how big they are, for one party of the battle. Decided by the server (it knows accounts). */
export interface RenownParty {
  /**
   * false when this party must not earn from this battle: computer-run village (no owner), same IP group (householdShared
   * guard), same tribe or allied tribes as the opponent. The server owns these decisions.
   */
  eligible: boolean;
  /** Village points of the party (sum over the player's villages), for the size factor. */
  points: number;
}

export interface BattleRenownInput {
  result: BattleResult;
  context?: BattleShareContext;
  attacker: RenownParty;
  defender: RenownParty;
  /** One per support contingent, same order as `result.supportLosses`. */
  support?: RenownParty[];
  /**
   * Raw Renown (not value, not paid Renown) already counted in the 24 h pair window (renownPairWindowMs) for this earner against
   * its opponent (the defender for the attacker, the attacker for defender and support): the sum of earlier `counted`
   * of the pair. 0 when there is no open window.
   */
  pairValue: (earner: RenownEarner) => number;
}

export interface RenownAward extends RenownShare {
  /** Renown earned (fractional; the server stores it as is and shows it floored). 0 when skipped. */
  renown: number;
  /**
   * Raw Renown (`rawRenown(share)`) to add to this earner/opponent pair's window; 0 when skipped (forbidden or under the
   * minimum). If it is above 0 and no window is open, the window starts at the battle time.
   */
  counted: number;
  skipped?: 'forbidden' | 'min_value';
}

/**
 * Renown per earner for one battle. Order of the rules, for each earner:
 * 1. skip when the party is not eligible (computer-run village, same IP group, same tribe, allied tribes: the server decides);
 * 2. skip when the resource value of the share (loot + kills) < RENOWN_MIN_BATTLE_VALUE; that battle is not added to the
 *    pair window either;
 * 3. raw Renown = `rawRenown(share)`; pair window pays F(prev + raw) - F(prev) (`pairRenown`), `prev` = pairValue(earner);
 * 4. times the size factor (opponent points / own points).
 * Building and Feast Renown never pass through here.
 */
export function battleRenown(input: BattleRenownInput): RenownAward[] {
  const shares = battleValueShares(input.result, input.context);
  const supportParties = input.support ?? [];
  return shares.map((share): RenownAward => {
    const earner: RenownEarner = share.index !== undefined ? { side: share.side, index: share.index } : { side: share.side };
    const party = share.side === 'attacker' ? input.attacker : share.side === 'defender' ? input.defender : supportParties[share.index as number];
    const opponent = share.side === 'attacker' ? input.defender : input.attacker;
    if (!party || !party.eligible) return { ...share, renown: 0, counted: 0, skipped: 'forbidden' };
    if (share.value < RENOWN_MIN_BATTLE_VALUE) return { ...share, renown: 0, counted: 0, skipped: 'min_value' };
    const add = rawRenown(share);
    const renown = pairRenown(input.pairValue(earner), add) * sizeFactor(opponent.points, party.points);
    return { ...share, renown, counted: add };
  });
}
