// Pure helpers of the desktop Army page (FrameArmy.tsx, no React, unit-tested): filtering and ordering of the movements, how many
// rows a panel shows before "+N more", and the "recent targets" the player sent to (kept in the browser only, never on the server).

import type { MovementDto, TrainJob } from '@clanfire/engine';

export type MoveFilter = 'all' | 'in' | 'out';

/** Incoming attacks first (most urgent), then other incoming (support, shipments), then my own troops; each by arrival time. */
export function movementRank(m: Pick<MovementDto, 'direction' | 'kind'>): number {
  if (m.direction === 'incoming') return m.kind === 'attack' ? 0 : 1;
  return 2;
}

export function sortMovements<T extends Pick<MovementDto, 'direction' | 'kind' | 'arriveAt'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => movementRank(a) - movementRank(b) || a.arriveAt - b.arriveAt);
}

export function filterMovements<T extends Pick<MovementDto, 'direction'>>(list: readonly T[], filter: MoveFilter): T[] {
  if (filter === 'all') return [...list];
  return list.filter((m) => (filter === 'in' ? m.direction === 'incoming' : m.direction === 'outgoing'));
}

export function moveCounts(list: readonly Pick<MovementDto, 'direction'>[]): Record<MoveFilter, number> {
  const incoming = list.filter((m) => m.direction === 'incoming').length;
  return { all: list.length, in: incoming, out: list.length - incoming };
}

/** The first `max` rows and how many are left over (the "+N more" link). */
export function takeRows<T>(list: readonly T[], max: number): { shown: T[]; more: number } {
  const n = Math.max(0, Math.floor(max));
  return { shown: list.slice(0, n), more: Math.max(0, list.length - n) };
}

/**
 * Support panel budget: how many rows each group ("here in my village", "my troops away") shows, `budget` rows in all. A group with
 * rows always gets at least one; what is left goes to the first group, then the second.
 */
export function splitSupportRows(hereN: number, awayN: number, budget = 3): { here: number; away: number } {
  const h0 = hereN > 0 ? 1 : 0;
  const a0 = awayN > 0 ? 1 : 0;
  let rest = Math.max(0, budget - h0 - a0);
  const addHere = Math.min(hereN - h0, rest);
  rest -= addHere;
  const addAway = Math.min(awayN - a0, rest);
  return { here: h0 + addHere, away: a0 + addAway };
}

/** When a training building's queue is done: the end of its last batch (a batch that has not started yet starts later). null = empty. */
export function queueDoneAt(queue: readonly TrainJob[]): number | null {
  if (queue.length === 0) return null;
  return Math.max(...queue.map((j) => j.startAt + j.count * j.perUnitMs));
}

/** Units still to come out of a queue (batch size minus what is already trained). */
export function queueUnitsLeft(queue: readonly TrainJob[]): number {
  return queue.reduce((n, j) => n + Math.max(0, j.count - j.done), 0);
}

// ---- Recent targets ---------------------------------------------------------------------------------------------------

export type RecentKind = 'abandoned' | 'player' | 'own' | 'free';

export interface RecentTarget {
  x: number;
  y: number;
  kind: RecentKind;
  /** Owner's name for a player village; '' otherwise. */
  who: string;
}

export const RECENT_MAX = 4;
const KINDS: readonly RecentKind[] = ['abandoned', 'player', 'own', 'free'];

/** The newest target first, one entry per tile, at most `max`. */
export function addRecent(list: readonly RecentTarget[], entry: RecentTarget, max = RECENT_MAX): RecentTarget[] {
  return [entry, ...list.filter((t) => t.x !== entry.x || t.y !== entry.y)].slice(0, max);
}

/** Stored JSON -> a clean list (anything malformed is dropped, never thrown). */
export function parseRecent(raw: string | null): RecentTarget[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: RecentTarget[] = [];
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (!Number.isSafeInteger(r.x) || !Number.isSafeInteger(r.y)) continue;
    const kind = KINDS.find((k) => k === r.kind);
    if (!kind) continue;
    const who = typeof r.who === 'string' ? r.who.slice(0, 40) : '';
    out.push({ x: r.x as number, y: r.y as number, kind, who });
    if (out.length >= RECENT_MAX) break;
  }
  return out;
}

export function loadRecent(key: string): RecentTarget[] {
  try {
    return parseRecent(window.localStorage.getItem(key));
  } catch {
    return [];
  }
}

export function saveRecent(key: string, list: readonly RecentTarget[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // Private window or blocked storage: the chips just do not persist.
  }
}
