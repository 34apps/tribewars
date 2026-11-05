// Sandbox (test mode) village states for allow-listed accounts. Pure; the server decides who may use it.

import { BUILDINGS, POP_PER_UNIT, SANDBOX_ARMY_PER_UNIT, SANDBOX_CHIEFTAIN_ROOM } from './config.ts';
import { populationCap, populationUsage, storageCap } from './economy.ts';
import { BUILDING_IDS, RESOURCE_IDS, UNIT_IDS } from './types.ts';
import type { UnitId, VillageState } from './types.ts';
import { cloneVillage } from './util.ts';

/**
 * Every building at its max level, stores full, SANDBOX_ARMY_PER_UNIT of every unit at home, queues cleared.
 * Units away stay as they are (their movements keep running).
 */
export function maxOutVillage(state: VillageState, t: number): VillageState {
  const v = cloneVillage(state);
  for (const b of BUILDING_IDS) v.buildings[b] = BUILDINGS[b].maxLevel;
  const cap = storageCap(v);
  for (const r of RESOURCE_IDS) v.resources[r] = cap;
  v.buildQueue = [];
  v.trainQueues = { barracks: [], stables: [], bannerhall: [] };
  // No Chieftains: they cost Renown and every living one is a future village. The army is fitted to the
  // population room that is left (buildings and existing troops count), keeping room for SANDBOX_CHIEFTAIN_ROOM
  // Chieftains so conquest can be tested without first clearing the army.
  const room = Math.max(0, populationCap(v) - populationUsage(v).total - SANDBOX_CHIEFTAIN_ROOM * POP_PER_UNIT.chieftain);
  const add: Partial<Record<UnitId, number>> = {};
  let wanted = 0;
  for (const u of UNIT_IDS) {
    if (u === 'chieftain') continue;
    add[u] = Math.max(0, SANDBOX_ARMY_PER_UNIT - v.troops[u]);
    wanted += (add[u] ?? 0) * POP_PER_UNIT[u];
  }
  const factor = wanted <= room ? 1 : room / wanted;
  for (const u of UNIT_IDS) if (u !== 'chieftain') v.troops[u] += Math.floor((add[u] ?? 0) * factor);
  v.lastUpdate = t;
  return v;
}
