import { DEFAULT_WORLD, createPlayerVillage, emptyUnits } from '../src/index.ts';
import type { BuildingLevels, Resources, Units, VillageState, WorldSettings } from '../src/index.ts';

export const HOUR = 3_600_000;
export const S1: WorldSettings = { ...DEFAULT_WORLD, speed: 1 };
export const S10: WorldSettings = { ...DEFAULT_WORLD, speed: 10 };

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** A player village at t=0 with optional overrides. */
export function village(over: {
  buildings?: Partial<BuildingLevels>;
  resources?: Partial<Resources>;
  troops?: Partial<Units>;
  away?: Partial<Units>;
} = {}): VillageState {
  const v = createPlayerVillage(0);
  Object.assign(v.buildings, over.buildings);
  Object.assign(v.resources, over.resources);
  Object.assign(v.troops, over.troops);
  Object.assign(v.away, over.away);
  return v;
}

/** A defender with explicit resources, troops and wall/vault levels. */
export function defenderWith(over: Parameters<typeof village>[0]): VillageState {
  return village(over);
}

export { emptyUnits };

export function units(u: Partial<Units>): Units {
  return { ...emptyUnits(), ...u };
}

export function near(actual: number, expected: number, eps = 1e-6): boolean {
  return Math.abs(actual - expected) <= eps;
}
