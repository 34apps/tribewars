// Pure helpers for map sites (Great Fire, Fire Shrines): names, state lines, which missions the panel offers.
// Data comes from GET /api/sites; rules are in packages/engine/src/sites.ts and docs/GAME_DESIGN.md 18.4b.

import { LOOKOUT_RADIUS, SHRINE_WAKE_DAYS, WAYMARK_RADIUS } from '@clanfire/engine';
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

/** Renown per day shown to a player: the daily rate times the world speed (the server credits it that way). */
const perDay = (rate: number, speed: number): number => Math.round(rate * (Number.isFinite(speed) && speed > 0 ? speed : 1));

/** The Renown a site gives, for the panel: what every member of the holding tribe earns a day (and what it becomes once the site wakes). */
export function siteBonusText(
  s: Pick<SiteDto, 'kind' | 'renownPerDayDormant' | 'renownPerDayAwake' | 'awake'>,
  speed = 1,
): string {
  const what = s.kind === 'great_fire' ? 'the Great Fire' : 'this shrine';
  const now = perDay(s.awake ? s.renownPerDayAwake : s.renownPerDayDormant, speed);
  const wake = !s.awake && s.renownPerDayAwake > s.renownPerDayDormant ? ` (${perDay(s.renownPerDayAwake, speed)} once it wakes on day ${SHRINE_WAKE_DAYS})` : '';
  return `While your tribe holds ${what}, every member earns ${now} Renown a day${wake}`;
}

/** Extra panel line for a member of the holding tribe: what they earn from it. Empty otherwise and for sites that give nothing. */
export function siteEarnLines(s: Pick<SiteDto, 'renownPerDay'>, mineHeld: boolean, speed = 1): string[] {
  return mineHeld && s.renownPerDay > 0 ? [`You earn ${perDay(s.renownPerDay, speed)} a day from it`] : [];
}

/** The site Wall line: "Wall 14 of 22 · next level in 7h 12m" (or "top level"). */
export function siteWallText(s: Pick<SiteDto, 'wallLevel' | 'wallMax' | 'wallNextMs'>): string {
  return `Wall ${s.wallLevel} of ${s.wallMax} · ${s.wallNextMs === null ? 'top level' : `next level in ${formatLeft(s.wallNextMs)}`}`;
}

/** The keepers line for a site nobody holds: "Keepers: 40% back, full in 14h" (empty for held sites and Waymarks and Lookouts too: they have keepers as well, so only held sites give ''). */
export function keepersText(s: Pick<SiteDto, 'holder' | 'keepers'>, regrowMs: number): string {
  if (s.holder) return '';
  if (s.keepers >= 1) return 'Keepers at full strength';
  return `Keepers ${Math.round(s.keepers * 100)}% back, full in ${formatLeft(Math.ceil((1 - s.keepers) * regrowMs))}`;
}

/** The tribe line in the Tribe area, or null when it is 0. */
export function tribeBonusLine(myRenownPerDay: number, speed = 1): string | null {
  return myRenownPerDay > 0 ? `Fire sites your tribe holds: you earn ${perDay(myRenownPerDay, speed)} Renown a day from them` : null;
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
