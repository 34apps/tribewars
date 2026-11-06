// Pure helpers for map sites (Great Fire, Fire Shrines): names, state lines, which missions the panel offers.
// Data comes from GET /api/sites; rules are in packages/engine/src/sites.ts and docs/GAME_DESIGN.md 18.4b.

import { LOOKOUT_RADIUS, WAYMARK_RADIUS } from '@clanfire/engine';
import type { Mission, SiteDto } from '@clanfire/engine';
import { formatInt, formatLeft } from './format.ts';

export const SITE_KIND_NAME: Record<SiteDto['kind'], string> = {
  great_fire: 'Great Fire',
  fire_shrine: 'Fire Shrine',
  waymark: 'Waymark',
  lookout: 'Lookout',
};

/** The two utility sites: no Renown bonus, no awake/dormant state. */
export function isUtilitySite(kind: SiteDto['kind']): boolean {
  return kind === 'waymark' || kind === 'lookout';
}

/** One plain line for a Waymark or Lookout (null for the fire sites, which show their Renown bonus instead). */
export function siteKindLine(kind: SiteDto['kind']): string | null {
  if (kind === 'waymark') return `Your tribe's troops and carts cross forest, hills and lakes faster within ${WAYMARK_RADIUS} tiles.`;
  if (kind === 'lookout') return `Your tribe sees enemy armies that pass within ${LOOKOUT_RADIUS} tiles.`;
  return null;
}

/** The server names sites ("Waymark 2"); older answers without a name fall back to the kind (and a shrine's number). */
export function siteName(s: Pick<SiteDto, 'id' | 'kind'> & { name?: string }): string {
  if (s.name) return s.name;
  if (s.kind === 'great_fire') return SITE_KIND_NAME.great_fire;
  return `${SITE_KIND_NAME[s.kind]} ${Math.max(1, s.id - 1)}`;
}

/** Range in tiles of a Waymark / Lookout, or 0 for other sites (drawn as a faint circle when selected). */
export function siteRange(kind: SiteDto['kind']): number {
  return kind === 'waymark' ? WAYMARK_RADIUS : kind === 'lookout' ? LOOKOUT_RADIUS : 0;
}

/** The site standing on a tile, if any. */
export function siteAt(sites: readonly SiteDto[], x: number, y: number): SiteDto | undefined {
  return sites.find((s) => s.x === x && s.y === y);
}

/** "[TAG] Name" or "Nobody holds it". */
export function holderText(s: Pick<SiteDto, 'holder'>): string {
  return s.holder ? `[${s.holder.tag}] ${s.holder.name}` : 'Nobody holds it';
}

/** "Awake" or "Dormant: wakes in 12d 3h" (a wake time in the past counts as awake). */
export function stateText(s: Pick<SiteDto, 'awake'>, wakesAt: number, now: number): string {
  if (s.awake) return 'Awake';
  return wakesAt > now ? `Dormant: wakes in ${formatLeft(wakesAt - now)}` : 'Dormant';
}

/** "600 of 3,000" with the word the number means: the holder's troops, or the militia of a neutral site. */
export function garrisonText(s: Pick<SiteDto, 'garrison' | 'maxPopulation' | 'holder'>): string {
  return `${formatInt(s.garrison)} of ${formatInt(s.maxPopulation)}${s.holder ? '' : ' (militia)'}`;
}

/** Milliseconds of calm left (0 when none). */
export function calmLeftMs(s: Pick<SiteDto, 'calmUntil'>, now: number): number {
  return s.calmUntil !== null && s.calmUntil > now ? s.calmUntil - now : 0;
}

/** "+4%" / "+10%" / "+2.5%" from a fraction. */
export function bonusPercent(fraction: number): string {
  const p = Math.round((Number.isFinite(fraction) ? fraction : 0) * 1000) / 10;
  return `+${Number.isInteger(p) ? p : p.toFixed(1)}%`;
}

/** The Renown a site gives, for the panel. */
export function siteBonusText(s: Pick<SiteDto, 'bonus' | 'holder'>): string {
  return `${bonusPercent(s.bonus)} Renown for every member of ${s.holder ? 'the holding tribe' : 'whoever holds it'}`;
}

/** The tribe bonus line in the Tribe area, or null when it is 0. */
export function tribeBonusLine(myBonus: number): string | null {
  return myBonus > 0 ? `Fire sites your tribe holds: ${bonusPercent(myBonus)} Renown for every member` : null;
}

export interface SiteMissions {
  missions: Mission[];
  /** Plain note about why a mission is missing or limited; null when there is nothing to say. */
  note: string | null;
}

/**
 * Missions the panel offers: a neutral site is taken by attack; my own tribe's site gets support; another tribe's site can be
 * attacked (not during the calm after a capture) or, from its allies, supported. The server re-checks all of it.
 */
export function siteMissions(s: SiteDto, myTribeId: number | null, now: number): SiteMissions {
  if (!s.holder) return { missions: ['attack'], note: null };
  if (myTribeId !== null && s.holder.tribeId === myTribeId) {
    return { missions: ['support'], note: 'Your tribe holds this site. Station troops here to keep it.' };
  }
  const calm = calmLeftMs(s, now);
  if (calm > 0) {
    return { missions: ['support'], note: `Calm after a capture: it cannot be attacked for ${formatLeft(calm)}. Only the holders and their allies can send support.` };
  }
  return { missions: ['attack', 'support'], note: 'Support is only accepted from the holding tribe and its allies.' };
}

/** Does a tap at a point hit the site's drawn box? `box` is in CSS px around the tile centre (see map/render.ts). */
export function hitsSiteBox(px: number, py: number, d: { x: number; y: number; scale: number }): boolean {
  const fx = (px - d.x) / d.scale;
  const fy = (py - d.y) / d.scale;
  return fx >= -48 && fx <= 48 && fy >= -120 && fy <= 28;
}

/** Sites in a stable order for lists (Great Fire first, then shrines by id). */
export function sortSites(sites: readonly SiteDto[]): SiteDto[] {
  return [...sites].sort((a, b) => (a.kind === b.kind ? a.id - b.id : a.kind === 'great_fire' ? -1 : 1));
}
