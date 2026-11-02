// Number, duration and time formatting shared by all screens.

const intFormat = new Intl.NumberFormat();
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Whole number with thousands separators (rounds down, like resources shown to players). */
export function formatInt(n: number): string {
  return intFormat.format(Math.floor(n + 1e-9));
}

/** 1,234 -> "1,234"; 12,345 -> "12.3k"; 1,234,567 -> "1.23M". */
export function formatCompact(n: number): string {
  const v = Math.floor(n + 1e-9);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  if (abs >= 10_000) return `${(v / 1000).toFixed(abs >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return intFormat.format(v);
}

/** Per-hour rate with explicit sign: "+35/h", "−12/h". */
export function formatRate(perHour: number): string {
  const r = Math.round(perHour);
  return `${r < 0 ? '−' : '+'}${formatCompact(Math.abs(r))}/h`;
}

/** Countdown / duration: "45s", "4m 05s", "1:02:03", "2d 03:04:05". Rounds up so it never reads 0 early. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '–';
  const total = Math.max(0, Math.ceil(ms / 1000 - 1e-9));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
  if (m > 0) return `${m}m ${pad2(s)}s`;
  return `${s}s`;
}

/** Coarse "time left": "2d 5h", "5h 12m", "12m", "45s". */
export function formatLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Wall-clock time of `ts`; adds the day when it is not today. `now` is server-corrected time. */
export function formatClock(ts: number, now: number): string {
  const d = new Date(ts);
  const today = new Date(now);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (sameDay(d, today)) return time;
  const tomorrow = new Date(now + 86_400_000);
  if (sameDay(d, tomorrow)) return `tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

/** "just now", "5m ago", "3h ago", or a date. */
export function formatAgo(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  if (diff < 45_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export const formatCoords = (x: number, y: number): string => `${x}|${y}`;

/** "+3.2%" / "−1.0%" from a fraction. */
export function formatSignedPercent(fraction: number): string {
  const p = Math.round(fraction * 1000) / 10;
  return `${p < 0 ? '−' : '+'}${Math.abs(p).toFixed(1)}%`;
}

const timeHm = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });
const weekdayShort = new Intl.DateTimeFormat([], { weekday: 'short' });
const dayMonth = new Intl.DateTimeFormat([], { day: 'numeric', month: 'short' });

/** Chat time: "14:05" today, "Mon 14:05" within a week, else "12 Oct 14:05". `now` is server-corrected time. */
export function formatChatTime(ts: number, now: number): string {
  const d = new Date(ts);
  const time = timeHm.format(d);
  if (sameDay(d, new Date(now))) return time;
  if (now - ts < 6 * 86_400_000) return `${weekdayShort.format(d)} ${time}`;
  return `${dayMonth.format(d)} ${time}`;
}

/** "12 Oct 2026" style date. */
export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}
