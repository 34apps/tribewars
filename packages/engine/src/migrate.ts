// One-time rule migration for worlds saved before the originality pass (2026-11-11): the Longhouse takes the Farm's population job, the
// Wrightyard trains siege, and the Log Ram and Boulder Sling become the Firecart (docs/GAME_DESIGN.md 4, 18.9; docs/ORIGINALITY_PROPOSAL.md).
// Pure functions on loose saved data (a saved village still has `logram` / `boulder` keys that `normalizeUnits` would drop).

import { addRefund } from './village.ts';
import type { Resources, VillageState } from './types.ts';

/** The two removed siege units as they were: what a queued batch and their research cost (the refund), and the population each took. */
export const LEGACY_SIEGE = {
  logram: { pop: 3, cost: { wood: 95, food: 120, iron: 100, gold: 2 }, research: { wood: 400, food: 300, iron: 500, gold: 10 } },
  boulder: { pop: 2, cost: { wood: 75, food: 130, iron: 120, gold: 7 }, research: { wood: 700, food: 500, iron: 900, gold: 40 } },
} as const;
type LegacyId = keyof typeof LEGACY_SIEGE;
const LEGACY_IDS = Object.keys(LEGACY_SIEGE) as LegacyId[];
const isLegacy = (u: unknown): u is LegacyId => typeof u === 'string' && (LEGACY_IDS as string[]).includes(u);

/** Barracks level from which a migrated village gets a free Wrightyard level 1. */
export const MIGRATION_WRIGHTYARD_BARRACKS = 5;

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** Firecarts that replace `rams` Log Rams and `slings` Boulder Slings: the same population (3 and 2 each, 3 per Firecart), rounded down. */
export function firecartsFor(rams: number, slings: number): number {
  return Math.floor((LEGACY_SIEGE.logram.pop * count(rams) + LEGACY_SIEGE.boulder.pop * count(slings)) / 3);
}

/** A copy of a loose unit map with the Log Rams and Boulder Slings turned into Firecarts (other keys untouched). */
export function convertSiegeUnits<T extends Record<string, unknown>>(units: T | undefined | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(units ?? {}) };
  const fire = firecartsFor(out.logram as number, out.boulder as number);
  delete out.logram;
  delete out.boulder;
  out.firecart = count(out.firecart) + fire;
  return out;
}

/** True when a unit map still names a removed siege unit. */
export const hasLegacySiege = (units: unknown): boolean => !!units && typeof units === 'object' && LEGACY_IDS.some((id) => id in (units as object));

/** Rank entries (`VillageRanks`-shaped, loose) with `logram` / `boulder` folded into `firecart` (the higher value per track when both exist); old keys removed. Returns a copy. */
export function convertSiegeRanks<T extends Record<string, unknown>>(ranks: T | undefined | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(ranks ?? {}) };
  const entries = [out.firecart, out.logram, out.boulder].filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e));
  delete out.logram;
  delete out.boulder;
  if (entries.length > 0) {
    const merged: Record<string, unknown> = {};
    for (const e of entries) {
      for (const [k, val] of Object.entries(e)) {
        const prev = merged[k];
        merged[k] = typeof val === 'number' && typeof prev === 'number' ? Math.max(prev, val) : prev ?? val;
      }
    }
    out.firecart = merged;
  }
  return out;
}

/**
 * A stored report body (loose JSON) in the new rules: every unit map (attacker / defender / support units and losses, a support report's
 * units, scout intel troops) converted with `convertSiegeUnits`, and siege hits by a removed unit now credit the Firecart. Returns a copy;
 * a body with nothing old comes back equal, so running it twice changes nothing.
 */
export function convertReportBody<T extends Record<string, any>>(body: T): T { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = { ...body }; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const key of ['attackerUnits', 'attackerLosses', 'defenderUnits', 'defenderLosses', 'supportUnits', 'supportLosses', 'units']) {
    if (hasLegacySiege(out[key])) out[key] = convertSiegeUnits(out[key]);
  }
  if (out.intel && typeof out.intel === 'object' && hasLegacySiege(out.intel.troops)) out.intel = { ...out.intel, troops: convertSiegeUnits(out.intel.troops) };
  if (Array.isArray(out.siege)) {
    out.siege = out.siege.map((h: Record<string, unknown>) => (isLegacy(h?.unit) ? { ...h, unit: 'firecart' } : h));
  }
  return out as T;
}

const cloneJson = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/**
 * A saved village in the new rules. Longhouse = the Farm level (a queued Farm level still finishes as a Farm); Log Rams and Boulder Slings at
 * home become Firecarts by population; queued siege batches and siege research are refunded (capped at the storehouse) and leave the
 * queues; researched siege counts as the Firecart researched; Barracks 5+ gets a free Wrightyard 1. `awayFirecarts`, when given, replaces the
 * converted `away` Firecart count (the server sums what its own movements and stationed contingents became, so the two always agree).
 * Idempotent: a village with no old siege units and a Longhouse already set is returned unchanged.
 */
export function migrateVillageOriginality(saved: unknown, awayFirecarts?: number): VillageState {
  const v = cloneJson(saved) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  v.buildings = v.buildings ?? {};
  const farm = count(v.buildings.farm);
  if (!(count(v.buildings.longhouse) > 0)) v.buildings.longhouse = farm;
  if (v.renownPaid && !(count(v.renownPaid.longhouse) > 0)) v.renownPaid.longhouse = count(v.renownPaid.farm) || farm;
  if (v.troops) v.troops = convertSiegeUnits(v.troops);
  if (v.away) {
    v.away = convertSiegeUnits(v.away);
    if (awayFirecarts !== undefined) v.away.firecart = count(awayFirecarts);
  }

  const refund: Resources = { wood: 0, food: 0, iron: 0, gold: 0 };
  const owe = (cost: Resources, times: number): void => {
    for (const r of ['wood', 'food', 'iron', 'gold'] as const) refund[r] += cost[r] * times;
  };
  const barracks: Array<Record<string, any>> | undefined = v.trainQueues?.barracks; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (barracks) {
    const kept: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    let freeFrom: number | null = null; // when the slot of the last removed batch began producing nothing
    for (const job of barracks) {
      if (isLegacy(job.unit)) {
        owe(LEGACY_SIEGE[job.unit].cost, Math.max(0, count(job.count) - count(job.done)));
        freeFrom = Math.max(freeFrom ?? 0, (job.startAt as number) + count(job.done) * (job.perUnitMs as number));
        // Units of the batch already trained are in `troops` (converted above).
        continue;
      }
      if (freeFrom !== null) {
        const prev = kept[kept.length - 1];
        // Never in the past: the refunded batch may have been scheduled long before the village was last settled.
        job.startAt = Math.max(prev ? (prev.startAt as number) + count(prev.count) * (prev.perUnitMs as number) : 0, Math.min(job.startAt as number, freeFrom), count(v.lastUpdate));
      }
      kept.push(job);
    }
    v.trainQueues.barracks = kept;
  }

  const queue: Array<Record<string, any>> | undefined = v.researchQueue; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (queue) {
    let cursor: number | null = null;
    const kept: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const job of queue) {
      if (isLegacy(job.unit)) {
        owe(LEGACY_SIEGE[job.unit].research, 1);
        cursor = job.startAt as number;
        continue;
      }
      if (cursor !== null) {
        const dur = (job.finishAt as number) - (job.startAt as number);
        const prev = kept[kept.length - 1];
        job.startAt = prev ? (prev.finishAt as number) : cursor;
        job.finishAt = (job.startAt as number) + dur;
      }
      kept.push(job);
    }
    if (kept.length === 0) delete v.researchQueue;
    else v.researchQueue = kept;
  }

  if (Array.isArray(v.researched) && v.researched.some(isLegacy)) {
    v.researched = [...new Set([...v.researched.filter((u: unknown) => !isLegacy(u)), 'firecart'])];
  }
  if (v.ranks) v.ranks = convertSiegeRanks(v.ranks);

  v.buildings.wrightyard = count(v.buildings.wrightyard);
  if (v.buildings.wrightyard === 0 && count(v.buildings.barracks) >= MIGRATION_WRIGHTYARD_BARRACKS) {
    v.buildings.wrightyard = 1;
    if (v.renownPaid) v.renownPaid.wrightyard = Math.max(1, count(v.renownPaid.wrightyard));
  }
  if (v.trainQueues && !v.trainQueues.wrightyard) v.trainQueues.wrightyard = [];

  const out = v as unknown as VillageState;
  addRefund(out, refund);
  return out;
}
