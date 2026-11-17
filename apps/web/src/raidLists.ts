// Raid lists (a paid extra): the view-model helpers behind the page. Pure, no React, no I/O. The server is authoritative; these only
// choose what to show and ask for. Validation uses the same engine functions the server runs.

import { MAX_UNIT_COUNT, RAID_LIST_SEND_CAP, UNIT_IDS, checkRaidListName, checkRaidRowUnits } from '@clanfire/engine';
import type { RaidListDto, RaidListRowDto, RaidListSendResponse, RaidRowRequest, RaidSkipReason, UnitId, Units } from '@clanfire/engine';
import { formatDuration, formatInt } from './format.ts';

/** Rows per page: the desktop page (1440 x 900) never scrolls, the phone page is shorter per row. */
export const RAID_ROWS_DESKTOP = 8;
export const RAID_ROWS_PHONE = 5;

/** Rows per page; a tall desktop window shows `extra` more (one per ~56 px of extra height). */
export function rowsPerPage(desktop: boolean, extra = 0): number {
  return desktop ? RAID_ROWS_DESKTOP + Math.max(0, Math.floor(extra)) : RAID_ROWS_PHONE;
}

// ---- Which rows are ticked --------------------------------------------------------------------------------------------------
// Every row starts ticked; the page remembers only the ones the player unticked. A row whose village is no longer abandoned is
// never ticked (the server would skip it anyway).

export function isTicked(row: Pick<RaidListRowDto, 'id' | 'abandoned'>, unticked: ReadonlySet<number>): boolean {
  return row.abandoned && !unticked.has(row.id);
}

export function tickedIds(rows: readonly RaidListRowDto[], unticked: ReadonlySet<number>): number[] {
  return rows.filter((r) => isTicked(r, unticked)).map((r) => r.id);
}

export function toggleTick(unticked: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(unticked);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** "Tick all" empties the set; "Tick none" unticks every row of the list. */
export function tickAll(rows: readonly RaidListRowDto[], on: boolean): Set<number> {
  return on ? new Set() : new Set(rows.map((r) => r.id));
}

/** The label of the one send button. */
export function sendLabel(n: number): string {
  return n === 1 ? 'Send 1 row' : `Send ${n} rows`;
}

/** A note under the send button when more rows are ticked than one press sends, else null. */
export function capNote(n: number, cap = RAID_LIST_SEND_CAP): string | null {
  return n > cap ? `At most ${cap} rows go per press. The first ${cap} are sent; press again for the rest.` : null;
}

// ---- Paging -------------------------------------------------------------------------------------------------------------------

export interface RowPage {
  page: number;
  pages: number;
  from: number;
  to: number;
  total: number;
  rows: RaidListRowDto[];
}

/** One page of rows (0-based `page`, clamped into range). */
export function pageRows(rows: readonly RaidListRowDto[], page: number, perPage: number): RowPage {
  const per = Math.max(1, Math.floor(perPage));
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const p = Math.min(Math.max(0, Math.floor(page) || 0), pages - 1);
  return { page: p, pages, from: rows.length === 0 ? 0 : p * per + 1, to: Math.min(rows.length, (p + 1) * per), total: rows.length, rows: rows.slice(p * per, (p + 1) * per) };
}

// ---- Troops ---------------------------------------------------------------------------------------------------------------------

/** The units a raid row may carry: every unit but the Chieftain (rows are plain raids). */
export const ROW_UNITS: readonly UnitId[] = UNIT_IDS.filter((u) => u !== 'chieftain');

/** Typed counts ("12", "", "3x") to numbers. Anything that is not a whole number is kept as NaN so the check names it. */
export function parseCounts(counts: Partial<Record<UnitId, string>>): Partial<Units> {
  const out: Partial<Units> = {};
  for (const u of UNIT_IDS) {
    const raw = (counts[u] ?? '').trim();
    if (raw === '') continue;
    out[u] = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  }
  return out;
}

/** The counts as the form shows them (blank for zero). */
export function countsFromUnits(units: Partial<Units>): Partial<Record<UnitId, string>> {
  const out: Partial<Record<UnitId, string>> = {};
  for (const u of UNIT_IDS) if ((units[u] ?? 0) > 0) out[u] = String(units[u]);
  return out;
}

/** The units of a row in unit order, zero entries dropped. */
export function unitEntries(units: Partial<Units>): Array<{ unit: UnitId; count: number }> {
  return UNIT_IDS.filter((u) => (units[u] ?? 0) > 0).map((u) => ({ unit: u, count: units[u] ?? 0 }));
}

export type NewRowCheck = { ok: true; body: RaidRowRequest } | { ok: false; message: string };

const COORD_MAX = 9_999_999;

function whole(text: string): number | null {
  const t = text.trim();
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && Math.abs(n) <= COORD_MAX ? n : null;
}

/** Checks the "Add village" form before it is sent (the server checks again, and also that an abandoned village stands there). */
export function checkNewRow(input: { x: string; y: string; fromVillageId: number | null; counts: Partial<Record<UnitId, string>> }): NewRowCheck {
  const x = whole(input.x);
  const y = whole(input.y);
  if (x === null || y === null) return { ok: false, message: 'Type the x and y coordinates of the village as whole numbers.' };
  if (input.fromVillageId === null) return { ok: false, message: 'Choose the village the troops leave from.' };
  const units = checkRaidRowUnits(parseCounts(input.counts));
  if (!units.ok) return units;
  return { ok: true, body: { x, y, fromVillageId: input.fromVillageId, units: units.units } };
}

/** The list name check for "+ New list" and rename (the same function the server runs). */
export function checkListName(name: string): { ok: true; name: string } | { ok: false; message: string } {
  return checkRaidListName(name);
}

// ---- Row facts ----------------------------------------------------------------------------------------------------------------

/** One-way travel: "12m 04s". */
export function travelText(seconds: number): string {
  return formatDuration(seconds * 1000);
}

/** "Won, 340 loot · 3h ago", "Lost · 2d ago" or "Never raided". */
export function lastText(last: RaidListRowDto['last'], now: number): string {
  if (!last) return 'Never raided';
  const diff = Math.max(0, now - last.at);
  const age = diff < 45_000 ? 'now' : diff < 3_600_000 ? `${Math.max(1, Math.round(diff / 60_000))}m ago` : diff < 86_400_000 ? `${Math.floor(diff / 3_600_000)}h ago` : `${Math.floor(diff / 86_400_000)}d ago`;
  const what = last.won ? (last.loot > 0 ? `Won, ${formatInt(last.loot)} loot` : 'Won, nothing taken') : 'Lost';
  return `${what} · ${age}`;
}

// ---- The result of one send -----------------------------------------------------------------------------------------------

const REASON_TEXT: Record<RaidSkipReason, string> = {
  not_enough_troops: 'Not enough troops at home in the sending village.',
  target_protected: 'The village is still under protection.',
  not_abandoned: 'It now belongs to a player. Remove this row.',
  invalid_target: 'There is no village to raid at these coordinates.',
  march_limit: 'The sending village already has the most marches out it can have.',
  press_cap: 'Over the limit for one press. It waits for the next press.',
  rate_limited: 'Too many sends in a short time. Try again in a moment.',
  village_gone: 'The sending village is not yours any more.',
  other: 'The server did not send this row.',
};

/** The plain reason for a skipped row: the server's own message when it gave one, else a sentence for the code. */
export function reasonText(reason: RaidSkipReason | undefined, message: string | undefined, cap = RAID_LIST_SEND_CAP): string {
  if (reason === 'press_cap') return `Over the limit of ${cap} rows per press. It waits for the next press.`;
  const m = message?.trim();
  if (m) return m;
  return REASON_TEXT[reason ?? 'other'] ?? REASON_TEXT.other;
}

export interface SendSummary {
  sent: number;
  skipped: number;
  /** "14 of 16 rows sent." */
  headline: string;
  /** Every skipped row with its plain reason (names from the list the rows belong to; "Row 12" when it is gone). */
  skippedRows: Array<{ rowId: number; name: string; coords: string | null; text: string }>;
  /** Set when a row was held back by the per-press limit. */
  capNote: string | null;
}

/** The numbers and the skipped rows of a send response, ready to show. */
export function summarizeSend(res: RaidListSendResponse, list: Pick<RaidListDto, 'rows'> | null, cap = RAID_LIST_SEND_CAP): SendSummary {
  const total = res.results.length;
  const byId = new Map((list?.rows ?? []).map((r) => [r.id, r] as const));
  const skippedRows = res.results
    .filter((r) => !r.ok)
    .map((r) => {
      const row = byId.get(r.rowId);
      return { rowId: r.rowId, name: row?.name ?? `Row ${r.rowId}`, coords: row ? `${row.x}|${row.y}` : null, text: reasonText(r.reason, r.message, cap) };
    });
  const headline = total === 0 ? 'Nothing was sent.' : `${res.sent} of ${total} ${total === 1 ? 'row' : 'rows'} sent.`;
  const capped = res.results.some((r) => !r.ok && r.reason === 'press_cap');
  return { sent: res.sent, skipped: res.skipped, headline, skippedRows, capNote: capped ? `At most ${cap} rows go per press. Press again for the rest.` : null };
}

/** The most skipped rows the desktop page lists before "+N more" (the page never scrolls). */
export const SKIPPED_SHOWN_DESKTOP = 4;

export { MAX_UNIT_COUNT, RAID_LIST_SEND_CAP };
