import { useState } from 'react';
import type { FormEvent } from 'react';
import { TRIBE_INVITE_TTL_HOURS, TRIBE_MAX_MEMBERS, TRIBE_MAX_OPEN_INVITES, canTribe } from '@tribewars/engine';
import { api } from '../api.ts';
import { formatAgo, formatInt, formatLeft } from '../format.ts';
import { useGame } from '../game.ts';
import { PlainText, RECRUITMENT_HINT, RECRUITMENT_NAME } from './bits.tsx';
import { useTribe } from './context.ts';
import type { MemberProps } from './context.ts';

function InviteForm() {
  const { data, run, busy } = useTribe();
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const name = username.trim();
  const full = data.invites.length >= TRIBE_MAX_OPEN_INVITES;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name || busy || full) return;
    const err = await run(() => api.invitePlayer(name), { ok: `Invitation sent to ${name}.`, toastError: false });
    setError(err);
    if (!err) setUsername('');
  }

  return (
    <section className="card" aria-labelledby="inv-new">
      <h2 id="inv-new" className="card-title">
        Invite a player <span className="muted">{data.invites.length}/{TRIBE_MAX_OPEN_INVITES} open</span>
      </h2>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="inline-form">
          <label className="visually-hidden" htmlFor="invite-name">Username</label>
          <input
            id="invite-name"
            className="input"
            value={username}
            maxLength={20}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Username"
            onChange={(e) => {
              setUsername(e.target.value);
              setError(null);
            }}
          />
          <button className="btn btn-primary" type="submit" disabled={!name || busy || full}>
            Invite
          </button>
        </div>
        <p className="muted small">
          Invitations expire after {Math.round(TRIBE_INVITE_TTL_HOURS / 24)} days. A player in another tribe can accept once they have left it.
        </p>
        {full && <p className="form-error">Too many open invitations. Cancel one first.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
    </section>
  );
}

export function Recruit({ tribe, role }: MemberProps) {
  const { data, busy, run } = useTribe();
  const { now } = useGame();
  const canInvite = canTribe(role, 'invite');
  const canApps = canTribe(role, 'handle_applications');
  const isFull = tribe.members >= TRIBE_MAX_MEMBERS;
  return (
    <>
      <section className="card" aria-labelledby="rec-mode">
        <h2 id="rec-mode" className="card-title">Recruitment: {RECRUITMENT_NAME[tribe.recruitment]}</h2>
        <p className="muted">
          {RECRUITMENT_HINT[tribe.recruitment]} {tribe.members}/{TRIBE_MAX_MEMBERS} members{isFull ? ' (full)' : ''}. Change the mode in Overview.
        </p>
      </section>

      {canInvite && <InviteForm />}

      {canInvite && data.invites.length > 0 && (
        <section className="card" aria-labelledby="inv-open">
          <h2 id="inv-open" className="card-title">Open invitations</h2>
          <ul className="stack">
            {data.invites.map((i) => (
              <li key={i.id} className="invite-row">
                <div className="invite-text">
                  <strong>{i.username}</strong>
                  <div className="muted small">
                    by {i.invitedBy} · expires in {formatLeft(i.expiresAt - now)}
                  </div>
                </div>
                <button className="btn btn-small" disabled={busy} onClick={() => void run(() => api.cancelInvite(i.id), { ok: 'Invitation cancelled.' })}>
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canApps && (
        <section className="card" aria-labelledby="apps-title">
          <h2 id="apps-title" className="card-title">
            Applications <span className="muted">{data.applications.length}</span>
          </h2>
          {data.applications.length === 0 ? (
            <p className="muted">No open applications.</p>
          ) : (
            <ul className="stack">
              {data.applications.map((a) => (
                <li key={a.id} className="application">
                  <div className="invite-row">
                    <div className="invite-text">
                      <strong>{a.username}</strong>
                      <span className="muted small"> · {formatInt(a.points)} pts · {formatAgo(a.createdAt, now)}</span>
                    </div>
                    <div className="row-actions">
                      <button className="btn btn-primary btn-small" disabled={busy || isFull} onClick={() => void run(() => api.acceptApplication(a.id), { ok: `${a.username} joined.` })}>
                        Accept
                      </button>
                      <button className="btn btn-small" disabled={busy} onClick={() => void run(() => api.declineApplication(a.id))}>
                        Decline
                      </button>
                    </div>
                  </div>
                  {a.message ? <PlainText className="quote" text={a.message} /> : <p className="muted small">No message.</p>}
                </li>
              ))}
            </ul>
          )}
          {isFull && data.applications.length > 0 && <p className="why">The tribe is full, so applications cannot be accepted.</p>}
        </section>
      )}
    </>
  );
}
