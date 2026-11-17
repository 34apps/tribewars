// Pure helpers for private notes and tags (no React, no I/O): map keys, lookup by coordinates and by owner name, the Notes page
// filter and sort, the form check, and readable error text. The rules (limits, tag set, checkNote) live in the engine (notes.ts).

import { NOTES_PER_PLAYER_MAX, NOTE_TAGS, checkNote } from '@clanfire/engine';
import type { NoteCheck, NoteDto, NoteTag, NoteTargetKind } from '@clanfire/engine';

export type NoteKind = NoteTargetKind;

/** "village:12" / "player:7": how the client files a note. */
export function noteKey(kind: NoteKind, targetId: number): string {
  return `${kind}:${targetId}`;
}

/** Key of a village tile for the report lookup: "3|-4". */
export function coordKey(x: number, y: number): string {
  return `${x}|${y}`;
}

export interface NoteIndex {
  byKey: Map<string, NoteDto>;
  /** Village notes by their tile (a report title only carries coordinates). */
  byCoords: Map<string, NoteDto>;
  /** Player notes by lower-cased player name (the map only carries the owner's name). */
  byPlayerName: Map<string, NoteDto>;
}

export function indexNotes(notes: readonly NoteDto[]): NoteIndex {
  const byKey = new Map<string, NoteDto>();
  const byCoords = new Map<string, NoteDto>();
  const byPlayerName = new Map<string, NoteDto>();
  for (const n of notes) {
    byKey.set(noteKey(n.kind, n.targetId), n);
    if (n.kind === 'village' && typeof n.x === 'number' && typeof n.y === 'number') byCoords.set(coordKey(n.x, n.y), n);
    if (n.kind === 'player') byPlayerName.set(n.targetName.toLowerCase(), n);
  }
  return { byKey, byCoords, byPlayerName };
}

/** Is this a known tag id? (Defends the screen against a server that sends a newer tag.) */
export function isNoteTag(t: unknown): t is NoteTag {
  return typeof t === 'string' && (NOTE_TAGS as readonly string[]).includes(t);
}

export function knownTags(tags: readonly unknown[]): NoteTag[] {
  return NOTE_TAGS.filter((t) => tags.includes(t));
}

/** The form check before sending: the shared rule, so the screen and the server agree. */
export function checkNoteForm(text: string, tags: readonly NoteTag[]): NoteCheck {
  return checkNote(text, [...tags]);
}

/** Code points (what the limit counts), not UTF-16 units. */
export function noteLength(text: string): number {
  return [...text].length;
}

/** A readable line for a failed note request (limit reached, rate limit); other errors keep their own message. */
export function noteErrorMessage(e: unknown): string {
  const err = e as { code?: string; status?: number; message?: string } | null;
  if (err && (err.code === 'note_limit' || err.status === 409)) {
    return `You have reached the limit of ${NOTES_PER_PLAYER_MAX} notes. Delete one you no longer need, then try again.`;
  }
  if (err && (err.status === 429 || err.code === 'rate_limited')) {
    return 'You are changing notes too quickly. Wait a moment and try again.';
  }
  return err && typeof err.message === 'string' && err.message ? err.message : 'Something went wrong.';
}

// ---- Report titles ---------------------------------------------------------------------------------------------------------

const TRAILING_COORDS = /\(\s*(-?\d+)\s*\|\s*(-?\d+)\s*\)(?!.*\(\s*-?\d+\s*\|\s*-?\d+\s*\))/;

/** The last "(x|y)" in a report title ("Raid on Hillfort (3|-4)"), or null. The server's titles carry the target's tile. */
export function reportCoords(title: string): { x: number; y: number } | null {
  const m = TRAILING_COORDS.exec(title);
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  return Number.isSafeInteger(x) && Number.isSafeInteger(y) ? { x, y } : null;
}

// ---- The Notes page --------------------------------------------------------------------------------------------------------

export type NoteKindFilter = 'all' | NoteKind;

export interface NoteFilter {
  /** Selected tags: a note matches when it has at least one (none selected = every note). */
  tags: readonly NoteTag[];
  kind: NoteKindFilter;
}

export function filterNotes(notes: readonly NoteDto[], f: NoteFilter): NoteDto[] {
  return notes.filter((n) => (f.kind === 'all' || n.kind === f.kind) && (f.tags.length === 0 || f.tags.some((t) => n.tags.includes(t))));
}

/** Toggle one tag in the selection (the order stays the fixed tag order). */
export function toggleTag(selected: readonly NoteTag[], tag: NoteTag): NoteTag[] {
  return NOTE_TAGS.filter((t) => (t === tag ? !selected.includes(t) : selected.includes(t)));
}

/** Notes per page of the Notes page: how many compact rows fit the area (never fewer than `min`). */
export function noteRowsFit(areaHeight: number, rowHeight: number, min = 3): number {
  if (!Number.isFinite(areaHeight) || rowHeight <= 0) return min;
  return Math.max(min, Math.floor(areaHeight / rowHeight));
}

/** Newest edit first (the server already sends this order; the client keeps it after local changes). */
export function sortNotes(notes: readonly NoteDto[]): NoteDto[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id);
}

/** Replace or add one note (the response of a save). */
export function upsertNote(notes: readonly NoteDto[], note: NoteDto): NoteDto[] {
  return sortNotes([...notes.filter((n) => n.id !== note.id && !(n.kind === note.kind && n.targetId === note.targetId)), note]);
}

export function removeNote(notes: readonly NoteDto[], id: number): NoteDto[] {
  return notes.filter((n) => n.id !== id);
}
