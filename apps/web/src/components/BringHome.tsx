// One "Bring home" button for the player's own troops abroad: a small menu with "All troops" and "Choose how many".
// Used by the desktop Army page's Support box and the phone's Support card.

import { useEffect, useId, useRef, useState } from 'react';

export interface BringHomeItem {
  id: 'all' | 'some';
  label: string;
  run: () => void;
}

/** The two menu items and what each does (kept apart from the markup so it can be tested without a DOM). */
export function bringHomeItems(onAll: () => void, onSome: () => void): BringHomeItem[] {
  return [
    { id: 'all', label: 'All troops', run: onAll },
    { id: 'some', label: 'Choose how many', run: onSome },
  ];
}

export function BringHome({ busy, onAll, onSome, className = 'fv-btn sm' }: { busy: boolean; onAll: () => void; onSome: () => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const menuId = useId();
  const items = bringHomeItems(onAll, onSome);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      if (wrap.current?.contains(document.activeElement)) wrap.current?.querySelector<HTMLElement>('.bh-btn')?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (busy) setOpen(false);
  }, [busy]);

  const focusItem = (i: number) => {
    const els = wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (els && els.length > 0) els[(i + els.length) % els.length]?.focus();
  };

  return (
    <span
      className="bh"
      ref={wrap}
    >
      <button
        type="button"
        className={`${className} bh-btn`}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setTimeout(() => focusItem(0), 0);
          }
        }}
      >
        Bring home <span className="bh-chev" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="bh-menu" role="menu" id={menuId} aria-label="Bring troops home">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              className="bh-item"
              onClick={() => {
                setOpen(false);
                it.run();
              }}
              onKeyDown={(e) => {
                const els = Array.from(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
                const at = els.indexOf(e.currentTarget);
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  focusItem(at + 1);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  focusItem(at - 1);
                }
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** The buttons at the end of a Support row: own troops abroad get "Bring home", guests in your villages get "Send back". */
export function SupportRowActions({
  mine,
  busy,
  onRecall,
  onRecallSome,
  onSendBack,
}: {
  mine: boolean;
  busy: boolean;
  onRecall: () => void;
  onRecallSome: () => void;
  onSendBack: () => void;
}) {
  if (mine) return <BringHome busy={busy} onAll={onRecall} onSome={onRecallSome} />;
  return (
    <button type="button" className="fv-btn sm" disabled={busy} onClick={onSendBack}>
      Send back
    </button>
  );
}
