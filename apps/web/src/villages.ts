// Several villages (docs/GAME_DESIGN.md 18.2, step 2): pure helpers for the village switcher, the hold clock of a cold
// village, which mission a map tile offers (Strike, Found, Occupy, Support) and the Chieftain's Renown price. No React, no art
// imports (unit-tested). The server decides everything; these only keep the screens honest.

import {
  CHIEFTAIN_MAX_BATCH,
  CHIEFTAIN_RENOWN_REFUND_SHARE,
  HEARTH_MAX_CHIEFTAINS,
  UNITS,
  UNIT_IDS,
  chieftainsNeeded,
  normalizeUnits,
  occupierPopulation,
  villageRenownPrice,
} from '@clanfire/engine';
import type { HearthInfoDto, MapVillageDto, Mission, RenownInfo, Units, VillageListItemDto, VillageReportData } from '@clanfire/engine';
import { formatInt, formatLeft } from './format.ts';
import { allowedMissions } from './rules.ts';

// ---- Hold clock -----------------------------------------------------------------------------------------

export interface HoldView {
  running: boolean;
  /** Time until the village changes owner (running) or what is left once the clock runs again (paused). */
  leftMs: number;
  /** Paused only: time until the claim fails. */
  failsInMs: number | null;
}

/** The hold clock at `now` (server-corrected). Counts down locally between server updates. */
export function holdView(h: HearthInfoDto, now: number): HoldView {
  if (h.running && h.endsAt !== null) return { running: true, leftMs: Math.max(0, h.endsAt - now), failsInMs: null };
  return { running: false, leftMs: Math.max(0, h.holdMsLeft), failsInMs: h.failsAt === null ? null : Math.max(0, h.failsAt - now) };
}

/** One plain sentence about the hold, for the tile panel and the village view. `mine`: I am the claimant. */
export function holdText(h: HearthInfoDto, now: number, mine = false): string {
  const v = holdView(h, now);
  const who = mine ? 'You hold' : `${h.claimBy} holds`;
  if (v.running) return `${who} this village. It changes hands in ${formatLeft(v.leftMs)} unless the hold is broken.`;
  const fails = v.failsInMs === null ? '' : ` The claim fails in ${formatLeft(v.failsInMs)} if it stays this weak.`;
  return `${who} this village, but the clock is paused: too few occupiers (${formatInt(h.minPopulation)} needed).${fails}`;
}

/** Occupiers standing there vs the minimum that keeps the clock running; null when the number is not known. */
export function occupierGap(h: HearthInfoDto, population: number | undefined): { have: number; need: number; enough: boolean } | null {
  if (population === undefined) return null;
  return { have: population, need: h.minPopulation, enough: population >= h.minPopulation };
}

/** Population of my occupiers standing in the village `villageId` (from the stationed list of my troops abroad). */
export function myOccupierPopulation(abroad: ReadonlyArray<{ host: { villageId: number }; units: Partial<Units> }>, villageId: number): number {
  let total = 0;
  for (const s of abroad) if (s.host.villageId === villageId) total += occupierPopulation(s.units);
  return total;
}

// ---- Switcher list --------------------------------------------------------------------------------------

/** Urgent first (incoming attack, soonest), then cold villages (soonest end of hold first), then the rest in founding order. */
export function orderVillages(list: readonly VillageListItemDto[]): VillageListItemDto[] {
  const rank = (v: VillageListItemDto): number => (v.incomingAttack ? 0 : v.hearth === 'out' ? 1 : 2);
  return [...list].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return (a.nextAttackAt ?? Infinity) - (b.nextAttackAt ?? Infinity) || a.id - b.id;
    if (ra === 1) return (a.holdEndsAt ?? Infinity) - (b.holdEndsAt ?? Infinity) || a.id - b.id;
    return a.id - b.id;
  });
}

export interface VillageBadge {
  kind: 'attack' | 'cold' | 'protected';
  text: string;
}

/** Badges for one switcher row. Colour is never the only signal: every badge has words. */
export function villageBadges(v: VillageListItemDto, now: number): VillageBadge[] {
  const out: VillageBadge[] = [];
  if (v.incomingAttack) out.push({ kind: 'attack', text: v.nextAttackAt !== null ? `Attack in ${formatLeft(v.nextAttackAt - now)}` : 'Under attack' });
  if (v.hearth === 'out') out.push({ kind: 'cold', text: v.holdEndsAt !== null ? `Hearth out, lost in ${formatLeft(v.holdEndsAt - now)}` : 'Hearth out' });
  if (v.protectedUntil !== null && v.protectedUntil > now) out.push({ kind: 'protected', text: `Protected ${formatLeft(v.protectedUntil - now)}` });
  return out;
}

/** Name and coordinates, for the bar and the list. */
export function villageLabel(v: { name: string; x: number; y: number }): string {
  return `${v.name} (${v.x}|${v.y})`;
}

/** Name rules of POST /api/villages/:id/rename: 1 to 30 characters of letters, digits, spaces and ' . _ -. Preview only. */
export function renameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 1) return 'Enter a name';
  if (name.length > 30) return 'At most 30 characters';
  if (!/^[\p{L}\p{N} '._-]+$/u.test(name)) return "Letters, digits, spaces and ' . _ - only";
  return null;
}

// ---- Chieftain ------------------------------------------------------------------------------------------

/** Renown the next Chieftain reserves: the server's number, or the engine rule when an older server did not send it. */
export function nextChieftainPrice(r: RenownInfo): number {
  return r.chieftainPrice ?? villageRenownPrice(r.villages, r.chieftains ?? 0);
}

/** Renown a batch of `count` Chieftains reserves (each one is priced as a village after those before it). */
export function chieftainBatchPrice(r: RenownInfo, count: number): number {
  const n = Math.max(0, Math.floor(count));
  let sum = 0;
  for (let i = 0; i < n; i++) sum += villageRenownPrice(r.villages, (r.chieftains ?? 0) + i);
  return sum;
}

/** Most Chieftains the Renown balance can reserve, at most `limit`. */
export function chieftainsAffordable(r: RenownInfo, limit = CHIEFTAIN_MAX_BATCH): number {
  let n = 0;
  while (n < limit && chieftainBatchPrice(r, n + 1) <= r.balance) n += 1;
  return n;
}

/** The rule in words, with the real numbers. */
export function chieftainRenownNote(): string {
  const pct = Math.round(CHIEFTAIN_RENOWN_REFUND_SHARE * 100);
  return `Renown is reserved when training starts. ${pct}% comes back if he dies; all of it if you cancel the batch. It is used up when he founds or takes a village.`;
}

// ---- Missions on the map --------------------------------------------------------------------------------

export interface MissionContext {
  playerId: number;
  /** The village I am sending from. */
  currentVillageId: number;
}

/**
 * Missions a map tile offers. null = a free tile (Found a village). Own other village: Support (troops stay) and
 * resources (separate form). A cold village I hold the claim on: Occupy and Scout (an attack on it is refused, you hold it).
 * Everything else follows `allowedMissions`.
 */
export function missionsFor(target: MapVillageDto | null, ctx: MissionContext): Mission[] {
  if (target === null) return ['found'];
  if (target.kind === 'own') return target.id === ctx.currentVillageId ? [] : ['support'];
  if (target.hearth && target.hearth.claimById === ctx.playerId) return ['occupy', 'scout'];
  return allowedMissions(target.kind, target.relation);
}

export type SendMode = 'attack' | 'strike' | 'scout' | 'support' | 'found' | 'occupy';

/** What the send dialog calls this send: an attack with Chieftains on an abandoned village is a Strike. */
export function sendMode(mission: Mission, chosen: Partial<Units>, targetKind: MapVillageDto['kind'] | null): SendMode {
  if (mission === 'attack' && normalizeUnits(chosen).chieftain > 0 && targetKind === 'abandoned') return 'strike';
  return mission;
}

export const SEND_MODE_BUTTON: Record<SendMode, string> = {
  attack: 'Send attack',
  strike: 'Strike',
  scout: 'Send scouts',
  support: 'Send support',
  found: 'Found a village here',
  occupy: 'Occupy',
};

export const SEND_MODE_SENT: Record<SendMode, string> = {
  attack: 'Attack sent to',
  strike: 'Strike sent to',
  scout: 'Scouts sent to',
  support: 'Support sent to',
  found: 'Chieftain sent to',
  occupy: 'Occupiers sent to',
};

export const SEND_MODE_HINT: Partial<Record<SendMode, string>> = {
  strike: `A Strike is an attack that tries to put the hearth out. No loot. If your army wins and at least one Chieftain lives, your survivors stay as occupiers and the hold clock starts. A Chieftain fights badly: bring an escort.`,
  found: 'One Chieftain carries an ember from your hearth to this free land. The Renown is already paid. Anything else you send is his escort and becomes the new village\'s garrison.',
  occupy: 'Reinforce the village you are holding. The hold clock only runs while your occupiers number enough.',
};

/** A reason the Strike cannot work as chosen, or null. Not blocking in the engine (a lone Chieftain just dies), but we say so. */
export function strikeWarning(chosen: Partial<Units>, abandoned = true, points = 0): string | null {
  const army = normalizeUnits(chosen);
  const need = chieftainsNeeded(abandoned, points);
  if (army.chieftain < need) return `This village needs ${need} Chieftain${need === 1 ? '' : 's'} to put the hearth out.`;
  if (army.chieftain > HEARTH_MAX_CHIEFTAINS) return `At most ${HEARTH_MAX_CHIEFTAINS} Chieftains can join an attack.`;
  let escort = 0;
  for (const u of UNIT_IDS) if (u !== 'chieftain') escort += army[u] * UNITS[u].attack;
  if (escort <= 0) return 'No escort: a Chieftain alone will die and the hearth stays lit.';
  return null;
}

/** Occupiers vs the minimum, for the Occupy form: warns when the new group is still too weak to keep the clock running. */
export function occupyWarning(chosen: Partial<Units>, alreadyThere: number, minPopulation: number): string | null {
  const total = alreadyThere + occupierPopulation(chosen);
  if (total >= minPopulation) return null;
  return `Together with the ${formatInt(alreadyThere)} already there that is ${formatInt(total)} of the ${formatInt(minPopulation)} needed to keep the clock running.`;
}

/** Units at home that make sense for this mode (scouts: Pathfinders only; support and occupy: no Chieftains). */
export function selectableUnits(mode: SendMode, atHome: Units): Array<(typeof UNIT_IDS)[number]> {
  const home = normalizeUnits(atHome);
  return UNIT_IDS.filter((u) => {
    if (home[u] <= 0) return false;
    if (mode === 'scout') return u === 'pathfinder';
    if (mode === 'support' || mode === 'occupy') return u !== 'chieftain';
    return true;
  });
}

/** Free-tile Found needs exactly one Chieftain; the rest is the escort. */
export function foundProblem(chosen: Partial<Units>): string | null {
  const n = normalizeUnits(chosen).chieftain;
  if (n < 1) return 'Choose one Chieftain';
  if (n > 1) return 'Only one Chieftain founds a village';
  return null;
}

// ---- Reports --------------------------------------------------------------------------------------------

const REASON_TEXT: Record<NonNullable<VillageReportData['reason']>, string> = {
  tile_taken: 'someone built there first',
  village_limit: 'you own as many villages as the world allows',
  time: 'the occupiers were too weak for too long',
  relit: 'the owner relit the hearth',
  replaced: 'another player took over the claim',
  no_room: 'there was no room for the troops',
  no_claim: 'you no longer held the claim',
};

export interface VillageReportText {
  title: string;
  lines: string[];
}

/** Short plain text for a village report (Strike, Hold, Found, Taken). `now` is only used for the hold time left. */
export function villageReportText(d: VillageReportData, now: number): VillageReportText {
  const name = d.village.name;
  const at = `(${d.village.x}|${d.village.y})`;
  const why = d.reason ? `, because ${REASON_TEXT[d.reason]}` : '';
  const hold = d.holdEndsAt != null ? `If the clock keeps running, ${d.holdEndsAt > now ? `it is yours in ${formatLeft(d.holdEndsAt - now)}` : 'it is yours now'}.` : 'The clock is paused until your occupiers are strong enough.';
  const home = d.units && UNIT_IDS.some((u) => (d.units?.[u] ?? 0) > 0) ? 'Your troops are on their way home.' : '';
  const overflow = d.overflow && UNIT_IDS.some((u) => (d.overflow?.[u] ?? 0) > 0) ? 'Troops that did not fit went home.' : '';
  switch (d.kind) {
    case 'struck':
      return { title: `Hearth put out at ${name}`, lines: [`Your Strike put out the hearth of ${name} ${at}. Your survivors stay as occupiers.`, hold] };
    case 'hearth_out':
      return {
        title: `Hearth out at ${name}`,
        lines: [`${d.claimBy ?? 'Someone'} put out the hearth of ${name} ${at}. Break the hold with troops before the clock runs out.`],
      };
    case 'taken':
      return { title: `${name} is yours`, lines: [`The hold ended: ${name} ${at} is now your village, buildings and all.`, overflow].filter(Boolean) };
    case 'lost':
      return { title: `${name} was lost`, lines: [`${name} ${at} changed owner. Troops of yours that were away are gone.`] };
    case 'founded':
      return { title: `New village ${name}`, lines: [`A new village stands at ${at}. It cannot be attacked for a while.`, overflow].filter(Boolean) };
    case 'found_failed':
      return { title: 'Founding failed', lines: [`Your Chieftain could not found a village at ${at}${why}. He is walking home.`] };
    case 'claim_failed':
      return { title: `Claim on ${name} failed`, lines: [`Your claim on ${name} ${at} ended without taking it${why}.`, home].filter(Boolean) };
    case 'relit':
      return { title: `Hearth relit at ${name}`, lines: [`The claim on ${name} ${at} ended and the hearth burns again.`] };
  }
}
