// Delete account, two steps: (1) what will happen, (2) password + the word DELETE. Used by the lobby's Account page and by the
// settings sheet of a world with its own accounts. The server re-checks everything (password, confirm word, lockout).

import { useState } from 'react';
import type { FormEvent } from 'react';
import { ACCOUNT_DELETE_CONFIRM } from '@clanfire/engine';
import type { AccountDeletionInfoDto } from '@clanfire/engine';
import { ApiRequestError, api, errorMessage } from '../api.ts';

/** The button is live only when a password is typed and the word matches exactly. */
export function canConfirmDelete(password: string, confirm: string): boolean {
  return password !== '' && confirm.trim() === ACCOUNT_DELETE_CONFIRM;
}

export function deleteErrorMessage(e: unknown): string {
  if (e instanceof ApiRequestError) {
    if (e.status === 401) return 'Wrong password.';
    if (e.status === 429) return 'Too many tries. Try again in a few minutes.';
  }
  return errorMessage(e);
}


/** Step 1 text. `info` is null for a world's own accounts (this world only, no Flames). */
export function DeleteWhatHappens({ info }: { info: AccountDeletionInfoDto | null }) {
  const names = info ? info.worlds.map((w) => w.name) : [];
  return (
    <>
      <ul className="acc-list">
        {info === null ? (
          <li>Your villages in this world become abandoned villages.</li>
        ) : names.length > 0 ? (
          <li>Your villages in {names.join(', ')} become abandoned villages.</li>
        ) : (
          <li>You have no villages yet.</li>
        )}
        <li>Your name in mail, forum and chat becomes “Deleted player”.</li>
        <li>Your badges and cosmetics are gone.</li>
      </ul>
      {info !== null && info.flames !== null && info.flames > 0 && (
        <div className="acc-flames">
          <p><strong>Your unspent Flames ({info.flames}) will be lost and cannot be refunded.</strong></p>
        </div>
      )}
      <p><strong>This cannot be undone.</strong></p>
    </>
  );
}

/** Step 2, presentational: values and handlers come from the parent (so it can be tested). */
export function DeleteConfirmStep({
  password,
  confirm,
  busy,
  error,
  onPassword,
  onConfirm,
  onCancel,
  onSubmit,
}: {
  password: string;
  confirm: string;
  busy: boolean;
  error: string | null;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const ok = canConfirmDelete(password, confirm) && !busy;
  return (
    <form
      className="acc-form"
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (ok) onSubmit();
      }}
    >
      <label className="field">
        <span>Your password</span>
        <input type="password" name="password" autoComplete="current-password" maxLength={128} value={password} onChange={(e) => onPassword(e.target.value)} />
      </label>
      <label className="field">
        <span>Type {ACCOUNT_DELETE_CONFIRM} to confirm</span>
        <input type="text" name="confirm" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} value={confirm} onChange={(e) => onConfirm(e.target.value)} />
      </label>
      <div className="form-error" role="alert" aria-live="assertive">{error}</div>
      <div className="acc-actions">
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-danger" disabled={!ok}>
          {busy ? 'Deleting…' : 'Delete my account'}
        </button>
      </div>
    </form>
  );
}

type Stage = 'closed' | 'loading' | 'what' | 'confirm';

export function DeleteAccountFlow({ mode, onDone }: { mode: 'lobby' | 'world'; onDone: () => void }) {
  const [stage, setStage] = useState<Stage>('closed');
  const [info, setInfo] = useState<AccountDeletionInfoDto | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setError(null);
    if (mode === 'world') {
      setStage('what');
      return;
    }
    setStage('loading');
    try {
      setInfo(await api.lobbyDeletionInfo());
      setStage('what');
    } catch (e) {
      setError(deleteErrorMessage(e));
      setStage('closed');
    }
  }

  function close() {
    setStage('closed');
    setPassword('');
    setConfirm('');
    setError(null);
  }

  async function submit() {
    if (busy || !canConfirmDelete(password, confirm)) return;
    setBusy(true);
    setError(null);
    try {
      const body = { password, confirm: confirm.trim() };
      await (mode === 'lobby' ? api.lobbyDeleteAccount(body) : api.worldDeleteAccount(body));
      onDone();
    } catch (e) {
      setError(deleteErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="acc-delete">
      {stage === 'closed' && (
        <>
          <button type="button" className="btn btn-danger-outline" onClick={() => void open()}>
            Delete my account…
          </button>
          <div className="form-error" role="alert">{error}</div>
        </>
      )}
      {stage === 'loading' && <p className="muted" role="status">Loading…</p>}
      {stage === 'what' && (
        <>
          <DeleteWhatHappens info={info} />
          <div className="acc-actions">
            <button type="button" className="btn" onClick={close}>
              Keep my account
            </button>
            <button type="button" className="btn btn-danger-outline" onClick={() => setStage('confirm')}>
              Continue
            </button>
          </div>
        </>
      )}
      {stage === 'confirm' && (
        <DeleteConfirmStep password={password} confirm={confirm} busy={busy} error={error} onPassword={setPassword} onConfirm={setConfirm} onCancel={close} onSubmit={() => void submit()} />
      )}
    </div>
  );
}
