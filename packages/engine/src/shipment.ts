// Resource shipments: capacity, validation, travel time. Pure rules; the server decides who may send to whom.

import { SHIPMENT_BASE_CAPACITY, SHIPMENT_CAPACITY_PER_MARKET_LEVEL, SHIPMENT_MIN_MARKET_LEVEL, SHIPMENT_SPEED } from './config.ts';
import { addClamped, storageCap } from './economy.ts';
import { RESOURCE_IDS } from './types.ts';
import type { CheckResult, Coords, Resources, VillageState, WorldSettings } from './types.ts';
import { routeTimeMs, travelRoute } from './travel.ts';
import { terrainAmountOf } from './world.ts';
import { MS_PER_HOUR, cloneVillage, distance, emptyResources, fail } from './util.ts';
import { settleVillage } from './village.ts';
import { moveSpeed } from './world-config.ts';

/** Most a village can put on one shipment. */
export function shipmentCapacity(marketLevel: number): number {
  return SHIPMENT_BASE_CAPACITY + SHIPMENT_CAPACITY_PER_MARKET_LEVEL * Math.max(0, Math.floor(marketLevel));
}

/** Travel time in ms on flat ground: ceil(distance / (carrier speed * world speed * unit speed) hours). */
export function flatShipmentTravelMs(from: Coords, to: Coords, s: WorldSettings): number {
  return Math.ceil((distance(from, to) * MS_PER_HOUR) / (SHIPMENT_SPEED * moveSpeed(s)));
}

/** Travel time in ms with terrain (carrier row of TERRAIN_SPEED, docs/GAME_DESIGN.md 18.4a); equals the flat time over grass. */
export function shipmentTravelMs(from: Coords, to: Coords, s: WorldSettings): number {
  return routeTimeMs(travelRoute(from, to, s.seed, terrainAmountOf(s)), 'carrier', SHIPMENT_SPEED, moveSpeed(s));
}

/** Strict parse: an object with only known resource ids, each a non-negative whole number. */
function parseResources(input: unknown): Resources | string {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Resources must be an object.';
  const out = emptyResources();
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!(RESOURCE_IDS as readonly string[]).includes(key)) return 'Unknown resource.';
    const n = raw[key];
    if (n === undefined) continue;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
      return 'Amounts must be whole numbers, zero or more.';
    }
    out[key as keyof Resources] = n;
  }
  return out;
}

/**
 * Validate a shipment from `state` (the caller settles it to the send time first): known resources, whole
 * non-negative amounts, something to send, no more than the village holds, no more than one shipment can carry.
 */
export function checkShipment(state: VillageState, input: unknown): CheckResult<{ resources: Resources; total: number }> {
  if (state.buildings.market < SHIPMENT_MIN_MARKET_LEVEL) return fail('requirements_not_met', 'Build a Market first to send shipments.');
  const res = parseResources(input);
  if (typeof res === 'string') return fail('invalid_input', res);
  let total = 0;
  for (const r of RESOURCE_IDS) {
    if (res[r] > state.resources[r]) return fail('not_enough_resources', 'You do not have that much to send.');
    total += res[r];
  }
  if (total <= 0) return fail('invalid_input', 'Choose something to send.');
  const cap = shipmentCapacity(state.buildings.market);
  if (total > cap) return fail('invalid_input', `One shipment carries at most ${cap} resources (upgrade the Market to carry more).`);
  return { ok: true, resources: res, total };
}

/** Settle to the send time and take the cargo out of the village. */
export function applyShipmentSend(state: VillageState, resources: Resources, t: number, s: WorldSettings): VillageState {
  const v = settleVillage(state, t, s);
  for (const r of RESOURCE_IDS) v.resources[r] -= resources[r];
  return v;
}

/** Settle to `t` and add the cargo, each resource capped at the storehouse (the overflow is lost). */
export function applyShipmentArrival(state: VillageState, resources: Resources, t: number, s: WorldSettings): VillageState {
  const v = cloneVillage(settleVillage(state, t, s));
  const cap = storageCap(v);
  for (const r of RESOURCE_IDS) v.resources[r] = addClamped(v.resources[r], resources[r], cap);
  return v;
}
