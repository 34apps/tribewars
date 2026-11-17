// Private notes and tags on villages and players: the validation shared by the server (authoritative) and the client (form checks).
// A note is plain text kept by its author only; it grants nothing and changes no rule (docs/GAME_DESIGN.md, notes).

export const NOTE_TEXT_MAX = 280; // characters (code points) per note
export const NOTES_PER_PLAYER_MAX = 500;

/** The fixed tag set (our own words). `id` is stored and sent; `label` and `hint` are for the screen. */
export const NOTE_TAGS = ['prey', 'menace', 'friend', 'watch', 'plan'] as const;
export type NoteTag = (typeof NOTE_TAGS)[number];

export const NOTE_TAG_INFO: Record<NoteTag, { label: string; hint: string }> = {
  prey: { label: 'Prey', hint: 'Worth raiding again' },
  menace: { label: 'Menace', hint: 'Dangerous: strong army or hits often' },
  friend: { label: 'Friend', hint: 'Someone you play with' },
  watch: { label: 'Watch', hint: 'Keep an eye on it' },
  plan: { label: 'Plan', hint: 'You mean to do something here' },
};

export type NoteTargetKind = 'village' | 'player';
export const NOTE_TARGET_KINDS: readonly NoteTargetKind[] = ['village', 'player'];

// Control characters (but a plain space is fine); line breaks are not allowed: a note is one short line.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]');

export type NoteCheck = { ok: true; text: string; tags: NoteTag[] } | { ok: false; message: string };

/**
 * Check the text and tags of a note. The text is trimmed (at most NOTE_TEXT_MAX characters, no control characters, no line
 * breaks, no bidi override marks); it may be empty when at least one tag is given. Tags: only known ids, no duplicates;
 * the result is in the fixed order of NOTE_TAGS. Both empty is refused (delete the note instead).
 */
export function checkNote(text: unknown, tags: unknown): NoteCheck {
  if (typeof text !== 'string') return { ok: false, message: 'The note must be text.' };
  const trimmed = text.trim();
  if ([...trimmed].length > NOTE_TEXT_MAX) return { ok: false, message: `A note can be at most ${NOTE_TEXT_MAX} characters.` };
  if (CONTROL_CHARS.test(trimmed)) return { ok: false, message: 'The note contains characters that are not allowed.' };
  if (!Array.isArray(tags) || tags.length > NOTE_TAGS.length) return { ok: false, message: 'Tags must be a short list.' };
  const seen = new Set<string>();
  for (const t of tags) {
    if (typeof t !== 'string' || !(NOTE_TAGS as readonly string[]).includes(t)) return { ok: false, message: 'Unknown tag.' };
    seen.add(t);
  }
  const ordered = NOTE_TAGS.filter((t) => seen.has(t));
  if (trimmed.length === 0 && ordered.length === 0) return { ok: false, message: 'Write a note or pick a tag.' };
  return { ok: true, text: trimmed, tags: ordered };
}
