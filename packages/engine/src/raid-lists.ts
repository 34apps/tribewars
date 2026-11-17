// Raid lists (a paid extra, convenience only) and "raid again": the validation and small rules shared by the server (authoritative)
// and the client (form checks). Nothing here changes a battle rule, a price or a speed: a list row is an ordinary attack on an
// abandoned village, sent through the normal send route with every check it has.

import { MAX_UNIT_COUNT } from './config.ts';
import { UNIT_IDS, type UnitId, type Units } from './types.ts';

/** Lists one player may keep. */
export const RAID_LIST_MAX_LISTS = 5;
/** Rows (villages) in one list. */
export const RAID_LIST_MAX_ROWS = 30;
/** Most rows one press of "Send all" tries; the rest wait for the next press. Every row is still a normal send (march cap, rate limit). */
export const RAID_LIST_SEND_CAP = 20;
export const RAID_LIST_NAME_MAX = 30;

/** Bits of `players.premium` (the old column, unused since the premium queue was removed). A world with the switch off ignores them. */
export const EXTRA_RAID_LISTS = 1;

/** Does this `premium` value carry the raid-list extra? */
export function hasRaidListsExtra(premium: number): boolean {
  return Number.isInteger(premium) && premium > 0 && (premium & EXTRA_RAID_LISTS) !== 0;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export type RaidListNameCheck = { ok: true; name: string } | { ok: false; message: string };

/** A list name: trimmed, 1..RAID_LIST_NAME_MAX characters, no control characters. */
export function checkRaidListName(name: unknown): RaidListNameCheck {
  if (typeof name !== 'string') return { ok: false, message: 'Give the list a name.' };
  const trimmed = name.trim();
  if ([...trimmed].length < 1) return { ok: false, message: 'Give the list a name.' };
  if ([...trimmed].length > RAID_LIST_NAME_MAX) return { ok: false, message: `The name can be at most ${RAID_LIST_NAME_MAX} characters.` };
  if (CONTROL_CHARS.test(trimmed)) return { ok: false, message: 'The name contains characters that are not allowed.' };
  return { ok: true, name: trimmed };
}

export type RaidRowUnitsCheck = { ok: true; units: Partial<Units> } | { ok: false; message: string };

/** The troops of a list row: known unit ids, whole counts 0..MAX_UNIT_COUNT, at least one above zero; no Chieftains (rows are plain raids). Zero entries dropped. */
export function checkRaidRowUnits(units: unknown): RaidRowUnitsCheck {
  if (typeof units !== 'object' || units === null || Array.isArray(units)) return { ok: false, message: 'Pick some troops for this village.' };
  const out: Partial<Units> = {};
  let total = 0;
  for (const [key, value] of Object.entries(units as Record<string, unknown>)) {
    if (!(UNIT_IDS as readonly string[]).includes(key)) return { ok: false, message: `Unknown unit "${key.slice(0, 24)}".` };
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_UNIT_COUNT) {
      return { ok: false, message: `Troop counts are whole numbers from 0 to ${MAX_UNIT_COUNT}.` };
    }
    if (value > 0) {
      out[key as UnitId] = value;
      total += value;
    }
  }
  if (total <= 0) return { ok: false, message: 'Pick some troops for this village.' };
  if ((out.chieftain ?? 0) > 0) return { ok: false, message: 'Chieftains cannot go on a raid list.' };
  const ordered: Partial<Units> = {};
  for (const u of UNIT_IDS) if (out[u] !== undefined) ordered[u] = out[u];
  return { ok: true, units: ordered };
}

export interface SendAgainPlan {
  /** What can go now: min(wanted, home) per unit, zero entries dropped. */
  send: Partial<Units>;
  /** What is short: wanted - home, only units that are short. */
  missing: Partial<Units>;
  /** Nothing is missing: the original army can go as it was. */
  complete: boolean;
  /** Nothing at all can go. */
  empty: boolean;
}

/**
 * "Raid again": compare the troops of the earlier march with what stands at home now. The client uses it to say what is missing and
 * to offer the rest; the server still runs every normal send check on whatever is sent.
 */
export function planSendAgain(wanted: Partial<Units>, home: Partial<Units>): SendAgainPlan {
  const send: Partial<Units> = {};
  const missing: Partial<Units> = {};
  for (const u of UNIT_IDS) {
    const want = wanted[u] ?? 0;
    if (want <= 0) continue;
    const raw = Math.floor(home[u] ?? 0);
    const have = Number.isFinite(raw) && raw > 0 ? raw : 0;
    if (have > 0) send[u] = Math.min(want, have);
    if (have < want) missing[u] = want - have;
  }
  return { send, missing, complete: Object.keys(missing).length === 0, empty: Object.keys(send).length === 0 };
}
