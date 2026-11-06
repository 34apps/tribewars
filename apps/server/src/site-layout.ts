// Where the map sites stand and the "no village near a site" rule (docs/GAME_DESIGN.md 18.4b). The positions are a pure function of
// the world seed and radius (engine generateSites); they are computed once per world and kept.

import { GameError, generateSites, isNearSite, terrainAmountOf, worldRules, type SiteDef, type WorldSettings } from '@clanfire/engine';

const cache = new Map<string, readonly SiteDef[]>();

/** The world's sites (same for every call with the same seed and radius). A world with `features.sites` off has none. */
export function sitesFor(settings: Pick<WorldSettings, 'seed' | 'radius' | 'config'>): readonly SiteDef[] {
  if (!worldRules(settings).features.sites) return [];
  const amount = terrainAmountOf(settings);
  const key = `${settings.seed}:${settings.radius}:${amount}`;
  let sites = cache.get(key);
  if (!sites) {
    sites = generateSites(settings.seed, settings.radius, amount);
    cache.set(key, sites);
  }
  return sites;
}

/** Fresh random picks a placement may take before the world counts as full (a site blocks only a 7 x 7 square, so one or two are plenty). */
const PLACEMENT_TRIES = 60;

/**
 * Ask `pick` for a tile until one is not within SITE_NO_VILLAGE_RADIUS of a site. `pick` must draw fresh random numbers on every call
 * (the callers pass the placement functions of the engine, which advance their own random generator).
 */
export function awayFromSites<T extends { x: number; y: number }>(sites: readonly SiteDef[], pick: () => T): T {
  for (let i = 0; i < PLACEMENT_TRIES; i++) {
    const spot = pick();
    if (!isNearSite(spot.x, spot.y, sites)) return spot;
  }
  throw new GameError('not_found', 'There is no free place left in this world.');
}

/** Drop the placements (abandoned villages) that fall within SITE_NO_VILLAGE_RADIUS of a site. */
export function withoutSiteTiles<T extends { x: number; y: number }>(sites: readonly SiteDef[], placements: readonly T[]): T[] {
  return placements.filter((p) => !isNearSite(p.x, p.y, sites));
}
