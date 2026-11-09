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

// ---- The seven other sub-tabs (pictures mix-tribe-{alerts,diplomacy,projects,recruit,chat,forum,log}-1440) ----

/** Rows per page where a list must fit the fixed 900 px frame (nothing scrolls inside a panel). */
export const ALERTS_PER_PAGE = 4;
export const HOLDS_PER_PAGE = 2;
export const RELATIONS_PER_PAGE = 6;
export const PROPOSALS_PER_PAGE = 2;
export const APPLICATIONS_PER_PAGE = 5;
export const INVITES_PER_PAGE = 5;
export const THREADS_PER_PAGE = 6;
export const LOG_PER_PAGE = 11;
export const LEDGER_TOTALS_SHOWN = 6;
export const LEDGER_LATEST_SHOWN = 3;

const KIND_SECTION: Record<DiplomacyKind, string> = { ally: 'Allies', nap: 'Non-aggression', enemy: 'Enemies' };

/** Relations in the order allies, non-aggression, enemies (each group keeps its given order). */
export function sortRelations<T extends Pick<TribeRelationDto, 'kind'>>(list: T[]): T[] {
  return KIND_ORDER.flatMap((k) => list.filter((r) => r.kind === k));
}

/** The section heading a relation row starts ("Allies", ...), or null when the previous row has the same kind. */
export function relationSection(list: Pick<TribeRelationDto, 'kind'>[], i: number): string | null {
  const cur = list[i];
  if (!cur) return null;
  return i === 0 || list[i - 1]?.kind !== cur.kind ? KIND_SECTION[cur.kind] : null;
}

/** The Watchtower's three levels as the lines of the info panel; `on` = the level is built. */
export function watchtowerSteps(level: number): Array<{ n: number; text: string; on: boolean }> {
  const text = ['Rough size of the army: small, medium, large or huge', 'Its slowest unit, so you know when it lands', 'About how many troops, rounded'];
  return text.map((t, i) => ({ n: i + 1, text: t, on: level >= i + 1 }));
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today 15:05", "Yesterday 22:10", "7 Nov 20:15" (24-hour clock, local time): the log and the forum posts. */
export function logTime(ts: number, now: number): string {
  const d = new Date(ts);
  const today = new Date(now);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (sameDay(d, today)) return `Today ${hm}`;
  if (sameDay(d, new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 12))) return `Yesterday ${hm}`;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hm}`;
}

/** "[ASH] Ashen Pact". */
export const tribeTagName = (o: { tag: string; name: string }) => `[${o.tag}] ${o.name}`;

/** Whether a scrolling list sits at (or within `slack` px of) its end. */
export function atEnd(el: { scrollHeight: number; scrollTop: number; clientHeight: number }, slack = 48): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < slack;
}

/** The thread list's page: which of the loaded threads to show, and whether a next page exists (loaded or still on the server). */
export function threadPaging(loaded: number, page: number, serverHasMore: boolean, perPage = THREADS_PER_PAGE): { page: number; from: number; to: number; hasNext: boolean; needsFetch: boolean } {
  const pages = Math.max(1, Math.ceil(loaded / perPage));
  const p = Math.min(Math.max(0, page), pages - 1);
  const to = Math.min(loaded, (p + 1) * perPage);
  const moreLoaded = p < pages - 1;
  return { page: p, from: loaded === 0 ? 0 : p * perPage + 1, to, hasNext: moreLoaded || serverHasMore, needsFetch: !moreLoaded && serverHasMore };
}

/** "15:23" today, else "Tue 15:23" (24-hour clock): when an attack lands. */
export function landsAt(ts: number, now: number): string {
  const d = new Date(ts);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return sameDay(d, new Date(now)) ? hm : `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${hm}`;
}

/** "14:02" today, else "7 Nov 14:02" (24-hour clock): the time next to a chat message. */
export function chatClock(ts: number, now: number): string {
  const d = new Date(ts);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return sameDay(d, new Date(now)) ? hm : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hm}`;
}
