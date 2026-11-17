// Pure helpers of the Realm page (no React, no I/O): live stock from the settled numbers, fullness, sorting, totals, summaries
// and the paging math. `serverTime` is the moment the response was settled to; `now` is the server-corrected clock of the screen.

import { RESOURCE_IDS, UNIT_IDS } from '@clanfire/engine';
import type { RealmBuildJobDto, RealmTrainBatchDto, RealmVillageDto, ResourceId, Resources, UnitId, Units } from '@clanfire/engine';

const HOUR_MS = 3_600_000;

/** Fullness at or above this reads "full"; at or above NEAR it reads "nearly full" (the bar turns to the warning colour). */
export const FULL_AT = 0.999;
export const NEAR_FULL_AT = 0.9;

export type Fill = 'ok' | 'near' | 'full';

export function fillOf(ratio: number): Fill {
  return ratio >= FULL_AT ? 'full' : ratio >= NEAR_FULL_AT ? 'near' : 'ok';
}

/** 0..1, safe for a zero cap. */
export function ratioOf(amount: number, cap: number): number {
  if (!(cap > 0) || !Number.isFinite(amount)) return 0;
  return Math.min(1, Math.max(0, amount / cap));
}

/**
 * The stock of one village at `now`: the settled amounts plus income since `serverTime`, kept inside 0..cap. The server settled
 * and floored the numbers; a growing stock is estimated locally (the next poll replaces it with the exact numbers).
 */
export function liveStock(v: Pick<RealmVillageDto, 'resources' | 'income' | 'storageCap'>, serverTime: number, now: number): Resources {
  const dt = Math.max(0, now - serverTime) / HOUR_MS;
  const out = { ...v.resources };
  for (const r of RESOURCE_IDS) {
    const base = v.resources[r];
    const grown = base + v.income[r] * dt;
    // A full stock stays full; a stock above the cap (it can happen after a Storehouse downgrade) is shown as it is, never growing.
    out[r] = base >= v.storageCap ? base : Math.min(v.storageCap, Math.max(0, grown));
  }
  return out;
}

/** The fullest of the four stocks, 0..1. */
export function stockFullness(stock: Resources, cap: number): number {
  let top = 0;
  for (const r of RESOURCE_IDS) top = Math.max(top, ratioOf(stock[r], cap));
  return top;
}

export function popRatio(v: Pick<RealmVillageDto, 'population'>): number {
  return ratioOf(v.population.used, v.population.cap);
}

/** Free places in the build queue (the FREE SLOT chip shows when this is above zero). */
export function freeSlots(v: Pick<RealmVillageDto, 'build'>): number {
  return Math.max(0, v.build.slots - v.build.queue.length);
}

/** Time left of a job or batch in ms (never negative). */
export function msLeft(finishAt: number, now: number): number {
  return Math.max(0, finishAt - now);
}

// ---- Sorting ---------------------------------------------------------------------------------------------------------------

export const SORT_KEYS = ['name', 'points', 'population', 'build', 'stock', 'incoming'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface SortChoice {
  key: SortKey;
  /** True flips the natural direction of the key. */
  reverse: boolean;
}

export const DEFAULT_SORT: SortChoice = { key: 'name', reverse: false };

export const SORT_LABEL: Record<SortKey, string> = {
  name: 'Name',
  points: 'Points',
  population: 'Population',
  build: 'Building',
  stock: 'Stock',
  incoming: 'Incoming attack',
};

/** What the natural direction means, for the title of a header. */
export const SORT_HINT: Record<SortKey, string> = {
  name: 'A to Z',
  points: 'most points first',
  population: 'fullest first',
  build: 'free queue first, then soonest done',
  stock: 'fullest first',
  incoming: 'soonest attack first',
};

/** Parse what localStorage held; anything unknown falls back to the default. */
export function parseSort(raw: string | null): SortChoice {
  if (!raw) return DEFAULT_SORT;
  try {
    const v = JSON.parse(raw) as Partial<SortChoice> | null;
    if (v && (SORT_KEYS as readonly string[]).includes(v.key as string)) return { key: v.key as SortKey, reverse: v.reverse === true };
  } catch {
    // fall through
  }
  return DEFAULT_SORT;
}

/** Choosing the active key again flips it; another key starts in its natural direction. */
export function nextSort(cur: SortChoice, key: SortKey): SortChoice {
  return cur.key === key ? { key, reverse: !cur.reverse } : { key, reverse: false };
}

/** Build-queue sort value: an empty queue first, then a queue with room, then by when the next job is done. */
function buildValue(v: RealmVillageDto): number {
  const q = v.build.queue;
  if (q.length === 0) return -2;
  if (q.length < v.build.slots) return -1 + (q[0]!.finishAt / 1e15);
  return q[0]!.finishAt;
}

function compare(a: RealmVillageDto, b: RealmVillageDto, key: SortKey, serverTime: number, now: number): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    case 'points':
      return b.points - a.points;
    case 'population':
      return popRatio(b) - popRatio(a);
    case 'build':
      return buildValue(a) - buildValue(b);
    case 'stock':
      return stockFullness(liveStock(b, serverTime, now), b.storageCap) - stockFullness(liveStock(a, serverTime, now), a.storageCap);
    case 'incoming': {
      const an = a.incoming.attacks > 0 && a.incoming.nextAt !== null ? a.incoming.nextAt : Infinity;
      const bn = b.incoming.attacks > 0 && b.incoming.nextAt !== null ? b.incoming.nextAt : Infinity;
      if (an === bn) return 0;
      return an < bn ? -1 : 1;
    }
  }
}

/** A sorted copy. Ties fall back to the name, then the id, so the order never jumps between polls. */
export function sortVillages(list: readonly RealmVillageDto[], choice: SortChoice, serverTime: number, now: number): RealmVillageDto[] {
  const dir = choice.reverse ? -1 : 1;
  return [...list].sort((a, b) => {
    const c = compare(a, b, choice.key, serverTime, now);
    if (c !== 0 && Number.isFinite(c)) return c * dir;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.id - b.id;
  });
}

// ---- Totals ----------------------------------------------------------------------------------------------------------------

export interface RealmTotals {
  villages: number;
  resources: Resources;
  income: Resources;
  /** Storage cap summed over the villages (each resource has the same cap in one village). */
  cap: number;
  population: { used: number; cap: number };
  troops: Partial<Units>;
  incoming: { attacks: number; nextAt: number | null };
  outgoing: { marches: number; nextAt: number | null };
  freeSlots: number;
}

const earliest = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.min(a, b));

export function realmTotals(list: readonly RealmVillageDto[], serverTime: number, now: number): RealmTotals {
  const resources = { wood: 0, food: 0, iron: 0, gold: 0 } as Resources;
  const income = { wood: 0, food: 0, iron: 0, gold: 0 } as Resources;
  const troops: Partial<Units> = {};
  const t: RealmTotals = {
    villages: list.length,
    resources,
    income,
    cap: 0,
    population: { used: 0, cap: 0 },
    troops,
    incoming: { attacks: 0, nextAt: null },
    outgoing: { marches: 0, nextAt: null },
    freeSlots: 0,
  };
  for (const v of list) {
    const stock = liveStock(v, serverTime, now);
    for (const r of RESOURCE_IDS) {
      resources[r] += stock[r];
      income[r] += v.income[r];
    }
    t.cap += v.storageCap;
    t.population.used += v.population.used;
    t.population.cap += v.population.cap;
    for (const u of UNIT_IDS) {
      const n = v.troops[u] ?? 0;
      if (n > 0) troops[u] = (troops[u] ?? 0) + n;
    }
    t.incoming.attacks += v.incoming.attacks;
    if (v.incoming.attacks > 0) t.incoming.nextAt = earliest(t.incoming.nextAt, v.incoming.nextAt);
    t.outgoing.marches += v.outgoing.marches;
    if (v.outgoing.marches > 0) t.outgoing.nextAt = earliest(t.outgoing.nextAt, v.outgoing.nextAt);
    t.freeSlots += freeSlots(v);
  }
  return t;
}

// ---- Cell summaries ----------------------------------------------------------------------------------------------------------

/** Non-zero troop entries in the fixed unit order. */
export function troopEntries(troops: Partial<Units>): Array<[UnitId, number]> {
  const out: Array<[UnitId, number]> = [];
  for (const u of UNIT_IDS) {
    const n = troops[u] ?? 0;
    if (n > 0) out.push([u, n]);
  }
  return out;
}

export interface BuildSummary {
  first: RealmBuildJobDto | null;
  second: RealmBuildJobDto | null;
  /** Jobs after the second. */
  more: number;
  free: number;
}

export function buildSummary(v: Pick<RealmVillageDto, 'build'>): BuildSummary {
  const q = v.build.queue;
  return { first: q[0] ?? null, second: q[1] ?? null, more: Math.max(0, q.length - 2), free: freeSlots(v) };
}

/** The first `max` batches, and how many more there are. */
export function trainingLines(training: readonly RealmTrainBatchDto[], max: number): { shown: RealmTrainBatchDto[]; more: number } {
  return { shown: training.slice(0, max), more: Math.max(0, training.length - max) };
}

export function stockPerResource(v: RealmVillageDto, serverTime: number, now: number): Array<{ id: ResourceId; amount: number; income: number; ratio: number; fill: Fill }> {
  const stock = liveStock(v, serverTime, now);
  return RESOURCE_IDS.map((id) => {
    const ratio = ratioOf(stock[id], v.storageCap);
    return { id, amount: stock[id], income: v.income[id], ratio, fill: fillOf(ratio) };
  });
}

// ---- Paging ------------------------------------------------------------------------------------------------------------------

export const MIN_ROWS_PER_PAGE = 3;

/** How many whole rows fit in `areaHeight` px (never fewer than `min`; a bad measure gives `min`). */
export function rowsFit(areaHeight: number, rowHeight: number, min = MIN_ROWS_PER_PAGE): number {
  if (!Number.isFinite(areaHeight) || !(rowHeight > 0)) return min;
  return Math.max(min, Math.floor(areaHeight / rowHeight));
}
