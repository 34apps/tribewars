// Small shared helpers: math, empty containers, cloning, id guards.

import { BUILDINGS, UNITS } from './config.ts';
import type { BuildingId, Coords, GameErrorCode, Resources, UnitId, Units, VillageState } from './types.ts';

export const MS_PER_HOUR = 3_600_000;

/** Tolerance for float comparisons on resource rates. */
export const EPSILON = 1e-9;

/**
 * base^exp for a non-negative integer exp by repeated multiplication. Unlike `**` this only uses
 * IEEE-exact multiplications, so client and server always round to the same integer.
 */
export function ipow(base: number, exp: number): number {
  let r = 1;
  for (let i = 0; i < exp; i++) r *= base;
  return r;
}

export function distance(a: Coords, b: Coords): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function emptyUnits(): Units {
  return { pikeman: 0, guard: 0, raider: 0, outrider: 0, knight: 0 };
}

export function emptyResources(): Resources {
  return { wood: 0, food: 0, iron: 0, gold: 0 };
}

export function totalUnits(u: Units): number {
  return u.pikeman + u.guard + u.raider + u.outrider + u.knight;
}

/** Deep copy of a village (cheaper than structuredClone). */
export function cloneVillage(v: VillageState): VillageState {
  const out: VillageState = {
    resources: { ...v.resources },
    lastUpdate: v.lastUpdate,
    buildings: { ...v.buildings },
    troops: { ...v.troops },
    away: { ...v.away },
    buildQueue: v.buildQueue.map((j) => ({ ...j })),
    trainQueues: {
      barracks: v.trainQueues.barracks.map((j) => ({ ...j })),
      stables: v.trainQueues.stables.map((j) => ({ ...j })),
    },
  };
  if (v.npc) out.npc = { ...v.npc };
  return out;
}

export function isBuildingId(x: unknown): x is BuildingId {
  return typeof x === 'string' && Object.hasOwn(BUILDINGS, x);
}

export function isUnitId(x: unknown): x is UnitId {
  return typeof x === 'string' && Object.hasOwn(UNITS, x);
}

export function fail(reason: GameErrorCode, message: string): { ok: false; reason: GameErrorCode; message: string } {
  return { ok: false, reason, message };
}
