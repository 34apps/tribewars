// Founding a village, giving up a village, restarting a player (docs/GAME_DESIGN.md 18.2, "Owner decisions 2026-11-04").
// Pure; the server owns the rows, the Renown ledger and the choice of tile.

import { FOUND_START_RESOURCES, MAX_VILLAGES_PER_PLAYER, NPC_TIER_WEIGHTS, RESTART_EDGE_BAND } from './config.ts';
import { storageCap } from './economy.ts';
import { mulberry32 } from './random.ts';
import { RESOURCE_IDS, UNIT_IDS } from './types.ts';
import type { Coords, Units, VillageState, WorldSettings } from './types.ts';
import { MS_PER_HOUR, cloneVillage, emptyUnits, normalizeUnits } from './util.ts';
import { admitTroops, createPlayerVillage, settleVillage } from './village.ts';
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
 * growthSteps 0, createdAt `now`, `growthSeed`; the troops standing at home STAY exactly as they are (owner 2026-11-17: they keep what they
 * have until defeated; Drillyard ranks too; Chieftains are used up; nothing is added and nothing is ever trained or refilled); `returning` = units of
 * the owner's marches that were on their way home (the server deletes the marches, so they join the village); stock kept but cut to the
 * storehouse; build/training/research queues, researched units, other units away, Feast window, hearth, locks and protection cleared. Other
 * away units are gone; the server handles movements. `renownPaid` follows the levels.
 */
export function abandonVillageKeepBuildings(state: VillageState, now: number, s: WorldSettings, growthSeed: number, returning: Partial<Units> = {}): VillageState {
  const v = settleVillage(state, now, s);
  delete v.hearth;
  delete v.lockUntil;
  delete v.protectedUntil;
  delete v.researched;
  delete v.researchQueue;
  delete v.feast;
  delete v.defenceMark;
  delete v.auto; // auto mode never survives a change of owner (premium; docs/GAME_DESIGN.md)
  v.buildQueue = [];
  v.trainQueues = { barracks: [], stables: [], wrightyard: [], bannerhall: [] };
  v.away = emptyUnits();
  const hall = v.buildings.hall;
  const back = normalizeUnits(returning);
  const home = emptyUnits();
  for (const u of UNIT_IDS) home[u] = v.troops[u] + back[u];
  home.chieftain = 0;
  v.troops = home;
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
