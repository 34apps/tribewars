// Texts for the terrain part of a trip (docs/GAME_DESIGN.md 18.4a). The numbers come from the engine; this only words them.

import type { Route, Terrain } from '@clanfire/engine';
import { TERRAINS } from '@clanfire/engine';

const SLOW_NAME: Record<Terrain, string> = { grass: 'grass', forest: 'forest', hills: 'hills', mountain: 'mountains', lake: 'water' };

/** "2.1 fields of hills, 1.4 of forest" for the slow ground on a route; empty when it is all grass (or under a tenth of a field). */
export function slowGroundText(route: Route): string {
  const parts = TERRAINS.filter((t) => t !== 'grass' && route.tiles[t] >= 0.05).map((t) => ({ t, n: route.tiles[t] }));
  return parts.map((p, i) => `${p.n.toFixed(1)} ${i === 0 ? 'fields of ' : 'of '}${SLOW_NAME[p.t]}`).join(', ');
}

/** "+12%": how much longer the trip takes than on flat ground; null when it does not. */
export function slowdownText(flatMs: number, ms: number): string | null {
  if (!(flatMs > 0) || !Number.isFinite(ms) || ms <= flatMs) return null;
  const pct = Math.max(1, Math.round((ms / flatMs - 1) * 100));
  return `+${pct}%`;
}
