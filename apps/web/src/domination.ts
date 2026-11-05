// Pure helpers behind the Domination bar and the world-end screen (no React, no I/O).
// The numbers all come from GET /api/domination and GET /api/world-end; this file only formats them.

import type { DominationStatusDto, DominationTribeDto, WorldEndDto } from '@clanfire/engine';

/** The message the server sends with a 403 once the world has ended. */
export const WORLD_ENDED_MESSAGE = 'This world has ended.';
/** What the player sees instead of a raw error when an order is refused because the world ended. */
export const WORLD_ENDED_NOTE = 'This world has ended. Orders are closed; you can still read the map, reports, mail, rankings and your tribe chat and forum.';
/** The short line a toast shows when an order button is tapped after the world ended. */
export const WORLD_ENDED_NOTICE = 'This world has ended. Orders are closed.';
/** Window event api.ts fires when an order is refused because the world ended; the app then asks GET /api/world-end. */
export const WORLD_ENDED_EVENT = 'clanfire:world-ended';
/** Top rows shown on the final tables. */
export const FINAL_ROWS = 50;
/** Tribes listed in the bar's "top tribes" list. */
export const TOP_TRIBES_SHOWN = 5;

/** True for the refusal every state-changing request gets after the world ended (403 'forbidden' "This world has ended."). */
export function isWorldEndedError(status: number, message: string): boolean {
  return status === 403 && message.trim().toLowerCase().startsWith('this world has ended');
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/** 0.7432 -> "74.3%"; 0 -> "0%"; a tiny share never shows as "0%" ("<0.1%"). */
export function percentText(share: number): string {
  const s = clamp01(share);
  if (s === 0) return '0%';
  const p = Math.round(s * 1000) / 10;
  if (p < 0.1) return '<0.1%';
  return `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
}

/** Width in percent (0..100) of a bar for a 0..1 value. */
export function barWidth(fraction: number): number {
  return Math.round(clamp01(fraction) * 1000) / 10;
}

/** "1 day", "14 days", "3.5 days". */
export function daysText(days: number): string {
  const d = Number.isFinite(days) ? Math.max(0, days) : 0;
  const rounded = Math.round(d * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${rounded === 1 ? 'day' : 'days'}`;
}

/** "3.5 of 14 days" (the unit is added once). */
export function daysOfText(have: number, need: number): string {
  const strip = (s: string) => s.replace(/ days?$/, '');
  return `${strip(daysText(have))} of ${daysText(need)}`;
}

export interface ConditionRow {
  key: 'share' | 'streak' | 'age' | 'players';
  label: string;
  /** Plain "x of y" text. */
  value: string;
  /** 0..1 for a small bar. */
  fraction: number;
  /** This condition holds right now. */
  ok: boolean;
}

/** The leader's line: "Ember Wolves [EW] holds 62.4% of all village points", or the empty-world line. */
export function leaderLine(s: Pick<DominationStatusDto, 'leader'>): string {
  const l = s.leader;
  if (!l) return 'No tribe owns a village yet.';
  return `${l.name} [${l.tag}] holds ${percentText(l.share)} of all village points`;
}

/** How far the leader is toward the win share, 0..1 (full bar = the win line). */
export function shareProgress(share: number, winShare: number): number {
  return winShare > 0 ? clamp01(share / winShare) : 0;
}

/** The four conditions with plain values, in the order they are explained to the player. */
export function conditionRows(s: DominationStatusDto): ConditionRow[] {
  const leaderShare = s.leader?.share ?? 0;
  const shareOk = leaderShare >= s.winShare;
  return [
    { key: 'share', label: 'Leader share', value: `${percentText(leaderShare)} of ${percentText(s.winShare)} needed`, fraction: shareProgress(leaderShare, s.winShare), ok: shareOk },
    { key: 'age', label: 'World age', value: daysOfText(s.worldAgeDays, s.minAgeDays), fraction: s.minAgeDays > 0 ? clamp01(s.worldAgeDays / s.minAgeDays) : 1, ok: s.ageOk },
    { key: 'players', label: 'Active players', value: `${s.activePlayers} of ${s.minActivePlayers} needed`, fraction: s.minActivePlayers > 0 ? clamp01(s.activePlayers / s.minActivePlayers) : 1, ok: s.playersOk },
    { key: 'streak', label: 'Streak', value: streakText(s), fraction: s.streakDaysNeeded > 0 ? clamp01(s.streakDays / s.streakDaysNeeded) : 0, ok: s.streakDaysNeeded > 0 && s.streakDays >= s.streakDaysNeeded },
  ];
}

/** "3.5 of 14 days" while a streak runs, "No streak running (14 days needed)" otherwise. */
export function streakText(s: Pick<DominationStatusDto, 'streakStartedAt' | 'streakDays' | 'streakDaysNeeded'>): string {
  if (s.streakStartedAt === null && s.streakDays <= 0) return `No streak running (${daysText(s.streakDaysNeeded)} needed)`;
  return daysOfText(s.streakDays, s.streakDaysNeeded);
}

export type DominationPhase = 'ended' | 'counting' | 'close' | 'quiet';

/** One word for the bar's mood: ended, a streak is running, the leader is within reach of the line, or nothing going on. */
export function dominationPhase(s: DominationStatusDto): DominationPhase {
  if (s.ended) return 'ended';
  if (s.qualifies && s.streakStartedAt !== null) return 'counting';
  if ((s.leader?.share ?? 0) >= s.winShare * 0.8) return 'close';
  return 'quiet';
}

/** A short headline for the compact bar. */
export function dominationHeadline(s: DominationStatusDto): string {
  const phase = dominationPhase(s);
  if (phase === 'ended') return s.ended?.winner ? `${s.ended.winner.name} [${s.ended.winner.tag}] won the world` : 'The world has ended';
  if (phase === 'counting') {
    const left = Math.max(0, s.streakDaysNeeded - s.streakDays);
    return `${s.leader ? `[${s.leader.tag}]` : 'A tribe'} is winning: ${daysText(left)} to go`;
  }
  if (phase === 'close') return `${s.leader ? `[${s.leader.tag}]` : 'A tribe'} is closing in on domination`;
  return 'No tribe dominates the world';
}

/**
 * Plain reasons from the server, trimmed, de-duplicated, one sentence each. Falls back to a line built from the
 * conditions when an older server sends none while the world does not count yet.
 */
export function reasonList(s: DominationStatusDto): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of s.reasons ?? []) {
    const r = typeof raw === 'string' ? raw.trim() : '';
    if (r && !seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  if (out.length === 0 && !s.qualifies && !s.ended) {
    if (!s.ageOk) out.push(`The world is only ${daysText(s.worldAgeDays)} old; it must be ${daysText(s.minAgeDays)}.`);
    if (!s.playersOk) out.push(`Only ${s.activePlayers} active players; ${s.minActivePlayers} are needed.`);
    if ((s.leader?.share ?? 0) < s.winShare) out.push(`No tribe holds ${percentText(s.winShare)} of the village points yet.`);
  }
  return out;
}

/** Top tribes for the list: leader first, at most `limit`, each with its bar width relative to the win share. */
export function topTribeRows(s: DominationStatusDto, limit = TOP_TRIBES_SHOWN): Array<DominationTribeDto & { text: string; width: number; mark: number }> {
  return [...s.topTribes]
    .sort((a, b) => b.points - a.points)
    .slice(0, limit)
    .map((t) => ({ ...t, text: percentText(t.share), width: barWidth(shareProgress(t.share, s.winShare)), mark: 100 }));
}

// ---- World end ------------------------------------------------------------------------------------------------

/** "Ember Wolves [EW] won the world" or, without a winner, "The world has ended". */
export function winnerLine(end: Pick<WorldEndDto, 'winner'>): string {
  return end.winner ? `${end.winner.name} [${end.winner.tag}] won the world` : 'The world has ended';
}

/** The world-end banner text: winner line plus the reason when it adds something. */
export function bannerText(end: Pick<WorldEndDto, 'winner' | 'reason'>): string {
  const reason = end.reason.trim();
  return reason ? `${winnerLine(end)}. ${reason.replace(/\.$/, '')}.` : `${winnerLine(end)}.`;
}

/** "Domination" / "Ended by the operators". */
export function endKindText(kind: WorldEndDto['kind']): string {
  return kind === 'domination' ? 'Won by domination' : 'Ended by the operators';
}

/** At most `FINAL_ROWS` rows, in rank order (ties keep their server order). */
export function finalRows<T extends { rank: number }>(rows: readonly T[], limit = FINAL_ROWS): T[] {
  return [...rows].sort((a, b) => a.rank - b.rank).slice(0, limit);
}

/** "12 villages" / "1 village". */
export function countText(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
