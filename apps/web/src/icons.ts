import type { BuildingId, Mission, ResourceId, UnitId } from '@clanfire/engine';

export const RESOURCE_ICON: Record<ResourceId, string> = {
  wood: '🪵',
  food: '🌾',
  iron: '⛓️',
  gold: '🪙',
};

export const RESOURCE_NAME: Record<ResourceId, string> = {
  wood: 'Wood',
  food: 'Food',
  iron: 'Iron',
  gold: 'Gold',
};

export const BUILDING_ICON: Record<BuildingId, string> = {
  hall: '🏰',
  lumber: '🪓',
  farm: '🌾',
  mine: '⛏️',
  goldmine: '💰',
  storehouse: '📦',
  barracks: '⚔️',
  stables: '🐴',
  wall: '🧱',
  vault: '🔒',
};

export const UNIT_ICON: Record<UnitId, string> = {
  pikeman: '🔱',
  guard: '🛡️',
  raider: '🗡️',
  outrider: '🐎',
  knight: '🏇',
  pathfinder: '🧭',
};

/** Movement kinds: the three missions plus the trip home. */
export type MovementKind = Mission | 'return';

export const MISSION_ICON: Record<MovementKind, string> = {
  attack: '⚔️',
  scout: '🧭',
  support: '🤝',
  return: '↩️',
};

export const MISSION_NAME: Record<MovementKind, string> = {
  attack: 'Attack',
  scout: 'Scout',
  support: 'Support',
  return: 'Return',
};
