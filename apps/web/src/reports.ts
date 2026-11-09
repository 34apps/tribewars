// Pure helpers for the Reports list: a short one-line title, the coordinates split off, a compact age and day groups.

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
