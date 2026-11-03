// Village lifecycle: creation, lazy settlement, build and train actions.

import {
  BUILDINGS,
  CANCEL_REFUND_PERCENT,
  MAX_BUILD_QUEUE,
  MAX_TRAIN_BATCH,
  MAX_TRAIN_QUEUE,
  NPC_GARRISON_PER_HALL,
  NPC_GROWTH_ORDER,
  NPC_MAX_LEVEL,
  NPC_MAX_STEPS_PER_SETTLE,
  NPC_START_LEVELS,
  NPC_START_GOLD_PER_TIER,
  NPC_START_RESOURCE_SHARE,
  NPC_TIER_WEIGHTS,
  POP_PER_UNIT,
  START_RESOURCES,
  TRAIN_TIME_FACTOR,
  UNITS,
} from './config.ts';
import {
  accrueResource,
  buildTimeMs,
  buildingCost,
  canAfford,
  buildingPop,
  netProductionPerHour,
  populationCap,
  populationUsage,
  productionFromLevels,
  storageCap,
  storageCapForLevel,
  upkeepPerHour,
} from './economy.ts';
import { BUILDING_IDS, GameError, RESOURCE_IDS, UNIT_IDS } from './types.ts';
import type {
  BuildJob,
  BuildingId,
  CheckResult,
  Resources,
  TrainJob,
  TrainingBuildingId,
  UnitId,
  Units,
  VillageState,
  WorldSettings,
} from './types.ts';
import { EPSILON, MS_PER_HOUR, cloneVillage, emptyResources, emptyUnits, fail, ipow, isBuildingId, isUnitId } from './util.ts';

// ---- Creation -----------------------------------------------------------------------------------

function emptyVillage(t: number): VillageState {
  const buildings = {} as VillageState['buildings'];
  for (const b of BUILDING_IDS) buildings[b] = 0;
  return {
    resources: emptyResources(),
    lastUpdate: t,
    buildings,
    troops: emptyUnits(),
    away: emptyUnits(),
    buildQueue: [],
    trainQueues: { barracks: [], stables: [] },
  };
}

/** A fresh player village at time t: start resources, start levels, no troops. */
export function createPlayerVillage(t: number): VillageState {
  const v = emptyVillage(t);
  v.resources = { ...START_RESOURCES };
  for (const b of BUILDING_IDS) v.buildings[b] = BUILDINGS[b].startLevel;
  return v;
}

/** Full garrison of an abandoned village for its current Town Hall level. */
function fullGarrison(hallLevel: number): Units {
  const out = emptyUnits();
  for (const u of UNIT_IDS) out[u] = (NPC_GARRISON_PER_HALL[u] ?? 0) * hallLevel;
  return out;
}

/** An abandoned (computer-run) village of tier 1..5 created at time t. */
export function createNpcVillage(tier: number, t: number): VillageState {
  if (!Number.isInteger(tier) || tier < 1 || tier > NPC_TIER_WEIGHTS.length) {
    throw new GameError('invalid_input', `Tier must be an integer from 1 to ${NPC_TIER_WEIGHTS.length}.`);
  }
  const v = emptyVillage(t);
  for (const b of BUILDING_IDS) {
    const rule = NPC_START_LEVELS[b];
    const level = rule ? rule.perTier * tier + rule.offset : 0;
    v.buildings[b] = Math.max(0, Math.min(level, NPC_MAX_LEVEL, BUILDINGS[b].maxLevel));
  }
  const half = Math.floor(storageCap(v) * NPC_START_RESOURCE_SHARE);
  for (const r of RESOURCE_IDS) v.resources[r] = r === 'gold' ? NPC_START_GOLD_PER_TIER * tier : half;
  v.troops = fullGarrison(v.buildings.hall);
  v.npc = { tier, growthSteps: 0, createdAt: t };
  return v;
}

// ---- Settlement ---------------------------------------------------------------------------------

/** One abandoned-village growth step n: raise one building, refill part of the garrison. Returns whether anything changed. */
function applyNpcStep(v: VillageState, n: number): boolean {
  let changed = false;
  const order = NPC_GROWTH_ORDER;
  for (let k = 0; k < order.length; k++) {
    const b = order[(n + k) % order.length] as BuildingId;
    if (v.buildings[b] < Math.min(NPC_MAX_LEVEL, BUILDINGS[b].maxLevel)) {
      v.buildings[b] += 1;
      changed = true;
      break;
    }
  }
  // Abandoned villages never recruit: the garrison they have stays as it is (owner, 2026-11-03).
  return changed;
}

/**
 * Bring a village up to time `t`: production (with level changes at build completions), finished
 * training units and abandoned-village growth. Returns a new state; O(jobs + steps).
 */
export function settleVillage(state: VillageState, t: number, s: WorldSettings): VillageState {
  const v = cloneVillage(state);
  if (!Number.isFinite(t) || t <= v.lastUpdate) return v;

  // Food upkeep is constant over the whole span: training moves units between queue and troops only.
  const upkeep = upkeepPerHour(v, s);
  let cur = v.lastUpdate;

  const advance = (to: number): void => {
    if (!(to > cur)) return;
    const hours = (to - cur) / MS_PER_HOUR;
    const gross = productionFromLevels(v.buildings, s.speed);
    const cap = storageCapForLevel(v.buildings.storehouse);
    for (const r of RESOURCE_IDS) {
      const rate = r === 'food' ? gross.food - upkeep : gross[r];
      v.resources[r] = accrueResource(v.resources[r], rate, hours, cap);
    }
    cur = to;
  };

  // 1. Build jobs that finish by t, in order: production at the old rates up to finishAt, then the new level.
  for (;;) {
    const job = v.buildQueue[0];
    if (!job || job.finishAt > t) break;
    v.buildQueue.shift();
    advance(job.finishAt);
    v.buildings[job.building] = Math.max(v.buildings[job.building], job.targetLevel);
  }

  // 2. Abandoned-village growth steps (older steps beyond the per-settle cap are skipped).
  if (v.npc) {
    const stepMs = (s.npcGrowthHours * MS_PER_HOUR) / s.speed;
    if (stepMs > 0) {
      const due = Math.floor((t - v.npc.createdAt) / stepMs);
      if (due > v.npc.growthSteps) {
        const first = Math.max(v.npc.growthSteps, due - NPC_MAX_STEPS_PER_SETTLE);
        for (let n = first; n < due; n++) {
          advance(Math.min(t, v.npc.createdAt + (n + 1) * stepMs));
          // A step that changes nothing means the village is fully grown: every later step is a no-op too.
          if (!applyNpcStep(v, n)) break;
        }
        v.npc.growthSteps = due;
      }
    }
  }

  advance(t);

  // Research finishes in queue order; waiting jobs were scheduled to start when the one before them ends.
  const rq = v.researchQueue;
  if (rq) {
    while (rq[0] && rq[0].finishAt <= t) {
      const done = rq.shift()!.unit;
      v.researched = [...new Set([...(v.researched ?? []), done])];
    }
    if (rq.length === 0) delete v.researchQueue;
  }

  // 3. Training: units finish one by one.
  for (const queue of [v.trainQueues.barracks, v.trainQueues.stables]) {
    for (const job of queue) {
      const finished = Math.min(job.count, Math.max(0, Math.floor((t - job.startAt) / job.perUnitMs)));
      if (finished > job.done) {
        v.troops[job.unit] += finished - job.done;
        job.done = finished;
      }
    }
    for (let i = queue.length - 1; i >= 0; i--) {
      const job = queue[i];
      if (job && job.done >= job.count) queue.splice(i, 1);
    }
  }

  v.lastUpdate = t;
  return v;
}

// ---- Building -----------------------------------------------------------------------------------

interface BuildPlan {
  building: BuildingId;
  targetLevel: number;
  cost: Resources;
  timeMs: number;
}

/** Rule check on an already settled village. */
function planBuild(v: VillageState, b: unknown, s: WorldSettings, maxQueue: number): CheckResult<BuildPlan> {
  if (!isBuildingId(b)) return fail('invalid_input', 'Unknown building.');
  const def = BUILDINGS[b];
  let queued = 0;
  for (const job of v.buildQueue) if (job.building === b) queued++;
  const targetLevel = v.buildings[b] + queued + 1;
  if (targetLevel > def.maxLevel) return fail('max_level', `${def.name} is already at its maximum level.`);
  for (const req of Object.keys(def.requires) as BuildingId[]) {
    const need = def.requires[req] ?? 0;
    if (v.buildings[req] < need) {
      return fail('requirements_not_met', `Requires ${BUILDINGS[req].name} level ${need}.`);
    }
  }
  const cost = buildingCost(b, targetLevel);
  const cap = storageCap(v);
  for (const r of RESOURCE_IDS) {
    if (cost[r] > cap) return fail('exceeds_storage', 'The cost is more than the storehouse can hold. Upgrade the Storehouse first.');
  }
  if (!canAfford(v.resources, cost)) return fail('not_enough_resources', 'Not enough resources.');
  if (v.buildQueue.length >= maxQueue) return fail('queue_full', 'The build queue is full.');
  if (!v.npc) {
    const extra = buildingPop(b, targetLevel) - buildingPop(b, targetLevel - 1);
    if (populationUsage(v).total + extra > populationCap(v)) {
      return fail('population_full', 'Not enough population room. Upgrade the Farm or spend troops first.');
    }
  }
  return { ok: true, building: b, targetLevel, cost, timeMs: buildTimeMs(b, targetLevel, v.buildings.hall, s) };
}

/** Can `b` be queued at time t? Never throws; unknown ids give `invalid_input`. */
export function checkBuild(
  state: VillageState,
  b: BuildingId | (string & {}),
  t: number,
  s: WorldSettings,
  maxQueue: number = MAX_BUILD_QUEUE,
): CheckResult<{ targetLevel: number; cost: Resources; timeMs: number }> {
  if (!Number.isFinite(t)) return fail('invalid_input', 'Invalid time.');
  const plan = planBuild(settleVillage(state, t, s), b, s, maxQueue);
  if (!plan.ok) return plan;
  return { ok: true, targetLevel: plan.targetLevel, cost: plan.cost, timeMs: plan.timeMs };
}

/** Settle to t, then queue `b`. Throws GameError with the check's reason when invalid. */
export function applyBuild(
  state: VillageState,
  b: BuildingId | (string & {}),
  t: number,
  s: WorldSettings,
  maxQueue: number = MAX_BUILD_QUEUE,
): VillageState {
  if (!Number.isFinite(t)) throw new GameError('invalid_input', 'Invalid time.');
  const v = settleVillage(state, t, s);
  const plan = planBuild(v, b, s, maxQueue);
  if (!plan.ok) throw new GameError(plan.reason, plan.message);
  const last = v.buildQueue[v.buildQueue.length - 1];
  const startAt = Math.max(v.lastUpdate, last ? last.finishAt : 0);
  for (const r of RESOURCE_IDS) v.resources[r] -= plan.cost[r];
  v.buildQueue.push({ building: plan.building, targetLevel: plan.targetLevel, startAt, finishAt: startAt + plan.timeMs });
  return v;
}

// ---- Training -----------------------------------------------------------------------------------

/** Time per unit in ms for the current level of the unit's training building (speed applied). */
export function trainTimeMs(u: UnitId, state: VillageState, s: WorldSettings): number {
  const def = UNITS[u];
  const level = Math.max(1, state.buildings[def.building]);
  const sec = def.trainTimeSec * ipow(TRAIN_TIME_FACTOR, level - 1);
  return Math.max(1, Math.round((sec / s.speed) * 1000));
}

interface TrainPlan {
  unit: UnitId;
  count: number;
  cost: Resources;
  perUnitMs: number;
}

function planTrain(v: VillageState, u: unknown, count: unknown, s: WorldSettings): CheckResult<TrainPlan> {
  if (!isUnitId(u)) return fail('invalid_input', 'Unknown unit.');
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_TRAIN_BATCH) {
    return fail('invalid_input', `Count must be a whole number from 1 to ${MAX_TRAIN_BATCH}.`);
  }
  const def = UNITS[u];
  for (const req of Object.keys(def.requires) as BuildingId[]) {
    const need = def.requires[req] ?? 0;
    if (v.buildings[req] < need) {
      return fail('requirements_not_met', `Requires ${BUILDINGS[req].name} level ${need}.`);
    }
  }
  if (def.research && !(v.researched ?? []).includes(u)) {
    return fail('requirements_not_met', `${def.name} must be researched in the Drillyard first.`);
  }
  if (v.trainQueues[def.building].length >= MAX_TRAIN_QUEUE) {
    return fail('queue_full', `The ${BUILDINGS[def.building].name} queue is full.`);
  }
  const cost = emptyResources();
  for (const r of RESOURCE_IDS) cost[r] = def.cost[r] * count;
  if (!canAfford(v.resources, cost)) return fail('not_enough_resources', 'Not enough resources.');
  if (!v.npc) {
    if (populationUsage(v).total + count * POP_PER_UNIT[u] > populationCap(v)) {
      return fail('population_full', 'Not enough population room. Upgrade the Farm to train more troops.');
    }
    const netAfter = netProductionPerHour(v, s).food - count * def.upkeep * s.speed;
    if (netAfter < -EPSILON) return fail('not_enough_food', 'Your farms cannot feed that many troops. Upgrade the Farm.');
  }
  return { ok: true, unit: u, count, cost, perUnitMs: trainTimeMs(u, v, s) };
}

/** Can a batch be queued at time t? Never throws; bad ids and counts give `invalid_input`. */
export function checkTrain(
  state: VillageState,
  u: UnitId | (string & {}),
  count: number,
  t: number,
  s: WorldSettings,
): CheckResult<{ cost: Resources; perUnitMs: number }> {
  if (!Number.isFinite(t)) return fail('invalid_input', 'Invalid time.');
  const plan = planTrain(settleVillage(state, t, s), u, count, s);
  if (!plan.ok) return plan;
  return { ok: true, cost: plan.cost, perUnitMs: plan.perUnitMs };
}

/** Settle to t, then queue a batch. Throws GameError with the check's reason when invalid. */
export function applyTrain(
  state: VillageState,
  u: UnitId | (string & {}),
  count: number,
  t: number,
  s: WorldSettings,
): VillageState {
  if (!Number.isFinite(t)) throw new GameError('invalid_input', 'Invalid time.');
  const v = settleVillage(state, t, s);
  const plan = planTrain(v, u, count, s);
  if (!plan.ok) throw new GameError(plan.reason, plan.message);
  const queue = v.trainQueues[UNITS[plan.unit].building];
  const last = queue[queue.length - 1];
  const startAt = Math.max(v.lastUpdate, last ? last.startAt + last.count * last.perUnitMs : 0);
  const job: TrainJob = { unit: plan.unit, count: plan.count, done: 0, perUnitMs: plan.perUnitMs, startAt };
  for (const r of RESOURCE_IDS) v.resources[r] -= plan.cost[r];
  queue.push(job);
  return v;
}

// ---- Cancelling a queued job --------------------------------------------------------------------

/** What comes back for a cancelled job: CANCEL_REFUND_PERCENT of the cost, rounded down per resource. */
export function refundOf(cost: Resources): Resources {
  const out = emptyResources();
  for (const r of RESOURCE_IDS) out[r] = Math.floor((cost[r] * CANCEL_REFUND_PERCENT) / 100);
  return out;
}

export function addRefund(v: VillageState, refund: Resources): void {
  const cap = storageCap(v);
  // Never above the storehouse, but never take away what is already there.
  for (const r of RESOURCE_IDS) v.resources[r] = Math.max(v.resources[r], Math.min(cap, v.resources[r] + refund[r]));
}

/**
 * Settle to t, then cancel the newest construction job (only the last one: later levels depend on earlier ones).
 * Returns the new state and the refund (CANCEL_REFUND_PERCENT of the paid cost).
 */
export function applyCancelBuild(state: VillageState, index: unknown, t: number, s: WorldSettings): { state: VillageState; refund: Resources } {
  if (!Number.isFinite(t)) throw new GameError('invalid_input', 'Invalid time.');
  const v = settleVillage(state, t, s);
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= v.buildQueue.length) {
    throw new GameError('invalid_input', 'That construction job is not in the queue any more.');
  }
  if (index !== v.buildQueue.length - 1) throw new GameError('invalid_input', 'Only the newest job in the construction queue can be cancelled.');
  const job = v.buildQueue[index] as BuildJob;
  v.buildQueue.pop();
  const refund = refundOf(buildingCost(job.building, job.targetLevel));
  addRefund(v, refund);
  return { state: v, refund };
}

/**
 * Settle to t, then cancel one training batch. Units already trained stay; the untrained rest is refunded at
 * CANCEL_REFUND_PERCENT. Batches queued behind it move up.
 */
export function applyCancelTrain(
  state: VillageState,
  building: unknown,
  index: unknown,
  t: number,
  s: WorldSettings,
): { state: VillageState; refund: Resources } {
  if (!Number.isFinite(t)) throw new GameError('invalid_input', 'Invalid time.');
  if (building !== 'barracks' && building !== 'stables') throw new GameError('invalid_input', 'Unknown training building.');
  const v = settleVillage(state, t, s);
  const queue = v.trainQueues[building as TrainingBuildingId];
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= queue.length) {
    throw new GameError('invalid_input', 'That training batch is not in the queue any more.');
  }
  const job = queue[index] as TrainJob;
  queue.splice(index, 1);
  // The batches behind it close the gap.
  for (let i = index; i < queue.length; i++) {
    const prev = queue[i - 1];
    const cur = queue[i] as TrainJob;
    cur.startAt = Math.max(v.lastUpdate, prev ? prev.startAt + prev.count * prev.perUnitMs : 0);
  }
  const left = job.count - job.done;
  const cost = emptyResources();
  for (const r of RESOURCE_IDS) cost[r] = UNITS[job.unit].cost[r] * left;
  const refund = refundOf(cost);
  addRefund(v, refund);
  return { state: v, refund };
}
