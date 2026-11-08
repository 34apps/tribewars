// Several villages (docs/GAME_DESIGN.md 18.2, step 2): pure helpers for the village switcher, the hold clock of a cold
// village, which mission a map tile offers (Strike, Found, Occupy, Support) and the Chieftain's Renown price. No React, no art
// imports (unit-tested). The server decides everything; these only keep the screens honest.

import {
  BUILDINGS,
  BUILDING_IDS,
  CHIEFTAIN_MAX_BATCH,
  CHIEFTAIN_RENOWN_REFUND_SHARE,
  HEARTH_MAX_CHIEFTAINS,
  NPC_TIER_WEIGHTS,
  UNITS,
  UNIT_IDS,
  chieftainsNeeded,
  createNpcVillage,
  hasChosenSiege,
  moraleFactor,
  normalizeUnits,
  occupierPopulation,
  totalUnits,
  villagePoints,
  villageRenownPrice,
  worldRules,
} from '@clanfire/engine';
import type {
  BuildingId,
  HearthInfoDto,
  MapVillageDto,
  Mission,
  RenownInfo,
  SiegeHit,
  UnitId,
  Units,
  VillageListItemDto,
  VillageReportData,
  WorldSettings,
} from '@clanfire/engine';
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

/** One short line about the hold, for the tile panel and the village view. `mine`: I am the claimant. */
export function holdText(h: HearthInfoDto, now: number, mine = false): string {
  const v = holdView(h, now);
  const who = mine ? 'You hold' : `${h.claimBy} holds`;
  if (v.running) return `${who} this village · ${formatLeft(v.leftMs)} left`;
  const fails = v.failsInMs === null ? '' : ` · fails in ${formatLeft(v.failsInMs)}`;
  return `${who} this village · paused, needs ${formatInt(h.minPopulation)} occupiers${fails}`;
}

/** Occupiers standing there vs the minimum that keeps the clock running; null when the number is not known. */
export function occupierGap(h: HearthInfoDto, population: number | undefined): { have: number; need: number; enough: boolean } | null {
  if (population === undefined) return null;
  return { have: population, need: h.minPopulation, enough: population >= h.minPopulation };
}

/** Tribe alerts: held villages first by the soonest change of owner (paused clocks last, by time left once they run). */
export function sortHolds<T extends { hearth: HearthInfoDto }>(holds: readonly T[]): T[] {
  const key = (h: HearthInfoDto): number => (h.running && h.endsAt !== null ? h.endsAt : Number.MAX_SAFE_INTEGER);
  return [...holds].sort((a, b) => key(a.hearth) - key(b.hearth) || a.hearth.holdMsLeft - b.hearth.holdMsLeft);
}

/** The badge on the Alerts section: attacks on their way plus held villages. */
export function alertCount(alerts: readonly unknown[] | null, holds: readonly unknown[]): number {
  return (alerts?.length ?? 0) + holds.length;
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
export function nextChieftainPrice(r: RenownInfo, s?: Pick<WorldSettings, 'config'>): number {
  return r.chieftainPrice ?? villageRenownPrice(r.villages, r.chieftains ?? 0, s);
}

/** Renown a batch of `count` Chieftains reserves (each one is priced as a village after those before it). `s`: this world's rules. */
export function chieftainBatchPrice(r: RenownInfo, count: number, s?: Pick<WorldSettings, 'config'>): number {
  const n = Math.max(0, Math.floor(count));
  let sum = 0;
  for (let i = 0; i < n; i++) sum += villageRenownPrice(r.villages, (r.chieftains ?? 0) + i, s);
  return sum;
}

/** Most Chieftains the Renown balance can reserve, at most `limit`. */
export function chieftainsAffordable(r: RenownInfo, limit = CHIEFTAIN_MAX_BATCH, s?: Pick<WorldSettings, 'config'>): number {
  let n = 0;
  while (n < limit && chieftainBatchPrice(r, n + 1, s) <= r.balance) n += 1;
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
 * resources (separate form). A cold village I hold the claim on: Occupy only (an attack on it is refused, you hold it).
 * Everything else follows `allowedMissions`.
 */
export function missionsFor(target: MapVillageDto | null, ctx: MissionContext): Mission[] {
  if (target === null) return ['found'];
  const relief = isReliefTarget(target, ctx);
  if (target.kind === 'own') return target.id === ctx.currentVillageId ? [] : relief ? ['support', 'attack'] : ['support'];
  if (target.hearth && target.hearth.claimById === ctx.playerId) return ['occupy'];
  const base = allowedMissions(target.kind, target.relation);
  // A relief attack goes next to Support on a cold tribe-mate's or ally's village (the attack mission there fights only the occupiers).
  return relief && !base.includes('attack') ? [...base, 'attack'] : base;
}

/**
 * A cold village (hearth out) I can fight for: another village of mine, or a tribe-mate's or ally's village, as long as I am
 * not the one holding it. The 'attack' mission there is a relief attack (the server refuses loot, Wall, Chieftains and siege;
 * it also refuses senders tied to the claimant, which only it can tell).
 */
export function isReliefTarget(target: MapVillageDto | null, ctx: MissionContext): boolean {
  const h = target?.hearth;
  if (!target || !h || h.claimById === ctx.playerId) return false;
  if (target.kind === 'own') return target.id !== ctx.currentVillageId;
  return target.kind === 'player' && (target.relation === 'tribe' || target.relation === 'ally');
}

// ---- Troop columns of the wide send form (Command post) --------------------------------------------------

export type UnitColumn = 'foot' | 'riders' | 'siege' | 'special';

export const UNIT_COLUMN_NAME: Record<UnitColumn, string> = { foot: 'Foot', riders: 'Riders', siege: 'Siege', special: 'Special' };

/** Which column a unit sits in: Chieftain and Pathfinder are Special, siege units Siege, the rest by their class. */
export function unitColumn(u: UnitId): UnitColumn {
  if (u === 'chieftain' || u === 'pathfinder') return 'special';
  if (UNITS[u].siege) return 'siege';
  return UNITS[u].unitClass === 'cavalry' ? 'riders' : 'foot';
}

/** The given units grouped into the columns Foot / Riders / Siege / Special (in that order, empty columns left out). */
export function unitColumns(units: readonly UnitId[]): Array<{ column: UnitColumn; units: UnitId[] }> {
  const order: UnitColumn[] = ['foot', 'riders', 'siege', 'special'];
  return order.map((column) => ({ column, units: units.filter((u) => unitColumn(u) === column) })).filter((c) => c.units.length > 0);
}

export type SendMode = 'attack' | 'strike' | 'scout' | 'support' | 'found' | 'occupy' | 'relieve';

/** Label of the relief attack in the mission switch and the dialog title (the confirm button says Relieve). */
export const RELIEF_LABEL = 'Win it back';

/** Villages a Strike can be aimed at: abandoned ones and other players' villages (never tribe-mates or allies: no attack mission there). */
export function canStrike(targetKind: MapVillageDto['kind'] | null): boolean {
  return targetKind === 'abandoned' || targetKind === 'player';
}

function isScoutOnly(army: Units): boolean {
  return army.pathfinder > 0 && UNIT_IDS.every((u) => u === 'pathfinder' || army[u] === 0);
}

/** What the send dialog calls this send: an attack with Chieftains on an abandoned or a player's village is a Strike. */
export function sendMode(mission: Mission, chosen: Partial<Units>, targetKind: MapVillageDto['kind'] | null, relief = false): SendMode {
  if (mission === 'attack' && relief) return 'relieve';
  if (mission === 'attack' && normalizeUnits(chosen).chieftain > 0 && canStrike(targetKind)) return 'strike';
  // An attack of Pathfinders only is a scouting march (the server decides; this only picks the button and the toast).
  if (mission === 'attack' && isScoutOnly(normalizeUnits(chosen))) return 'scout';
  return mission;
}

/** Chieftains a Strike on this village needs (abandoned: one; a player's village: more as it grows). */
export function strikeNeed(targetKind: MapVillageDto['kind'] | null, points: number): number {
  return chieftainsNeeded(targetKind !== 'player', points);
}

export const SEND_MODE_BUTTON: Record<SendMode, string> = {
  attack: 'Send attack',
  strike: 'Strike',
  scout: 'Send scouts',
  support: 'Send support',
  found: 'Found a village here',
  occupy: 'Occupy',
  relieve: 'Relieve',
};

export const SEND_MODE_SENT: Record<SendMode, string> = {
  attack: 'Attack sent to',
  strike: 'Strike sent to',
  scout: 'Scouts sent to',
  support: 'Support sent to',
  found: 'Chieftain sent to',
  occupy: 'Occupiers sent to',
  relieve: 'Relief sent to',
};

export const SEND_MODE_HINT: Partial<Record<SendMode, string>> = {
  strike: 'Puts the hearth out. No loot. Survivors stay as occupiers. Bring an escort.',
  found: 'One Chieftain carries an ember from your hearth to this free land. Anything else you send is his escort and becomes the new village\'s garrison.',
  occupy: 'Reinforce the village you are holding. The hold clock only runs while your occupiers number enough.',
  relieve: 'Fights only the occupiers holding this village. No loot. If they all fall the hearth relights.',
};

/** The Strike hint for the send dialog; a player's village adds the hold length, who is safe and the escort advice. */
export function strikeHint(targetKind: MapVillageDto['kind'] | null, s?: Pick<WorldSettings, 'speed' | 'config'>): string {
  const rules = worldRules(s).conquest;
  const speed = s?.speed ?? 1;
  const chain = `Chieftains must land within ${hoursText(rules.chainWindowHours / speed)}.`;
  if (targetKind !== 'player') return `${hoursText(rules.holdHoursAbandoned / speed, true)} hold. ${chain}`;
  if (!rules.playersCanBeConquered) return `Only abandoned villages can be taken. ${chain}`;
  return `${hoursText(rules.holdHours / speed, true)} hold. ${chain} Allies are safe.`;
}

/** Real hours as plain words: "8 hours", "1 hour", "45 minutes"; `adjective` gives "8-hour", "45-minute". Rounded to the minute. */
export function hoursText(hours: number, adjective = false): string {
  if (!Number.isFinite(hours) || hours < 0) return adjective ? '0-hour' : '0 hours';
  const minutes = Math.round(hours * 60);
  const [n, unit] = hours < 1 && minutes >= 1 ? [minutes, 'minute'] : [Math.round(hours * 100) / 100, 'hour'];
  return adjective ? `${n}-${unit}` : `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** A reason the Strike cannot work as chosen, or null. Not blocking in the engine (a lone Chieftain just dies), but we say so. */
export function strikeWarning(chosen: Partial<Units>, abandoned = true, points = 0): string | null {
  const army = normalizeUnits(chosen);
  const need = chieftainsNeeded(abandoned, points);
  if (army.chieftain < need) return `This village needs ${need} Chieftain${need === 1 ? '' : 's'} to put the hearth out.`;
  if (army.chieftain > HEARTH_MAX_CHIEFTAINS) return `At most ${HEARTH_MAX_CHIEFTAINS} Chieftains can join an attack.`;
  let escort = 0;
  for (const u of UNIT_IDS) if (u !== 'chieftain') escort += army[u] * UNITS[u].attack;
  if (escort <= 0) return 'No escort: a Chieftain alone will die and the hearth stays lit.';
  if (!abandoned) return 'A player defends this village: a weak escort loses the fight and the Chieftains die with it.';
  return null;
}

/** Occupiers vs the minimum, for the Occupy form: warns when the new group is still too weak to keep the clock running. */
export function occupyWarning(chosen: Partial<Units>, alreadyThere: number, minPopulation: number): string | null {
  const total = alreadyThere + occupierPopulation(chosen);
  if (total >= minPopulation) return null;
  return `Together with the ${formatInt(alreadyThere)} already there that is ${formatInt(total)} of the ${formatInt(minPopulation)} needed to keep the clock running.`;
}

/**
 * Units at home that make sense for this mode (scouts: Pathfinders only; support and occupy: no Chieftains). Siege units
 * (Log Ram, Boulder Sling) only join an attack, as in checkMission.
 */
export function selectableUnits(mode: SendMode, atHome: Units, siegeOn = true): Array<(typeof UNIT_IDS)[number]> {
  const home = normalizeUnits(atHome);
  const attacks = mode === 'attack' || mode === 'strike';
  // Siege units stay in the list at 0 (so the player sees they exist) once there is any other army to send with them.
  const anyOther = UNIT_IDS.some((u) => !UNITS[u].siege && home[u] > 0);
  return UNIT_IDS.filter((u) => {
    // A world without siege (features.siege off) never shows the units, even if some were trained earlier.
    if (UNITS[u].siege && !siegeOn) return false;
    // A relief attack fights the occupiers only: no Chieftains, no siege units (the server refuses them).
    if (mode === 'relieve') return home[u] > 0 && u !== 'chieftain' && !UNITS[u].siege;
    if (UNITS[u].siege && attacks && anyOther) return true;
    if (home[u] <= 0) return false;
    if (UNITS[u].siege && !attacks) return false;
    if (mode === 'scout') return u === 'pathfinder';
    if (mode === 'support' || mode === 'occupy') return u !== 'chieftain';
    return true;
  });
}

// ---- Siege (docs/GAME_DESIGN.md 18.9) -------------------------------------------------------------------

/** The building picker shows only on an attack that carries Boulder Slings (the units that take a chosen building). */
export function showsSiegePicker(mission: Mission, chosen: Partial<Units>, siegeOn = true): boolean {
  return siegeOn && mission === 'attack' && hasChosenSiege(chosen);
}

/** Buildings a Boulder Sling can be told to hit. Names only: levels are known from a scouting report, never here. */
export function siegeTargetOptions(): Array<{ id: BuildingId; name: string }> {
  return BUILDING_IDS.map((id) => ({ id, name: BUILDINGS[id].name }));
}

/** Level shown next to a building name in the picker: "Wall 7 · scouted 3h ago", or just the name without a scout report. */
export function siegeOptionLabel(name: string, level: number | undefined, ageText: string | null): string {
  return level === undefined || ageText === null ? name : `${name} ${level} · scouted ${ageText}`;
}

/** Chain progress line for a village tile: "Chieftain chain: 1 of 2 (counts for 8m 20s more)". Null when nothing is banked. */
export function chainText(chain: MapVillageDto['chain'], now: number): string | null {
  if (!chain || chain.have < 1) return null;
  const left = chain.endsAt - now;
  if (left <= 0) return null;
  return `${chain.have} of ${chain.need} Chieftains (counts ${formatLeft(left)} more)`;
}

export type StrengthBand = 'weak' | 'medium' | 'strong';
/** Display thresholds only (not balance): units a founding garrison can have at most, by band. */
const WEAK_UP_TO_TROOPS = 12;
const MEDIUM_UP_TO_TROOPS = 24;

let tierStarts: Array<{ points: number; troops: number }> | null = null;
/** Points and garrison an abandoned village has the day it is created, per tier (from the engine's own generator). */
function npcTierStarts(): Array<{ points: number; troops: number }> {
  if (!tierStarts) {
    tierStarts = NPC_TIER_WEIGHTS.map((_, i) => {
      const v = createNpcVillage(i + 1, 0);
      return { points: villagePoints(v), troops: totalUnits(v.troops) };
    });
  }
  return tierStarts;
}

/**
 * Rough strength of an abandoned village from what the map shows (its points). It was created with a tier whose starting points are
 * a floor for its points (buildings only grow), and its garrison never refills (GAME_DESIGN 8), so it cannot hold more troops than the
 * start garrison of the highest tier its points allow. Raids may have thinned it, so this is an upper bound, not a count.
 */
export function abandonedStrength(points: number): { band: StrengthBand; maxTroops: number } {
  const p = Number.isFinite(points) ? points : 0;
  let maxTroops = 0;
  for (const t of npcTierStarts()) if (t.points <= p || maxTroops === 0) maxTroops = t.troops;
  return { band: maxTroops <= WEAK_UP_TO_TROOPS ? 'weak' : maxTroops <= MEDIUM_UP_TO_TROOPS ? 'medium' : 'strong', maxTroops };
}

/** The `targetBuilding` to send: only with the picker showing and a real building picked ('' = random = leave it out). */
export function siegeTargetFor(mission: Mission, chosen: Partial<Units>, picked: string): BuildingId | undefined {
  if (!showsSiegePicker(mission, chosen)) return undefined;
  return (BUILDING_IDS as readonly string[]).includes(picked) ? (picked as BuildingId) : undefined;
}

/** One report line per siege hit: "Log Ram: Wall 8 -> 6", "Boulder Sling: Market 4 -> 3 (random)", or why nothing happened. */
export function siegeHitText(h: SiegeHit): string {
  const unit = UNITS[h.unit]?.name ?? h.unit;
  const building = BUILDINGS[h.building]?.name ?? h.building;
  if (h.from === h.to) return `${unit} found nothing to hit at ${building}${h.random ? ' (random)' : ''}.`;
  return `${unit}: ${building} ${h.from} → ${h.to}${h.random ? ' (random)' : ''}`;
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
  tile_taken: 'tile taken',
  village_limit: 'village limit reached',
  time: 'occupiers too weak',
  relit: 'owner relit the hearth',
  replaced: 'claim replaced',
  no_room: 'no room for troops',
  no_claim: 'claim lost',
};

/** Shown instead of a build or train button while the hearth of the current village is out. */
export const HEARTH_OUT_REASON = 'The hearth is out';

/** Shown instead of a build button while the hearth is out; only the Wall can still be built (owner 2026-11-05). */
export const HEARTH_OUT_BUILD_REASON = 'The hearth is out: only the Wall can be built';

/** Why a building cannot be started because the hearth of this village is out, or null (lit hearth, or the Wall). */
export function hearthBuildReason(hearthOut: boolean, id: BuildingId): string | null {
  return hearthOut && id !== 'wall' ? HEARTH_OUT_BUILD_REASON : null;
}

export interface VillageReportText {
  title: string;
  lines: string[];
}

/** Short plain text for a village report (Strike, Hold, Found, Taken). `now` is only used for the hold time left. */
export function villageReportText(d: VillageReportData, now: number): VillageReportText {
  const name = d.village.name;
  const at = `(${d.village.x}|${d.village.y})`;
  const why = d.reason ? ` (${REASON_TEXT[d.reason]})` : '';
  const hold = d.holdEndsAt != null ? `${d.holdEndsAt > now ? `Yours in ${formatLeft(d.holdEndsAt - now)}` : 'Yours now'}.` : 'Clock paused: too few occupiers.';
  const home = d.units && UNIT_IDS.some((u) => (d.units?.[u] ?? 0) > 0) ? 'Troops heading home.' : '';
  const overflow = d.overflow && UNIT_IDS.some((u) => (d.overflow?.[u] ?? 0) > 0) ? 'Extra troops went home.' : '';
  switch (d.kind) {
    case 'struck':
      return { title: `Hearth put out at ${name}`, lines: [`Hearth of ${name} ${at} put out. Survivors hold it.`, hold] };
    case 'hearth_out':
      return {
        title: `Hearth out at ${name}`,
        lines: [`${d.claimBy ?? 'Someone'} put out the hearth of ${name} ${at}. Break the hold.`],
      };
    case 'taken':
      return { title: `${name} is yours`, lines: [`${name} ${at} is now yours.`, overflow].filter(Boolean) };
    case 'lost':
      return { title: `${name} was lost`, lines: [`${name} ${at} changed owner. Troops away are lost.`] };
    case 'founded':
      return { title: `New village ${name}`, lines: [`New village at ${at}. Protected for a while.`, overflow].filter(Boolean) };
    case 'found_failed':
      return { title: 'Founding failed', lines: [`Founding at ${at} failed${why}. Chieftain heading home.`] };
    case 'claim_failed':
      return { title: `Claim on ${name} failed`, lines: [`Claim on ${name} ${at} failed${why}.`, home].filter(Boolean) };
    case 'relit':
      return { title: `Hearth relit at ${name}`, lines: [`Claim on ${name} ${at} ended. Hearth relit.`] };
  }
}

// ---- Map side panel helpers ------------------------------------------------------------------------------

/** The troop picker of the map panel lists only units that are at home (count > 0); a siege row at 0 is not offered there. */
export function homeUnits(visible: readonly UnitId[], home: Partial<Units>): UnitId[] {
  return visible.filter((u) => (home[u] ?? 0) > 0);
}

/** "Send resources" (header button of the map panel): another player's or abandoned village, or another village of mine. */
export function canShipTo(village: Pick<MapVillageDto, 'kind'> | undefined, isOwn: boolean, isCurrent: boolean): boolean {
  if (!village) return false;
  if (village.kind === 'own') return !isCurrent;
  return !isOwn && (village.kind === 'player' || village.kind === 'abandoned');
}

/** What the send form holds after "Clear": no counts, random siege target, no note. */
export function clearedSendForm(): { counts: Partial<Record<UnitId, string>>; siegePick: string; groupNote: null } {
  return { counts: {}, siegePick: '', groupNote: null };
}

// ---- Morale ---------------------------------------------------------------------------------------------

/** My total points: the sum of my villages' points, like the rankings (computed from the settled states the client already has). */
export function ownTotalPoints(villages: ReadonlyArray<{ state: Parameters<typeof villagePoints>[0] }>): number {
  return villages.reduce((n, v) => n + villagePoints(v.state), 0);
}

/**
 * Morale a send would meet if it arrived now: 0.75 or 1. Only an attack on a village owned by ANOTHER player (the map row carries
 * the owner's public points); never an abandoned village, a relief attack, a scouting-only army or support. The server decides at arrival.
 */
export function moraleNow(opts: {
  mission: Mission;
  relief: boolean;
  target: Pick<MapVillageDto, 'kind' | 'ownerPoints'> | null;
  chosen: Partial<Units>;
  ownPoints: number;
  enabled: boolean;
}): number {
  const { mission, relief, target, chosen, ownPoints, enabled } = opts;
  if (mission !== 'attack' || relief || !target || target.kind !== 'player' || typeof target.ownerPoints !== 'number') return 1;
  const fighters = totalUnits(normalizeUnits(chosen)) - (chosen.pathfinder ?? 0);
  if (fighters <= 0) return 1;
  return moraleFactor(ownPoints, target.ownerPoints, enabled);
}

/** Help behind the "?" next to the Morale line. */
export const MORALE_HELP = 'Attacking a player with under a third of your points: your army fights at 75% attack strength. Never against abandoned villages or sites.';

/** "Morale 75%" for a factor below 1, else null. */
export const moraleLabel = (factor: number | null | undefined): string | null => (typeof factor === 'number' && factor < 1 ? `Morale ${Math.round(factor * 100)}%` : null);
