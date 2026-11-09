// Pure helpers of the desktop Ranks page: the three lists (real rows plus optional sample rows), search, paging and the "Jump to me" page.
// Same rules as the phone's RankingsView (ties share a rank, my own row is always in the list).

import { daysOfText, daysText, percentText, shareProgress } from '../../domination.ts';
import { formatInt } from '../../format.ts';
import type { DominationStatusDto, PlayerRankDto, PlayerRankingResponse, RenownRankDto, RenownRankingResponse, TribeSummaryDto } from '@clanfire/engine';

export type RankSection = 'players' | 'tribes' | 'renown' | 'domination';
export const RANK_SECTIONS: Array<{ id: RankSection; label: string }> = [
  { id: 'players', label: 'Players' },
  { id: 'tribes', label: 'Tribes' },
  { id: 'renown', label: 'Renown' },
  { id: 'domination', label: 'Domination' },
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

// ---- Domination tab ("The road") ----------------------------------------------------------------------------------------
// Everything comes from GET /api/domination (DominationStatusDto); these helpers only shape it for the page.

export interface ShareSegment {
  key: string;
  /** Tribe tag, or null for the "other tribes and players without a tribe" rest. */
  tag: string | null;
  /** 0..1 of all village points owned by players. */
  share: number;
}

/** The "Who owns the world" bar: the biggest tribes (as far as the server lists them), then the rest. Shares add up to 1. */
export function shareSegments(s: Pick<DominationStatusDto, 'topTribes' | 'totalPoints'>): ShareSegment[] {
  const tribes = [...s.topTribes].filter((t) => t.share > 0).sort((a, b) => b.points - a.points);
  const used = tribes.reduce((sum, t) => sum + t.share, 0);
  const out: ShareSegment[] = tribes.map((t) => ({ key: `t${t.tribeId}`, tag: t.tag, share: t.share }));
  out.push({ key: 'rest', tag: null, share: Math.max(0, 1 - used) });
  return out;
}

/**
 * Village points the leader still needs to reach the win share, counting that the total grows with the leader's own gain:
 * (p + x) / (T + x) >= w  =>  x >= (w T - p) / (1 - w). Null without a leader, 0 once the line is reached.
 */
export function pointsToLine(s: Pick<DominationStatusDto, 'leader' | 'totalPoints' | 'winShare'>): number | null {
  if (!s.leader || s.winShare >= 1) return null;
  const need = (s.winShare * s.totalPoints - s.leader.points) / (1 - s.winShare);
  return Math.max(0, Math.ceil(need));
}

export interface RoadStep {
  key: 'age' | 'players' | 'share' | 'streak' | 'end';
  title: string;
  /** The big line of the step. */
  value: string;
  /** 0..1 progress bar; null for the last step. */
  fraction: number | null;
  ok: boolean;
  /** The small line under the bar. */
  note: string;
}

/** The five steps of the road, each with the real numbers of the world. */
export function roadSteps(s: DominationStatusDto): RoadStep[] {
  const leaderShare = s.leader?.share ?? 0;
  const shareOk = leaderShare >= s.winShare;
  const streakOk = s.streakDaysNeeded > 0 ? s.streakDays >= s.streakDaysNeeded : s.qualifies;
  const owed = pointsToLine(s);
  const peakNote = s.minActivePlayers > s.settings.minActivePlayers ? `${s.minActivePlayers} needed (a share of the peak, ${s.peakActivePlayers})` : `${s.minActivePlayers} needed`;
  const streakRunning = s.streakStartedAt !== null || s.streakDays > 0;
  const ended = s.ended;
  return [
    {
      key: 'age',
      title: `World is ${daysText(s.minAgeDays)} old`,
      value: daysOfText(s.worldAgeDays, s.minAgeDays),
      fraction: s.minAgeDays > 0 ? clamp(s.worldAgeDays / s.minAgeDays) : 1,
      ok: s.ageOk,
      note: s.ageOk ? 'old enough' : `about ${daysText(s.minAgeDays - s.worldAgeDays)} to go`,
    },
    {
      key: 'players',
      title: 'Enough active players',
      value: `${s.activePlayers} active`,
      fraction: s.minActivePlayers > 0 ? clamp(s.activePlayers / s.minActivePlayers) : 1,
      ok: s.playersOk,
      note: peakNote,
    },
    {
      key: 'share',
      title: `One tribe reaches ${percentText(s.winShare)}`,
      value: s.leader ? `${s.leader.tag} ${percentText(leaderShare)}` : 'no tribe yet',
      fraction: shareProgress(leaderShare, s.winShare),
      ok: shareOk,
      note: shareOk ? 'the line is reached' : owed === null ? 'no tribe owns a village yet' : `needs about ${formatInt(owed)} points more`,
    },
    {
      key: 'streak',
      title: `Holds it ${daysText(s.streakDaysNeeded)} in a row`,
      value: streakRunning ? daysOfText(s.streakDays, s.streakDaysNeeded) : 'not started',
      fraction: s.streakDaysNeeded > 0 ? clamp(s.streakDays / s.streakDaysNeeded) : 0,
      ok: streakOk,
      note: streakRunning ? `${daysText(Math.max(0, s.streakDaysNeeded - s.streakDays))} to go` : 'starts when 1-3 are true',
    },
    {
      key: 'end',
      title: 'World ends',
      value: ended ? (ended.winner ? `${ended.winner.name} [${ended.winner.tag}] won` : 'The world has ended') : 'winner named',
      fraction: null,
      ok: ended !== null,
      note: ended ? 'see the world-end screen' : 'see below',
    },
  ];
}

const clamp = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
