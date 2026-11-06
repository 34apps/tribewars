// Founding a village, giving up a village, restarting a player (docs/GAME_DESIGN.md 18.2, "Owner decisions 2026-11-04").
// Pure; the server owns the rows, the Renown ledger and the choice of tile.

import { FOUND_START_RESOURCES, MAX_VILLAGES_PER_PLAYER, NPC_TIER_WEIGHTS, RESTART_EDGE_BAND } from './config.ts';
import { storageCap } from './economy.ts';
import { mulberry32 } from './random.ts';
import { RESOURCE_IDS } from './types.ts';
import type { Coords, Units, VillageState, WorldSettings } from './types.ts';
import { MS_PER_HOUR, cloneVillage, emptyUnits } from './util.ts';
import { admitTroops, createPlayerVillage, fullGarrison, settleVillage } from './village.ts';
import { worldRules } from './world-config.ts';
import { expandingRadius, findExpandingSpawn, findSpawnLocation } from './world.ts';

const hoursMs = (hours: number, s: WorldSettings): number => Math.round((hours * MS_PER_HOUR) / s.speed);

/** Name of a player's n-th village (n >= 2), until they rename it. */
export function foundedVillageName(playerName: string, n: number): string {
  return `${playerName}'s village ${Math.max(1, Math.floor(n))}`;
}

/** Can a player with `villagesOwned` villages own one more? (Sanity cap; the Renown price is the real limit.) */
export function underVillageLimit(villagesOwned: number): boolean {
  return villagesOwned < MAX_VILLAGES_PER_PLAYER;
}

/**
 * The village a found mission creates when the Chieftain arrives at `t`: new-player start levels, FOUND_START_RESOURCES, no
 * Renown for those levels, and a protection time (`protectedUntil` = t + the world's `protection.foundHours` / speed) in which it cannot be
 * attacked. The escort (the army without the Chieftain, who is used up) becomes the garrison up to the population cap;
 * `overflow` is what did not fit (the server sends it home). Chieftains in `escort` are ignored.
 */
export function createFoundedVillage(t: number, s: WorldSettings, escort: Partial<Units> = emptyUnits()): { state: VillageState; overflow: Units } {
  const base = createPlayerVillage(t, FOUND_START_RESOURCES);
  const moved = admitTroops(base, { ...escort, chieftain: 0 });
  moved.state.protectedUntil = t + hoursMs(worldRules(s).protection.foundHours, s);
  moved.overflow.chieftain = 0;
  return moved;
}

/**
 * Turn an idle owner's village into an abandoned village that KEEPS ALL ITS BUILDINGS (owner 2026-11-04), so it becomes a
 * valuable target. The village is settled to `now` first. Then: `npc` = tier from the Town Hall level (clamped 1..tiers),
 * growthSteps 0, createdAt `now`, `growthSeed`; garrison = the full abandoned garrison for that Town Hall level; stock kept but
 * cut to the storehouse; build/training/research queues, ranks, researched units, units away, Feast window, hearth, locks and
 * protection cleared. Units of the owner that were away are gone; the server handles movements. `renownPaid` follows the levels.
 */
export function abandonVillageKeepBuildings(state: VillageState, now: number, s: WorldSettings, growthSeed: number): VillageState {
  const v = settleVillage(state, now, s);
  delete v.hearth;
  delete v.lockUntil;
  delete v.protectedUntil;
  delete v.researched;
  delete v.researchQueue;
  delete v.ranks;
  delete v.feast;
  delete v.defenceMark;
  v.buildQueue = [];
  v.trainQueues = { barracks: [], stables: [], bannerhall: [] };
  v.away = emptyUnits();
  const hall = v.buildings.hall;
  v.troops = fullGarrison(hall);
  const cap = storageCap(v);
  for (const r of RESOURCE_IDS) v.resources[r] = Math.min(v.resources[r], cap);
  v.npc = { tier: Math.min(NPC_TIER_WEIGHTS.length, Math.max(1, hall)), growthSteps: 0, createdAt: now, growthSeed: growthSeed >>> 0 };
  v.renownPaid = { ...v.buildings };
  v.lastUpdate = now;
  return cloneVillage(v);
}

/** Protection time of a restarted player (ms, speed applied). */
export function restartProtectionMs(s: WorldSettings): number {
  return hoursMs(worldRules(s).protection.restartHours, s);
}

/**
 * Where a player who lost their last village starts again. 'expanding' layout: a random free tile at the outer edge of the
 * current populated disc (`playerVillages` = player villages in the world now, not counting the restarting player), the same
 * edge a newcomer gets; the server then adds the ring of abandoned villages with `generateNpcsForSpawn`. 'scattered' layout:
 * a random free tile. `isOccupied(x, y)` reports a village on that exact tile. `seed` makes the choice deterministic (the server
 * mixes in a secret). Throws GameError('not_found') only if the world is full. `protectionMs` is how long the new village is
 * safe from attacks (`protection.restartHours` / speed): the server sets `protectedUntil` = now + protectionMs.
 */
export function restartPlacement(
  s: WorldSettings,
  playerVillages: number,
  seed: number,
  isOccupied: (x: number, y: number) => boolean,
  /** Extra rule a tile must pass (the server: away from map sites). */
  allowed?: (x: number, y: number) => boolean,
): { spot: Coords; protectionMs: number } {
  const rng = mulberry32(seed >>> 0);
  const spot =
    s.layout === 'expanding'
      ? findExpandingSpawn(isOccupied, rng, s, playerVillages, RESTART_EDGE_BAND, allowed)
      : findSpawnLocation(isOccupied, rng, s, allowed);
  return { spot, protectionMs: restartProtectionMs(s) };
}

/** Radius of the populated disc a restart lands on (expanding layout), for tests and the client. */
export function restartEdgeRadius(s: WorldSettings, playerVillages: number): number {
  return Math.min(expandingRadius(playerVillages), Math.max(0, Math.floor(s.radius)));
}
