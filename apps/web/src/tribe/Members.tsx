import { useMemo, useState } from 'react';
import { canTribe } from '@clanfire/engine';
import type { TribeAction, TribeMemberDto } from '@clanfire/engine';
import { api } from '../api.ts';
import { MemberBadges } from '../components/Badges.tsx';
import { ChieftainAvatar } from '../art/Chieftain.tsx';
import { formatAgo, formatCoords, formatInt } from '../format.ts';
import { useGame, useRules } from '../game.ts';
import { RoleBadge } from './bits.tsx';
import { memberFlags } from './memberFlags.ts';
import { useTribe } from './context.ts';
import type { MemberProps } from './context.ts';
import type { RunAction } from './useMyTribe.ts';

/** One grantable right as a checkbox (leader only). */
export function GrantBox({ label, right, grants, m, busy, run, on, off }: { label: string; right: TribeAction; grants: TribeAction[]; m: TribeMemberDto; busy: boolean; run: RunAction; on: string; off: string }) {
  const has = grants.includes(right);
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={has}
        disabled={busy}
        onChange={() =>
          void run(
            async () => {
              await api.setGrants(m.playerId, has ? grants.filter((g) => g !== right) : [...grants, right]);
              return api.myTribe();
            },
            { ok: has ? off : on },
          )
        }
      />{' '}
      {label}
    </label>
  );
}

/** What `role` may do to member `m`, and the confirmed actions. Shared by the phone row and the desktop Manage panel. */
export function useMemberOps(m: TribeMemberDto, role: MemberProps['role']) {
  const { player } = useGame();
  const { busy, run, confirm } = useTribe();
  const isMe = m.playerId === player.id;
  const { canSetRole, canRemove, canTransfer, canGrant, hasActions } = memberFlags(role, m, isMe);
  const grants: TribeAction[] = m.grants ?? [];

  async function remove() {
    const ok = await confirm({
      title: `Remove ${m.username}?`,
      body: <p>{m.username} loses access to chat and log.</p>,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (ok) await run(() => api.kickMember(m.playerId), { ok: `${m.username} was removed.` });
  }

  async function transfer() {
    const ok = await confirm({
      title: `Make ${m.username} the leader?`,
      body: <p>You become an officer and lose disband and role rights.</p>,
      confirmLabel: 'Transfer leadership',
      danger: true,
    });
    if (ok) await run(() => api.transferLeadership(m.playerId), { ok: `${m.username} is the new leader.` });
  }

  return { isMe, canSetRole, canRemove, canTransfer, canGrant, hasActions, grants, remove, transfer, busy, run };
}

/** Leave / disband with their confirmations (phone Members card and desktop Leaving card). */
export function useLeaveActions(tribe: MemberProps['tribe'], role: MemberProps['role']) {
  const { busy, run, confirm } = useTribe();
  const leaderBlocked = role === 'leader' && tribe.members > 1;
  const label = `[${tribe.tag}] ${tribe.name}`;

  async function leave() {
    const last = tribe.members <= 1;
    const ok = await confirm({
      title: `Leave ${label}?`,
      body: (
        <p>
          You lose access to chat and log.{last && ' The tribe is disbanded.'}
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
          Members, invitations and relations are deleted. This cannot be undone.
        </p>
      ),
      confirmLabel: 'Disband tribe',
      danger: true,
    });
    if (ok) await run(() => api.disbandTribe(), { ok: 'The tribe was disbanded.' });
  }

  return { busy, leaderBlocked, leave, disband };
}

function MemberRow({ m, role }: { m: TribeMemberDto; role: MemberProps['role'] }) {
  const { showOnMap, now } = useGame();
  const [open, setOpen] = useState(false);
  const { isMe, canSetRole, canRemove, canTransfer, canGrant, hasActions, grants, remove, transfer, busy, run } = useMemberOps(m, role);

  return (
    <li className="member-row">
      <ChieftainAvatar id={m.chieftain} size={40} className="member-avatar" />
      <div className="member-body">
        <div className="member-main">
          <strong className="member-name">{m.username}</strong>
          {isMe && <span className="muted small">(you)</span>}
          <RoleBadge role={m.role} />
          <MemberBadges badges={m.badges} />
          {hasActions && (
            <button className="btn btn-small member-manage" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              Manage
            </button>
          )}
        </div>
        <div className="member-sub">
          <span>{formatInt(m.points)} pts</span>
          <button className="link" onClick={() => showOnMap(m.villageX, m.villageY)}>
            {formatCoords(m.villageX, m.villageY)}
          </button>
          <span className="muted">joined {formatAgo(m.joinedAt, now)}</span>
          {m.lastActive !== undefined && (
            <span className={m.online ? undefined : 'muted'}>
              {m.online ? '● Online' : `Seen ${formatAgo(m.lastActive, now)}`}
            </span>
          )}
        </div>
        {open && hasActions && (
          <div className="member-actions">
            {canGrant && (
              <>
                <GrantBox label="See online status" right="view_activity" grants={grants} m={m} busy={busy} run={run} on={`${m.username} sees online status.`} off={`${m.username} no longer sees online status.`} />
                <GrantBox label="Projects" right="projects" grants={grants} m={m} busy={busy} run={run} on={`${m.username} runs projects.`} off={`${m.username} no longer runs projects.`} />
              </>
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
  const maxMembers = useRules().tribe.maxMembers;
  const { busy, leaderBlocked, leave, disband } = useLeaveActions(tribe, role);
  const sorted = useMemo(
    () => [...tribe.memberList].sort((a, b) => b.points - a.points || a.username.localeCompare(b.username)),
    [tribe.memberList],
  );

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
          <p className="muted">Hand over leadership first.</p>
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
