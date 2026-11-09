// Pure helpers of the desktop Ranks page: the three lists (real rows plus optional sample rows), search, paging and the "Jump to me" page.
// Same rules as the phone's RankingsView (ties share a rank, my own row is always in the list).

import type { PlayerRankDto, PlayerRankingResponse, RenownRankDto, RenownRankingResponse, TribeSummaryDto } from '@clanfire/engine';

export type RankSection = 'players' | 'tribes' | 'renown';
export const RANK_SECTIONS: Array<{ id: RankSection; label: string }> = [
  { id: 'players', label: 'Players' },
  { id: 'tribes', label: 'Tribes' },
  { id: 'renown', label: 'Renown' },
];
export const RANKS_PER_PAGE = 20;

/** Sort by points (high first) and give ties the same rank (1, 2, 2, 4). */
export function rerank<T extends { rank: number; points: number }>(rows: T[]): T[] {
  const sorted = [...rows].sort((a, b) => b.points - a.points);
  let prevPoints = -1;
  let prevRank = 0;
  return sorted.map((r, i) => {
    const rank = r.points === prevPoints ? prevRank : i + 1;
    prevPoints = r.points;
    prevRank = rank;
    return { ...r, rank };
  });
}

/** Real players (my own row added when it is outside the top list), with the made-up ones mixed in when `sample` is given. */
export function playerRows(real: PlayerRankingResponse, sample: PlayerRankDto[] | null): PlayerRankDto[] {
  const base = [...real.players];
  if (real.me && !base.some((p) => p.playerId === real.me!.playerId)) base.push(real.me);
  return sample ? rerank([...base, ...sample]) : base;
}

export function tribeRows(real: TribeSummaryDto[], sample: TribeSummaryDto[] | null): TribeSummaryDto[] {
  return sample ? rerank([...real, ...sample]) : real;
}

/** Renown list; made-up players get a Renown made up from their points (as on the phone). */
export function renownRows(data: RenownRankingResponse, sample: PlayerRankDto[] | null): RenownRankDto[] {
  let base = [...data.players];
  if (data.me && !base.some((p) => p.playerId === data.me!.playerId)) base.push(data.me);
  if (!sample) return base;
  const made = sample.map((s) => ({ ...s, rank: 0, renown: Math.round(s.points * 1.4) }));
  let prev = -1;
  let prevRank = 0;
  base = [...base, ...made]
    .sort((a, b) => b.renown - a.renown)
    .map((r, i) => {
      const rank = r.renown === prev ? prevRank : i + 1;
      prev = r.renown;
      prevRank = rank;
      return { ...r, rank };
    });
  return base;
}

/** Player name or tribe tag contains the text (case-insensitive); empty text keeps everything. */
export function searchPlayers<T extends { username: string; tribe: { tag: string } | null }>(rows: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((p) => p.username.toLowerCase().includes(q) || (p.tribe?.tag.toLowerCase().includes(q) ?? false)) : rows;
}

export function searchTribes(rows: TribeSummaryDto[], query: string): TribeSummaryDto[] {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((t) => t.name.toLowerCase().includes(q) || t.tag.toLowerCase().includes(q)) : rows;
}

/** 0-based page that holds row `index` (-1 when absent). */
export function pageOfIndex(index: number, perPage = RANKS_PER_PAGE): number {
  return index < 0 ? -1 : Math.floor(index / perPage);
}

/** Page buttons: first, last and the neighbours of the current page (0-based numbers), 'gap' where pages are skipped. */
export function pageItems(page: number, pages: number): Array<number | 'gap'> {
  const shown = new Set<number>([0, pages - 1, page - 1, page, page + 1]);
  const list = [...shown].filter((p) => p >= 0 && p < pages).sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  list.forEach((p, i) => {
    if (i > 0 && p - list[i - 1]! > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

/** "1–20 of 486 players · average 1,032 points" pieces: the rank-line text for the foot of the table. */
export function averagePoints(rows: Array<{ points: number }>): number {
  return rows.length ? Math.round(rows.reduce((s, r) => s + r.points, 0) / rows.length) : 0;
}
