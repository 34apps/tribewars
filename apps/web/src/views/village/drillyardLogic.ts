// Drillyard page: the plain-words side of the rank rules. Every number comes from the engine constants (config.ts); nothing here is hard-coded.

import {
  BREACH_BONUS,
  DRILLYARD_HALL_FROM,
  DRILLYARD_POINTS_PER_HALL_LEVEL,
  DRILLYARD_POINTS_PER_LEVEL,
  KEEN_BONUS,
  RANKABLE_UNITS,
  RANK_BONUS,
  RANK_MAX,
  RANK_POINTS,
  RANK_TRACKS_OF,
  UNITS,
  UNIT_IDS,
  isResearched,
} from '@clanfire/engine';
import type { RankTrack, UnitId, VillageState } from '@clanfire/engine';

/** Plain words on screen (owner 2026-11-11: "Might, Bulwark ... too hard to understand"); the engine ids stay might/bulwark/keen/breach. */
export const TRACK_NAME: Record<RankTrack, string> = { might: 'Attack', bulwark: 'Defence', keen: 'Scouting', breach: 'Breach' };

/** Bonus per rank of one track, as a fraction (0.05 = +5%). */
export const TRACK_PER_RANK: Record<RankTrack, number> = { might: RANK_BONUS, bulwark: RANK_BONUS, keen: KEEN_BONUS, breach: BREACH_BONUS };

/** Whole percent, free of float dust (0.06 * 3 = 0.18 -> 18). */
export const pct = (fraction: number): number => Math.round(fraction * 100);

/** "+5% attack per rank": what one rank of the track does for this unit. */
export function trackEffect(track: RankTrack, unit: UnitId): string {
  const per = pct(TRACK_PER_RANK[track]);
  switch (track) {
    case 'might':
      return `+${per}% attack per rank`;
    case 'bulwark':
      return `+${per}% defence per rank, foot and riders`;
    case 'keen':
      return `+${per}% scouting per rank`;
    case 'breach': {
      const hits = UNITS[unit].siege?.hits;
      return `+${per}% siege power per rank${hits === 'wall' ? ', on the Wall' : hits === 'buildings' ? ', on buildings' : ''}`;
    }
  }
}

/** The same, short, for a row that already shows the track's name in its tag: "+5% per rank", "+4% per rank, on the Wall". */
export function trackEffectShort(track: RankTrack, unit: UnitId): string {
  const per = `+${pct(TRACK_PER_RANK[track])}% per rank`;
  if (track !== 'breach') return per;
  const hits = UNITS[unit].siege?.hits;
  return `${per}${hits === 'wall' ? ', on the Wall' : hits === 'buildings' ? ', on buildings' : ''}`;
}

/** The bonus a given rank has reached, in percent (0 for rank 0). */
export const trackBonusPct = (track: RankTrack, rank: number): number => pct(TRACK_PER_RANK[track] * rank);

/** Training Points that buying the next rank costs when the track stands at `rank` (null at the top). */
export const nextRankPoints = (rank: number): number | null => (rank >= RANK_MAX ? null : (RANK_POINTS[rank] ?? 0));

export interface RankRow {
  unit: UnitId;
  track: RankTrack;
  /** First row of this unit (gets the picture and name; a second track of the same unit repeats the name only). */
  first: boolean;
}

/** Units that get rank rows on the Drillyard page: rankable (they have a track) and researched (or free). Page order = RANKABLE_UNITS. */
export const rankCardUnits = (live: Pick<VillageState, 'researched'>): UnitId[] =>
  RANKABLE_UNITS.filter((u) => UNIT_IDS.includes(u) && !!RANK_TRACKS_OF[u]?.length && isResearched(live as VillageState, u));

/** One row per (unit, track) the unit really has. */
export function rankRows(units: readonly UnitId[]): RankRow[] {
  const rows: RankRow[] = [];
  for (const unit of units) (RANK_TRACKS_OF[unit] ?? []).forEach((track, i) => rows.push({ unit, track, first: i === 0 }));
  return rows;
}

/** Groups on the Ranks page, in page order: Defence, Attack, Scouting, Breach (the track's plain name labels the row). */
export const RANK_GROUP_ORDER: readonly RankTrack[] = ['bulwark', 'might', 'keen', 'breach'];

export interface RankGroup {
  track: RankTrack;
  label: string;
  units: UnitId[];
}

/** The cards by role: one group per track, holding every unit that really has that track (read from RANK_TRACKS_OF), in page order. Empty groups are left out. */
export function rankGroups(units: readonly UnitId[]): RankGroup[] {
  return RANK_GROUP_ORDER.map((track) => ({ track, label: TRACK_NAME[track], units: units.filter((u) => RANK_TRACKS_OF[u]?.includes(track)) })).filter((g) => g.units.length > 0);
}

/** Small hint by the points bar: where more points come from. */
export function pointsHint(): string {
  const hall = DRILLYARD_POINTS_PER_HALL_LEVEL > 0 ? `, +${DRILLYARD_POINTS_PER_HALL_LEVEL} per Town Hall level above ${DRILLYARD_HALL_FROM}` : '';
  return `+${DRILLYARD_POINTS_PER_LEVEL} per Drillyard level${hall}`;
}

/** What one rank costs in points: "2 points" when every rank costs the same, else the list ("1, 2, 3, 4, 5 points"). */
export function rankCostRule(): string {
  const costs = RANK_POINTS.slice(0, RANK_MAX);
  const same = costs.every((c) => c === costs[0]);
  const plural = (n: number) => (n === 1 ? 'point' : 'points');
  return same ? `Every rank costs ${costs[0]} ${plural(costs[0] ?? 0)}` : `Ranks 1 to ${RANK_MAX} cost ${costs.join(', ')} points`;
}

/** The "how it works" line above the rank rows. */
export function pointsRuleText(): string {
  const hall = DRILLYARD_POINTS_PER_HALL_LEVEL > 0 ? `, plus ${DRILLYARD_POINTS_PER_HALL_LEVEL} per Town Hall level above ${DRILLYARD_HALL_FROM}` : '';
  return `Each Drillyard level gives ${DRILLYARD_POINTS_PER_LEVEL} points${hall}. ${rankCostRule()}, up to rank ${RANK_MAX}. Reset gives the points back, not the resources.`;
}
