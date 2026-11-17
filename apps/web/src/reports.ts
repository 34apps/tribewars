// Pure helpers for the Reports list: a short one-line title, the coordinates split off, a compact age and day groups, and the
// "what happened" headline built from the title, the side, the outcome and the report digest.

import type { ReportSummaryDto } from '@clanfire/engine';
import { formatInt } from './format.ts';

export interface ReportLine {
  /** Short sentence, e.g. "Tolvek attacked" or "You raided Hillfort". */
  text: string;
  /** "(12|-40)" without brackets, or null. */
  coords: string | null;
}

const COORDS = /\(\s*(-?\d+)\s*\|\s*(-?\d+)\s*\)/;

/** One-line title from the server's report title ("Raid on X (1|2)" becomes "You raided X"); coordinates come back separately. */
export function reportLine(title: string): ReportLine {
  const m = COORDS.exec(title);
  const coords = m ? `${m[1]}|${m[2]}` : null;
  const base = (m ? title.replace(COORDS, '') : title).replace(/\s+/g, ' ').replace(/\s+([:,.])/g, '$1').trim();
  const rules: Array<[RegExp, (g: string[]) => string]> = [
    [/^Raid on (.+)$/, (g) => `You raided ${g[1]}`],
    [/^Attack from (.+)$/, (g) => `${g[1]} attacked`],
    [/^Your troops at (.+) were attacked$/, (g) => `Support at ${g[1]} attacked`],
    [/^Relief attack at (.+?)(?: from .+)?$/, (g) => `Relief at ${g[1]}`],
    [/^Scouting (.+)$/, (g) => `You scouted ${g[1]}`],
    [/^Enemy scouts from (.+)$/, (g) => `Scouts from ${g[1]}`],
    [/^Support for (.+?) turned back(?::.*)?$/, (g) => `Support for ${g[1]} turned back`],
    [/^Shipment delivered to (.+)$/, (g) => `You sent goods to ${g[1]}`],
    [/^Shipment received from (.+)$/, (g) => `Goods from ${g[1]}`],
  ];
  // Default village names are "<owner>'s village": the owner's name alone reads better in a list.
  const short = (name: string): string => /^.+'s village$/.test(name) ? name.replace(/'s village$/, '') : name;
  for (const [re, make] of rules) {
    const g = re.exec(base);
    if (g) return { text: make(g.map((x, i) => (i === 0 ? x : short(x)))), coords };
  }
  return { text: base, coords };
}

/** "now", "5m", "4h", "3d", then a short date. */
export function formatShortAgo(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  if (diff < 45_000) return 'now';
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export type DayGroup = 'today' | 'yesterday' | 'earlier';
export const DAY_GROUP_LABEL: Record<DayGroup, string> = { today: 'Today', yesterday: 'Yesterday', earlier: 'Earlier' };

/** Which local calendar day `ts` falls on, relative to `now`. */
export function dayGroup(ts: number, now: number): DayGroup {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  if (ts >= today) return 'today';
  start.setDate(start.getDate() - 1);
  return ts >= start.getTime() ? 'yesterday' : 'earlier';
}

/** Keeps the incoming order; only non-empty groups. */
export function groupByDay<T extends { createdAt: number }>(items: T[], now: number): Array<{ group: DayGroup; items: T[] }> {
  const out: Array<{ group: DayGroup; items: T[] }> = [];
  for (const g of ['today', 'yesterday', 'earlier'] as const) {
    const these = items.filter((i) => dayGroup(i.createdAt, now) === g);
    if (these.length > 0) out.push({ group: g, items: these });
  }
  return out;
}

// ---- Headline: what happened at a glance ---------------------------------------------------------------------------------

export type HeadlineInput = Pick<ReportSummaryDto, 'title' | 'side' | 'type' | 'won' | 'outcome' | 'digest'>;

export interface ReportHeadline {
  /** "Raided Hillfort", "Tolvek attacked you", "Scouts caught at Oak". Never carries the coordinates. */
  title: string;
  /** "12|-4" without brackets, or null. */
  coords: string | null;
  /** The result in one word: "won", "held", "seen" ... null when the headline says it already or nothing is known. */
  outcome: string | null;
  /** Numbers that go with it: "340 loot", "lost 3 of 120". The loot figure comes first. */
  figures: string[];
  /** Loot carried home or taken, or null when the report has no loot figure (not a battle, or no digest). */
  loot: number | null;
}

/** "lost 3 of 120" for your own marching troops; "lost 12" (no total) for the defending side, where the force is a mix. */
const lostFigure = (lost: number | null, sent: number | null, withTotal = true): string | null => {
  if (lost === null) return null;
  if (lost <= 0) return 'no losses';
  return withTotal && sent !== null && sent >= lost ? `lost ${formatInt(lost)} of ${formatInt(sent)}` : `lost ${formatInt(lost)}`;
};

const shortName = (name: string): string => (/^.+'s village$/.test(name) ? name.replace(/'s village$/, '') : name);
const named = (title: string, re: RegExp): string | null => {
  const m = COORDS.exec(title);
  const base = (m ? title.replace(COORDS, '') : title).replace(/\s+/g, ' ').replace(/\s+([:,.])/g, '$1').trim();
  const g = re.exec(base);
  return g ? shortName(g[1] ?? '') : null;
};

/**
 * One headline for a list row and the open report: "Raided Hillfort (12|-4) - won, 340 loot, lost 3 of 120". Needs the digest the
 * server adds to a report; a report without one (an older server, shipments, village events) keeps the plain `reportLine` text.
 */
export function reportHeadline(r: HeadlineInput): ReportHeadline {
  const line = reportLine(r.title);
  const plain: ReportHeadline = { title: line.text, coords: line.coords, outcome: null, figures: [], loot: null };
  const d = r.digest;
  if (!d || r.type === 'shipment' || r.type === 'village') return plain;
  const loot = d.loot;
  const lost = lostFigure(d.lost, d.sent);
  const lootFigure = loot > 0 ? `${formatInt(loot)} loot` : 'nothing taken';

  if (r.type === 'scout') {
    if (r.side === 'attack') {
      const target = named(r.title, /^Scouting (.+)$/);
      if (target === null) return plain;
      const lostScouts = d.lost !== null && d.lost > 0 ? lostFigure(d.lost, d.sent) : null;
      if (r.won) return { ...plain, title: `Scouted ${target}`, outcome: 'seen', figures: lostScouts ? [lostScouts] : [] };
      return { ...plain, title: `Scouts caught at ${target}`, outcome: null, figures: lost ? [lost] : [] };
    }
    const from = named(r.title, /^Enemy scouts from (.+)$/);
    if (from === null) return plain;
    return { ...plain, title: `Scouts from ${from}`, outcome: r.won ? 'caught' : 'not caught' };
  }

  if (r.type === 'support') {
    const m = /turned back(?::\s*(.+))?$/.exec(r.title);
    return m?.[1] ? { ...plain, outcome: m[1].trim() } : plain;
  }

  if (r.type !== 'battle') return plain;

  if (r.outcome === 'called_off') {
    const target = named(r.title, /^Attack on (.+?)(?: called off.*)?$/);
    const why = /called off:\s*(.+)$/.exec(r.title)?.[1]?.trim();
    if (target === null) return plain;
    return { ...plain, title: `Attack on ${target} called off`, outcome: why ?? 'no losses, no loot' };
  }

  if (r.side === 'attack') {
    const target = named(r.title, /^Raid on (.+)$/);
    if (target === null) return plain;
    if (r.won) {
      return { ...plain, title: `Raided ${target}`, outcome: 'won', figures: [lootFigure, ...(lost ? [lost] : [])], loot };
    }
    return { ...plain, title: `Raid on ${target} lost`, outcome: null, figures: lost ? [lost] : [], loot: 0 };
  }

  if (r.side === 'defense') {
    const lostOnly = lostFigure(d.lost, d.sent, false);
    const from = named(r.title, /^Attack from (.+)$/);
    if (from === null) return plain;
    if (r.won) return { ...plain, title: `${from} attacked you`, outcome: 'held', figures: lostOnly ? [lostOnly] : [], loot: 0 };
    return { ...plain, title: `${from} attacked you`, outcome: 'lost', figures: [loot > 0 ? `they took ${formatInt(loot)}` : 'nothing taken'], loot };
  }

  if (r.side === 'support') {
    const lostOnly = lostFigure(d.lost, d.sent, false);
    return { ...plain, outcome: r.won ? 'held' : 'overrun', figures: lostOnly ? [lostOnly] : [] };
  }
  return plain;
}

/** The headline as one sentence: "Raided Hillfort (12|-4) \u2014 won, 340 loot, lost 3 of 120". */
export function reportSentence(h: ReportHeadline): string {
  const head = h.coords ? `${h.title} (${h.coords})` : h.title;
  const tail = [h.outcome, ...h.figures].filter((x): x is string => !!x).join(', ');
  return tail ? `${head} \u2014 ${tail}` : head;
}

/** The part a list row shows under the title (the Won / Lost tag already says the outcome): "340 loot, lost 3 of 120". */
export function reportFigures(h: ReportHeadline): string {
  return h.figures.join(' \u00b7 ');
}

/** The result line under an open report's title: "Won, 340 loot, lost 3 of 120" (empty when nothing is known). */
export function reportResultLine(h: ReportHeadline): string {
  const text = [h.outcome, ...h.figures].filter((x): x is string => !!x).join(', ');
  return text === '' ? '' : text.charAt(0).toUpperCase() + text.slice(1);
}
