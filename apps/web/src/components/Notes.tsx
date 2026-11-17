// Private notes and tags on villages and players: filled tag chips, a read-only note line, the editor, and the small dialog that
// opens it from a list row. Everything here is the author's own text: it is always rendered as a React text node (never as HTML,
// never turned into a link). Only the author ever sees a note (docs/GAME_DESIGN.md, notes).

import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { NOTE_TAGS, NOTE_TAG_INFO } from '@clanfire/engine';
import type { NoteTag } from '@clanfire/engine';
import { Icon } from '../art/Icon.tsx';
import { NOTE_TAG_ICON } from '../icons.ts';
import { checkNoteForm, knownTags, noteLength, toggleTag } from '../notes.ts';
import type { NoteKind } from '../notes.ts';
import { useNotes } from '../hooks/useNotes.tsx';

/** One filled tag chip: own icon plus the label. `compact` = the icon alone (label and hint stay in the title and for screen readers). */
export function NoteTagChip({ tag, compact }: { tag: NoteTag; compact?: boolean }) {
  const info = NOTE_TAG_INFO[tag];
  if (!info) return null;
  return (
    <span className={`nt nt-${tag}${compact ? ' nt-compact' : ''}`} title={`${info.label}: ${info.hint}`}>
      <Icon name={NOTE_TAG_ICON[tag]} size={16} />
      {compact ? <span className="visually-hidden">{info.label}</span> : <span>{info.label}</span>}
    </span>
  );
}

/** The tags of a note as filled chips (`max` keeps a row from overflowing: the rest becomes "+N"). */
export function NoteChips({ tags, compact, max }: { tags: readonly NoteTag[]; compact?: boolean; max?: number }) {
  const list = knownTags(tags);
  if (list.length === 0) return null;
  const shown = max !== undefined && list.length > max ? list.slice(0, max) : list;
  const rest = list.length - shown.length;
  return (
    <span className="nt-chips">
      {shown.map((t) => (
        <NoteTagChip key={t} tag={t} compact={compact} />
      ))}
      {rest > 0 && (
        <span className="nt nt-more" title={list.slice(shown.length).map((t) => NOTE_TAG_INFO[t].label).join(', ')}>
          +{rest}
        </span>
      )}
    </span>
  );
}

/** Tags and the text of a note on one line, cut with an ellipsis; a tap (or Enter) opens the full text, a second one folds it. */
export function NoteLine({ tags, text, expandable = true, className = '' }: { tags: readonly NoteTag[]; text: string; expandable?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const body = text ? (
    expandable ? (
      <button type="button" className={`nt-text${open ? ' is-open' : ''}`} aria-expanded={open} title={text} onClick={() => setOpen((o) => !o)}>
        {text}
      </button>
    ) : (
      <span className="nt-text" title={text}>
        {text}
      </span>
    )
  ) : null;
  return (
    <span className={`nt-line ${className}`.trim()}>
      <NoteChips tags={tags} />
      {body}
    </span>
  );
}

export interface NoteEditorProps {
  initial?: { text: string; tags: readonly NoteTag[] } | null;
  /** Throws an Error with a readable message on failure (shown under the field). */
  onSave: (text: string, tags: NoteTag[]) => Promise<void>;
  /** Present when a note exists: shows the Delete button. */
  onDelete?: () => Promise<void>;
  onCancel?: () => void;
  /** 'wm' draws the buttons in the map panel's family; 'btn' is the app family. */
  variant?: 'btn' | 'wm';
  textMax: number;
  autoFocus?: boolean;
}

/** One short line of text (no line breaks) and tag toggles; Save and Delete; checked with the shared rule before anything is sent. */
export function NoteEditor({ initial, onSave, onDelete, onCancel, variant = 'btn', textMax, autoFocus }: NoteEditorProps) {
  const [text, setText] = useState(initial?.text ?? '');
  const [tags, setTags] = useState<NoteTag[]>(initial ? knownTags(initial.tags) : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const len = noteLength(text);
  const cls = (kind: 'main' | 'plain') =>
    variant === 'wm' ? `wm-btn wm-btn-small${kind === 'main' ? ' wm-btn-sun' : ''}` : `btn btn-small${kind === 'main' ? ' btn-primary' : ''}`;

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const check = checkNoteForm(text, tags);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    void run(() => onSave(check.text, check.tags));
  };

  return (
    <form className="nt-editor" onSubmit={submit} aria-label="Note">
      <label className="nt-field" htmlFor={`${id}-t`}>
        <span className="visually-hidden">Note text</span>
        <textarea
          id={`${id}-t`}
          className="nt-input"
          rows={2}
          value={text}
          autoFocus={autoFocus}
          disabled={busy}
          placeholder="A short note for yourself"
          aria-describedby={`${id}-c`}
          onChange={(e) => setText(e.target.value.replace(/[\r\n]+/g, ' '))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <span id={`${id}-c`} className={`nt-count${len > textMax ? ' is-over' : ''}`} aria-live="polite">
          {len} / {textMax}
        </span>
      </label>
      <div className="nt-tags" role="group" aria-label="Tags">
        {NOTE_TAGS.map((t) => {
          const on = tags.includes(t);
          return (
            <button
              key={t}
              type="button"
              className={`nt nt-${t} nt-toggle${on ? ' is-on' : ''}`}
              aria-pressed={on}
              disabled={busy}
              title={NOTE_TAG_INFO[t].hint}
              onClick={() => setTags((cur) => toggleTag(cur, t))}
            >
              <Icon name={NOTE_TAG_ICON[t]} size={16} />
              <span>{NOTE_TAG_INFO[t].label}</span>
            </button>
          );
        })}
      </div>
      <p className="nt-hint">Only you can see this.</p>
      {error && (
        <p className="form-error nt-error" role="alert">
          {error}
        </p>
      )}
      <div className="nt-actions">
        <button type="submit" className={cls('main')} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {onDelete && (
          <button type="button" className={cls('plain')} disabled={busy} onClick={() => void run(onDelete)}>
            Delete
          </button>
        )}
        {onCancel && (
          <button type="button" className={cls('plain')} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** Editor wired to the notes store for one target (a village or a player). `onDone` runs after a save or a delete. */
export function TargetNoteEditor({ kind, targetId, onDone, onCancel, variant, autoFocus }: { kind: NoteKind; targetId: number; onDone?: () => void; onCancel?: () => void; variant?: 'btn' | 'wm'; autoFocus?: boolean }) {
  const notes = useNotes();
  const existing = notes.get(kind, targetId);
  return (
    <NoteEditor
      initial={existing ?? null}
      textMax={notes.textMax}
      variant={variant}
      autoFocus={autoFocus}
      onCancel={onCancel}
      onSave={async (text, tags) => {
        await notes.save(kind, targetId, text, tags);
        onDone?.();
      }}
      onDelete={
        existing
          ? async () => {
              await notes.remove(existing.id);
              onDone?.();
            }
          : undefined
      }
    />
  );
}

/** A note row in a panel: the note (or "No note"), and an Add / Edit button that opens the editor in place. */
export function TargetNote({ kind, targetId, label, variant = 'btn', canAdd = true }: { kind: NoteKind; targetId: number; label: string; variant?: 'btn' | 'wm'; canAdd?: boolean }) {
  const notes = useNotes();
  const [editing, setEditing] = useState(false);
  const existing = notes.get(kind, targetId);
  const small = variant === 'wm' ? 'wm-btn wm-btn-small' : 'btn btn-small';
  return (
    <div className="nt-row">
      <div className="nt-row-head">
        <span className="nt-row-label">{label}</span>
        {!editing && (existing || canAdd) && (
          <button type="button" className={`${small} nt-row-btn`} onClick={() => setEditing(true)} aria-label={`${existing ? 'Edit' : 'Add'} note: ${label}`}>
            <Icon name="note" size={18} />
            <span>{existing ? 'Edit' : 'Add note'}</span>
          </button>
        )}
      </div>
      {!editing && existing && <NoteLine tags={existing.tags} text={existing.text} />}
      {editing && <TargetNoteEditor kind={kind} targetId={targetId} variant={variant} autoFocus onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />}
    </div>
  );
}

/** The note section of a player's profile sheet (real players other than me). */
export function PlayerNoteSection({ playerId, name }: { playerId: number; name: string }) {
  return (
    <div className="nt-section">
      <TargetNote kind="player" targetId={playerId} label={`Your note on ${name}`} />
    </div>
  );
}

/** A small dialog (bottom sheet on a phone) holding one note editor; closes on Escape, on the backdrop and after a save or delete. */
export function NoteDialog({ kind, targetId, title, subtitle, onClose }: { kind: NoteKind; targetId: number; title: string; subtitle?: ReactNode; onClose: () => void }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <div className="nt-wrap" onClick={onClose}>
      <div ref={ref} className="nt-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <div className="nt-dialog-head">
          <Icon name="note" size={26} />
          <div className="nt-dialog-titles">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p className="nt-dialog-sub">{subtitle}</p>}
          </div>
          <button type="button" className="nt-x" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <TargetNoteEditor kind={kind} targetId={targetId} autoFocus onDone={onClose} onCancel={onClose} />
      </div>
    </div>
  );
}

/** The note icon button of a list row: filled when a note exists. Opens the dialog above. */
export function NoteButton({ kind, targetId, title, subtitle, hasNote, className = '' }: { kind: NoteKind; targetId: number; title: string; subtitle?: ReactNode; hasNote: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`nt-btn${hasNote ? ' has-note' : ''} ${className}`.trim()}
        aria-label={`${hasNote ? 'Edit' : 'Add'} note on ${title}`}
        title={hasNote ? 'Edit note' : 'Add note'}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Icon name="note" size={18} />
      </button>
      {open && <NoteDialog kind={kind} targetId={targetId} title={title} subtitle={subtitle} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Chips of the village note found by the coordinates in a report title (compact: icons only, so the row keeps its layout). */
export function ReportNoteChips({ x, y }: { x: number; y: number }) {
  const { byCoords } = useNotes();
  const note = byCoords.get(`${x}|${y}`);
  if (!note || note.tags.length === 0) return null;
  return <NoteChips tags={note.tags} compact max={3} />;
}
