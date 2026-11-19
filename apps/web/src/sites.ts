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

/** Milliseconds of calm left (0 when none). */
export function calmLeftMs(s: Pick<SiteDto, 'calmUntil'>, now: number): number {
  return s.calmUntil !== null && s.calmUntil > now ? s.calmUntil - now : 0;
}


/** Renown per day shown to a player: the daily rate times the world speed (the server credits it that way). */
const perDay = (rate: number, speed: number): number => Math.round(rate * (Number.isFinite(speed) && speed > 0 ? speed : 1));

export type SiteTone = 'free' | 'ours' | 'theirs';

export interface SiteStatus {
  tone: SiteTone;
  title: string;
  sub: string;
  /** The holding tribe (for the tag button); null when nobody holds it. */
  tribe: SiteDto['holder'];
}

/** The one status line of the panel: who holds the site and what that means for me. A running calm replaces the sub line. */
export function siteStatus(s: Pick<SiteDto, 'holder' | 'calmUntil'>, myTribeId: number | null, now: number): SiteStatus {
  const calm = calmLeftMs(s, now);
  const calmSub = `Calm: nobody can attack it for ${formatLeft(calm)}`;
  if (!s.holder) return { tone: 'free', title: 'Nobody holds it', sub: calm > 0 ? calmSub : "Free to take: beat its keepers and it is your tribe's", tribe: null };
  if (myTribeId !== null && s.holder.tribeId === myTribeId) {
    return { tone: 'ours', title: 'Your tribe holds it', sub: calm > 0 ? calmSub : 'Keep troops here or it turns free', tribe: s.holder };
  }
  return { tone: 'theirs', title: `Held by ${s.holder.name}`, sub: calm > 0 ? calmSub : 'Beat their troops to take it', tribe: s.holder };
}

export interface SiteTile {
  /** Which small icon the tile shows. */
  icon: 'renown' | 'road' | 'lookout' | 'keepers' | 'troops' | 'wall';
  label: string;
  value: string;
  /** Small word after the big number ("tiles", "of 22"). */
  unit?: string;
  /** Bar share 0..1; undefined = no bar. */
  fill?: number;
  sub: string;
}

/** The "Gives" tile: Renown a day for a fire site (world speed applied), or the reach of a Waymark / Lookout. */
export function siteGivesTile(
  s: Pick<SiteDto, 'kind' | 'awake' | 'renownPerDayDormant' | 'renownPerDayAwake'>,
  speed = 1,
): SiteTile {
  if (s.kind === 'waymark') {
    return { icon: 'road', label: 'Gives', value: String(WAYMARK_RADIUS), unit: ' tiles', sub: 'around it: half the slowdown in forest, hills, lakes' };
  }
  if (s.kind === 'lookout') {
    return { icon: 'lookout', label: 'Gives', value: String(LOOKOUT_RADIUS), unit: ' tiles', sub: 'around it: you see enemy armies passing' };
  }
  const now = perDay(s.awake ? s.renownPerDayAwake : s.renownPerDayDormant, speed);
  const wake = !s.awake && s.renownPerDayAwake > s.renownPerDayDormant ? ` · ${perDay(s.renownPerDayAwake, speed)} once it wakes` : '';
  return { icon: 'renown', label: 'Gives', value: `+${now}`, sub: `Renown a day to every member of your tribe${wake}` };
}

/** The defenders tile: the keepers' strength while nobody holds the site, the holder's troops while somebody does. */
export function siteDefendersTile(
  s: Pick<SiteDto, 'holder' | 'keepers' | 'garrison' | 'maxPopulation'>,
  regrowMs: number,
): SiteTile {
  if (!s.holder) {
    const back = Math.max(0, Math.min(1, s.keepers));
    const sub = back >= 1 ? 'at full strength' : `${Math.round(back * 100)}% back · full in ${formatLeft(Math.ceil((1 - back) * regrowMs))}`;
    return { icon: 'keepers', label: 'Keepers', value: formatInt(s.garrison), fill: back, sub };
  }
  const fill = s.maxPopulation > 0 ? Math.max(0, Math.min(1, s.garrison / s.maxPopulation)) : 0;
  return { icon: 'troops', label: 'Troops', value: formatInt(s.garrison), fill, sub: `of ${formatInt(s.maxPopulation)} room` };
}

/** The Wall tile: "6 of 22", the bar and the time to the next level. */
export function siteWallTile(s: Pick<SiteDto, 'wallLevel' | 'wallMax' | 'wallNextMs'>): SiteTile {
  return {
    icon: 'wall',
    label: 'Wall',
    value: String(s.wallLevel),
    unit: ` of ${s.wallMax}`,
    fill: s.wallMax > 0 ? Math.max(0, Math.min(1, s.wallLevel / s.wallMax)) : 0,
    sub: s.wallNextMs === null ? 'top level' : `+1 level in ${formatLeft(s.wallNextMs)}`,
  };
}

/** Headings and hints of the send form on a site: attack takes it, support keeps it. */
export function siteSendCopy(tone: SiteTone): { titles: Partial<Record<Mission, string>>; hints: Partial<Record<Mission, string>> } {
  return {
    titles: { attack: 'Attack to take it', support: tone === 'ours' ? 'Support to keep it' : 'Support the holders' },
    hints: {
      attack: 'Win, and your survivors stay to hold it.',
      support: tone === 'ours' ? 'More troops here make it harder to take.' : 'Your troops join the holders. Only they and their allies can send support.',
    },
  };
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
    return { missions: ['support'], note: null };
  }
  const calm = calmLeftMs(s, now);
  if (calm > 0) {
    return { missions: ['support'], note: 'Only the holders and their allies can send support.' };
  }
  return { missions: ['attack', 'support'], note: null };
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
