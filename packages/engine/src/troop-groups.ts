// Saved troop groups: the validation shared by the server (authoritative) and the client (form checks).
// A group is only a saved set of unit counts for the send form; it grants nothing and changes no rule.

import { MAX_UNIT_COUNT, TROOP_GROUP_NAME_MAX } from './config.ts';
import { UNIT_IDS, type UnitId, type Units } from './types.ts';

export type TroopGroupCheck =
  | { ok: true; name: string; units: Partial<Units> }
  | { ok: false; message: string };

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * Check a group name and unit map. The name is trimmed (1..TROOP_GROUP_NAME_MAX characters, no control characters).
 * Units: only known unit ids, integer counts 0..MAX_UNIT_COUNT, at least one above zero. Zero entries are dropped from the result.
 */
export function checkTroopGroup(name: unknown, units: unknown): TroopGroupCheck {
  if (typeof name !== 'string') return { ok: false, message: 'Give the group a name.' };
  const trimmed = name.trim();
  if (trimmed.length < 1) return { ok: false, message: 'Give the group a name.' };
  if ([...trimmed].length > TROOP_GROUP_NAME_MAX) return { ok: false, message: `The name can be at most ${TROOP_GROUP_NAME_MAX} characters.` };
  if (CONTROL_CHARS.test(trimmed)) return { ok: false, message: 'The name contains characters that are not allowed.' };
  if (typeof units !== 'object' || units === null || Array.isArray(units)) return { ok: false, message: 'Pick some troops for the group.' };
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
  if (total <= 0) return { ok: false, message: 'Pick some troops for the group.' };
  // Stable key order so stored and compared groups look the same.
  const ordered: Partial<Units> = {};
  for (const u of UNIT_IDS) if (out[u] !== undefined) ordered[u] = out[u];
  return { ok: true, name: trimmed, units: ordered };
}
