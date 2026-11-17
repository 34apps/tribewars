// SQL for the notes table (private notes and tags on villages and players): prepared statements with bound parameters only.
// Every statement is keyed on the author's player id, so another player's note can never be read, changed or deleted.

import { NOTE_TAGS, type NoteTag, type NoteTargetKind } from '@clanfire/engine';
import { SqlBase, type Raw } from './sql.ts';

export const NOTES_LIST_LIMIT = 500;

export interface NoteRow {
  id: number;
  kind: NoteTargetKind;
  targetId: number;
  targetName: string;
  /** Village rows only. */
  x: number | null;
  y: number | null;
  /** Village rows: the current owner's name, null = abandoned. Player rows: null. */
  ownerName: string | null;
  text: string;
  tags: NoteTag[];
  updatedAt: number;
}

/** Stored JSON back to a tag list; anything unexpected (hand-edited database) is dropped rather than trusted. */
export function parseTags(text: string): NoteTag[] {
  try {
    const raw = JSON.parse(text) as unknown;
    if (Array.isArray(raw)) return NOTE_TAGS.filter((t) => raw.includes(t));
  } catch {
    // no tags
  }
  return [];
}

const toRow = (r: Raw): NoteRow => ({
  id: r.id as number,
  kind: r.kind as NoteTargetKind,
  targetId: r.target_id as number,
  targetName: r.target_name as string,
  x: (r.x as number | null) ?? null,
  y: (r.y as number | null) ?? null,
  ownerName: (r.owner_name as string | null) ?? null,
  text: r.text as string,
  tags: parseTags(r.tags as string),
  updatedAt: r.updated_at as number,
});

// Village notes join the village (current name, tile) and its current owner; player notes join the player. A note whose target no
// longer exists is not listed. `%FILTER%` is either empty or `AND n.id = ?`.
const LIST_SQL = `
SELECT n.id, n.kind, n.target_id, n.text, n.tags, n.updated_at, v.name AS target_name, v.x AS x, v.y AS y, o.username AS owner_name
FROM notes n JOIN villages v ON n.kind = 'village' AND v.id = n.target_id LEFT JOIN players o ON o.id = v.owner_id
WHERE n.player_id = ? %FILTER%
UNION ALL
SELECT n.id, n.kind, n.target_id, n.text, n.tags, n.updated_at, p.username AS target_name, NULL AS x, NULL AS y, NULL AS owner_name
FROM notes n JOIN players p ON n.kind = 'player' AND p.id = n.target_id
WHERE n.player_id = ? %FILTER%
ORDER BY 6 DESC, 1 DESC
LIMIT ${NOTES_LIST_LIMIT}`;

export class NoteStore extends SqlBase {
  /** The author's notes, newest edit first, at most NOTES_LIST_LIMIT, in one query. */
  list(playerId: number): NoteRow[] {
    return this.all(LIST_SQL.replaceAll('%FILTER%', ''), playerId, playerId).map(toRow);
  }

  get1(playerId: number, id: number): NoteRow | null {
    const r = this.get(LIST_SQL.replaceAll('%FILTER%', 'AND n.id = ?'), playerId, id, playerId, id);
    return r ? toRow(r) : null;
  }

  count(playerId: number): number {
    return Number(this.get('SELECT COUNT(*) AS n FROM notes WHERE player_id = ?', playerId)?.n ?? 0);
  }

  /** Id of the author's note on this target, or null. */
  find(playerId: number, kind: NoteTargetKind, targetId: number): number | null {
    const r = this.get('SELECT id FROM notes WHERE player_id = ? AND kind = ? AND target_id = ?', playerId, kind, targetId);
    return r ? (r.id as number) : null;
  }

  targetExists(kind: NoteTargetKind, targetId: number): boolean {
    const sql = kind === 'village' ? 'SELECT 1 AS one FROM villages WHERE id = ?' : 'SELECT 1 AS one FROM players WHERE id = ?';
    return this.get(sql, targetId) !== undefined;
  }

  /** Create the note or replace the author's note on this target (one per target); returns its id. */
  upsert(playerId: number, kind: NoteTargetKind, targetId: number, text: string, tags: readonly NoteTag[], now: number): number {
    this.run(
      `INSERT INTO notes (player_id, kind, target_id, text, tags, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (player_id, kind, target_id) DO UPDATE SET text = excluded.text, tags = excluded.tags, updated_at = excluded.updated_at`,
      playerId, kind, targetId, text, JSON.stringify(tags), now,
    );
    return this.find(playerId, kind, targetId) as number;
  }

  /** True when a note of this author was removed. */
  delete(playerId: number, id: number): boolean {
    return this.run('DELETE FROM notes WHERE id = ? AND player_id = ?', id, playerId).changes > 0;
  }

  /** The author's notes on these villages (the realm overview): village id -> text and tags. One query. */
  forVillages(playerId: number, villageIds: readonly number[]): Map<number, { text: string; tags: NoteTag[] }> {
    const out = new Map<number, { text: string; tags: NoteTag[] }>();
    if (villageIds.length === 0) return out;
    const rows = this.all(
      `SELECT target_id, text, tags FROM notes WHERE player_id = ? AND kind = 'village' AND target_id IN (${villageIds.map(() => '?').join(',')})`,
      playerId,
      ...villageIds,
    );
    for (const r of rows) out.set(r.target_id as number, { text: r.text as string, tags: parseTags(r.tags as string) });
    return out;
  }
}
