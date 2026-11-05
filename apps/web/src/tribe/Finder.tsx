// What a player without a tribe sees: invitations, applications, the ranked tribe list and the found form.

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  PLAYER_MAX_APPLICATIONS,
  TRIBE_DESCRIPTION_MAX,
  TRIBE_FOUND_HALL_LEVEL,
  TRIBE_NAME_MAX,
  TRIBE_TAG_MAX,
  checkTribeDescription,
  checkTribeIdentity,
  normalizeTribeName,
  normalizeTribeTag,
} from '@clanfire/engine';
import type { Recruitment, TribeSummaryDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { formatInt, formatLeft } from '../format.ts';
import { useGame, useRules } from '../game.ts';
import { CharCount, PlainText, RECRUITMENT_HINT, RECRUITMENT_NAME, RECRUITMENT_OPTIONS, Segmented, TribeLabel } from './bits.tsx';
import { useTribe } from './context.ts';
import { ApplyForm, JoinButton } from './Join.tsx';
import { Icon } from '../art/Icon.tsx';

function Invitations() {
  const { data, busy, run, openTribe } = useTribe();
  const { now } = useGame();
  if (data.invites.length === 0) return null;
  return (
    <section className="card" aria-labelledby="inv-title">
      <h2 id="inv-title" className="card-title">Your invitations</h2>
      <ul className="stack">
        {data.invites.map((i) => (
          <li key={i.id} className="invite-row">
            <div className="invite-text">
              <button className="link" onClick={() => openTribe({ id: i.tribe.id })}>
                <TribeLabel tag={i.tribe.tag} name={i.tribe.name} />
              </button>
              <div className="muted small">
                Invited by {i.invitedBy} · expires in {formatLeft(i.expiresAt - now)}
              </div>
            </div>
            <div className="row-actions">
              <button className="btn btn-primary btn-small" disabled={busy} onClick={() => void run(() => api.acceptInvite(i.id), { ok: `You joined ${i.tribe.name}.` })}>
                Accept
              </button>
              <button className="btn btn-small" disabled={busy} onClick={() => void run(() => api.declineInvite(i.id))}>
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Applications() {
  const { data, busy, run, openTribe } = useTribe();
  if (data.applications.length === 0) return null;
  return (
    <section className="card" aria-labelledby="app-title">
      <h2 id="app-title" className="card-title">
        Your applications <span className="muted">{data.applications.length}/{PLAYER_MAX_APPLICATIONS}</span>
      </h2>
      <ul className="stack">
        {data.applications.map((a) => (
          <li key={a.id} className="invite-row">
            <div className="invite-text">
              <button className="link" onClick={() => openTribe({ id: a.tribe.id })}>
                <TribeLabel tag={a.tribe.tag} name={a.tribe.name} />
              </button>
              {a.message && <PlainText className="quote small" text={a.message} />}
            </div>
            <div className="row-actions">
              <button className="btn btn-small" disabled={busy} onClick={() => void run(() => api.withdrawApplication(a.id), { ok: 'Application withdrawn.' })}>
                Withdraw
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TribeList() {
  const { openTribe } = useTribe();
  const maxMembers = useRules().tribe.maxMembers;
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [tribes, setTribes] = useState<TribeSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<number | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setQuery(q.trim()), 250);
    return () => window.clearTimeout(id);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    api
      .tribes(query)
      .then((res) => {
        if (cancelled) return;
        setTribes(res.tribes);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <section className="card" aria-labelledby="find-title">
      <h2 id="find-title" className="card-title">Find a tribe</h2>
      <label className="field">
        <span className="visually-hidden">Search by name or tag</span>
        <input
          className="input"
          type="search"
          inputMode="search"
          autoComplete="off"
          placeholder="Search by name or tag"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {tribes === null && !error && <p className="muted pad-top">Loading…</p>}
      {tribes !== null && tribes.length === 0 && (
        <p className="muted pad-top">{query ? 'No tribe matches that search.' : 'No tribes yet. Found the first one below.'}</p>
      )}
      {tribes !== null && tribes.length > 0 && (
        <ul className="tribe-list">
          {tribes.map((t) => (
            <li key={t.id} className="tribe-row">
              <button className="tribe-row-main" onClick={() => openTribe({ id: t.id })}>
                <span className="rank" aria-label={`Rank ${t.rank}`}>#{t.rank}</span>
                <span className="tribe-row-text">
                  <span className="tribe-row-title"><TribeLabel tag={t.tag} name={t.name} /></span>
                  <span className="muted small">
                    {t.members}/{maxMembers} members · {formatInt(t.points)} pts
                  </span>
                  <span className="muted small">Recruitment: {RECRUITMENT_NAME[t.recruitment]}</span>
                </span>
              </button>
              <div className="tribe-row-action">
                <JoinButton t={t} onApply={() => setApplying(t.id)} />
              </div>
              {applying === t.id && <ApplyForm t={t} onDone={() => setApplying(null)} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FoundForm() {
  const { live } = useGame();
  const { run, busy } = useTribe();
  const hall = live.buildings.hall;
  const locked = hall < TRIBE_FOUND_HALL_LEVEL;
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [recruitment, setRecruitment] = useState<Recruitment>('application');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const normName = normalizeTribeName(name);
  const normTag = normalizeTribeTag(tag);
  const identity = checkTribeIdentity(normName, normTag);
  const desc = checkTribeDescription(description);
  let why: string | null = null;
  if (locked) why = `Needs Town Hall ${TRIBE_FOUND_HALL_LEVEL}`;
  else if (name.trim() === '' || tag.trim() === '') why = 'Choose a name and a tag';
  else if (!identity.ok) why = identity.message;
  else if (!desc.ok) why = desc.message;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (why || busy || !identity.ok || !desc.ok) return;
    const err = await run(
      () => api.createTribe({ name: identity.name, tag: identity.tag, recruitment, ...(desc.text ? { description: desc.text } : {}) }),
      { ok: `You founded ${identity.name}.`, toastError: false },
    );
    setError(err);
  }

  return (
    <details className="card fold">
      <summary className="fold-summary">
        <span className="card-title">Found a tribe</span>
        {locked && (
          <span className="tag tag-warn">
            <Icon name="lock" size={18} className="inline-icon" /> Needs Town Hall {TRIBE_FOUND_HALL_LEVEL}
          </span>
        )}
      </summary>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        {locked && (
          <p className="notice">
            Your Town Hall is level {hall}. Raise it to level {TRIBE_FOUND_HALL_LEVEL} in the Village tab to found a tribe. Joining one has no requirement.
          </p>
        )}
        <fieldset className="fieldset" disabled={locked}>
          <label className="field">
            <span>Name</span>
            <input
              className="input"
              value={name}
              maxLength={TRIBE_NAME_MAX + 10}
              autoComplete="off"
              placeholder="e.g. Iron Wolves"
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
          </label>
          <label className="field">
            <span>Tag <span className="hint">2-6 letters or digits, shown as [TAG]</span></span>
            <input
              className="input input-tag"
              value={tag}
              maxLength={TRIBE_TAG_MAX}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="WOLF"
              onChange={(e) => {
                setTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                setError(null);
              }}
            />
          </label>
          <div className="field">
            <span>Recruitment</span>
            <Segmented label="Recruitment" value={recruitment} options={RECRUITMENT_OPTIONS} onChange={setRecruitment} />
            <span className="hint">{RECRUITMENT_HINT[recruitment]}</span>
          </div>
          <label className="field">
            <span>Description <span className="hint">optional</span></span>
            <textarea className="input textarea" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <div className="form-row">
            <CharCount value={description} max={TRIBE_DESCRIPTION_MAX} />
          </div>
        </fieldset>
        <p className="muted small">Name and tag are permanent. You become the leader.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={!!why || busy}>
          {locked ? `Needs Town Hall ${TRIBE_FOUND_HALL_LEVEL}` : busy ? 'Founding…' : 'Found tribe'}
        </button>
        {why && !locked && <div className="why">{why}</div>}
      </form>
    </details>
  );
}

export function Finder() {
  return (
    <>
      <Invitations />
      <Applications />
      <TribeList />
      <FoundForm />
    </>
  );
}
