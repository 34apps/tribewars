import type { Mission, ResourceId, UnitId } from '@clanfire/engine';
import type { IconName } from './art/Icon.tsx';

// Names of the drawn icons (src/art/Icon.tsx) per game thing. Buildings use their sprites (src/art/buildings.ts).

export const RESOURCE_ICON: Record<ResourceId, IconName> = {
  wood: 'wood',
  food: 'food',
  iron: 'iron',
  gold: 'gold',
};

export const RESOURCE_NAME: Record<ResourceId, string> = {
  wood: 'Wood',
  food: 'Food',
  iron: 'Iron',
  gold: 'Gold',
};

export const UNIT_ICON: Record<UnitId, IconName> = {
  pikeman: 'pikeman',
  guard: 'guard',
  raider: 'raider',
  outrider: 'outrider',
  knight: 'knight',
  pathfinder: 'pathfinder',
  chieftain: 'chieftain',
};

/** Movement kinds: the missions plus the trip home. */
export type MovementKind = Mission | 'return' | 'shipment';

export const MISSION_ICON: Record<MovementKind, IconName> = {
  attack: 'send',
  scout: 'scout',
  support: 'support',
  found: 'send',
  occupy: 'support',
  return: 'return',
  shipment: 'support',
};

export const MISSION_NAME: Record<MovementKind, string> = {
  attack: 'Attack',
  scout: 'Scout',
  support: 'Support',
  found: 'Found village',
  occupy: 'Occupy',
  return: 'Return',
  shipment: 'Shipment',
};
