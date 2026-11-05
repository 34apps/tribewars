import { useMemo, useState } from 'react';
import { canKick, canTribe } from '@clanfire/engine';
import type { TribeAction, TribeMemberDto } from '@clanfire/engine';
import { api } from '../api.ts';
import { ChieftainAvatar } from '../art/Chieftain.tsx';
import { formatAgo, formatCoords, formatInt } from '../format.ts';
import { useGame, useRules } from '../game.ts';
import { RoleBadge } from './bits.tsx';
import { useTribe } from './context.ts';
import type { MemberProps } from './context.ts';

function MemberRow({ m, role }: { m: TribeMemberDto; role: MemberProps['role'] }) {
  const { player, showOnMap, now } = useGame();
  const { busy, run, confirm } = useTribe();
  const [open, setOpen] = useState(false);
  const isMe = m.playerId === player.id;

  const canSetRole = canTribe(role, 'set_roles') && !isMe && m.role !== 'leader';
  const canRemove = !isMe && canKick(role, m.role);
  const canTransfer = canTribe(role, 'transfer_leadership') && !isMe && m.role !== 'leader';
  // Only the leader sets individual rights (the server checks it too); officers already have view_activity by role.
  const canGrant = role === 'leader' && !isMe && m.role === 'member';
  const hasActions = canSetRole || canRemove || canTransfer || canGrant;
  const grants: TribeAction[] = m.grants ?? [];
  const seesActivity = grants.includes('view_activity');

  async function remove() {
    const ok = await confirm({
      title: `Remove ${m.username}?`,
      body: <p>{m.username} leaves the tribe and loses access to its chat and log. They can apply again later.</p>,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (ok) await run(() => api.kickMember(m.playerId), { ok: `${m.username} was removed.` });
  }

  async function transfer() {
    const ok = await confirm({
      title: `Make ${m.username} the leader?`,
      body: <p>{m.username} becomes the leader. You become an officer and lose the right to disband the tribe or change roles.</p>,
      confirmLabel: 'Transfer leadership',
      danger: true,
    });
    if (ok) await run(() => api.transferLeadership(m.playerId), { ok: `${m.username} is the new leader.` });
  }

  return (
    <li className="member-row">
      <ChieftainAvatar id={m.chieftain} size={40} className="member-avatar" />
      <div className="member-body">
        <div className="member-main">
          <strong className="member-name">{m.username}</strong>
          {isMe && <span className="muted small">(you)</span>}
          <RoleBadge role={m.role} />
          {hasActions && (
            <button className="btn btn-small member-manage" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              Manage
            </button>
          )}
        </div>
        <div className="member-sub">
          <span>{formatInt(m.points)} pts</span>
          <button className="link" onClick={() => showOnMap(m.villageX, m.villageY)}>
            {formatCoords(m.villageX, m.villageY)} on map
          </button>
          <span className="muted">joined {formatAgo(m.joinedAt, now)}</span>
          {m.lastActive !== undefined && (
            <span className={m.online ? undefined : 'muted'}>
              {m.online ? '● Online' : `Offline · last seen ${formatAgo(m.lastActive, now)}`}
            </span>
          )}
        </div>
        {open && hasActions && (
          <div className="member-actions">
            {canGrant && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={seesActivity}
                  disabled={busy}
                  onChange={() =>
                    void run(
                      async () => {
                        await api.setGrants(m.playerId, seesActivity ? grants.filter((g) => g !== 'view_activity') : [...grants, 'view_activity']);
                        return api.myTribe();
                      },
                      { ok: seesActivity ? `${m.username} can no longer see who is online.` : `${m.username} can now see who is online.` },
                    )
                  }
                />{' '}
                Can see members' online status
              </label>
            )}
            {canSetRole && m.role === 'member' && (
              <button className="btn" disabled={busy} onClick={() => void run(() => api.setMemberRole(m.playerId, 'officer'), { ok: `${m.username} is now an officer.` })}>
                Make officer
              </button>
            )}
            {canSetRole && m.role === 'officer' && (
              <button className="btn" disabled={busy} onClick={() => void run(() => api.setMemberRole(m.playerId, 'member'), { ok: `${m.username} is now a member.` })}>
                Make member
              </button>
            )}
            {canTransfer && (
              <button className="btn" disabled={busy} onClick={() => void transfer()}>
                Make leader
              </button>
            )}
            {canRemove && (
              <button className="btn btn-danger-outline" disabled={busy} onClick={() => void remove()}>
                Remove
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function Members({ tribe, role }: MemberProps) {
  const { busy, run, confirm } = useTribe();
  const maxMembers = useRules().tribe.maxMembers;
  const sorted = useMemo(
    () => [...tribe.memberList].sort((a, b) => b.points - a.points || a.username.localeCompare(b.username)),
    [tribe.memberList],
  );
  const leaderBlocked = role === 'leader' && tribe.members > 1;
  const label = `[${tribe.tag}] ${tribe.name}`;

  async function leave() {
    const last = tribe.members <= 1;
    const ok = await confirm({
      title: `Leave ${label}?`,
      body: (
        <p>
          You lose access to the tribe chat and log.
          {last && ' You are the last member, so the tribe is disbanded.'} You can join or found another tribe later.
        </p>
      ),
      confirmLabel: 'Leave tribe',
      danger: true,
    });
    if (ok) await run(() => api.leaveTribe(), { ok: 'You left the tribe.' });
  }

  async function disband() {
    const ok = await confirm({
      title: `Disband ${label}?`,
      body: (
        <p>
          Every member is removed, and all invitations, applications, proposals and relations are deleted. The name and tag
          become free. This cannot be undone.
        </p>
      ),
      confirmLabel: 'Disband tribe',
      danger: true,
    });
    if (ok) await run(() => api.disbandTribe(), { ok: 'The tribe was disbanded.' });
  }

  return (
    <>
      <section className="card" aria-labelledby="mem-title">
        <h2 id="mem-title" className="card-title">
          Members <span className="muted">{tribe.members}/{maxMembers}</span>
        </h2>
        <ul className="member-list">
          {sorted.map((m) => (
            <MemberRow key={m.playerId} m={m} role={role} />
          ))}
        </ul>
      </section>

      <section className="card stack" aria-labelledby="leave-title">
        <h2 id="leave-title" className="card-title">Leaving</h2>
        {leaderBlocked && (
          <p className="muted">
            You lead this tribe. Make another member the leader (Manage on their row) before you leave.
          </p>
        )}
        <div className="form-row wrap">
          <button className="btn btn-danger-outline" disabled={busy || leaderBlocked} onClick={() => void leave()}>
            Leave tribe
          </button>
          {canTribe(role, 'disband') && (
            <button className="btn btn-danger-outline" disabled={busy} onClick={() => void disband()}>
              Disband tribe
            </button>
          )}
        </div>
      </section>
    </>
  );
}
