import type { BuildingId, ResourceId, UnitId } from '@clanfire/engine';

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
};
