// Auto mode page (views/AutoView.tsx): the plain-words text pieces, kept pure so tests can check them.
// The server decides everything (what is next, when); this only words it. Contract: AutoNextDto / AutoVillageDto in the engine api.ts.

import { AUTO_SHARE_STEP, BUILDINGS, UNITS } from '@clanfire/engine';
import type { AutoNextDto, AutoVillageDto, BuildingId, UnitId } from '@clanfire/engine';
import { formatLeft } from './format.ts';
import { requirementText, unmetRequirements } from './rules.ts';

export const AUTO_INTRO =
  'Your villages build and recruit by themselves. Each one spends its own income: the balance says how much goes to buildings and how much to troops. It waits until it can pay, and never skips.';
export const AUTO_NOT_ENTITLED = 'Auto mode is part of Premium. There is nothing to buy yet.';
/** Pause after the last slider move before it is sent. */
export const AUTO_SLIDER_DELAY_MS = 600;

/** "70% buildings · 30% troops". */
export function shareText(buildShare: number): string {
  const b = Math.max(0, Math.min(100, Math.round(buildShare)));
  return `${b}% buildings · ${100 - b}% troops`;
}

/** Snap a slider value to the allowed steps (0..100, multiples of AUTO_SHARE_STEP). */
export function snapShare(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v / AUTO_SHARE_STEP) * AUTO_SHARE_STEP));
}

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

/** The "Next" line. Off: "Off". On with nothing left: "Nothing left to do". */
export function nextLine(v: Pick<AutoVillageDto, 'on' | 'next'>, now: number): string {
  if (!v.on) return 'Off';
  const next = v.next;
  if (!next) return 'Nothing left to do';
  const what = nextWhat(next);
  const wait = nextWait(next, now);
  switch (next.waiting) {
    case 'now':
      return `Next: ${what} · now`;
    case 'resources':
      return `Next: ${what} · waiting for resources${wait ? `, ${wait}` : ''}`;
    case 'slot':
      return `Next: ${what} · waiting for a free slot${wait ? `, ${wait}` : ''}`;
    case 'room':
      return `Next: ${what} · needs people room`;
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

/** Why a unit chip is greyed ("Needs Stables 1"), from the village's buildings when known; else a plain fallback. */
export function whyNotTrainable(unit: UnitId, buildings?: Partial<Record<BuildingId, number>>): string {
  if (buildings) {
    const unmet = unmetRequirements(buildings as Record<BuildingId, number>, UNITS[unit].requires);
    if (unmet.length > 0) return `Needs ${requirementText(unmet)}`;
  }
  return UNITS[unit].research ? 'Needs research' : 'Not available yet';
}

/** Add or remove a unit from the picked list, keeping the order of `all`. */
export function toggleUnit(picked: readonly UnitId[], unit: UnitId, all: readonly UnitId[]): UnitId[] {
  const set = new Set(picked);
  if (set.has(unit)) set.delete(unit);
  else set.add(unit);
  return all.filter((u) => set.has(u));
}

/** The page's tab: only while the world has the premium tools (`features.premium`). */
export function autoTabOn(config: { features?: { premium?: boolean } } | undefined | null): boolean {
  return config?.features?.premium === true;
}

/** Not entitled (or saving): every control of a card is off. A picked unit stays pressable so it can be un-picked, an unavailable unselected one does not. */
export function controlsOff(locked: boolean, saving: boolean): boolean {
  return locked || saving;
}
export function chipDisabled(locked: boolean, saving: boolean, trainable: boolean, picked: boolean): boolean {
  return controlsOff(locked, saving) || (!trainable && !picked);
}
