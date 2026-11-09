// The Recruit sub-tab of the desktop Tribe page (picture: design/proposals/ingame-pages/mix-tribe-recruit-1440.png): applications with
// Accept / Decline, the Invite form and the open invitations. Same rights, endpoints and limits as the phone's Recruit.

import { useState } from 'react';
import type { FormEvent } from 'react';
import { TRIBE_INVITE_TTL_HOURS, TRIBE_MAX_OPEN_INVITES, canTribe } from '@clanfire/engine';
import { api } from '../../api.ts';
import { formatAgo, formatInt, formatLeft } from '../../format.ts';
import { useGame, useRules } from '../../game.ts';
import { RECRUITMENT_NAME } from '../../tribe/bits.tsx';
import { useTribe } from '../../tribe/context.ts';
import type { MemberProps } from '../../tribe/context.ts';
import { APPLICATIONS_PER_PAGE, INVITES_PER_PAGE } from './frame-tribe-logic.ts';
import { PageButtons, usePaged } from './frame-tribe-bits.tsx';

const initial = (name: string) => [...name][0]?.toUpperCase() ?? '?';

function InvitePanel() {
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
    <form className="fv-pn" onSubmit={(e) => void submit(e)} aria-label="Invite a player">
      <div className="fv-ph frt-ph">
        <h2>Invite a player</h2>
        <span className="fv-sp" />
        <span className="fv-mut">{data.invites.length}/{TRIBE_MAX_OPEN_INVITES} open · expire after {Math.round(TRIBE_INVITE_TTL_HOURS / 24)} days</span>
      </div>
      <div className="frt-form">
        <label className="frt-fld">
          <span className="frt-fl">Username</span>
          <input
            className="frt-in"
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
        </label>
        {full && <p className="form-error">Invitation limit reached.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="fv-btn fv-btn-g frt-wide" disabled={!name || busy || full}>
          Invite
        </button>
      </div>
    </form>
  );
}

function OpenInvites() {
  const { data, busy, run } = useTribe();
  const { now } = useGame();
  const inv = usePaged(data.invites, INVITES_PER_PAGE);
  return (
    <section className="fv-pn" aria-label="Open invitations">
      <div className="fv-ph frt-ph">
        <h2>Open invitations</h2>
        {data.invites.length > 0 && <span className="frt-cnt">{data.invites.length}</span>}
        <span className="fv-sp" />
        {inv.paged && <PageButtons page={inv.pg.page} pages={inv.pg.pages} onPage={inv.setPage} label="invitations" />}
      </div>
      {data.invites.length === 0 && <p className="fv-empty frt-pad">No open invitations.</p>}
      {inv.slice.map((i) => (
        <div key={i.id} className="frt-ir">
          <span className="frt-ini" aria-hidden="true">{initial(i.username)}</span>
          <span className="frt-relt">
            <b>{i.username}</b>
            <small>
              invited by {i.invitedBy} · ends in {formatLeft(i.expiresAt - now)}
            </small>
          </span>
          <button type="button" className="fv-btn" disabled={busy} onClick={() => void run(() => api.cancelInvite(i.id), { ok: 'Invitation cancelled.' })}>
            Cancel
          </button>
        </div>
      ))}
    </section>
  );
}

function Applications({ tribe }: Pick<MemberProps, 'tribe'>) {
  const { data, busy, run } = useTribe();
  const { now } = useGame();
  const maxMembers = useRules().tribe.maxMembers;
  const isFull = tribe.members >= maxMembers;
  const app = usePaged(data.applications, APPLICATIONS_PER_PAGE);
  return (
    <section className="fv-pn frt-grow" aria-label="Applications">
      <div className="fv-ph frt-ph">
        <h2>Applications</h2>
        {data.applications.length > 0 && <span className="frt-cnt">{data.applications.length}</span>}
        <span className="fv-sp" />
        <span className="fv-mut">
          Recruitment: {RECRUITMENT_NAME[tribe.recruitment].toLowerCase()} · {tribe.members} of {maxMembers}
          {isFull ? ' (full)' : ''}
        </span>
        {app.paged && <PageButtons page={app.pg.page} pages={app.pg.pages} onPage={app.setPage} label="applications" />}
      </div>
      {data.applications.length === 0 && <p className="fv-empty frt-pad">No applications waiting.</p>}
      {app.slice.map((a) => (
        <div key={a.id} className="frt-ar">
          <span className="frt-ini is-big" aria-hidden="true">{initial(a.username)}</span>
          <span className="frt-relt">
            <span className="frt-arn">
              <b>{a.username}</b>
              <small>
                {formatInt(a.points)} points · {formatAgo(a.createdAt, now)}
              </small>
            </span>
            {a.message ? <span className="frt-am">{a.message}</span> : <small className="fv-mut">No message.</small>}
          </span>
          <button type="button" className="fv-btn fv-btn-g" disabled={busy || isFull} onClick={() => void run(() => api.acceptApplication(a.id), { ok: `${a.username} joined.` })}>
            Accept
          </button>
          <button type="button" className="fv-btn" disabled={busy} onClick={() => void run(() => api.declineApplication(a.id))}>
            Decline
          </button>
        </div>
      ))}
      {isFull && data.applications.length > 0 && <p className="frt-why frt-padx">Tribe full.</p>}
    </section>
  );
}

export function FrameTribeRecruit({ tribe, role }: MemberProps) {
  const maxMembers = useRules().tribe.maxMembers;
  const canInvite = canTribe(role, 'invite');
  const canApps = canTribe(role, 'handle_applications');
  return (
    <div className="frt-two">
      {canApps ? (
        <Applications tribe={tribe} />
      ) : (
        <section className="fv-pn frt-grow" aria-label="Recruitment">
          <div className="fv-ph frt-ph">
            <h2>Recruitment: {RECRUITMENT_NAME[tribe.recruitment].toLowerCase()}</h2>
          </div>
          <p className="fv-empty frt-pad">
            {tribe.members} of {maxMembers} members{tribe.members >= maxMembers ? ' (full)' : ''}. Officers with the right handle applications.
          </p>
        </section>
      )}
      {canInvite && (
        <div className="frt-side frt-side-d">
          <InvitePanel />
          <OpenInvites />
        </div>
      )}
    </div>
  );
}
