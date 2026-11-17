// Pure logic of the Incoming-attack page (FrameIncoming.tsx): which attacks to list, grouping by my village, paging, the size line,
// the ready-made tribe chat line and the village to use as the other end of a support or a shipment. No I/O.
// Nothing here shows more than the server sends: no troop counts of own attacks and never the attacker's chosen siege target.

import { TRIBE_CHAT_MESSAGE_MAX, distance } from '@clanfire/engine';
import type { VillageRefDto, WatchtowerSizeBand } from '@clanfire/engine';
import { formatClock, formatCoords, formatDuration } from '../../format.ts';
import type { KnownAttack } from '../../incoming.ts';

/** One line is a village heading or an attack row. Eight fit the 1440 x 900 frame next to the header and the pager. */
export const INCOMING_LINES_PER_PAGE = 8;

/** Wording of the Tribe > Alerts list (tribe/Alerts.tsx). */
export const BAND_TEXT: Record<WatchtowerSizeBand, string> = { small: 'Small army', medium: 'Medium army', large: 'Large army', huge: 'Huge army' };

/** Shown when the tribe's Watchtower sends no size (no tribe, or the project is not built high enough). */
export const SIZE_UNKNOWN = 'Size unknown (a tribe Watchtower shows it)';

/** Attacks on my own villages that have not landed yet (a second of grace, like the tab chips), soonest first. */
export function ownAttacks(attacks: KnownAttack[], now: number): KnownAttack[] {
  return attacks.filter((a) => a.own && a.arriveAt > now - 1000).sort((a, b) => a.arriveAt - b.arriveAt || a.movementId - b.movementId);
}

export interface VillageGroup {
  village: VillageRefDto;
  /** Soonest first. */
  attacks: KnownAttack[];
  soonestAt: number;
}

/** Attacks grouped by the village they hit; the group with the soonest landing comes first. */
export function groupByVillage(attacks: KnownAttack[]): VillageGroup[] {
  const map = new Map<number, VillageGroup>();
  for (const a of [...attacks].sort((x, y) => x.arriveAt - y.arriveAt || x.movementId - y.movementId)) {
    const g = map.get(a.target.villageId);
    if (g) g.attacks.push(a);
    else map.set(a.target.villageId, { village: a.target, attacks: [a], soonestAt: a.arriveAt });
  }
  return [...map.values()].sort((a, b) => a.soonestAt - b.soonestAt || a.village.villageId - b.village.villageId);
}

/** A village heading with the part of its attacks that sits on one page. */
export interface PageChunk {
  village: VillageRefDto;
  /** Landing of the village's soonest attack (the heading shows it on every page). */
  soonestAt: number;
  /** All attacks on the village, over all pages. */
  total: number;
  /** The attacks listed on this page. */
  attacks: KnownAttack[];
  /** The village's attacks started on an earlier page. */
  continued: boolean;
  /** Every attack on the village (for the tribe line and the buttons). */
  all: KnownAttack[];
}

/**
 * Cut the groups into pages of at most `lines` lines (a heading counts 1, each attack 1). A group never starts on a page with
 * room for only its heading, and one with more attacks than fit continues on the next page under the same heading.
 */
export function pageChunks(groups: VillageGroup[], lines: number = INCOMING_LINES_PER_PAGE): PageChunk[][] {
  const budget = Math.max(2, Math.floor(lines));
  const pages: PageChunk[][] = [];
  let current: PageChunk[] = [];
  let used = 0;
  for (const g of groups) {
    let rest = g.attacks;
    let continued = false;
    while (rest.length > 0) {
      if (budget - used < 2) {
        pages.push(current);
        current = [];
        used = 0;
      }
      const room = budget - used - 1;
      const take = rest.slice(0, room);
      rest = rest.slice(room);
      current.push({ village: g.village, soonestAt: g.soonestAt, total: g.attacks.length, attacks: take, continued, all: g.attacks });
      used += 1 + take.length;
      continued = true;
    }
  }
  if (current.length > 0) pages.push(current);
  return pages;
}

/** "Medium army ~120" (the number only at Watchtower level 3), or the unknown line. */
export function sizeText(a: Pick<KnownAttack, 'sizeBand' | 'sizeAbout'>): string {
  if (!a.sizeBand) return SIZE_UNKNOWN;
  return `${BAND_TEXT[a.sizeBand]}${a.sizeAbout !== undefined && a.sizeAbout > 0 ? ` ~${a.sizeAbout.toLocaleString('en-US')}` : ''}`;
}

/** The chip colour class of tribe/Alerts.tsx ("huge" shares the large colour). */
export function sizeClass(band: WatchtowerSizeBand | undefined): string {
  return band ? `size-${band === 'huge' ? 'large' : band}` : 'size-none';
}

/** "(12|34)". */
export const villageSpot = (v: { x: number; y: number }): string => `(${formatCoords(v.x, v.y)})`;

/**
 * The one line "Ask the tribe for help" posts to the tribe chat (max TRIBE_CHAT_MESSAGE_MAX characters): the village, the
 * soonest landing (clock time and time left) and a request. Never says what the attackers bring (the page does not know).
 */
export function tribeHelpText(village: Pick<VillageRefDto, 'name' | 'x' | 'y'>, attacks: KnownAttack[], now: number): string {
  const sorted = [...attacks].sort((a, b) => a.arriveAt - b.arriveAt);
  const first = sorted[0];
  const where = `${village.name} ${villageSpot(village)}`;
  if (!first) return `Help needed at ${where}. Please send support.`;
  const when = `${formatClock(first.arriveAt, now)} (in ${formatDuration(first.arriveAt - now)})`;
  const what = sorted.length === 1 ? `an attack lands ${when}` : `${sorted.length} attacks are on the way, the first lands ${when}`;
  return `Help needed at ${where}: ${what}. Please send support.`.slice(0, TRIBE_CHAT_MESSAGE_MAX);
}

/**
 * Another village of mine to use as the other end of a support (the sender) or of a shipment (the receiver): the nearest one to `target`,
 * preferring villages that are not under attack themselves. null when `villages` has no other village.
 */
export function pickOtherVillage(villages: readonly { id: number; x: number; y: number }[], target: { villageId: number; x: number; y: number }, attackedIds: ReadonlySet<number>): number | null {
  const others = villages.filter((v) => v.id !== target.villageId);
  if (others.length === 0) return null;
  const calm = others.filter((v) => !attackedIds.has(v.id));
  const pool = calm.length > 0 ? calm : others;
  const best = [...pool].sort((a, b) => distance(a, target) - distance(b, target) || a.id - b.id)[0];
  return best ? best.id : null;
}

/** Heading line of a village: how many attacks and when the first lands. */
export function groupLine(total: number, soonestAt: number, now: number): string {
  const left = soonestAt - now;
  const first = left > 0 ? `in ${formatDuration(left)}` : 'landing now';
  return `${total === 1 ? '1 attack' : `${total} attacks`} · ${total === 1 ? 'lands' : 'first lands'} ${formatClock(soonestAt, now)} (${first})`;
}
