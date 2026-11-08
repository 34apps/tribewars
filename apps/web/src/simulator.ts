// Battle simulator (client only): runs the REAL engine battle (`resolveBattle`) on numbers the player types, at three fixed luck
// values. Nothing here talks to the server and nothing changes a village. Pure helpers, no React.

import {
  BATTLE_LUCK,
  BUILDINGS,
  RANK_MAX,
  UNITS,
  UNIT_IDS,
  createPlayerVillage,
  emptyUnits,
  normalizeUnits,
  MORALE_ATTACK_FACTOR,
  resolveBattle,
} from '@clanfire/engine';
import type { BattleInput, BattleResult, BuildingId, ReportDto, UnitId, Units, VillageRanks, WorldSettings } from '@clanfire/engine';

/** The three columns of the result: bad luck, even, good luck (for the attacker). */
export const SIM_LUCKS = [
  { id: 'bad', label: 'Bad luck', luck: -BATTLE_LUCK },
  { id: 'even', label: 'Even', luck: 0 },
  { id: 'good', label: 'Good luck', luck: BATTLE_LUCK },
] as const;

/** "-10%" / "+10%" / "0%" for a luck value. */
export function luckText(luck: number): string {
  const pct = Math.round(luck * 1000) / 10;
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%`;
}

/** Most of one unit a field accepts. */
export const SIM_COUNT_MAX = 1_000_000;

/** Text of a count field to a whole number 0..SIM_COUNT_MAX (blank, negative or broken text is 0; decimals are cut). */
export function parseCount(text: string | undefined): number {
  if (text === undefined || text.trim() === '') return 0;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(SIM_COUNT_MAX, Math.floor(n));
}

/** Text fields of a unit list to a Units record. */
export function unitsFromText(text: Partial<Record<UnitId, string>>): Units {
  const out = emptyUnits();
  for (const u of UNIT_IDS) out[u] = parseCount(text[u]);
  return out;
}

/** Units to text fields (zero counts left empty). */
export function textFromUnits(units: Partial<Units>): Partial<Record<UnitId, string>> {
  const out: Partial<Record<UnitId, string>> = {};
  for (const u of UNIT_IDS) {
    const n = parseCount(String(units[u] ?? ''));
    if (n > 0) out[u] = String(n);
  }
  return out;
}

export const hasTroops = (units: Partial<Units>): boolean => UNIT_IDS.some((u) => (units[u] ?? 0) > 0);

/** Every unit at rank `rank` on both defence tracks of Bulwark (the simulator's one "Bulwark rank" choice). */
export function uniformBulwark(rank: number): VillageRanks | undefined {
  const r = Math.max(0, Math.min(RANK_MAX, Math.floor(Number.isFinite(rank) ? rank : 0)));
  if (r === 0) return undefined;
  const out: VillageRanks = {};
  for (const u of UNIT_IDS) out[u] = { might: 0, bulwark: r, keen: 0 };
  return out;
}

export const WALL_MAX = BUILDINGS.wall.maxLevel;

/** Whole number 0..max from a text field (blank = 0). */
export function parseLevel(text: string | undefined, max: number): number {
  return Math.min(max, parseCount(text));
}

export interface SimSetup {
  attacker: Units;
  defender: Units;
  /** Support contingent stationed in the defending village (one list: the simulator treats it as one contingent). */
  support: Units;
  wall: number;
  /** The attacking village's ranks (Might); undefined = none. */
  attackerRanks?: VillageRanks;
  /** Bulwark rank 0..RANK_MAX for the village's own troops / for the support. */
  defenderBulwark: number;
  supportBulwark: number;
  /** The building the Boulder Slings were told to hit; null = random (needs levels the simulator does not know, so nothing is hit). */
  siegeTarget: BuildingId | null;
  /** Level of the picked building (not the Wall). */
  targetLevel: number;
  /** Morale: the attacker fights at 75% (the player ticked it). */
  morale?: boolean;
}

/** What one luck setting gives: the engine result plus the numbers the page shows. */
export interface SimOutcome {
  luck: number;
  result: BattleResult;
  wallBefore: number;
  /** Wall after the rams (during and after the battle). */
  wallAfter: number;
  /** What the attacker's survivors can carry. */
  carry: number;
  /** Units that took part, per side (attacker: sent; defender: own troops; support). */
  attackerSurvivors: Units;
  defenderSurvivors: Units;
  supportSurvivors: Units;
}

const SEED = 1;

/** The engine input for a setup at a given luck. The defender is a fresh village with only the typed troops, Wall and target level. */
export function battleInput(setup: SimSetup, luck: number): BattleInput {
  const village = createPlayerVillage(0);
  village.buildings.wall = Math.max(0, Math.min(WALL_MAX, Math.floor(setup.wall)));
  const target = setup.siegeTarget;
  if (target && target !== 'wall') village.buildings[target] = Math.max(0, Math.min(BUILDINGS[target].maxLevel, Math.floor(setup.targetLevel)));
  village.troops = normalizeUnits(setup.defender);
  const support = normalizeUnits(setup.support);
  const hasSupport = hasTroops(support);
  const input: BattleInput = {
    attackerUnits: normalizeUnits(setup.attacker),
    defender: village,
    seed: SEED,
    fixedLuck: luck,
    noLoot: true,
    siegeTarget: setup.siegeTarget,
  };
  if (setup.morale) input.moraleFactor = MORALE_ATTACK_FACTOR;
  if (setup.attackerRanks) input.attackerRanks = setup.attackerRanks;
  const defenderRanks = uniformBulwark(setup.defenderBulwark);
  if (defenderRanks) input.defenderRanks = defenderRanks;
  if (hasSupport) {
    input.support = [support];
    const supportRanks = uniformBulwark(setup.supportBulwark);
    if (supportRanks) input.supportRanks = [supportRanks];
  }
  return input;
}

/** Run the real battle at one luck value. `s` = the world's settings (siege on/off); without it siege is on. */
export function simulate(setup: SimSetup, luck: number, s?: Pick<WorldSettings, 'config'>): SimOutcome {
  const input = battleInput(setup, luck);
  const result = resolveBattle(input, s);
  const wallBefore = input.defender.buildings.wall;
  let wallAfter = result.wallDuring;
  for (const h of result.siege ?? []) if (h.building === 'wall') wallAfter = h.to;
  let carry = 0;
  for (const u of UNIT_IDS) carry += result.attackerSurvivors[u] * UNITS[u].carry;
  const defenderSurvivors = emptyUnits();
  const supportSurvivors = emptyUnits();
  const supportLost = result.supportLosses[0] ?? emptyUnits();
  const support = input.support?.[0] ?? emptyUnits();
  for (const u of UNIT_IDS) {
    defenderSurvivors[u] = Math.max(0, result.defenderUnits[u] - result.defenderLosses[u]);
    supportSurvivors[u] = Math.max(0, support[u] - supportLost[u]);
  }
  return { luck: result.luck, result, wallBefore, wallAfter, carry, attackerSurvivors: result.attackerSurvivors, defenderSurvivors, supportSurvivors };
}

/** Bad luck, even and good luck in that order. */
export function simulateAll(setup: SimSetup, s?: Pick<WorldSettings, 'config'>): SimOutcome[] {
  return SIM_LUCKS.map((l) => simulate(setup, l.luck, s));
}

// ---- Pre-filling from other screens ---------------------------------------------------------------------

/** What another screen hands to the simulator page; anything missing stays as it is (empty on a new visit). */
export interface SimDraftData {
  attacker?: Partial<Units>;
  defender?: Partial<Units>;
  support?: Partial<Units>;
  /** Defender's Wall level. */
  wall?: number;
  /** Tick the Morale box. */
  morale?: boolean;
}

/** The send form's chosen troops, nothing else (the defender is unknown there). */
export function draftFromSend(chosen: Partial<Units>, morale = false): SimDraftData {
  return { attacker: { ...chosen }, ...(morale ? { morale: true } : {}) };
}

/**
 * Report to a draft: only what the report shows. A battle report gives the defender's troops (when not hidden), the support that
 * fought and the Wall; my army is filled in only when I was the attacker (`side` 'attack'). A scout report gives the troops and Wall
 * of a successful scouting (rounded counts stay rounded). Null for reports with nothing to try.
 */
export function draftFromReport(report: ReportDto): SimDraftData | null {
  const b = report.battle;
  if (report.type === 'battle' && b && b.outcome === 'battle') {
    const draft: SimDraftData = {};
    if (report.side === 'attack') draft.attacker = { ...normalizeUnits(b.attackerUnits) };
    if (b.defenderUnits) draft.defender = { ...normalizeUnits(b.defenderUnits) };
    if (b.supportUnits) draft.support = { ...normalizeUnits(b.supportUnits) };
    if (typeof b.morale === 'number' && b.morale < 1) draft.morale = true;
    // The Wall before the Log Rams fired, when the report says so; otherwise the Wall as it counted.
    const wallHit = (b.siege ?? []).find((h) => h.building === 'wall');
    if (wallHit) draft.wall = wallHit.from;
    else if (typeof b.wallLevel === 'number') draft.wall = b.wallLevel;
    return draft;
  }
  const s = report.scout;
  if (report.type === 'scout' && s && s.success && s.intel) {
    const draft: SimDraftData = {};
    if (s.intel.troops) draft.defender = { ...normalizeUnits(s.intel.troops) };
    if (typeof s.intel.wallLevel === 'number') draft.wall = s.intel.wallLevel;
    return draft.defender || draft.wall !== undefined ? draft : null;
  }
  return null;
}

/** A report page shows "Try in simulator" when it can fill something in. */
export const canTryInSimulator = (report: ReportDto): boolean => draftFromReport(report) !== null;
