// Private notes and tags (docs/GAME_DESIGN.md, notes). Contract: packages/engine/src/api.ts. A note is visible to its author only:
// every statement is keyed on the caller's player id, and someone else's note id answers 404 not_found like a missing one.
// The text is plain text: stored and returned exactly as checkNote leaves it (the client shows it as text). It is never logged.

import type { FastifyInstance } from 'fastify';
import {
  GameError,
  NOTE_TARGET_KINDS,
  NOTE_TEXT_MAX,
  NOTES_PER_PLAYER_MAX,
  checkNote,
  type NoteDto,
  type NoteRequest,
  type NoteResponse,
  type NotesResponse,
} from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import type { NoteRow } from '../notes-store.ts';
import { playerOf, requireAuth } from './auth.ts';

const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', pattern: '^[0-9]{1,12}$' } },
} as const;

const noQuery = { type: 'object', additionalProperties: false, properties: {} } as const;
const emptyBody = { type: 'object', additionalProperties: false } as const;

// `text` and `tags` are left untyped on purpose: the schema would coerce "5" to 5; checkNote is the strict check.
const noteBody = {
  type: 'object',
  required: ['kind', 'targetId', 'text', 'tags'],
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: [...NOTE_TARGET_KINDS] },
    targetId: { type: 'integer', minimum: 1, maximum: 9_007_199_254_740_991 },
    text: {},
    tags: {},
  },
} as const;

const toDto = (n: NoteRow): NoteDto => ({
  id: n.id,
  kind: n.kind,
  targetId: n.targetId,
  targetName: n.targetName,
  ...(n.kind === 'village' ? { x: n.x ?? 0, y: n.y ?? 0, ownerName: n.ownerName } : {}),
  text: n.text,
  tags: n.tags,
  updatedAt: n.updatedAt,
});

const notFound = (): GameError => new GameError('not_found', 'That note does not exist.');

export function noteRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { onRequest: requireAuth(ctx) };
  const { store } = ctx;
  type Id = { Params: { id: string } };

  app.get('/api/notes', { ...auth, schema: { querystring: noQuery } }, async (req): Promise<NotesResponse> => ({
    notes: store.notes.list(playerOf(req).id).map(toDto),
    limits: { textMax: NOTE_TEXT_MAX, max: NOTES_PER_PLAYER_MAX },
  }));

  app.post<{ Body: NoteRequest }>('/api/notes', { ...auth, schema: { body: noteBody } }, async (req): Promise<NoteResponse> => {
    const player = playerOf(req);
    const { kind, targetId } = req.body;
    const c = checkNote(req.body.text, req.body.tags);
    if (!c.ok) throw new GameError('invalid_input', c.message);
    const row = store.tx(() => {
      if (!store.notes.targetExists(kind, targetId)) throw new GameError('not_found', kind === 'village' ? 'Village not found.' : 'Player not found.');
      // Replacing a note never counts against the cap; only a new one past it is refused (checked in the same transaction as the write).
      if (store.notes.find(player.id, kind, targetId) === null && store.notes.count(player.id) >= NOTES_PER_PLAYER_MAX) {
        throw new GameError('note_limit', `You can keep at most ${NOTES_PER_PLAYER_MAX} notes. Delete one first.`);
      }
      return store.notes.get1(player.id, store.notes.upsert(player.id, kind, targetId, c.text, c.tags, req.nowMs));
    });
    if (!row) throw new GameError('internal_error', 'The note was not saved.');
    return { note: toDto(row) };
  });

  app.post<Id>('/api/notes/:id/delete', { ...auth, schema: { params: idParams, body: emptyBody } }, async (req, reply): Promise<void> => {
    if (!store.tx(() => store.notes.delete(playerOf(req).id, Number(req.params.id)))) throw notFound();
    void reply.code(204);
  });
}
