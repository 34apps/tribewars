// Costs, times, production, upkeep, storage. Pure formulas from docs/GAME_DESIGN.md sections 2-4.

import {
  BUILDINGS,
  HALL_TIME_FACTOR,
  PRODUCTION_BASE,
  PRODUCTION_GROWTH,
  PRODUCTION_LEVEL0,
  RESOURCE_PRODUCER,
  STORAGE_BASE,
  STORAGE_GROWTH,
  STORAGE_LEVEL0,
  UNITS,
  VAULT_BASE,
  VAULT_GROWTH,
} from './config.ts';
import { RESOURCE_IDS, UNIT_IDS } from './types.ts';
import type { BuildingId, BuildingLevels, Resources, VillageState, WorldSettings } from './types.ts';
import { emptyResources, ipow } from './util.ts';

/** Cost of building `b` at `level` (level >= 1). */
export function buildingCost(b: BuildingId, level: number): Resources {
  const def = BUILDINGS[b];
  const factor = ipow(def.costGrowth, level - 1);
  const out = emptyResources();
  for (const r of RESOURCE_IDS) out[r] = Math.round(def.baseCost[r] * factor);
  return out;
}

/** Construction time in ms of `level` of `b`, given the Town Hall level when queued. At least 1 ms. */
export function buildTimeMs(b: BuildingId, level: number, hallLevel: number, s: WorldSettings): number {
  const def = BUILDINGS[b];
  const sec = def.baseTimeSec * ipow(def.timeGrowth, level - 1) * ipow(HALL_TIME_FACTOR, Math.max(1, hallLevel) - 1);
  return Math.max(1, Math.round((sec / s.speed) * 1000));
}

/** Gross production per hour for the given building levels, speed applied. */
export function productionFromLevels(levels: BuildingLevels, speed: number): Resources {
  const out = emptyResources();
  for (const r of RESOURCE_IDS) {
    const producer = RESOURCE_PRODUCER[r];
    const level = levels[producer];
    let perHour: number;
    if (level <= 0) perHour = r === 'gold' ? 0 : PRODUCTION_LEVEL0;
    else perHour = Math.round(PRODUCTION_BASE[producer] * ipow(PRODUCTION_GROWTH, level - 1));
    out[r] = perHour * speed;
  }
  return out;
}

/** Gross production per hour (before food upkeep), speed applied. */
export function productionPerHour(state: VillageState, s: WorldSettings): Resources {
  return productionFromLevels(state.buildings, s.speed);
}

/**
 * Food eaten per hour by every unit at home, away or still queued for training (speed applied).
 * Units of a queued batch count from the moment they are queued, so this stays constant while they train.
 * Abandoned villages pay nothing.
 */
export function upkeepPerHour(state: VillageState, s: WorldSettings): number {
  if (state.npc) return 0;
  let food = 0;
  for (const u of UNIT_IDS) food += (state.troops[u] + state.away[u]) * UNITS[u].upkeep;
  for (const queue of [state.trainQueues.barracks, state.trainQueues.stables]) {
    for (const job of queue) food += (job.count - job.done) * UNITS[job.unit].upkeep;
  }
  return food * s.speed;
}

/** Production per hour with food upkeep subtracted (food may be negative). */
export function netProductionPerHour(state: VillageState, s: WorldSettings): Resources {
  const out = productionPerHour(state, s);
  out.food -= upkeepPerHour(state, s);
  return out;
}

/** Storage cap per resource for a storehouse level. */
export function storageCapForLevel(level: number): number {
  return level <= 0 ? STORAGE_LEVEL0 : Math.round(STORAGE_BASE * ipow(STORAGE_GROWTH, level - 1));
}

export function storageCap(state: VillageState): number {
  return storageCapForLevel(state.buildings.storehouse);
}

/** Amount of each resource a vault level hides from raiders. */
export function vaultForLevel(level: number): number {
  return level <= 0 ? 0 : Math.round(VAULT_BASE * ipow(VAULT_GROWTH, level - 1));
}

export function vaultProtection(state: VillageState): number {
  return vaultForLevel(state.buildings.vault);
}

export function canAfford(r: Resources, cost: Resources): boolean {
  for (const id of RESOURCE_IDS) if (!(r[id] >= cost[id])) return false;
  return true;
}

/**
 * Accrue `rate * hours` onto `amount`, clamped to [0, cap]. An amount already above the cap is never
 * reduced by a non-negative rate (production only stops growing).
 */
export function accrueResource(amount: number, rate: number, hours: number, cap: number): number {
  const next = amount + rate * hours;
  if (amount >= cap) return rate >= 0 ? amount : Math.max(0, next);
  return Math.min(cap, Math.max(0, next));
}

/** Add `add` (refund, loot) clamped to the cap; an amount already above the cap is left alone. */
export function addClamped(amount: number, add: number, cap: number): number {
  return amount >= cap ? amount : Math.min(cap, amount + add);
}
