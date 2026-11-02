// Small shared helpers: math, empty containers, cloning, id guards.

import { BUILDINGS, UNITS } from './config.ts';
import { BUILDING_IDS, UNIT_IDS } from './types.ts';
import type { BuildingId, BuildingLevels, Coords, GameErrorCode, Resources, TrainJob, UnitId, Units, VillageState } from './types.ts';

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
  return { pikeman: 0, guard: 0, raider: 0, outrider: 0, knight: 0, pathfinder: 0 };
}

export function emptyResources(): Resources {
  return { wood: 0, food: 0, iron: 0, gold: 0 };
}

/** Sum of all unit counts; a missing key (data saved before a unit existed) counts as 0. */
export function totalUnits(u: Partial<Units>): number {
  let n = 0;
  for (const id of UNIT_IDS) n += u[id] || 0;
  return n;
}

/**
 * A full `Units` from a loose map: every UnitId present, missing keys and non-finite or non-numeric
 * values become 0, unknown keys are dropped. Always a fresh object. Use it on anything loaded from
 * storage (units saved before a unit existed lack its key).
 */
export function normalizeUnits(u: Partial<Units> | undefined): Units {
  const out = emptyUnits();
  if (typeof u !== 'object' || u === null) return out;
  for (const id of UNIT_IDS) {
    const n = u[id];
    out[id] = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  }
  return out;
}

/**
 * Deep copy of a village with every collection complete: all unit keys in `troops`/`away`, all
 * building keys (missing = 0) and both training queues. Brings old saved states up to the current
 * shape. Pure; the input is never mutated and nothing is shared with it.
 */
export function normalizeVillage(v: VillageState): VillageState {
  const buildings = {} as BuildingLevels;
  for (const b of BUILDING_IDS) {
    const n = v.buildings?.[b];
    buildings[b] = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  }
  const copyJobs = (jobs: TrainJob[] | undefined): TrainJob[] => (jobs ?? []).map((j) => ({ ...j }));
  const out: VillageState = {
    resources: { ...v.resources },
    lastUpdate: v.lastUpdate,
    buildings,
    troops: normalizeUnits(v.troops),
    away: normalizeUnits(v.away),
    buildQueue: v.buildQueue.map((j) => ({ ...j })),
    trainQueues: {
      barracks: copyJobs(v.trainQueues?.barracks),
      stables: copyJobs(v.trainQueues?.stables),
    },
  };
  if (v.npc) out.npc = { ...v.npc };
  return out;
}

/** Deep copy of a village (cheaper than structuredClone). Also normalizes, so old saved states work. */
export function cloneVillage(v: VillageState): VillageState {
  return normalizeVillage(v);
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
