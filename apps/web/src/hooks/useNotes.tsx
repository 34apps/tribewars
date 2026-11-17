import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { NOTES_PER_PLAYER_MAX, NOTE_TEXT_MAX } from '@clanfire/engine';
import type { NoteDto, NoteTag } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { indexNotes, noteErrorMessage, noteKey, removeNote, sortNotes, upsertNote } from '../notes.ts';
import type { NoteIndex, NoteKind } from '../notes.ts';

export interface NotesStore extends NoteIndex {
  notes: NoteDto[];
  /** False until the first GET /api/notes answered (or failed). */
  loaded: boolean;
  /** Last load error (an older server without notes, a hiccup); null when fine. */
  loadError: string | null;
  max: number;
  textMax: number;
  /** The note on one target, or undefined. */
  get: (kind: NoteKind, targetId: number) => NoteDto | undefined;
  /** Create or replace my note on a target. Throws an Error with a readable message (shown by the caller); refreshes on success. */
  save: (kind: NoteKind, targetId: number, text: string, tags: NoteTag[]) => Promise<void>;
  /** Delete one note by id. Throws like save. */
  remove: (id: number) => Promise<void>;
  refresh: () => Promise<void>;
}

const EMPTY_INDEX = indexNotes([]);

const NotesContext = createContext<NotesStore | null>(null);

/** My private notes, loaded once after sign-in (mount this inside the signed-in tree) and refreshed after every write. */
export function NotesProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<NoteDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [limits, setLimits] = useState({ max: NOTES_PER_PLAYER_MAX, textMax: NOTE_TEXT_MAX });
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.notes();
      if (!alive.current) return;
      setNotes(sortNotes(Array.isArray(res.notes) ? res.notes : []));
      if (res.limits && Number.isFinite(res.limits.max) && Number.isFinite(res.limits.textMax)) setLimits({ max: res.limits.max, textMax: res.limits.textMax });
      setLoadError(null);
    } catch (e) {
      if (alive.current) setLoadError(errorMessage(e));
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  const save = useCallback(
    async (kind: NoteKind, targetId: number, text: string, tags: NoteTag[]) => {
      let note: NoteDto;
      try {
        note = (await api.saveNote({ kind, targetId, text, tags })).note;
      } catch (e) {
        throw new Error(noteErrorMessage(e));
      }
      if (alive.current) setNotes((cur) => upsertNote(cur, note));
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: number) => {
      try {
        await api.deleteNote(id);
      } catch (e) {
        throw new Error(noteErrorMessage(e));
      }
      if (alive.current) setNotes((cur) => removeNote(cur, id));
      await refresh();
    },
    [refresh],
  );

  const index = useMemo(() => (notes.length === 0 ? EMPTY_INDEX : indexNotes(notes)), [notes]);
  const value = useMemo<NotesStore>(
    () => ({
      notes,
      ...index,
      loaded,
      loadError,
      max: limits.max,
      textMax: limits.textMax,
      get: (kind, targetId) => index.byKey.get(noteKey(kind, targetId)),
      save,
      remove,
      refresh,
    }),
    [notes, index, loaded, loadError, limits, save, remove, refresh],
  );
  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

const NO_NOTES: NotesStore = {
  notes: [],
  ...EMPTY_INDEX,
  loaded: false,
  loadError: null,
  max: NOTES_PER_PLAYER_MAX,
  textMax: NOTE_TEXT_MAX,
  get: () => undefined,
  save: () => Promise.reject(new Error('Notes are not available.')),
  remove: () => Promise.reject(new Error('Notes are not available.')),
  refresh: () => Promise.resolve(),
};

/** The notes store; outside a provider (tests, previews) it is an empty, read-only store. */
export function useNotes(): NotesStore {
  return useContext(NotesContext) ?? NO_NOTES;
}
