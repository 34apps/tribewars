// Public page of any tribe: description, members, relations, and join controls for tribeless viewers.

import { useEffect, useMemo, useState } from 'react';
import type { TribeDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { ChieftainAvatar } from '../art/Chieftain.tsx';
import { formatCoords, formatDate, formatInt } from '../format.ts';
import { useGame, useRules } from '../game.ts';
import type { TribeTarget } from '../game.ts';
import { KindBadge, PlainText, RECRUITMENT_NAME, RoleBadge, TribeLabel } from './bits.tsx';
import { useTribe } from './context.ts';
import { ApplyForm, JoinButton } from './Join.tsx';

export function PublicTribe({ target, onBack }: { target: TribeTarget; onBack: () => void }) {
  const { data, openTribe } = useTribe();
  const { showOnMap } = useGame();
  const maxMembers = useRules().tribe.maxMembers;
  const [tribe, setTribe] = useState<TribeDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setTribe(null);
    setError(null);
    api.tribe(target.id)
      .then((t) => {
        if (!cancelled) setTribe(t);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [target, attempt]);

  const members = useMemo(
    () => (tribe ? [...tribe.memberList].sort((a, b) => b.points - a.points || a.username.localeCompare(b.username)) : []),
    [tribe],
  );
  const tribeless = data.tribe === null;
  const mine = tribe !== null && data.tribe?.id === tribe.id;

  return (
    <>
      <button className="btn btn-small back" onClick={onBack}>
        ← Back
      </button>
      {error && (
        <div className="card">
          <p className="form-error" role="alert">{error}</p>
          <button className="btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      )}
      {!tribe && !error && <p className="muted">Loading tribe…</p>}
      {tribe && (
        <>
          <section className="card" aria-labelledby="pub-title">
            <h1 id="pub-title" className="page-title tribe-title"><TribeLabel tag={tribe.tag} name={tribe.name} /></h1>
            <dl className="facts">
              <div><dt>Rank</dt><dd>#{tribe.rank}</dd></div>
              <div><dt>Points</dt><dd>{formatInt(tribe.points)}</dd></div>
              <div><dt>Members</dt><dd>{tribe.members}/{maxMembers}</dd></div>
              <div><dt>Recruitment</dt><dd>{RECRUITMENT_NAME[tribe.recruitment]}</dd></div>
              <div><dt>Founded</dt><dd>{formatDate(tribe.createdAt)}</dd></div>
            </dl>
            {mine && <p className="notice notice-ok">This is your tribe.</p>}
            {tribeless && (
              <div className="join-line">
                <JoinButton t={tribe} onApply={() => setApplying(true)} />
                {tribe.recruitment === 'invite' && <span className="muted small">Ask an officer to invite you.</span>}
              </div>
            )}
            {tribeless && applying && <ApplyForm t={tribe} onDone={() => setApplying(false)} />}
          </section>

          <section className="card" aria-labelledby="pub-desc">
            <h2 id="pub-desc" className="card-title">About</h2>
            {tribe.description ? <PlainText text={tribe.description} /> : <p className="muted">No description yet.</p>}
          </section>

          <section className="card" aria-labelledby="pub-members">
            <h2 id="pub-members" className="card-title">Members <span className="muted">{members.length}</span></h2>
            <ul className="member-list">
              {members.map((m) => (
                <li key={m.playerId} className="member-row">
                  <ChieftainAvatar id={m.chieftain} size={40} className="member-avatar" />
                  <div className="member-body">
                    <div className="member-main">
                      <strong className="member-name">{m.username}</strong>
                      <RoleBadge role={m.role} />
                    </div>
                    <div className="member-sub">
                      <span>{formatInt(m.points)} pts</span>
                      <button className="link" onClick={() => showOnMap(m.villageX, m.villageY)}>
                        {formatCoords(m.villageX, m.villageY)} on map
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card" aria-labelledby="pub-rel">
            <h2 id="pub-rel" className="card-title">Relations</h2>
            {tribe.relations.length === 0 ? (
              <p className="muted">No alliances, pacts or wars.</p>
            ) : (
              <ul className="stack">
                {tribe.relations.map((r) => (
                  <li key={r.id} className="relation-row">
                    <KindBadge kind={r.kind} />
                    <button className="link" onClick={() => openTribe({ id: r.other.id })}>
                      <TribeLabel tag={r.other.tag} name={r.other.name} />
                    </button>
                    {r.endsAt !== null && <span className="muted small">ending</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
