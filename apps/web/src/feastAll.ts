// "Feast in all villages" (Premium): pure helpers for the list on the Banner Hall page (docs/GAME_DESIGN.md 18.2). No React (unit-tested).
// The server decides everything; these only keep the ticks, numbers and sentences honest.

import { FEAST_RENOWN } from '@clanfire/engine';
import type { FeastAllResponse, FeastVillageDto } from '@clanfire/engine';
import { clampFeastCount } from './renown.ts';

export const FEAST_ALL_NOT_ENTITLED = 'Premium: hold Feasts in all your villages at once.';
export const FEAST_ALL_INTRO = 'Tick the villages, pick how many Feasts each holds, then hold them all with one press.';

export type FeastRowState = 'no-hall' | 'broke' | 'ready';

/** What a row can do: no Banner Hall, not enough for one Feast, or ready. */
export function rowState(v: Pick<FeastVillageDto, 'bannerhall' | 'max'>): FeastRowState {
  if (v.bannerhall < 1) return 'no-hall';
  return v.max < 1 ? 'broke' : 'ready';
}

export function rowNote(state: FeastRowState): string | null {
  if (state === 'no-hall') return 'Needs Banner Hall level 1';
  if (state === 'broke') return 'Not enough resources for one Feast';
  return null;
}

export interface FeastPick {
  on: boolean;
  /** What is typed in the number field (may be empty or junk while typing). */
  text: string;
}

/** Defaults: ticked and at `max` where one Feast is possible, else unticked. */
export function defaultPicks(villages: readonly FeastVillageDto[]): Record<number, FeastPick> {
  const out: Record<number, FeastPick> = {};
  for (const v of villages) {
    const ready = rowState(v) === 'ready';
    out[v.id] = { on: ready, text: String(ready ? v.max : 0) };
  }
  return out;
}

/** The number of Feasts a row will hold: typed value clamped to 0..max (0 for a row that cannot). */
export function pickCount(v: Pick<FeastVillageDto, 'bannerhall' | 'max'>, pick: FeastPick | undefined): number {
  if (!pick || rowState(v) !== 'ready') return 0;
  const typed = Number.parseInt(pick.text, 10);
  return clampFeastCount(Number.isFinite(typed) ? typed : 1, v.max);
}

export interface FeastTotals {
  villages: number;
  feasts: number;
  renown: number;
}

/** Ticked rows that can Feast: how many villages, Feasts and Renown. */
export function pickTotals(villages: readonly FeastVillageDto[], picks: Record<number, FeastPick>): FeastTotals {
  let n = 0;
  let feasts = 0;
  for (const v of villages) {
    const c = picks[v.id]?.on ? pickCount(v, picks[v.id]) : 0;
    if (c > 0) {
      n += 1;
      feasts += c;
    }
  }
  return { villages: n, feasts, renown: feasts * FEAST_RENOWN };
}

/** The POST body: ticked rows with at least one Feast. */
export function buildFeastRequest(villages: readonly FeastVillageDto[], picks: Record<number, FeastPick>): { id: number; count: number }[] {
  const out: { id: number; count: number }[] = [];
  for (const v of villages) {
    const count = picks[v.id]?.on ? pickCount(v, picks[v.id]) : 0;
    if (count > 0) out.push({ id: v.id, count });
  }
  return out;
}

/** Tick all (when at least one ready row is unticked) or untick all. Only rows that can Feast get ticked. */
export function toggleAll(villages: readonly FeastVillageDto[], picks: Record<number, FeastPick>): Record<number, FeastPick> {
  const ready = villages.filter((v) => rowState(v) === 'ready');
  const allOn = ready.every((v) => picks[v.id]?.on);
  const out = { ...picks };
  for (const v of ready) out[v.id] = { ...(out[v.id] ?? { text: String(v.max) }), on: !allOn };
  return out;
}

/** "Held 37 Feasts in 4 villages: +370 Renown" (or "Nothing was held"). */
export function resultLine(res: Pick<FeastAllResponse, 'gained' | 'results'>): string {
  const held = res.results.filter((r) => r.held > 0);
  const feasts = held.reduce((n, r) => n + r.held, 0);
  if (feasts < 1) return 'Nothing was held.';
  return `Held ${feasts.toLocaleString('en-US')} ${feasts === 1 ? 'Feast' : 'Feasts'} in ${held.length} ${held.length === 1 ? 'village' : 'villages'}: +${res.gained.toLocaleString('en-US')} Renown`;
}

/** One line per skipped village: "Name: server message". Unknown ids are left out. */
export function skippedLines(res: Pick<FeastAllResponse, 'results'>, villages: readonly Pick<FeastVillageDto, 'id' | 'name'>[]): string[] {
  const out: string[] = [];
  for (const r of res.results) {
    if (!r.skipped) continue;
    const name = villages.find((v) => v.id === r.id)?.name ?? `Village ${r.id}`;
    out.push(`${name}: ${r.skipped.message}`);
  }
  return out;
}
