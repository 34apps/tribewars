// Settings sheet: the "Show first steps" switch for everyone, and the "Test mode" card, shown only to accounts the server allow-lists (player.sandbox).
// The server re-checks every call. Loaded lazily by the shell.

import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { useGame } from '../game.ts';
import { setDesignPreview, useDesignPreview } from '../views/village/designPreviewState.ts';

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { player, refresh, toast, firstSteps, applyFirstSteps } = useGame();
  const [busy, setBusy] = useState<'max' | 'reset' | 'warp' | 'clear' | 'army' | 'finish' | null>(null);
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

  async function run(action: 'max' | 'reset' | 'clear' | 'army' | 'finish') {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      await (action === 'max' ? api.sandboxMax() : action === 'clear' ? api.sandboxClearAbandoned() : action === 'army' ? api.sandboxClearArmy() : action === 'finish' ? api.sandboxFinish() : api.sandboxReset());
      setConfirmReset(false);
      await refresh();
      toast(action === 'max' ? 'Maxed out.' : action === 'clear' ? 'Abandoned villages emptied.' : action === 'army' ? 'Army cleared.' : action === 'finish' ? 'Queues finished.' : 'Reset.');
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
      toast(seconds === 0 ? 'Armies arrived.' : `Armies arrive in ${seconds} s.`);
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
      {firstSteps && !firstSteps.allClaimed && (
        <label className="check" style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
          <input
            type="checkbox"
            role="switch"
            checked={!firstSteps.hidden}
            disabled={busy !== null}
            onChange={(e) => {
              const hidden = !e.target.checked;
              setError(null);
              api
                .setFirstStepsHidden(hidden)
                .then(applyFirstSteps)
                .catch((err) => setError(errorMessage(err)));
            }}
          />
          <span>Show first steps</span>
        </label>
      )}
      {player.sandbox ? (
        <section aria-labelledby="test-mode-title">
          <h3 id="test-mode-title" className="card-title">Test mode</h3>
          <label className="check" style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
            <input type="checkbox" role="switch" checked={dp.on} onChange={(e) => setDesignPreview(e.target.checked)} />
            <span title="Village shows every building at levels 0–20; nothing is saved.">Design preview</span>
          </label>
          <button type="button" className="btn btn-block" disabled={busy !== null} onClick={() => void run('max')}>
            {busy === 'max' ? 'Working…' : 'Max out village'}
          </button>
          <button type="button" className="btn btn-block" disabled={busy !== null} onClick={() => void run('finish')}>
            {busy === 'finish' ? 'Working…' : 'Finish queues'}
          </button>
          <button type="button" className="btn btn-block" disabled={busy !== null} onClick={() => void run('army')}>
            {busy === 'army' ? 'Working…' : 'Clear home army'}
          </button>
          <button type="button" className="btn btn-block" disabled={busy !== null} onClick={() => void run('clear')}>
            {busy === 'clear' ? 'Working…' : 'Empty abandoned'}
          </button>
          <p className="muted">Armies arrive in</p>
          <div className="confirm-actions">
            {[0, 10, 60].map((s) => (
              <button key={s} type="button" className="btn" disabled={busy !== null} onClick={() => void warp(s)}>
                {s === 0 ? 'Now' : `${s} s`}
              </button>
            ))}
          </div>
          {confirmReset ? (
            <div>
              <p className="muted">Wipes buildings, troops, resources, queues.</p>
              <div className="confirm-actions">
                <button type="button" className="btn" disabled={busy !== null} onClick={() => setConfirmReset(false)}>
                  Keep
                </button>
                <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void run('reset')}>
                  {busy === 'reset' ? 'Working…' : 'Yes, reset'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-block" disabled={busy !== null} onClick={() => setConfirmReset(true)}>
              Reset village
            </button>
          )}
        </section>
      ) : null}
      <div className="form-error" role="alert" aria-live="assertive">{error}</div>
      <div className="confirm-actions">
        <button type="button" className="btn" disabled={busy !== null} onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
