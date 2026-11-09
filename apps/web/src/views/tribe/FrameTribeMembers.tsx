// The Members sub-tab of the desktop Tribe page (picture: design/proposals/ingame-pages/mix-tribe-members-1440.png): the members as a
// table with paging (nothing scrolls), the picked member's actions in a side panel, and the Leaving card.

import { useMemo, useState } from 'react';
import { canTribe } from '@clanfire/engine';
import type { TribeMemberDto } from '@clanfire/engine';
import { api } from '../../api.ts';
import { ChieftainAvatar } from '../../art/Chieftain.tsx';
import { MemberBadges } from '../../components/Badges.tsx';
import { formatAgo, formatCoords, formatInt } from '../../format.ts';
import { useGame, useRules } from '../../game.ts';
import { RoleBadge } from '../../tribe/bits.tsx';
import { useTribe } from '../../tribe/context.ts';
import type { MemberProps } from '../../tribe/context.ts';
import { GrantBox, useLeaveActions, useMemberOps } from '../../tribe/Members.tsx';
import { memberFlags } from '../../tribe/memberFlags.ts';
import { ROLE_NAME } from '../../relations.ts';
import { pageSlice, paging } from '../reports/frame-reports-logic.ts';
import { Chev } from '../village/FrameParts.tsx';
import { MEMBERS_PER_PAGE, pickedMember, shortDate, sortMembers } from './frame-tribe-logic.ts';

function ManagePanel({ m, role }: { m: TribeMemberDto; role: MemberProps['role'] }) {
  const { showOnMap, now } = useGame();
  const { isMe, canSetRole, canRemove, canTransfer, canGrant, hasActions, grants, remove, transfer, busy, run } = useMemberOps(m, role);
  return (
    <section className="fv-pn frt-manage" aria-label={`Member ${m.username}`}>
      <div className="fv-ph frt-ph">
        <h2>{hasActions ? `Manage ${m.username}` : m.username}</h2>
      </div>
      <div className="frt-mg">
        <div className="frt-mgh">
          <ChieftainAvatar id={m.chieftain} size={48} className="frt-av" />
          <span className="frt-mgt">
            <b>
              {m.username}
              {isMe && <span className="fv-mut"> (you)</span>}
            </b>
            <small>
              {ROLE_NAME[m.role]} · {formatInt(m.points)} points · joined {shortDate(m.joinedAt)}
            </small>
          </span>
        </div>
        <div className="frt-mgl">
          <MemberBadges badges={m.badges} />
          <button type="button" className="fv-lk" onClick={() => showOnMap(m.villageX, m.villageY)}>
            Village {formatCoords(m.villageX, m.villageY)} <Chev />
          </button>
          {m.lastActive !== undefined && <span className="fv-mut">{m.online ? 'Online now' : `Seen ${formatAgo(m.lastActive, now)}`}</span>}
        </div>
        {!hasActions && <p className="fv-empty">{isMe ? 'This is you.' : 'You have no actions for this member.'}</p>}
        {canGrant && (
          <div className="frt-grants">
            <GrantBox label="See online status" right="view_activity" grants={grants} m={m} busy={busy} run={run} on={`${m.username} sees online status.`} off={`${m.username} no longer sees online status.`} />
            <GrantBox label="Projects" right="projects" grants={grants} m={m} busy={busy} run={run} on={`${m.username} runs projects.`} off={`${m.username} no longer runs projects.`} />
          </div>
        )}
        {(canSetRole || canTransfer) && (
          <div className="frt-mgb">
            {canSetRole && m.role === 'member' && (
              <button type="button" className="fv-btn" disabled={busy} onClick={() => void run(() => api.setMemberRole(m.playerId, 'officer'), { ok: `${m.username} is now an officer.` })}>
                Make officer
              </button>
            )}
            {canSetRole && m.role === 'officer' && (
              <button type="button" className="fv-btn" disabled={busy} onClick={() => void run(() => api.setMemberRole(m.playerId, 'member'), { ok: `${m.username} is now a member.` })}>
                Make member
              </button>
            )}
            {canTransfer && (
              <button type="button" className="fv-btn" disabled={busy} onClick={() => void transfer()}>
                Make leader
              </button>
            )}
          </div>
        )}
        {canRemove && (
          <button type="button" className="fv-btn frt-del" disabled={busy} onClick={() => void remove()}>
            Remove
          </button>
        )}
      </div>
    </section>
  );
}

function LeavingCard({ tribe, role }: MemberProps) {
  const { busy, leaderBlocked, leave, disband } = useLeaveActions(tribe, role);
  return (
    <section className="fv-pn frt-leaving" aria-label="Leaving">
      <div className="fv-ph frt-ph">
        <h2>Leaving</h2>
      </div>
      <div className="frt-mg">
        <p className="fv-empty">
          {leaderBlocked ? 'As leader you can leave once you are the last member or have handed over the lead.' : 'You lose access to chat and log when you leave.'}
        </p>
        <div className="frt-mgb">
          <button type="button" className="fv-btn frt-del" disabled={busy || leaderBlocked} onClick={() => void leave()}>
            Leave tribe
          </button>
          {canTribe(role, 'disband') && (
            <button type="button" className="fv-btn frt-del" disabled={busy} onClick={() => void disband()}>
              Disband
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export function FrameTribeMembers({ tribe, role }: MemberProps) {
  const { player, showOnMap, now } = useGame();
  const maxMembers = useRules().tribe.maxMembers;
  const sorted = useMemo(() => sortMembers(tribe.memberList), [tribe.memberList]);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const manageable = (m: TribeMemberDto) => memberFlags(role, m, m.playerId === player.id).hasActions;
  const current = pickedMember(sorted, picked, manageable);
  const pg = paging(sorted.length, page, MEMBERS_PER_PAGE);
  const rows = pageSlice(sorted, pg.page, MEMBERS_PER_PAGE);
  const showActivity = sorted.some((m) => m.lastActive !== undefined);
  return (
    <div className="frt-mem">
      <section className="fv-pn frt-table" aria-label="Members">
        <div className="fv-ph frt-ph">
          <h2>Members</h2>
          <span className="frt-cnt">{tribe.members} / {maxMembers}</span>
          <span className="fv-sp" />
          <span className="fv-mut">by points</span>
        </div>
        <table className="frt-mt3">
          <thead>
            <tr>
              <th style={{ width: 46 }}>#</th>
              <th>Player</th>
              <th>Role</th>
              <th className="n">Points</th>
              <th>Village</th>
              <th>Joined</th>
              {showActivity && <th>Last seen</th>}
              <th style={{ width: 112 }}><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m, i) => {
              const isMe = m.playerId === player.id;
              const can = manageable(m);
              const sel = current?.playerId === m.playerId;
              return (
                <tr key={m.playerId} className={sel ? 'is-sel' : undefined} onClick={() => setPicked(m.playerId)}>
                  <td className="rk">{pg.from + i}</td>
                  <td>
                    <span className="frt-pl">
                      <ChieftainAvatar id={m.chieftain} size={30} className="frt-av" />
                      <b>{m.username}</b>
                      {isMe && <span className="fv-mut">(you)</span>}
                      <MemberBadges badges={m.badges} />
                    </span>
                  </td>
                  <td><RoleBadge role={m.role} /></td>
                  <td className="n"><b>{formatInt(m.points)}</b></td>
                  <td>
                    <button
                      type="button"
                      className="fv-lk"
                      onClick={(e) => {
                        e.stopPropagation();
                        showOnMap(m.villageX, m.villageY);
                      }}
                    >
                      {formatCoords(m.villageX, m.villageY)}
                    </button>
                  </td>
                  <td className="fv-mut">{shortDate(m.joinedAt)}</td>
                  {showActivity && (
                    <td>{m.lastActive === undefined ? '' : m.online ? <span className="frt-onl">Online</span> : <span className="fv-mut">{formatAgo(m.lastActive, now)}</span>}</td>
                  )}
                  <td className="act">
                    {can && (
                      <button type="button" className={`fv-btn${sel ? ' fv-btn-g' : ''}`} aria-pressed={sel} onClick={() => setPicked(m.playerId)}>
                        Manage
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="frt-pgr">
          <span className="fv-mut">{pg.total === 0 ? '0 members' : `${pg.from}–${pg.to} of ${pg.total}`}</span>
          <span className="fv-sp" />
          <button type="button" className="fv-pg" aria-label="Previous members" disabled={pg.page <= 0} onClick={() => setPage(pg.page - 1)}>
            <Chev flip size={16} />
          </button>
          <button type="button" className="fv-pg" aria-label="More members" disabled={pg.page >= pg.pages - 1} onClick={() => setPage(pg.page + 1)}>
            <Chev size={16} />
          </button>
        </div>
      </section>
      <div className="frt-side">
        {current && <ManagePanel key={current.playerId} m={current} role={role} />}
        <LeavingCard tribe={tribe} role={role} />
      </div>
    </div>
  );
}
