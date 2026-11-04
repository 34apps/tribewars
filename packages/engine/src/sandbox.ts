// Sandbox (test mode) village states for allow-listed accounts. Pure; the server decides who may use it.

import { BUILDINGS, SANDBOX_ARMY_PER_UNIT } from './config.ts';
import { storageCap } from './economy.ts';
import { BUILDING_IDS, RESOURCE_IDS, UNIT_IDS } from './types.ts';
import type { VillageState } from './types.ts';
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
  // No Chieftains: they cost Renown and every living one is a future village.
  for (const u of UNIT_IDS) if (u !== 'chieftain') v.troops[u] = Math.max(v.troops[u], SANDBOX_ARMY_PER_UNIT);
  v.buildQueue = [];
  v.trainQueues = { barracks: [], stables: [], bannerhall: [] };
  v.lastUpdate = t;
  return v;
}
