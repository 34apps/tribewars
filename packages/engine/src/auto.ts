// Auto mode (premium; docs/GAME_DESIGN.md "Auto mode and 5 build slots"): a village spends its own income on buildings and troops by itself.
// Pure. `settleAuto` runs inside `settleVillage` as an event loop in time order, like an abandoned village's self-build: a purchase is
// made at the exact moment its cost is covered and a queue slot is free, with build completions (which change production and levels)
// and research completions in between. Settling in one call or in many steps gives the same result (up to the millisecond rounding of
// "when is it affordable").

import {
  AUTO_DEFAULT_SHARE,
  AUTO_DEFAULT_UNITS,
  AUTO_HALL_LAG,
  AUTO_MAX_ACTIONS_PER_SETTLE,
  AUTO_POP_ROOM_SHARE,
  AUTO_SHARE_STEP,
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
import { RESOURCE_IDS, TRAINING_BUILDING_IDS } from './types.ts';
import type { AutoModeState, BuildingId, BuildingLevels, CheckResult, Resources, TrainJob, UnitId, VillageState, WorldSettings } from './types.ts';
import type { AutoNextDto } from './api.ts';
import { MS_PER_HOUR, fail, isUnitId } from './util.ts';
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

/** Settings of a village that never had auto mode: off, the default balance and units, counters at zero. */
export function defaultAutoMode(): AutoModeState {
  return { on: false, buildShare: AUTO_DEFAULT_SHARE, units: [...AUTO_DEFAULT_UNITS], spentBuild: 0, spentTroops: 0, nextUnit: 0 };
}

export interface AutoSettings {
  on: boolean;
  buildShare: number;
  units: UnitId[];
}

/**
 * Check a settings request body. `on` is required; a missing `buildShare` / `units` keeps the value of `base` (the village's current
 * settings, or the defaults on first setup). Never throws.
 */
export function checkAutoSettings(input: unknown, base: Pick<AutoModeState, 'buildShare' | 'units'> = defaultAutoMode()): CheckResult<AutoSettings> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return fail('invalid_input', 'Auto mode settings must be an object.');
  const o = input as Record<string, unknown>;
  if (typeof o.on !== 'boolean') return fail('invalid_input', '"on" must be true or false.');
  let buildShare = base.buildShare;
  if (o.buildShare !== undefined) {
    const n = o.buildShare;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100 || n % AUTO_SHARE_STEP !== 0) {
      return fail('invalid_input', `The balance must be a whole number from 0 to 100 in steps of ${AUTO_SHARE_STEP}.`);
    }
    buildShare = n;
  }
  let units: UnitId[] = [...base.units];
  if (o.units !== undefined) {
    if (!Array.isArray(o.units) || o.units.length > AUTO_UNIT_IDS.length) return fail('invalid_input', 'Pick up to ' + AUTO_UNIT_IDS.length + ' units.');
    const seen = new Set<string>();
    units = [];
    for (const u of o.units) {
      if (!isUnitId(u) || !(AUTO_UNIT_IDS as readonly string[]).includes(u)) return fail('invalid_input', 'Auto mode cannot recruit that unit.');
      if (seen.has(u)) return fail('invalid_input', 'Each unit can be picked once.');
      seen.add(u);
      units.push(u);
    }
  }
  return { ok: true, on: o.on, buildShare, units };
}

/**
 * The new auto mode state after the player saved `settings`. Switching on, or changing the balance or the units, resets the spending
 * counters (a fresh start for the balance); saving the same values again keeps them.
 */
export function applyAutoSettings(current: AutoModeState | undefined, settings: AutoSettings): AutoModeState {
  const cur = current ?? defaultAutoMode();
  const same = cur.buildShare === settings.buildShare && cur.units.length === settings.units.length && cur.units.every((u, i) => u === settings.units[i]);
  const keep = same && (cur.on || !settings.on);
  return {
    on: settings.on,
    buildShare: settings.buildShare,
    units: [...settings.units],
    spentBuild: keep ? cur.spentBuild : 0,
    spentTroops: keep ? cur.spentTroops : 0,
    nextUnit: keep && cur.nextUnit < settings.units.length ? cur.nextUnit : 0,
  };
}

// ---- Planning -------------------------------------------------------------------------------------

type Waiting = AutoNextDto['waiting'];

type AutoPick =
  | { kind: 'build'; building: BuildingId; level: number; cost: Resources }
  | { kind: 'troops'; unit: UnitId; unitIndex: number; count: number; cost: Resources };

interface AutoPlan {
  pick: AutoPick;
  waiting: Waiting;
  /** Earliest time the purchase can happen if nothing else changes; Infinity = waits for a job to finish (an event). */
  at: number;
  /** Best guess shown to the player; null = cannot tell. */
  readyAt: number | null;
}

const RESOURCE_BUILDINGS: readonly BuildingId[] = ['lumber', 'farm', 'mine', 'goldmine'];

const sumOf = (c: Resources): number => c.wood + c.food + c.iron + c.gold;
const trainEnd = (j: TrainJob): number => j.startAt + j.count * j.perUnitMs;

/** Building levels counting queued levels as built. */
function effectiveLevels(v: VillageState): BuildingLevels {
  const eff = { ...v.buildings };
  for (const j of v.buildQueue) eff[j.building] = Math.max(eff[j.building], j.targetLevel);
  return eff;
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

/** The building side's pick (the Steady growth plan, docs/GAME_DESIGN.md): null when it cannot happen. */
function buildSide(v: VillageState, cur: number, s: WorldSettings, forceRoom: boolean, limit: number): AutoPlan | null {
  const eff = effectiveLevels(v);
  const effCap = storageCapForLevel(eff.storehouse);
  const usage = populationUsage(v).total;
  const effPopCap = popCapForLevel(eff.longhouse);
  const avail = (b: BuildingId): boolean => {
    if (eff[b] >= BUILDINGS[b].maxLevel) return false;
    for (const req of Object.keys(BUILDINGS[b].requires) as BuildingId[]) if (v.buildings[req] < (BUILDINGS[b].requires[req] ?? 0)) return false;
    return true;
  };

  // The base pick: Town Hall when it lags, else the lowest resource building.
  let pick: BuildingId | null = null;
  const inPlay = RESOURCE_BUILDINGS.filter((b) => eff[b] > 0 || avail(b));
  const lowest = Math.min(...inPlay.map((b) => eff[b]));
  if (inPlay.length > 0 && avail('hall') && eff.hall + AUTO_HALL_LAG <= lowest) pick = 'hall';
  else {
    // The resource building whose next level costs least (wood + food + iron + gold; ties in RESOURCE_BUILDINGS order), so the
    // dear Gold Mine comes up less often than the three cheap camps and nothing waits half a day while the others are cheap.
    let best = Infinity;
    for (const b of RESOURCE_BUILDINGS) {
      if (!avail(b)) continue;
      const c = sumOf(buildingCost(b, eff[b] + 1));
      if (c < best) { best = c; pick = b; }
    }
  }

  const lowRoom = effPopCap > 0 && effPopCap - usage < AUTO_POP_ROOM_SHARE * effPopCap;
  if ((lowRoom || forceRoom) && avail('longhouse')) pick = 'longhouse';
  else if (pick !== null) {
    const cost = buildingCost(pick, eff[pick] + 1);
    const full = RESOURCE_IDS.some((r) => v.resources[r] >= AUTO_STORE_FULL_SHARE * effCap);
    if ((full || overCap(cost, effCap)) && avail('storehouse')) pick = 'storehouse';
    else if (overCap(cost, effCap)) return null;
    else {
      const extra = buildingPop(pick, eff[pick] + 1) - buildingPop(pick, eff[pick]);
      if (extra > 0 && usage + extra > effPopCap) pick = avail('longhouse') ? 'longhouse' : null;
    }
  }
  if (pick === null) return null;

  const level = eff[pick] + 1;
  const cost = buildingCost(pick, level);
  if (overCap(cost, effCap)) return null;
  const wait = resourceWaitMs(v, cost, s);
  if (wait === null) return null;
  const build: AutoPick = { kind: 'build', building: pick, level, cost };
  // Blocked until a queued Storehouse / Longhouse level is done (the queue holds one: the pick fitted the effective levels only).
  const extra = buildingPop(pick, level) - buildingPop(pick, level - 1);
  if (overCap(cost, storageCap(v))) {
    const job = v.buildQueue.find((j) => j.building === 'storehouse');
    return job ? { pick: build, waiting: 'resources', at: Infinity, readyAt: job.finishAt } : null;
  }
  if (extra > 0 && usage + extra > populationCap(v)) {
    const job = v.buildQueue.find((j) => j.building === 'longhouse');
    return job ? { pick: build, waiting: 'room', at: Infinity, readyAt: job.finishAt } : null;
  }
  if (v.buildQueue.length >= limit) {
    const first = v.buildQueue[0];
    return { pick: build, waiting: 'slot', at: Infinity, readyAt: first ? Math.max(first.finishAt, cur + wait) : null };
  }
  return { pick: build, waiting: wait > 0 ? 'resources' : 'now', at: cur + wait, readyAt: cur + wait };
}

/** The troop side: a plan, or null (cannot happen); `roomBlocked` tells that only the population room is missing. */
function troopSide(v: VillageState, cur: number, s: WorldSettings): { plan: AutoPlan | null; roomBlocked: boolean } {
  const a = v.auto!;
  const none = { plan: null, roomBlocked: false };
  const n = a.units.length;
  let idx = -1;
  for (let k = 0; k < n; k++) {
    const i = (a.nextUnit + k) % n;
    const u = a.units[i]!;
    if (!(AUTO_UNIT_IDS as readonly string[]).includes(u) || unitUnavailable(v, u, s)) continue;
    idx = i;
    break;
  }
  if (idx < 0) return none;
  const unit = a.units[idx]!;
  const def = UNITS[unit];
  const count = AUTO_TRAIN_BATCH;
  const cost: Resources = { wood: 0, food: 0, iron: 0, gold: 0 };
  for (const r of RESOURCE_IDS) cost[r] = def.cost[r] * count;
  const eff = effectiveLevels(v);
  if (overCap(cost, storageCapForLevel(eff.storehouse))) return none;
  const usage = populationUsage(v).total;
  const add = count * POP_PER_UNIT[unit];
  if (usage + add > popCapForLevel(eff.longhouse)) return { plan: null, roomBlocked: true };
  const wait = resourceWaitMs(v, cost, s);
  if (wait === null) return none;
  const pick: AutoPick = { kind: 'troops', unit, unitIndex: idx, count, cost };
  if (overCap(cost, storageCap(v))) {
    const job = v.buildQueue.find((j) => j.building === 'storehouse');
    return job ? { plan: { pick, waiting: 'resources', at: Infinity, readyAt: job.finishAt }, roomBlocked: false } : none;
  }
  if (usage + add > populationCap(v)) {
    const job = v.buildQueue.find((j) => j.building === 'longhouse');
    return job ? { plan: { pick, waiting: 'room', at: Infinity, readyAt: job.finishAt }, roomBlocked: false } : none;
  }
  const x = cur + wait;
  const queue = v.trainQueues[def.building];
  const unfinished = queue.filter((j) => trainEnd(j) > x);
  const last = queue[queue.length - 1];
  const merge = last !== undefined && last.unit === unit && trainEnd(last) > x;
  const limit = worldRules(s).queues.train;
  if (merge || unfinished.length < limit) return { plan: { pick, waiting: wait > 0 ? 'resources' : 'now', at: x, readyAt: x }, roomBlocked: false };
  const y = Math.max(x, trainEnd(unfinished[unfinished.length - limit]!));
  return { plan: { pick, waiting: 'slot', at: y, readyAt: y }, roomBlocked: false };
}

/** What auto mode buys next: the side whose turn it is, or the other side when that one cannot happen at all. Null: nothing can happen. */
function autoPlan(v: VillageState, cur: number, s: WorldSettings, limit: number): AutoPlan | null {
  const a = v.auto!;
  const total = a.spentBuild + a.spentTroops;
  const wantBuild = a.buildShare >= 100 ? true : a.buildShare <= 0 ? false : total === 0 || a.spentBuild * 100 < a.buildShare * total;
  const troops = troopSide(v, cur, s);
  const build = buildSide(v, cur, s, troops.roomBlocked, limit);
  return wantBuild ? (build ?? troops.plan) : (troops.plan ?? build);
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
  const a = v.auto!;
  const cost = plan.pick.cost;
  // The wait was rounded up to a whole millisecond; floats may leave a hair short.
  for (const r of RESOURCE_IDS) if (v.resources[r] < cost[r] && cost[r] - v.resources[r] < 1e-6) v.resources[r] = cost[r];
  if (plan.pick.kind === 'build') {
    const p = planBuild(v, plan.pick.building, s, limit);
    if (!p.ok) return false;
    const last = v.buildQueue[v.buildQueue.length - 1];
    const startAt = Math.max(cur, last ? last.finishAt : 0);
    for (const r of RESOURCE_IDS) v.resources[r] -= p.cost[r];
    v.buildQueue.push({ building: p.building, targetLevel: p.targetLevel, startAt, finishAt: startAt + p.timeMs, cost: { ...p.cost }, auto: true });
    a.spentBuild += sumOf(p.cost);
    return true;
  }
  const { unit, count, unitIndex } = plan.pick;
  const def = UNITS[unit];
  if (unitUnavailable(v, unit, s)) return false;
  for (const r of RESOURCE_IDS) if (!(v.resources[r] >= cost[r])) return false;
  if (populationUsage(v).total + count * POP_PER_UNIT[unit] > populationCap(v)) return false;
  const queue = v.trainQueues[def.building];
  const last = queue[queue.length - 1];
  if (last && last.unit === unit && trainEnd(last) > cur) {
    last.count += count;
    last.auto = true;
  } else {
    if (queue.length >= worldRules(s).queues.train) return false;
    queue.push({ unit, count, done: 0, perUnitMs: trainTimeMs(unit, v, s), startAt: Math.max(cur, last ? trainEnd(last) : 0), unitCost: { ...def.cost }, auto: true });
  }
  for (const r of RESOURCE_IDS) v.resources[r] -= cost[r];
  a.spentTroops += sumOf(cost);
  a.nextUnit = (unitIndex + 1) % a.units.length;
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

/**
 * What auto mode does next in this village, at time `t` (the village is settled to `t` first). Null while it is off, in an abandoned or
 * cold village, or when nothing can happen (every steady-growth building at max and no unit can be recruited).
 */
export function autoNext(state: VillageState, t: number, s: WorldSettings): AutoNextDto | null {
  if (!state.auto?.on || state.npc || state.hearth) return null;
  const v = settleVillage(state, t, s);
  if (!v.auto?.on) return null;
  const cur = v.lastUpdate;
  const plan = autoPlan(v, cur, s, buildQueueLimit(worldRules(s), true));
  if (!plan) return null;
  const waiting: Waiting = plan.at <= cur ? 'now' : plan.waiting;
  const readyAt = plan.readyAt !== null && Number.isFinite(plan.readyAt) ? plan.readyAt : null;
  if (plan.pick.kind === 'build') return { kind: 'build', building: plan.pick.building, level: plan.pick.level, waiting, readyAt };
  return { kind: 'troops', unit: plan.pick.unit, count: plan.pick.count, waiting, readyAt };
}

/** Units of AUTO_UNIT_IDS this village can train right now (building level, research); the Auto page greys out the rest. */
export function autoTrainableUnits(v: VillageState, s: WorldSettings): UnitId[] {
  return AUTO_UNIT_IDS.filter((u) => unitUnavailable(v, u, s) === null);
}
