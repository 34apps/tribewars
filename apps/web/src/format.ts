// Number, duration and time formatting shared by all screens.

const intFormat = new Intl.NumberFormat();
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Whole number with thousands separators (rounds down, like resources shown to players). */
export function formatInt(n: number): string {
  return intFormat.format(Math.floor(n + 1e-9));
}

/** `abs / unit` rounded DOWN to `decimals` places, as a plain string ("48.2", "999", "1.91"): no trailing zeros, no rounding up. */
function floorScaled(abs: number, unit: number, decimals: number): string {
  const f = 10 ** decimals;
  return String(Math.floor((abs / unit) * f + 1e-9) / f);
}

/**
 * Big numbers shortened, always rounded DOWN so "999k" never turns into "1000k":
 * 2,935 -> "2,935"; 48,250 -> "48.2k"; 999,999 -> "999k"; 1,912,345 -> "1.91M"; 12,400,000 -> "12.4M"; 125M; 1.23B.
 */
export function formatCompact(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.floor(Math.abs(n) + 1e-9);
  if (abs < 10_000) return sign + intFormat.format(abs);
  if (abs < 100_000) return `${sign}${floorScaled(abs, 1e3, 1)}k`;
  if (abs < 1_000_000) return `${sign}${floorScaled(abs, 1e3, 0)}k`;
  if (abs < 1e9) return `${sign}${floorScaled(abs, 1e6, abs < 1e7 ? 2 : abs < 1e8 ? 1 : 0)}M`;
  return `${sign}${floorScaled(abs, 1e9, abs < 1e10 ? 2 : abs < 1e11 ? 1 : 0)}B`;
}

/** The phone-pill form: at most 4 glyphs (the comma does not count). 2,935 -> "2,935"; 48,250 -> "48k"; 1,912,345 -> "1.9M"; 125M. */
export function formatCompactShort(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.floor(Math.abs(n) + 1e-9);
  if (abs < 10_000) return sign + intFormat.format(abs);
  if (abs < 1_000_000) return `${sign}${floorScaled(abs, 1e3, 0)}k`;
  if (abs < 1e9) return `${sign}${floorScaled(abs, 1e6, abs < 1e7 ? 1 : 0)}M`;
  return `${sign}${floorScaled(abs, 1e9, abs < 1e10 ? 1 : 0)}B`;
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

/** One unit only, for tight tags: "2d", "23h", "45m", "30s" (the largest whole unit; the full time goes in the tooltip). */
export function formatLeftShort(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total >= 86400) return `${Math.floor(total / 86400)}d`;
  if (total >= 3600) return `${Math.floor(total / 3600)}h`;
  if (total >= 60) return `${Math.floor(total / 60)}m`;
  return `${total}s`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Wall-clock time of `ts` and, when it is not today, its day ("tomorrow", "Thu 12 Nov"; '' for today). */
export function formatClockParts(ts: number, now: number): { time: string; day: string } {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  if (sameDay(d, new Date(now))) return { time, day: '' };
  if (sameDay(d, new Date(now + 86_400_000))) return { time, day: 'tomorrow' };
  return { time, day: d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) };
}

/** Wall-clock time of `ts`; adds the day when it is not today. `now` is server-corrected time. */
export function formatClock(ts: number, now: number): string {
  const { time, day } = formatClockParts(ts, now);
  if (day === '') return time;
  return day === 'tomorrow' ? `tomorrow ${time}` : `${day} ${time}`;
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

/** The coordinate tag of the phone village tab: "−9 | 24" (true minus sign, spaces around the bar). */
export const formatCoordsTag = (x: number, y: number): string => `${x < 0 ? '−' : ''}${Math.abs(x)} | ${y < 0 ? '−' : ''}${Math.abs(y)}`;

/** "+3.2%" / "−1.0%" from a fraction. */
export function formatSignedPercent(fraction: number): string {
  const p = Math.round(fraction * 1000) / 10;
  return `${p < 0 ? '−' : '+'}${Math.abs(p).toFixed(1)}%`;
}

const timeHm = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
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
