// Rename the current village: the form and the pencil button next to the village name (kept free of CSS imports so tests can render it).

import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { useGame } from '../game.ts';
import { renameProblem } from '../villages.ts';

/** Rename the current village: one text field, the same name rules as the server. */
export function RenameVillage({ onDone }: { onDone?: () => void }) {
  const { village, applyVillage, refresh, toast } = useGame();
  const [name, setName] = useState(village.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = renameProblem(name);
  const unchanged = name.trim() === village.name;

  async function save() {
    if (busy || problem || unchanged) return;
    setBusy(true);
    setError(null);
    try {
      applyVillage(await api.renameVillage(village.id, name.trim()));
      toast(`Renamed to ${name.trim()}`);
      onDone?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  return (
    <form
      className="vsw-rename"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label htmlFor="vsw-name" className="vsw-rename-label">
        Village name
      </label>
      <div className="vsw-rename-row">
        <input id="vsw-name" className="input" type="text" maxLength={30} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={busy || !!problem || unchanged}>
          Save
        </button>
      </div>
      {error ? (
        <p className="vsw-error" role="alert">
          {error}
        </p>
      ) : (
        problem &&
        name.length > 0 && <p className="vsw-error">{problem}</p>
      )}
    </form>
  );
}

/** A small pencil next to the village name: "Rename village". Opens the same RenameVillage form in a popover under the name row. */
export function RenameButton({ frame = false }: { frame?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <span className="vb-rename" ref={ref}>
      <button
        type="button"
        className={`vb-pencil${frame ? ' is-frame' : ''}`}
        aria-label="Rename village"
        title="Rename village"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 13.5l.8-3.2 7.9-7.9a1.4 1.4 0 012 2l-7.9 7.9z" />
        </svg>
      </button>
      {open && (
        <div className="vsw-pop vb-rename-pop" role="group" aria-label="Rename village">
          <div className="vsw-foot">
            <RenameVillage onDone={() => setOpen(false)} />
          </div>
        </div>
      )}
    </span>
  );
}
