// Settings sheet. Today it holds the "Test mode" card, shown only to accounts the server allow-lists (player.sandbox).
// The server re-checks every call. Loaded lazily by the shell.

import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { useGame } from '../game.ts';
import { setDesignPreview, useDesignPreview } from '../views/village/designPreviewState.ts';

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { player, refresh, toast } = useGame();
  const [busy, setBusy] = useState<'max' | 'reset' | 'warp' | 'clear' | 'army' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dp = useDesignPreview();
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

  async function run(action: 'max' | 'reset' | 'clear' | 'army') {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      await (action === 'max' ? api.sandboxMax() : action === 'clear' ? api.sandboxClearAbandoned() : action === 'army' ? api.sandboxClearArmy() : api.sandboxReset());
      setConfirmReset(false);
      await refresh();
      toast(action === 'max' ? 'Your villages are maxed out.' : action === 'clear' ? 'Abandoned villages are empty.' : action === 'army' ? 'Your army at home is gone.' : 'Your villages are fresh again.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function warp(seconds: number) {
    if (busy) return;
    setBusy('warp');
    setError(null);
    try {
      await api.sandboxWarp(seconds);
      await refresh();
      toast(seconds === 0 ? 'Armies arrived now.' : `Armies arrive in ${seconds} s.`);
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
          <label className="check" style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
            <input type="checkbox" role="switch" checked={dp.on} onChange={(e) => setDesignPreview(e.target.checked)} />
            <span>Design preview (village shows every building at levels 0–20; nothing is saved)</span>
          </label>
          <button type="button" className="btn btn-block" disabled={busy !== null} onClick={() => void run('max')}>
            {busy === 'max' ? 'Working…' : 'Max out my village'}
          </button>
          <button type="button" className="btn btn-block" disabled={busy !== null} onClick={() => void run('army')}>
            {busy === 'army' ? 'Working…' : 'Clear my army (troops at home)'}
          </button>
          <button type="button" className="btn btn-block" disabled={busy !== null} onClick={() => void run('clear')}>
            {busy === 'clear' ? 'Working…' : 'Empty abandoned villages'}
          </button>
          <p className="muted">Armies on the road (outgoing, returning, incoming) arrive after:</p>
          <div className="confirm-actions">
            {[0, 10, 60].map((s) => (
              <button key={s} type="button" className="btn" disabled={busy !== null} onClick={() => void warp(s)}>
                {s === 0 ? 'Now' : `${s} s`}
              </button>
            ))}
          </div>
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
