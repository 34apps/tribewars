// Texts for the terrain part of a trip (docs/GAME_DESIGN.md 18.4a). The numbers come from the engine; this only words them.

import type { Route, Terrain } from '@clanfire/engine';
import { TERRAINS } from '@clanfire/engine';

const SLOW_NAME: Record<Terrain, string> = { grass: 'grass', forest: 'forest', hills: 'hills', mountain: 'mountains', lake: 'water' };

/** "forest and hills": the slow ground on a route, most first; empty when it is all grass (or under a tenth of a field). */
export function slowGroundText(route: Route): string {
  const names = TERRAINS.filter((t) => t !== 'grass' && route.tiles[t] >= 0.05)
    .sort((a, b) => route.tiles[b] - route.tiles[a])
    .map((t) => SLOW_NAME[t]);
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "Forest and hills on the way: 8% slower" in plain words; null when the ground does not slow the trip. */
export function slowTripText(route: Route, flatMs: number, ms: number): string | null {
  if (!(flatMs > 0) || !Number.isFinite(ms) || ms <= flatMs) return null;
  const pct = Math.max(1, Math.round((ms / flatMs - 1) * 100));
  const ground = slowGroundText(route) || 'rough ground';
  return `${ground[0]!.toUpperCase()}${ground.slice(1)} on the way: ${pct}% slower`;
}

/** Shown in a send summary when a Waymark of my tribe shortens the trip. */
export const WAYMARK_NOTE = 'Waymark: faster';
