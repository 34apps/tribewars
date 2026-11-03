// Settings sheet. Today it holds the "Test mode" card, shown only to accounts the server allow-lists (player.sandbox).
// The server re-checks every call. Loaded lazily by the shell.

import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { useGame } from '../game.ts';

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { player, refresh, toast } = useGame();
  const [busy, setBusy] = useState<'max' | 'reset' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dlg.open) dlg.showModal();
    return () => {
      if (dlg.open) dlg.close();
      previous?.focus?.();
    };
  }, []);

  async function run(action: 'max' | 'reset') {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      await (action === 'max' ? api.sandboxMax() : api.sandboxReset());
      setConfirmReset(false);
      await refresh();
      toast(action === 'max' ? 'Your villages are maxed out.' : 'Your villages are fresh again.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby="settings-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onClose();
      }}
    >
      <h2 id="settings-dialog-title" className="card-title">Settings</h2>
      {player.sandbox ? (
        <section aria-labelledby="test-mode-title">
          <h3 id="test-mode-title" className="card-title">Test mode</h3>
          <p className="muted">
            For testing only; only your account sees this. World speed is unchanged, so a reset goes back to the real game pace.
          </p>
          <button type="button" className="btn btn-block" disabled={busy !== null} onClick={() => void run('max')}>
            {busy === 'max' ? 'Working…' : 'Max out my village'}
          </button>
          {confirmReset ? (
            <div>
              <p className="muted">This wipes your villages back to the start: buildings, troops, resources and queues.</p>
              <div className="confirm-actions">
                <button type="button" className="btn" disabled={busy !== null} onClick={() => setConfirmReset(false)}>
                  Keep my village
                </button>
                <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void run('reset')}>
                  {busy === 'reset' ? 'Working…' : 'Yes, reset'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-block" disabled={busy !== null} onClick={() => setConfirmReset(true)}>
              Reset to a fresh village (real game pace)
            </button>
          )}
        </section>
      ) : (
        <p className="muted">Nothing to set here yet.</p>
      )}
      <div className="form-error" role="alert" aria-live="assertive">{error}</div>
      <div className="confirm-actions">
        <button type="button" className="btn" disabled={busy !== null} onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
