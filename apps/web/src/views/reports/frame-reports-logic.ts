// Pure helpers for the desktop Reports page (FrameReports.tsx): filter groups with unread counts, client-side paging, the row
// outcome label and the carried-of-capacity line of a battle. No React, no I/O.

import { UNITS, UNIT_IDS, normalizeUnits } from '@clanfire/engine';
import type { BattleReportData, ReportSummaryDto, Units } from '@clanfire/engine';

export type ReportFilter = 'all' | 'battles' | 'scouting' | 'support' | 'shipments';

export const REPORT_FILTERS: Array<{ id: ReportFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'battles', label: 'Battles' },
  { id: 'scouting', label: 'Scouting' },
  { id: 'support', label: 'Support' },
  { id: 'shipments', label: 'Shipments' },
];

/** Rows per page of the list (the page never scrolls). */
export const REPORTS_PER_PAGE = 12;

type Kind = Pick<ReportSummaryDto, 'type' | 'side'>;

/** Which chip a report belongs to. Village events (Strike, Hold, Found, Taken) count as battles; battles your stationed troops fought in count as support. */
export function reportFilterOf(r: Kind): Exclude<ReportFilter, 'all'> {
  if (r.type === 'scout') return 'scouting';
  if (r.type === 'shipment') return 'shipments';
  if (r.type === 'support' || (r.type === 'battle' && r.side === 'support')) return 'support';
  return 'battles';
}

export function filterReports<T extends Kind>(list: T[], f: ReportFilter): T[] {
  return f === 'all' ? list : list.filter((r) => reportFilterOf(r) === f);
}

/** Unread count per chip (the "All" chip counts every unread report). */
export function filterCounts(list: Array<Kind & { read: boolean }>): Record<ReportFilter, { total: number; unread: number }> {
  const out: Record<ReportFilter, { total: number; unread: number }> = {
    all: { total: 0, unread: 0 },
    battles: { total: 0, unread: 0 },
    scouting: { total: 0, unread: 0 },
    support: { total: 0, unread: 0 },
    shipments: { total: 0, unread: 0 },
  };
  for (const r of list) {
    for (const k of ['all', reportFilterOf(r)] as const) {
      out[k].total += 1;
      if (!r.read) out[k].unread += 1;
    }
  }
  return out;
}

export interface Paging {
  /** Page actually shown (clamped into range), 0-based. */
  page: number;
  pages: number;
  /** 1-based first and last row shown, 0 when empty. */
  from: number;
  to: number;
  total: number;
}

export function paging(total: number, page: number, perPage = REPORTS_PER_PAGE): Paging {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(0, Math.floor(page) || 0), pages - 1);
  const from = total === 0 ? 0 : p * perPage + 1;
  return { page: p, pages, from, to: Math.min(total, (p + 1) * perPage), total };
}

export function pageSlice<T>(list: T[], page: number, perPage = REPORTS_PER_PAGE): T[] {
  const p = paging(list.length, page, perPage).page;
  return list.slice(p * perPage, (p + 1) * perPage);
}

/** Page (0-based) that holds the report with this id, or -1 when it is not in the list. */
export function pageOf(list: Array<{ id: number }>, id: number | null, perPage = REPORTS_PER_PAGE): number {
  if (id === null) return -1;
  const i = list.findIndex((r) => r.id === id);
  return i < 0 ? -1 : Math.floor(i / perPage);
}

/** What the loot-carrying survivors of the attacking army could take: survivors x each unit's carry (engine config). */
export function carryCapacity(sent: Units, lost: Units): number {
  const a = normalizeUnits(sent);
  const l = normalizeUnits(lost);
  let sum = 0;
  for (const u of UNIT_IDS) sum += Math.max(0, a[u] - l[u]) * UNITS[u].carry;
  return Math.floor(sum);
}

/** "Carried X of Y": only when the report has survivors who could carry and some loot was taken; otherwise null (the line is left out). */
export function carriedLine(b: Pick<BattleReportData, 'attackerUnits' | 'attackerLosses' | 'loot'>): { carried: number; capacity: number; ratio: number } | null {
  const capacity = carryCapacity(b.attackerUnits, b.attackerLosses);
  const carried = b.loot.wood + b.loot.food + b.loot.iron + b.loot.gold;
  if (capacity <= 0 || carried <= 0) return null;
  return { carried, capacity, ratio: Math.max(0, Math.min(1, carried / capacity)) };
}

/** Share of the attack in the head-to-head bar, 0..1 (0.5 when both are 0). */
export function attackShare(attackPower: number, defensePower: number): number {
  const sum = attackPower + defensePower;
  return sum <= 0 ? 0.5 : attackPower / sum;
}

/** Row budget of a forces table: normal rows up to `normal`, compact rows up to `compact`, beyond that the rest goes behind "+N more". */
export function tableDensity(rows: number, normal = 11, compact = 15): { density: 'normal' | 'compact'; shown: number } {
  if (rows <= normal) return { density: 'normal', shown: rows };
  if (rows <= compact) return { density: 'compact', shown: rows };
  return { density: 'compact', shown: compact - 1 };
}

/** The short outcome label of a list row. Shipments: "Received" for goods that came to you, else "Delivered". */
export function rowOutcome(r: ReportSummaryDto): { label: string; tone: 'won' | 'lost' | 'tl' | 'mut' | 'dk' } {
  if (r.type === 'village') return { label: r.won ? 'Good news' : 'Setback', tone: r.won ? 'won' : 'lost' };
  if (r.type === 'shipment') return { label: /^Shipment received/i.test(r.title) ? 'Received' : 'Delivered', tone: 'mut' };
  if (r.type === 'support') return { label: 'Turned back', tone: 'mut' };
  if (r.outcome === 'called_off') return { label: 'Called off', tone: 'mut' };
  if (r.type === 'scout') {
    if (r.side === 'attack') return r.won ? { label: 'Scouted', tone: 'tl' } : { label: 'Failed', tone: 'lost' };
    return r.won ? { label: 'Caught', tone: 'won' } : { label: 'Escaped', tone: 'lost' };
  }
  if (r.side === 'support') return { label: r.won ? 'Held' : 'Overrun', tone: r.won ? 'won' : 'lost' };
  return { label: r.won ? 'Won' : 'Lost', tone: r.won ? 'won' : 'lost' };
}
