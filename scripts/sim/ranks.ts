// Drillyard rank policy of the computer players (balance.ts and conquest.ts), on the REAL engine: checkRank / applyRank,
// pointsTotal / pointsSpent, RANK_TRACKS_OF, RANK_COST, RANK_POINTS. Nothing about points, costs or tracks is copied here, so
// flipping the config constants (points per level, rank points, which unit has which track) changes the sims by itself.
//
// Rule (what a sensible player does, documented here because the sims never bought ranks before 2026-11-18):
//  - Each style has a PRIORITY LIST of (unit, track): attackers first Might (Raider, Elk Rider, Knight), then Bulwark (Shieldbearer,
//    Pikeman), then Breach for the Log Ram; defenders Bulwark (Shieldbearer, Pikeman, Knight, Hearthwarden), then Might for the Raider;
//    balanced players take turns (round-robin) over both kinds. The list only holds units the style trains (def.army), only units that
//    are researched (isResearched), and Knight / Hearthwarden / siege units only while the village owns some (home, away or queued).
//  - Per village at most ONE rank per sim day (RANK_PER_DAY), and only when the stock after paying still holds
//    RANK_RESERVE_SHARE x the cost of the next planned building (never starve construction; the same stock that training reserves).
//  - The first entry of the list that still has a rank to buy and the Training Points for it is the one: if its resources are not
//    there yet the player waits and saves (it never skips to a cheaper entry), and the War Chest keeps the gold of that rank back.

import {
  RANK_COST,
  RANK_MAX,
  RANK_POINTS,
  RANK_TRACKS_OF,
  RESOURCE_IDS,
  applyRank,
  checkRank,
  isResearched,
  pointsSpent,
  pointsTotal,
  rankOf,
} from '../../packages/engine/src/index.ts';
import type { RankTrack, Resources, UnitId, Units, VillageRanks, VillageState, WorldSettings } from '../../packages/engine/src/index.ts';

const DAY = 24 * 3_600_000;
/** Ranks bought per village per sim day at most. */
export const RANK_PER_DAY = 1;
/** After paying, the stock must still hold this share of the next planned building's cost (per resource). */
export const RANK_RESERVE_SHARE = 0.5;

export type RankKind = 'attacker' | 'defender' | 'balanced';
export interface RankEntry {
  unit: UnitId;
  track: RankTrack;
}
const e = (unit: UnitId, track: RankTrack): RankEntry => ({ unit, track });

/** The priority lists (before the filter by what the style trains and what the config gives a unit). */
const LISTS: Record<RankKind, RankEntry[]> = {
  attacker: [e('raider', 'might'), e('outrider', 'might'), e('knight', 'might'), e('guard', 'bulwark'), e('pikeman', 'bulwark'), e('logram', 'breach'), e('firecart', 'breach')],
  defender: [e('guard', 'bulwark'), e('pikeman', 'bulwark'), e('knight', 'bulwark'), e('hearthwarden', 'bulwark'), e('raider', 'might')],
  balanced: [e('raider', 'might'), e('guard', 'bulwark'), e('outrider', 'might'), e('pikeman', 'bulwark'), e('knight', 'might'), e('knight', 'bulwark'), e('hearthwarden', 'bulwark'), e('logram', 'breach'), e('firecart', 'breach')],
};
/** Units a player only ranks while he owns some (they are rare or a side line). */
const OWN_FIRST: ReadonlySet<UnitId> = new Set<UnitId>(['knight', 'hearthwarden', 'logram', 'firecart']);

const key = (x: RankEntry): string => `${x.unit}:${x.track}`;

/** `{ attackerRanks, defenderRanks }` for resolveBattle, leaving out what is missing (exactOptionalPropertyTypes). */
export function battleRanks(attacker?: VillageRanks, defender?: VillageRanks): { attackerRanks?: VillageRanks; defenderRanks?: VillageRanks } {
  return { ...(attacker ? { attackerRanks: attacker } : {}), ...(defender ? { defenderRanks: defender } : {}) };
}

export class RankPolicy {
  /** Every rank bought, in order (all villages of the player). */
  readonly bought: Array<{ at: number; unit: UnitId; track: RankTrack; village: number }> = [];
  private readonly list: RankEntry[];
  private readonly last = new Map<number, { day: number; cursor: number }>();

  /** `trains` = the units the style trains (its army wheel, plus siege units when they are played). */
  constructor(
    private readonly kind: RankKind,
    trains: readonly UnitId[],
  ) {
    this.list = LISTS[kind].filter((x) => trains.includes(x.unit) && (RANK_TRACKS_OF[x.unit]?.includes(x.track) ?? false));
  }

  /** The entry the next rank would go to (first below the top rank with Training Points left; the round-robin starts at the village's cursor). */
  private pick(state: VillageState, owned: Units, cursor: number): { entry: RankEntry; index: number; rank: number } | undefined {
    const free = pointsTotal(state) - pointsSpent(state);
    const n = this.list.length;
    for (let i = 0; i < n; i++) {
      const index = this.kind === 'balanced' ? (cursor + i) % n : i;
      const entry = this.list[index] as RankEntry;
      if (OWN_FIRST.has(entry.unit) && !(owned[entry.unit] > 0)) continue;
      if (!isResearched(state, entry.unit)) continue;
      const rank = rankOf(state.ranks, entry.unit, entry.track) + 1;
      if (rank > RANK_MAX) continue;
      if ((RANK_POINTS[rank - 1] ?? 0) > free) continue;
      return { entry, index, rank };
    }
    return undefined;
  }

  /** Gold the next rank needs (a village that pays gold into the War Chest keeps this back); 0 when nothing would be bought. */
  goldNeed(village: number, state: VillageState, owned: Units): number {
    const p = this.pick(state, owned, this.last.get(village)?.cursor ?? 0);
    return p ? (RANK_COST[p.rank - 1]?.gold ?? 0) : 0;
  }

  /**
   * One decision of village `village` at time `t`: buy the next rank when the day's allowance is unused, the engine says yes and the
   * stock after paying still holds `reserve` x RANK_RESERVE_SHARE (the next planned building). Returns the (maybe new) state.
   */
  step(village: number, state: VillageState, t: number, s: WorldSettings, owned: Units, reserve: Resources): VillageState {
    if (this.list.length === 0) return state;
    const day = Math.floor(t / DAY);
    const mem = this.last.get(village) ?? { day: -1, cursor: 0 };
    if (mem.day === day) return state;
    const p = this.pick(state, owned, mem.cursor);
    if (!p) return state;
    const c = checkRank(state, p.entry.unit, p.entry.track, t, s);
    if (!c.ok) return state; // saving up
    for (const id of RESOURCE_IDS) if (state.resources[id] < c.cost[id] + reserve[id] * RANK_RESERVE_SHARE) return state;
    const next = applyRank(state, p.entry.unit, p.entry.track, t, s);
    this.bought.push({ at: t, unit: p.entry.unit, track: p.entry.track, village });
    this.last.set(village, { day, cursor: (p.index + 1) % this.list.length });
    return next;
  }

  /** Ranks bought up to and including sim day `day` (1 = the first 24 h). */
  boughtByDay(day: number): number {
    return this.bought.filter((b) => b.at < day * DAY).length;
  }

  /** Ranks bought so far per (unit, track), for the report. */
  byEntry(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const b of this.bought) out[key(b)] = (out[key(b)] ?? 0) + 1;
    return out;
  }
}

export function formatByEntry(by: Record<string, number>): string {
  const parts = Object.entries(by).map(([k, n]) => `${k.replace(':', ' ')} ${n}`);
  return parts.length > 0 ? parts.join(', ') : 'none';
}
