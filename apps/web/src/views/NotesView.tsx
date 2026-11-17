// The Notes page: every private note of mine on a village or a player, with a tag and kind filter, edit and delete per row.
// Desktop: rows paged by the height of the area (nothing scrolls inside the page). Phone: a single column of compact cards.
// Names and notes are user text: always React text nodes, never links.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NOTE_TAGS, NOTE_TAG_INFO } from '@clanfire/engine';
import type { NoteDto, NoteTag } from '@clanfire/engine';
import { Icon } from '../art/Icon.tsx';
import { NoteDialog, NoteLine } from '../components/Notes.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { formatAgo, formatCoords } from '../format.ts';
import { useGame } from '../game.ts';
import { useIsDesktop } from '../hooks/useLayout.ts';
import { useNotes } from '../hooks/useNotes.tsx';
import { NOTE_TAG_ICON } from '../icons.ts';
import { filterNotes, noteRowsFit, toggleTag } from '../notes.ts';
import type { NoteKindFilter } from '../notes.ts';
import { paging, pageSlice } from './reports/frame-reports-logic.ts';
import { Chev } from './village/FrameParts.tsx';

const ROW_H = 64;
const PAGER_H = 52;

const KIND_FILTERS: Array<{ id: NoteKindFilter; label: string }> = [
  { id: 'all', label: 'All kinds' },
  { id: 'village', label: 'Villages' },
  { id: 'player', label: 'Players' },
];

function Filters({ tags, setTags, kind, setKind, counts }: { tags: NoteTag[]; setTags: (t: NoteTag[]) => void; kind: NoteKindFilter; setKind: (k: NoteKindFilter) => void; counts: Record<NoteTag, number> }) {
  return (
    <>
      <div className="np-group" role="group" aria-label="Filter by tag">
        <button type="button" className={`np-chip${tags.length === 0 ? ' is-on' : ''}`} aria-pressed={tags.length === 0} onClick={() => setTags([])}>
          All
        </button>
        {NOTE_TAGS.map((t) => {
          const on = tags.includes(t);
          return (
            <button key={t} type="button" className={`np-chip nt nt-${t}${on ? ' is-on' : ''}`} aria-pressed={on} title={NOTE_TAG_INFO[t].hint} onClick={() => setTags(toggleTag(tags, t))}>
              <Icon name={NOTE_TAG_ICON[t]} size={16} />
              <span>
                {NOTE_TAG_INFO[t].label}
                <span className="visually-hidden">, {counts[t]} notes</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="np-group" role="group" aria-label="Filter by kind">
        {KIND_FILTERS.map((k) => (
          <button key={k.id} type="button" className={`np-chip np-kind${kind === k.id ? ' is-on' : ''}`} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
    </>
  );
}

function useNotesPage() {
  const notes = useNotes();
  const { now, showOnMap } = useGame();
  const [tags, setTags] = useState<NoteTag[]>([]);
  const [kind, setKind] = useState<NoteKindFilter>('all');
  const [editing, setEditing] = useState<NoteDto | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filtered = useMemo(() => filterNotes(notes.notes, { tags, kind }), [notes.notes, tags, kind]);
  const counts = useMemo(() => {
    const out = { prey: 0, menace: 0, friend: 0, watch: 0, plan: 0 } as Record<NoteTag, number>;
    for (const n of notes.notes) for (const t of n.tags) if (t in out) out[t] += 1;
    return out;
  }, [notes.notes]);
  const remove = async (n: NoteDto) => {
    if (confirm !== n.id) {
      setConfirm(n.id);
      return;
    }
    setConfirm(null);
    setError(null);
    try {
      await notes.remove(n.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };
  return { notes, now, showOnMap, tags, setTags, kind, setKind, editing, setEditing, confirm, setConfirm, error, filtered, counts, remove };
}

type PageState = ReturnType<typeof useNotesPage>;

function subtitleOf(n: NoteDto): string {
  if (n.kind === 'player') return 'Player';
  const where = typeof n.x === 'number' && typeof n.y === 'number' ? formatCoords(n.x, n.y) : '';
  const owner = n.ownerName === null ? 'Abandoned' : n.ownerName ? n.ownerName : '';
  return [where, owner].filter(Boolean).join(' · ');
}

function Who({ n, showOnMap }: { n: NoteDto; showOnMap: PageState['showOnMap'] }) {
  const canOpen = n.kind === 'village' && typeof n.x === 'number' && typeof n.y === 'number';
  const body = (
    <>
      <b title={n.targetName}>{n.targetName}</b>
      <span className="np-sub" title={subtitleOf(n)}>
        {subtitleOf(n)}
      </span>
    </>
  );
  return canOpen ? (
    <button type="button" className="np-who" aria-label={`Show ${n.targetName} on the map`} title="Show on the map" onClick={() => showOnMap(n.x!, n.y!)}>
      {body}
    </button>
  ) : (
    <span className="np-who">{body}</span>
  );
}

function RowActions({ n, page, size = 'btn-small' }: { n: NoteDto; page: PageState; size?: string }) {
  const asking = page.confirm === n.id;
  return (
    <span className="np-acts">
      <button type="button" className={`btn ${size}`} onClick={() => page.setEditing(n)} aria-label={`Edit note on ${n.targetName}`}>
        Edit
      </button>
      <button type="button" className={`btn ${size}${asking ? ' btn-primary' : ''}`} onClick={() => void page.remove(n)} onBlur={() => page.setConfirm(null)} aria-label={`${asking ? 'Confirm: delete' : 'Delete'} note on ${n.targetName}`}>
        {asking ? 'Sure?' : 'Delete'}
      </button>
    </span>
  );
}

function Empty({ any }: { any: boolean }) {
  return (
    <p className="np-empty">
      {any
        ? 'No note matches this filter.'
        : 'No notes yet. Open a village on the map, a player in the rankings or a report and add a short note and tags. Only you can see them.'}
    </p>
  );
}

function CountChip({ n, max }: { n: number; max: number }) {
  return (
    <span className="np-count" title="Notes you have written, of the most you can keep">
      {n} / {max}
    </span>
  );
}

function NotesTable() {
  const page = useNotesPage();
  const { notes, now, showOnMap, tags, setTags, kind, setKind, editing, setEditing, error, filtered, counts } = page;
  const [pageNo, setPageNo] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setArea(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const total = filtered.length;
  const fitAll = area === null ? 8 : noteRowsFit(area, ROW_H);
  const perPage = total <= fitAll ? Math.max(1, total) : area === null ? 8 : noteRowsFit(area - PAGER_H, ROW_H);
  const pg = paging(total, pageNo, perPage);
  const rows = pageSlice(filtered, pg.page, perPage);
  useEffect(() => {
    if (pageNo !== pg.page) setPageNo(pg.page);
  }, [pageNo, pg.page]);
  useEffect(() => setPageNo(0), [tags, kind]);

  return (
    <section className="fv-pn np" aria-label="Notes">
      <div className="fv-ph">
        <Icon name="note" size={26} />
        <h2>Notes</h2>
        <CountChip n={notes.notes.length} max={notes.max} />
        <span className="fv-sp" />
        <span className="fv-mut">Private: only you can see these.</span>
      </div>
      <div className="np-filters">
        <Filters tags={tags} setTags={setTags} kind={kind} setKind={setKind} counts={counts} />
      </div>
      {error && (
        <p className="form-error np-empty" role="alert">
          {error}
        </p>
      )}
      <div className="np-body" ref={bodyRef}>
        {!notes.loaded && !notes.loadError && <p className="np-empty">Loading…</p>}
        {notes.loadError && (
          <p className="form-error np-empty" role="alert">
            {notes.loadError}{' '}
            <button type="button" className="fv-lk" onClick={() => void notes.refresh()}>
              Retry
            </button>
          </p>
        )}
        {notes.loaded && !notes.loadError && total === 0 && <Empty any={notes.notes.length > 0} />}
        {total > 0 && (
          <ul className="np-rows">
            {rows.map((n) => (
              <li key={n.id} className="np-row">
                <Who n={n} showOnMap={showOnMap} />
                <span className="np-note">
                  <NoteLine tags={n.tags} text={n.text} />
                </span>
                <span className="np-when" title={new Date(n.updatedAt).toLocaleString()}>
                  {formatAgo(n.updatedAt, now)}
                </span>
                <RowActions n={n} page={page} />
              </li>
            ))}
          </ul>
        )}
        {pg.pages > 1 && (
          <div className="np-pager">
            <span className="fv-mut">
              Page {pg.page + 1} of {pg.pages} · notes {pg.from}–{pg.to} of {pg.total}
            </span>
            <span className="fv-sp" />
            <button type="button" className="np-pgb" aria-label="Previous page" disabled={pg.page <= 0} onClick={() => setPageNo(pg.page - 1)}>
              <Chev flip size={16} />
            </button>
            <button type="button" className="np-pgb" aria-label="Next page" disabled={pg.page >= pg.pages - 1} onClick={() => setPageNo(pg.page + 1)}>
              <Chev size={16} />
            </button>
          </div>
        )}
      </div>
      {editing && <NoteDialog kind={editing.kind} targetId={editing.targetId} title={editing.targetName} subtitle={subtitleOf(editing)} onClose={() => setEditing(null)} />}
    </section>
  );
}

function NotesCards() {
  const page = useNotesPage();
  const { notes, now, showOnMap, tags, setTags, kind, setKind, editing, setEditing, error, filtered, counts } = page;
  return (
    <div className="page np-page">
      <PageHeader icon="note" title="Notes" count={<CountChip n={notes.notes.length} max={notes.max} />}>
        <p className="muted small">Private: only you can see these.</p>
      </PageHeader>
      <div className="np-phone-filters">
        <Filters tags={tags} setTags={setTags} kind={kind} setKind={setKind} counts={counts} />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!notes.loaded && !notes.loadError && <p className="muted">Loading…</p>}
      {notes.loadError && (
        <p className="form-error" role="alert">
          {notes.loadError}{' '}
          <button type="button" className="link" onClick={() => void notes.refresh()}>
            Retry
          </button>
        </p>
      )}
      {notes.loaded && !notes.loadError && filtered.length === 0 && <Empty any={notes.notes.length > 0} />}
      <ul className="np-cards">
        {filtered.map((n) => (
          <li key={n.id} className="np-card">
            <div className="np-card-head">
              <Who n={n} showOnMap={showOnMap} />
            </div>
            <NoteLine tags={n.tags} text={n.text} />
            <div className="np-card-foot">
              <span className="np-when" title={new Date(n.updatedAt).toLocaleString()}>
                {formatAgo(n.updatedAt, now)}
              </span>
              <RowActions n={n} page={page} />
            </div>
          </li>
        ))}
      </ul>
      {editing && <NoteDialog kind={editing.kind} targetId={editing.targetId} title={editing.targetName} subtitle={subtitleOf(editing)} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function NotesView() {
  return useIsDesktop() ? <NotesTable /> : <NotesCards />;
}
