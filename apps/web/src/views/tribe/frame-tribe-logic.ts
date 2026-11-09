// Pure helpers for the desktop Tribe page (FrameTribe.tsx): the Overview's summary lines, the alert detail line, the latest
// forum threads across boards, the header's recruitment line and the members table's ordering and short dates.

import type { DiplomacyKind, ForumThreadSummaryDto, Recruitment, TribeAlertDto, TribeMemberDto, TribeProjectId, TribeRelationDto, UnitId } from '@clanfire/engine';

export const MEMBERS_PER_PAGE = 10;
/** Alert rows the Overview shows before "+N more" (what fits the 900 px frame). */
export const OVERVIEW_ALERTS = 3;
export const OVERVIEW_THREADS = 5;
export const OVERVIEW_CHAT = 6;

export const RECRUITMENT_LINE: Record<Recruitment, string> = {
  open: 'Open recruitment',
  application: 'Recruitment by application',
  invite: 'Invitation only',
};

const KIND_WORD: Record<DiplomacyKind, string> = { ally: 'ally', nap: 'non-aggression', enemy: 'enemy' };
const KIND_ORDER: DiplomacyKind[] = ['ally', 'nap', 'enemy'];

/** "1 ally · 1 non-aggression · 1 enemy"; "2 allies", "2 enemies"; "no relations yet" when empty. */
export function diplomacyLine(relations: Pick<TribeRelationDto, 'kind'>[], waitingProposals = 0): string {
  const parts: string[] = [];
  for (const k of KIND_ORDER) {
    const n = relations.filter((r) => r.kind === k).length;
    if (n === 0) continue;
    const word = n === 1 ? KIND_WORD[k] : k === 'ally' ? 'allies' : k === 'enemy' ? 'enemies' : 'non-aggression';
    parts.push(`${n} ${word}`);
  }
  if (waitingProposals > 0) parts.push(`${waitingProposals} ${waitingProposals === 1 ? 'proposal' : 'proposals'} waiting`);
  return parts.length > 0 ? parts.join(' · ') : 'no relations yet';
}

const PROJECT_NAME: Record<TribeProjectId, string> = { roads: 'Roads', watchtower: 'Watchtower', wards: 'Wards' };
const PROJECT_ORDER: TribeProjectId[] = ['roads', 'watchtower', 'wards'];

/** "building Watchtower 3 · 31:12:00 left" while one runs (`left` already formatted), else the finished levels, else a hint. */
export function projectsLine(running: { project: TribeProjectId; level: number } | null, left: string, levels: Partial<Record<TribeProjectId, number>> | undefined): string {
  if (running) return `building ${PROJECT_NAME[running.project]} ${running.level} · ${left} left`;
  const done = PROJECT_ORDER.filter((p) => (levels?.[p] ?? 0) > 0).map((p) => `${PROJECT_NAME[p]} ${levels?.[p]}`);
  return done.length > 0 ? `nothing running · ${done.join(' · ')}` : 'nothing built yet';
}

/** The member with the most points (ties: first by name), or null for an empty list. */
export function topMember<T extends Pick<TribeMemberDto, 'username' | 'points'>>(list: T[]): T | null {
  let best: T | null = null;
  for (const m of list) if (!best || m.points > best.points || (m.points === best.points && m.username.localeCompare(best.username) < 0)) best = m;
  return best;
}

/** What the Watchtower shows about an attack, as one short phrase ("medium, Log Rams", "small ~120, Raiders"), or '' when it shows nothing. */
export function alertDetail(a: Pick<TribeAlertDto, 'sizeBand' | 'sizeAbout' | 'slowestUnit'>, unitName: (u: UnitId) => string): string {
  const size = a.sizeBand ? `${a.sizeBand}${a.sizeAbout !== undefined && a.sizeAbout > 0 ? ` ~${a.sizeAbout.toLocaleString('en-US')}` : ''}` : '';
  const unit = a.slowestUnit ? unitName(a.slowestUnit) : '';
  return [size, unit].filter(Boolean).join(', ');
}

/** The newest threads over all boards, by last post. Threads seen twice are listed once. */
export function latestThreads(threads: ForumThreadSummaryDto[], n = OVERVIEW_THREADS): ForumThreadSummaryDto[] {
  const seen = new Set<number>();
  return [...threads]
    .sort((a, b) => b.lastPostAt - a.lastPostAt || b.id - a.id)
    .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
    .slice(0, n);
}

/** "5 Oct" (no year): the members table. */
export function shortDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Members by points, then name. */
export function sortMembers<T extends Pick<TribeMemberDto, 'username' | 'points'>>(list: T[]): T[] {
  return [...list].sort((a, b) => b.points - a.points || a.username.localeCompare(b.username));
}

/** The member row for the side panel: the picked one if still there, else the first the viewer can manage, else the first. */
export function pickedMember<T extends { playerId: number }>(list: T[], picked: number | null, manageable: (m: T) => boolean): T | null {
  return list.find((m) => m.playerId === picked) ?? list.find(manageable) ?? list[0] ?? null;
}

/** "31:12:00": hours (not wrapped into days), minutes, seconds; rounds up like the other countdowns. */
export function formatHms(ms: number): string {
  if (!Number.isFinite(ms)) return '–';
  const total = Math.max(0, Math.ceil(ms / 1000 - 1e-9));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
