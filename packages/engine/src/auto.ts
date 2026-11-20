// Auto mode (premium; docs/GAME_DESIGN.md section 23): a village works toward the goals the player set (troop amounts, building levels)
// with its own income. Pure. `settleAuto` runs inside `settleVillage` as an event loop in time order, like an abandoned village's
// self-build: a purchase is made at the exact moment its cost is covered and its queue has no auto job left, with build completions
// (which change production and levels) and research completions in between. Settling in one call or in many steps gives the same result
// (up to the millisecond rounding of "when is it affordable").

import {
  AUTO_GOAL_MAX_TROOPS,
  AUTO_MAX_ACTIONS_PER_SETTLE,
  AUTO_POP_ROOM_SHARE,
  AUTO_STORE_FULL_SHARE,
  AUTO_TRAIN_BATCH,
  AUTO_UNIT_IDS,
  BUILDINGS,
  POP_PER_UNIT,
  PREMIUM_BUILD_QUEUE,
  PREMIUM_RESEARCH_QUEUE,
  UNITS,
} from './config.ts';
import { buildingCost, buildingPop, popCapForLevel, populationCap, populationUsage, productionFromLevels, storageCap, storageCapForLevel } from './economy.ts';
import { BUILDING_IDS, RESOURCE_IDS, TRAINING_BUILDING_IDS } from './types.ts';
import type { AutoModeState, BuildingId, BuildingLevels, CheckResult, Resources, TrainJob, UnitId, VillageState, WorldSettings } from './types.ts';
import type { AutoNextDto, AutoVillageDto } from './api.ts';
import { MS_PER_HOUR, fail, isBuildingId, isUnitId } from './util.ts';
import { planBuild, settleVillage, trainTimeMs, unitUnavailable } from './village.ts';
import { worldRules } from './world-config.ts';
import type { WorldConfig } from './world-config.ts';

// ---- Entitlement helpers and settings -------------------------------------------------------------

/** Build jobs per village: the premium tools raise it to PREMIUM_BUILD_QUEUE (never below the world's own limit). */
export function buildQueueLimit(rules: Pick<WorldConfig, 'queues'>, premiumTools: boolean): number {
  return premiumTools ? Math.max(PREMIUM_BUILD_QUEUE, rules.queues.build) : rules.queues.build;
}

/** Research jobs per village: the premium tools raise it to PREMIUM_RESEARCH_QUEUE (never below the world's own limit). */
export function researchQueueLimit(rules: Pick<WorldConfig, 'queues'>, premiumTools: boolean): number {
  return premiumTools ? Math.max(PREMIUM_RESEARCH_QUEUE, rules.queues.research) : rules.queues.research;
}

/** Settings of a village that never had auto mode: off, no goals. */
export function defaultAutoMode(): AutoModeState {
  return { on: false, troopGoals: {}, buildingGoals: {} };
}

export interface AutoSettings {
  on: boolean;
  troopGoals: Partial<Record<UnitId, number>>;
  buildingGoals: Partial<Record<BuildingId, number>>;
}

function plainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Check a settings request body. `on` is required; a missing `troopGoals` / `buildingGoals` keeps the value of `base` (the village's
 * current settings). Amounts and levels of 0 remove the goal. Never throws.
 */
export function checkAutoSettings(input: unknown, base: Pick<AutoModeState, 'troopGoals' | 'buildingGoals'> = defaultAutoMode()): CheckResult<AutoSettings> {
  if (!plainObject(input)) return fail('invalid_input', 'Auto mode settings must be an object.');
  if (typeof input.on !== 'boolean') return fail('invalid_input', '"on" must be true or false.');
  let troopGoals = { ...base.troopGoals };
  if (input.troopGoals !== undefined) {
    if (!plainObject(input.troopGoals)) return fail('invalid_input', 'Troop goals must be an object of unit amounts.');
    const keys = Object.keys(input.troopGoals);
    if (keys.length > AUTO_UNIT_IDS.length) return fail('invalid_input', 'Too many troop goals.');
    troopGoals = {};
    for (const k of keys) {
      const n = input.troopGoals[k];
      if (!isUnitId(k) || !(AUTO_UNIT_IDS as readonly string[]).includes(k)) return fail('invalid_input', 'Auto mode cannot recruit that unit.');
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > AUTO_GOAL_MAX_TROOPS) {
        return fail('invalid_input', `A troop goal must be a whole number from 0 to ${AUTO_GOAL_MAX_TROOPS}.`);
      }
      if (n > 0) troopGoals[k] = n;
    }
  }
  let buildingGoals = { ...base.buildingGoals };
  if (input.buildingGoals !== undefined) {
    if (!plainObject(input.buildingGoals)) return fail('invalid_input', 'Building goals must be an object of levels.');
    const keys = Object.keys(input.buildingGoals);
    if (keys.length > BUILDING_IDS.length) return fail('invalid_input', 'Too many building goals.');
    buildingGoals = {};
    for (const k of keys) {
      const n = input.buildingGoals[k];
      if (!isBuildingId(k)) return fail('invalid_input', 'Unknown building.');
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > BUILDINGS[k].maxLevel) {
        return fail('invalid_input', `The level of ${BUILDINGS[k].name} must be a whole number from 0 to ${BUILDINGS[k].maxLevel}.`);
      }
      if (n > 0) buildingGoals[k] = n;
    }
  }
  return { ok: true, on: input.on, troopGoals, buildingGoals };
}

/** The new auto mode state after the player saved `settings`. */
export function applyAutoSettings(_current: AutoModeState | undefined, settings: AutoSettings): AutoModeState {
  return { on: settings.on, troopGoals: { ...settings.troopGoals }, buildingGoals: { ...settings.buildingGoals } };
}

// ---- Goals and planning ---------------------------------------------------------------------------

type Waiting = AutoNextDto['waiting'];

type Step =
  | { kind: 'build'; building: BuildingId; level: number; cost: Resources }
  | { kind: 'troops'; unit: UnitId; count: number; cost: Resources };

interface AutoPlan {
  pick: Step;
  waiting: Waiting;
  /** Earliest time the purchase can happen if nothing else changes; Infinity = waits for a job to finish (an event). */
  at: number;
  /** Best guess shown to the player; null = cannot tell. */
  readyAt: number | null;
}

interface Goal {
  kind: 'build' | 'troops';
  building?: BuildingId;
  unit?: UnitId;
  have: number;
  target: number;
  /** have / target, 0..1. */
  progress: number;
}

const trainEnd = (j: TrainJob): number => j.startAt + j.count * j.perUnitMs;

/** Building levels counting queued levels as built. */
function effectiveLevels(v: VillageState): BuildingLevels {
  const eff = { ...v.buildings };
  for (const j of v.buildQueue) eff[j.building] = Math.max(eff[j.building], j.targetLevel);
  return eff;
}

/** Troops of a unit counted toward its goal: home + away + still in training. */
export function troopsHave(v: VillageState, u: UnitId): number {
  let n = (v.troops[u] || 0) + (v.away[u] || 0);
  for (const b of TRAINING_BUILDING_IDS) for (const j of v.trainQueues[b]) if (j.unit === u) n += j.count - j.done;
  return n;
}

/** A goal auto cannot work on whatever is built: the unit still needs Drillyard research (auto never researches), or the hearth is out. */
function unitSkipped(v: VillageState, u: UnitId): boolean {
  if (UNITS[u].research && !(v.researched ?? []).includes(u)) return true;
  return !!v.hearth;
}

/** Every unmet goal, furthest behind first (lowest progress; ties: buildings before troops, then the game's own order). */
function unmetGoals(v: VillageState, eff: BuildingLevels): Goal[] {
  const a = v.auto;
  const out: Goal[] = [];
  if (!a) return out;
  for (const b of BUILDING_IDS) {
    const target = a.buildingGoals[b] ?? 0;
    if (target > 0 && eff[b] < target) out.push({ kind: 'build', building: b, have: eff[b], target, progress: eff[b] / target });
  }
  for (const u of AUTO_UNIT_IDS) {
    const target = a.troopGoals[u] ?? 0;
    if (target <= 0) continue;
    const have = troopsHave(v, u);
    if (have < target) out.push({ kind: 'troops', unit: u, have, target, progress: have / target });
  }
  return out.map((g, i) => ({ g, i })).sort((x, y) => x.g.progress - y.g.progress || x.i - y.i).map((x) => x.g);
}

/** Ms until the stock covers `cost` at the current production: 0 when it does already, null when a missing resource is not produced. */
function resourceWaitMs(v: VillageState, cost: Resources, s: WorldSettings): number | null {
  const rate = productionFromLevels(v.buildings, s.speed);
  let wait = 0;
  for (const r of RESOURCE_IDS) {
    if (cost[r] <= 0 || v.resources[r] >= cost[r]) continue;
    if (!(rate[r] > 0)) return null;
    wait = Math.max(wait, Math.ceil(((cost[r] - v.resources[r]) / rate[r]) * MS_PER_HOUR));
  }
  return wait;
}

function overCap(cost: Resources, cap: number): boolean {
  return RESOURCE_IDS.some((r) => cost[r] > cap);
}

interface Ctx {
  v: VillageState;
  s: WorldSettings;
  cur: number;
  limit: number;
  eff: BuildingLevels;
  effCap: number;
  usage: number;
  effPopCap: number;
}

function makeCtx(v: VillageState, cur: number, s: WorldSettings, limit: number): Ctx {
  const eff = effectiveLevels(v);
  return { v, s, cur, limit, eff, effCap: storageCapForLevel(eff.storehouse), usage: populationUsage(v).total, effPopCap: popCapForLevel(eff.longhouse) };
}

/** Can the next level of `b` be queued as far as the building itself goes (not at max counting the queue, requirements built)? */
function avail(c: Ctx, b: BuildingId): boolean {
  if (c.eff[b] >= BUILDINGS[b].maxLevel) return false;
  for (const req of Object.keys(BUILDINGS[b].requires) as BuildingId[]) if (c.v.buildings[req] < (BUILDINGS[b].requires[req] ?? 0)) return false;
  return true;
}

const buildStep = (c: Ctx, b: BuildingId): Step => ({ kind: 'build', building: b, level: c.eff[b] + 1, cost: buildingCost(b, c.eff[b] + 1) });

/** A step plus, when it has to wait for a building that is already queued, the time that building is done. */
interface Resolved {
  step: Step;
  blockedAt?: number;
}

/**
 * The first unmet requirement of a goal becomes the step (recursively: that building's own requirements first). A requirement that is
 * queued but not built yet makes the goal wait for it (`blockedAt`). Null: it can never happen.
 */
function resolveRequires(c: Ctx, requires: Partial<Record<BuildingId, number>>, own: Step, depth: number): Resolved | 'met' | null {
  for (const req of Object.keys(requires) as BuildingId[]) {
    const need = requires[req] ?? 0;
    if (c.v.buildings[req] >= need) continue;
    if (c.eff[req] >= need) {
      const job = c.v.buildQueue.find((j) => j.building === req && j.targetLevel >= need);
      return job ? { step: own, blockedAt: job.finishAt } : null;
    }
    return resolveBuilding(c, req, depth + 1);
  }
  return 'met';
}

function resolveBuilding(c: Ctx, b: BuildingId, depth: number): Resolved | null {
  if (depth > BUILDING_IDS.length || c.eff[b] >= BUILDINGS[b].maxLevel) return null;
  const own = buildStep(c, b);
  const r = resolveRequires(c, BUILDINGS[b].requires, own, depth);
  return r === 'met' ? { step: own } : r;
}

function troopCost(u: UnitId, count: number): Resources {
  const cost: Resources = { wood: 0, food: 0, iron: 0, gold: 0 };
  for (const r of RESOURCE_IDS) cost[r] = UNITS[u].cost[r] * count;
  return cost;
}

function resolveTroops(c: Ctx, u: UnitId, remaining: number): Resolved | null {
  const count = Math.min(AUTO_TRAIN_BATCH, remaining);
  const own: Step = { kind: 'troops', unit: u, count, cost: troopCost(u, count) };
  const r = resolveRequires(c, UNITS[u].requires, own, 0);
  return r === 'met' ? { step: own } : r;
}

/** Make a step fit the population room: otherwise the Longhouse comes first; with no Longhouse to build, a troop order shrinks to what fits. */
function ensureRoom(c: Ctx, step: Step): Step | null {
  if (step.kind === 'build') {
    const extra = buildingPop(step.building, step.level) - buildingPop(step.building, step.level - 1);
    if (extra > 0 && c.usage + extra > c.effPopCap) return avail(c, 'longhouse') ? buildStep(c, 'longhouse') : null;
    return step;
  }
  const each = POP_PER_UNIT[step.unit];
  if (c.usage + step.count * each <= c.effPopCap) return step;
  if (avail(c, 'longhouse')) return buildStep(c, 'longhouse');
  const fit = Math.floor((c.effPopCap - c.usage) / each);
  if (fit < 1) return null;
  return { ...step, count: fit, cost: troopCost(step.unit, fit) };
}

/** From a chosen step to when it happens. Null: it can never happen. */
function planStep(c: Ctx, step: Step): AutoPlan | null {
  const { v, s, cur } = c;
  const wait = resourceWaitMs(v, step.cost, s);
  if (wait === null) return null;
  const x = cur + wait;
  // Blocked until a queued Storehouse / Longhouse level is done (the step fitted the effective levels only).
  if (overCap(step.cost, storageCap(v))) {
    const job = v.buildQueue.find((j) => j.building === 'storehouse');
    return job ? { pick: step, waiting: 'resources', at: Infinity, readyAt: job.finishAt } : null;
  }
  const each = step.kind === 'build' ? buildingPop(step.building, step.level) - buildingPop(step.building, step.level - 1) : step.count * POP_PER_UNIT[step.unit];
  if (each > 0 && c.usage + each > populationCap(v)) {
    const job = v.buildQueue.find((j) => j.building === 'longhouse');
    return job ? { pick: step, waiting: 'room', at: Infinity, readyAt: job.finishAt } : null;
  }
  if (step.kind === 'build') {
    // At most one auto job in the build queue at a time (owner, 2026-11-20); a full queue (manual jobs) waits for a slot too.
    const auto = v.buildQueue.find((j) => j.auto);
    if (auto) return { pick: step, waiting: 'slot', at: Infinity, readyAt: Math.max(auto.finishAt, x) };
    if (v.buildQueue.length >= c.limit) {
      const first = v.buildQueue[0];
      return { pick: step, waiting: 'slot', at: Infinity, readyAt: first ? Math.max(first.finishAt, x) : null };
    }
    return { pick: step, waiting: wait > 0 ? 'resources' : 'now', at: x, readyAt: x };
  }
  // Troops: one auto batch per training queue at a time, and a free slot.
  const queue = v.trainQueues[UNITS[step.unit].building];
  const unfinished = queue.filter((j) => trainEnd(j) > x);
  const limit = worldRules(s).queues.train;
  let y = x;
  const auto = unfinished.find((j) => j.auto);
  if (auto) y = Math.max(y, trainEnd(auto));
  if (unfinished.length >= limit) y = Math.max(y, trainEnd(unfinished[unfinished.length - limit]!));
  if (y > x) return { pick: step, waiting: 'slot', at: y, readyAt: y };
  return { pick: step, waiting: wait > 0 ? 'resources' : 'now', at: x, readyAt: x };
}

/**
 * What auto mode buys next (docs/GAME_DESIGN.md section 23): the goal furthest behind, first the building its requirements need; the
 * Longhouse when people room runs low and a troop goal is open; the Storehouse when a store is nearly full or the step costs more than
 * it holds. A goal that cannot happen at all passes to the next one. Null: no open goal can happen (or all are met).
 */
function autoPlan(v: VillageState, cur: number, s: WorldSettings, limit: number): AutoPlan | null {
  const c = makeCtx(v, cur, s, limit);
  const workable = unmetGoals(v, c.eff).filter((g) => g.kind === 'build' || !unitSkipped(v, g.unit!));
  const troopOpen = workable.some((g) => g.kind === 'troops');
  const lowRoom = c.effPopCap > 0 && c.effPopCap - c.usage < AUTO_POP_ROOM_SHARE * c.effPopCap;
  const full = RESOURCE_IDS.some((r) => v.resources[r] >= AUTO_STORE_FULL_SHARE * c.effCap);
  for (const g of workable) {
    const r = g.kind === 'build' ? resolveBuilding(c, g.building!, 0) : resolveTroops(c, g.unit!, g.target - g.have);
    if (!r) continue;
    let step: Step | null = r.step;
    let blocked = r.blockedAt;
    if (lowRoom && troopOpen && avail(c, 'longhouse')) {
      step = buildStep(c, 'longhouse');
      blocked = undefined;
    } else if (full && avail(c, 'storehouse')) {
      step = buildStep(c, 'storehouse');
      blocked = undefined;
    }
    if (blocked === undefined) step = ensureRoom(c, step);
    if (step === null) continue;
    if (blocked === undefined && overCap(step.cost, c.effCap)) {
      if ((step.kind === 'build' && step.building === 'storehouse') || !avail(c, 'storehouse')) continue;
      step = buildStep(c, 'storehouse');
      if (overCap(step.cost, c.effCap)) continue;
    }
    if (blocked !== undefined) return { pick: step, waiting: 'requirement', at: Infinity, readyAt: blocked };
    const plan = planStep(c, step);
    if (plan) return plan;
  }
  return null;
}

// ---- Settling -------------------------------------------------------------------------------------

/** Move the units finished by `at` into `troops` and drop finished batches (the same as settleVillage's training step). */
function landTraining(v: VillageState, at: number): void {
  for (const b of TRAINING_BUILDING_IDS) {
    const queue = v.trainQueues[b];
    for (const job of queue) {
      const finished = Math.min(job.count, Math.max(0, Math.floor((at - job.startAt) / job.perUnitMs)));
      if (finished > job.done) {
        v.troops[job.unit] += finished - job.done;
        job.done = finished;
      }
    }
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.done >= queue[i]!.count) queue.splice(i, 1);
  }
}

function buy(v: VillageState, plan: AutoPlan, cur: number, s: WorldSettings, limit: number): boolean {
  const cost = plan.pick.cost;
  landTraining(v, cur); // a batch that ends exactly now frees its place
  // The wait was rounded up to a whole millisecond; floats may leave a hair short.
  for (const r of RESOURCE_IDS) if (v.resources[r] < cost[r] && cost[r] - v.resources[r] < 1e-6) v.resources[r] = cost[r];
  if (plan.pick.kind === 'build') {
    if (v.buildQueue.some((j) => j.auto)) return false;
    const p = planBuild(v, plan.pick.building, s, limit);
    if (!p.ok) return false;
    const last = v.buildQueue[v.buildQueue.length - 1];
    const startAt = Math.max(cur, last ? last.finishAt : 0);
    for (const r of RESOURCE_IDS) v.resources[r] -= p.cost[r];
    v.buildQueue.push({ building: p.building, targetLevel: p.targetLevel, startAt, finishAt: startAt + p.timeMs, cost: { ...p.cost }, auto: true });
    return true;
  }
  const { unit, count } = plan.pick;
  const def = UNITS[unit];
  if (unitUnavailable(v, unit, s)) return false;
  for (const r of RESOURCE_IDS) if (!(v.resources[r] >= cost[r])) return false;
  if (populationUsage(v).total + count * POP_PER_UNIT[unit] > populationCap(v)) return false;
  const queue = v.trainQueues[def.building];
  if (queue.some((j) => j.auto)) return false;
  const last = queue[queue.length - 1];
  if (queue.length >= worldRules(s).queues.train) return false;
  queue.push({ unit, count, done: 0, perUnitMs: trainTimeMs(unit, v, s), startAt: Math.max(cur, last ? trainEnd(last) : 0), unitCost: { ...def.cost }, auto: true });
  for (const r of RESOURCE_IDS) v.resources[r] -= cost[r];
  return true;
}

export interface AutoSettleHooks {
  /** The time the village has been brought up to so far. */
  cur: () => number;
  /** Production up to `to` (settleVillage's own accrual with the storehouse cap). */
  advance: (to: number) => void;
}

/**
 * Run auto mode up to `t` on `v` (mutates it). Called by settleVillage for a village with auto mode on that is neither abandoned nor
 * cold. Build jobs and research that finish by `t` are completed here, in time order with the purchases.
 */
export function settleAuto(v: VillageState, t: number, s: WorldSettings, h: AutoSettleHooks): void {
  const limit = buildQueueLimit(worldRules(s), true);
  let actions = 0;
  for (;;) {
    const cur = h.cur();
    landTraining(v, cur);
    const job = v.buildQueue[0];
    const research = v.researchQueue?.[0];
    const jobAt = job ? job.finishAt : Infinity;
    const researchAt = research ? research.finishAt : Infinity;
    const eventAt = Math.min(jobAt, researchAt);
    const plan = actions < AUTO_MAX_ACTIONS_PER_SETTLE ? autoPlan(v, cur, s, limit) : null;
    const at = plan ? plan.at : Infinity;
    if (plan && at <= eventAt && at <= t) {
      h.advance(at);
      if (!buy(v, plan, h.cur(), s, limit)) break;
      actions++;
      continue;
    }
    if (eventAt > t) break;
    if (jobAt <= researchAt) {
      v.buildQueue.shift();
      h.advance(job!.finishAt);
      v.buildings[job!.building] = Math.max(v.buildings[job!.building], job!.targetLevel);
    } else {
      h.advance(research!.finishAt); // a unit researched now must not be bought before this moment
      const done = v.researchQueue!.shift()!.unit;
      v.researched = [...new Set([...(v.researched ?? []), done])];
    }
  }
}

/** Goal status of an already settled village: 'empty' no goals, 'reached' all met, 'working' a step is next, 'blocked' nothing can happen. */
export function autoSummary(v: VillageState, s: WorldSettings): { status: AutoVillageDto['status']; next: AutoNextDto | null } {
  const a = v.auto;
  if (!a || (Object.keys(a.troopGoals).length === 0 && Object.keys(a.buildingGoals).length === 0)) return { status: 'empty', next: null };
  if (unmetGoals(v, effectiveLevels(v)).length === 0) return { status: 'reached', next: null };
  const cur = v.lastUpdate;
  const plan = autoPlan(v, cur, s, buildQueueLimit(worldRules(s), true));
  if (!plan) return { status: 'blocked', next: null };
  const waiting: Waiting = plan.at <= cur && plan.waiting !== 'requirement' ? 'now' : plan.waiting;
  const readyAt = plan.readyAt !== null && Number.isFinite(plan.readyAt) ? plan.readyAt : null;
  const p = plan.pick;
  const next: AutoNextDto = p.kind === 'build' ? { kind: 'build', building: p.building, level: p.level, waiting, readyAt } : { kind: 'troops', unit: p.unit, count: p.count, waiting, readyAt };
  return { status: 'working', next };
}

/**
 * What auto mode does next in this village, at time `t` (the village is settled to `t` first). Null while it is off, in an abandoned or
 * cold village, when all goals are met, or when nothing can happen.
 */
export function autoNext(state: VillageState, t: number, s: WorldSettings): AutoNextDto | null {
  if (!state.auto?.on || state.npc || state.hearth) return null;
  const v = settleVillage(state, t, s);
  if (!v.auto?.on) return null;
  return autoSummary(v, s).next;
}

/** Units of AUTO_UNIT_IDS this village can train right now (building level, research); the Auto page marks the rest. */
export function autoTrainableUnits(v: VillageState, s: WorldSettings): UnitId[] {
  return AUTO_UNIT_IDS.filter((u) => unitUnavailable(v, u, s) === null);
}

/** Units of AUTO_UNIT_IDS that still need Drillyard research (their goals are skipped). */
export function autoNeedsResearch(v: VillageState): UnitId[] {
  return AUTO_UNIT_IDS.filter((u) => UNITS[u].research && !(v.researched ?? []).includes(u));
}

/** Troops counted toward goals per auto unit, and building levels counting queued ones (for the Auto page's progress bars). */
export function autoProgress(v: VillageState): { have: Partial<Record<UnitId, number>>; levels: Partial<Record<BuildingId, number>> } {
  const have: Partial<Record<UnitId, number>> = {};
  for (const u of AUTO_UNIT_IDS) have[u] = troopsHave(v, u);
  return { have, levels: effectiveLevels(v) };
}
