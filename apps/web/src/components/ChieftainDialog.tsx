// "Change chieftain": the picker in an in-page modal dialog; saves with POST /api/me/chieftain. Loaded lazily by the shell.

import { useEffect, useRef, useState } from 'react';
import { CHIEFTAINS } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { useGame } from '../game.ts';
import ChieftainPicker from './ChieftainPicker.tsx';

export default function ChieftainDialog({ onClose }: { onClose: () => void }) {
  const { player, tribeChanged, toast } = useGame();
  const [value, setValue] = useState(player.chieftain);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dlg.open) dlg.showModal();
    dlg.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
    return () => {
      if (dlg.open) dlg.close();
      previous?.focus?.();
    };
  }, []);

  const chosen = CHIEFTAINS.find((c) => c.id === value);
  const unchanged = value === player.chieftain;

  async function save() {
    if (busy || unchanged) return;
    setBusy(true);
    setError(null);
    try {
      await api.setChieftain(value);
      // Refreshes /api/state (header avatar) and bumps tribeVersion so tribe lists and the map re-fetch.
      tribeChanged();
      toast(`${chosen?.name ?? 'Chieftain'} chosen`);
      closeRef.current();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="confirm chief-dialog"
      aria-labelledby="chief-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onClose();
      }}
    >
      <h2 id="chief-dialog-title" className="card-title">Change chieftain</h2>
      <ChieftainPicker value={value} onChange={setValue} disabled={busy} />
      <div className="form-error" role="alert" aria-live="assertive">{error}</div>
      <div className="confirm-actions">
        <button type="button" className="btn" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || unchanged} onClick={() => void save()}>
          {busy ? 'Saving…' : unchanged ? 'Pick another' : `Lead as ${chosen?.name ?? 'this chieftain'}`}
        </button>
      </div>
    </dialog>
  );
}
