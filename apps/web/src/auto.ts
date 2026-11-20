// Auto mode page (views/AutoView.tsx): the plain-words text pieces, kept pure so tests can check them.
// The server decides everything (what is next, when); this only words it. Contract: AutoNextDto / AutoVillageDto in the engine api.ts.

import { AUTO_GOAL_MAX_TROOPS, BUILDINGS, BUILDING_IDS, UNITS } from '@clanfire/engine';
import type { AutoNextDto, AutoVillageDto, BuildingId, UnitId } from '@clanfire/engine';
import { formatLeft } from './format.ts';

export const AUTO_INTRO =
  'Set goals for each village: how many troops and which building levels you want. Auto mode works toward the goal that is furthest behind, spends the village\'s own income, and stops when every goal is reached.';
export const AUTO_NOT_ENTITLED = 'Auto mode is part of Premium. There is nothing to buy yet.';
/** Pause after the last change before it is sent. */
export const AUTO_SAVE_DELAY_MS = 700;
export const RESEARCH_NOTE = 'Needs research at the Drillyard';

/** "Pikemen", "Ember Guards": plain plural of a unit name (names ending in "man" take "men"). */
export function unitPlural(unit: UnitId, count = 2): string {
  const n = UNITS[unit].name;
  if (count === 1) return n;
  return n.endsWith('man') ? `${n.slice(0, -3)}men` : `${n}s`;
}

/** "Storehouse 10" or "10 Pikemen". */
export function nextWhat(next: AutoNextDto): string {
  if (next.kind === 'build') return `${BUILDINGS[next.building as BuildingId]?.name ?? 'Building'} ${next.level ?? ''}`.trim();
  const count = next.count ?? 0;
  return `${count} ${unitPlural(next.unit as UnitId, count)}`;
}

/** "about 40 min" until `readyAt` (server time); 'any moment' when it is due. '' when the server cannot tell. */
export function nextWait(next: AutoNextDto, now: number): string {
  if (next.readyAt === null || next.readyAt === undefined) return '';
  const left = next.readyAt - now;
  return left <= 1000 ? 'any moment' : `about ${formatLeft(left)}`;
}

/** The status line under the switch. The word "Off" is only on the switch itself. */
export function nextLine(v: Pick<AutoVillageDto, 'on' | 'status' | 'next'>, now: number): string {
  if (v.status === 'empty') return 'Add a goal to begin';
  if (!v.on) return v.status === 'reached' ? 'All goals reached' : 'Switch on to work toward your goals';
  if (v.status === 'reached') return 'All goals reached';
  const next = v.next;
  if (v.status === 'blocked' || !next) return 'Nothing to do yet: the open goals need research or a resource this village does not make';
  const what = nextWhat(next);
  const wait = nextWait(next, now);
  switch (next.waiting) {
    case 'now':
      return `Next: ${what} · now`;
    case 'resources':
      return `Next: ${what} · waiting for resources${wait ? `, ${wait}` : ''}`;
    case 'slot':
      return `Next: ${what} · waiting for the queue${wait ? `, ${wait}` : ''}`;
    case 'room':
      return `Next: ${what} · needs people room`;
    case 'requirement':
      return `Next: ${what} · waiting for a building it needs${wait ? `, ${wait}` : ''}`;
  }
}

/** "Queued by auto: 2 builds · 1 troop batch". */
export function queuedLine(v: Pick<AutoVillageDto, 'queuedBuilds' | 'queuedTroops'>): string {
  const b = v.queuedBuilds;
  const t = v.queuedTroops;
  if (b <= 0 && t <= 0) return 'Nothing queued by auto';
  const parts: string[] = [];
  if (b > 0) parts.push(`${b} build${b === 1 ? '' : 's'}`);
  if (t > 0) parts.push(`${t} troop batch${t === 1 ? '' : 'es'}`);
  return `Queued by auto: ${parts.join(' · ')}`;
}

/** Progress of a goal in whole percent, 0..100 (a goal of 0 counts as done). */
export function progressPct(have: number, goal: number): number {
  if (!(goal > 0)) return 100;
  return Math.max(0, Math.min(100, Math.floor((have / goal) * 100)));
}

/** "120 / 3,000" */
export function progressText(have: number, goal: number): string {
  return `${have.toLocaleString('en-US')} / ${goal.toLocaleString('en-US')}`;
}

/** Amount field text to a goal: empty or junk = 0, whole numbers only, 0..AUTO_GOAL_MAX_TROOPS. */
export function parseTroopGoal(text: string): number {
  const n = Math.floor(Number(text.replace(/[^0-9]/g, '')));
  return Number.isFinite(n) ? Math.max(0, Math.min(AUTO_GOAL_MAX_TROOPS, n)) : 0;
}

/** A level stepped by `delta`, kept inside 1..the building's max (0 removes the goal elsewhere). */
export function stepLevel(building: BuildingId, level: number, delta: number): number {
  return Math.max(1, Math.min(BUILDINGS[building].maxLevel, level + delta));
}

/** Buildings that have no goal yet, in the game's order: the "Add building goal" choices. */
export function addableBuildings(goals: Partial<Record<BuildingId, number>>): BuildingId[] {
  return BUILDING_IDS.filter((b) => !(goals[b] && goals[b]! > 0));
}

/** The level a new building goal starts at: one above what the village has (counting queued levels), at most the max. */
export function startGoalLevel(building: BuildingId, current: number): number {
  return Math.max(1, Math.min(BUILDINGS[building].maxLevel, current + 1));
}

/** Amounts / levels of 0 dropped, so the saved goals only hold real ones. */
export function cleanGoals<K extends string>(goals: Partial<Record<K, number>>): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const k of Object.keys(goals) as K[]) if ((goals[k] ?? 0) > 0) out[k] = goals[k]!;
  return out;
}

export function goalCount(v: Pick<AutoVillageDto, 'troopGoals' | 'buildingGoals'>): number {
  return Object.keys(cleanGoals(v.troopGoals)).length + Object.keys(cleanGoals(v.buildingGoals)).length;
}

/** The page's tab: only while the world has the premium tools (`features.premium`). */
export function autoTabOn(config: { features?: { premium?: boolean } } | undefined | null): boolean {
  return config?.features?.premium === true;
}

/** Not entitled (or saving): every control of a card is off. */
export function controlsOff(locked: boolean, saving: boolean): boolean {
  return locked || saving;
}
