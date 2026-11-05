// Sandbox (test mode) village states for allow-listed accounts. Pure; the server decides who may use it.

import { BUILDINGS, POP_PER_UNIT, SANDBOX_ARMY_PER_UNIT, SANDBOX_CHIEFTAIN_ROOM, UNITS } from './config.ts';
import { netProductionPerHour, populationCap, populationUsage, storageCap } from './economy.ts';
import { BUILDING_IDS, RESOURCE_IDS, UNIT_IDS } from './types.ts';
import type { UnitId, VillageState, WorldSettings } from './types.ts';
import { cloneVillage } from './util.ts';

/**
 * Every building at its max level, stores full, SANDBOX_ARMY_PER_UNIT of every unit at home, queues cleared.
 * Units away stay as they are (their movements keep running).
 */
export function maxOutVillage(state: VillageState, t: number, settings?: WorldSettings): VillageState {
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
  let factor = wanted <= room ? 1 : room / wanted;
  const grant = (f: number): VillageState => {
    const g = cloneVillage(v);
    for (const u of UNIT_IDS) if (u !== 'chieftain') g.troops[u] += Math.floor((add[u] ?? 0) * f);
    return g;
  };
  if (settings) {
    // Food too: the farms must still feed the army plus SANDBOX_CHIEFTAIN_ROOM Chieftains (upkeep grows with the army).
    const reserve = SANDBOX_CHIEFTAIN_ROOM * UNITS.chieftain.upkeep * settings.speed;
    const fed = (f: number): boolean => netProductionPerHour(grant(f), settings).food - reserve >= 0;
    if (!fed(factor)) {
      let lo = 0;
      let hi = factor;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (fed(mid)) lo = mid;
        else hi = mid;
      }
      factor = lo;
    }
  }
  v.troops = grant(factor).troops;
  v.lastUpdate = t;
  return v;
}
