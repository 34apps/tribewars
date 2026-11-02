// Join / apply controls shared by the tribe list and a tribe's public page.

import { useState } from 'react';
import type { FormEvent } from 'react';
import { PLAYER_MAX_APPLICATIONS, TRIBE_APPLICATION_MESSAGE_MAX, TRIBE_MAX_MEMBERS } from '@tribewars/engine';
import type { Recruitment } from '@tribewars/engine';
import { api } from '../api.ts';
import { CharCount } from './bits.tsx';
import { useTribe } from './context.ts';

export interface JoinTarget {
  id: number;
  name: string;
  tag: string;
  members: number;
  recruitment: Recruitment;
}

/** Join (open) / Apply (application) / Invite only, for a tribeless viewer. `onApply` opens the message form. */
export function JoinButton({ t, onApply }: { t: JoinTarget; onApply: () => void }) {
  const { data, busy, run } = useTribe();
  const applied = data.applications.some((a) => a.tribe.id === t.id);
  const invited = data.invites.some((i) => i.tribe.id === t.id);
  const atAppLimit = data.applications.length >= PLAYER_MAX_APPLICATIONS;

  if (invited) return <span className="tag tag-info">Invited</span>;
  if (t.members >= TRIBE_MAX_MEMBERS) return <span className="tag tag-muted">Full</span>;
  if (t.recruitment === 'open') {
    return (
      <button className="btn btn-primary btn-small" disabled={busy} onClick={() => void run(() => api.joinTribe(t.id), { ok: `You joined ${t.name}.` })}>
        Join
      </button>
    );
  }
  if (t.recruitment === 'application') {
    if (applied) return <span className="tag tag-ok">Applied</span>;
    return (
      <button className="btn btn-small" disabled={busy || atAppLimit} onClick={onApply} title={atAppLimit ? `You can have ${PLAYER_MAX_APPLICATIONS} open applications` : undefined}>
        Apply
      </button>
    );
  }
  return <span className="tag tag-muted">Invite only</span>;
}

export function ApplyForm({ t, onDone }: { t: JoinTarget; onDone: () => void }) {
  const { run, busy } = useTribe();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const over = [...message.trim()].length > TRIBE_APPLICATION_MESSAGE_MAX;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || over) return;
    const err = await run(() => api.applyToTribe(t.id, message.trim()), { ok: `Application sent to ${t.name}.`, toastError: false });
    setError(err);
    if (!err) onDone();
  }

  return (
    <form className="apply-form" onSubmit={(e) => void submit(e)}>
      <label className="field">
        <span>Message to {t.name}</span>
        <textarea
          className="input textarea"
          rows={3}
          value={message}
          placeholder="Who are you and why this tribe?"
          onChange={(e) => {
            setMessage(e.target.value);
            setError(null);
          }}
        />
      </label>
      <div className="form-row">
        <CharCount value={message} max={TRIBE_APPLICATION_MESSAGE_MAX} />
        <span className="spacer" />
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || over}>
          Send application
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}
