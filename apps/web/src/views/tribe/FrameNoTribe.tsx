// The desktop Tribe page for a player without a tribe (owner pick "A", design/proposals/ingame-pages/notribe-a-1440.png): a header with
// stat tiles and the Domination mini bar, the ranked "Find a tribe" table on the left, and on the right my invitations, my applications
// and the "Found a tribe" form. A fixed 900 px page (the table pages, nothing scrolls). Same data and actions as the phone's Finder.
// Left out because the picture has no room for it: the optional tribe description of the found form (the phone still has it).

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  PLAYER_MAX_APPLICATIONS,
  TRIBE_FOUND_HALL_LEVEL,
  TRIBE_NAME_MAX,
  TRIBE_TAG_MAX,
  checkTribeIdentity,
  normalizeTribeName,
  normalizeTribeTag,
} from '@clanfire/engine';
import type { Recruitment, TribeSummaryDto } from '@clanfire/engine';
import { api, errorMessage } from '../../api.ts';
import { Icon } from '../../art/Icon.tsx';
import { barWidth, percentText } from '../../domination.ts';
import { formatInt, formatLeft } from '../../format.ts';
import { useGame, useRules } from '../../game.ts';
import { useDomination } from '../../hooks/useDomination.ts';
import { PlainText } from '../../tribe/bits.tsx';
import { useTribe } from '../../tribe/context.ts';
import { ApplyForm } from '../../tribe/Join.tsx';
import { Dialog } from '../army/FrameArmy.tsx';
import { searchTribes } from '../ranks/frame-ranks-logic.ts';
import { openRanksDomination } from '../ranks/FrameRanks.tsx';
import { Chev } from '../village/FrameParts.tsx';
import { usePaged, PageButtons } from './frame-tribe-bits.tsx';
import { shortDate } from './frame-tribe-logic.ts';
import { NOTRIBE_INVITES, NOTRIBE_ROWS, WHO_MAY_JOIN, joinAction, memberFill } from './frame-notribe-logic.ts';
import { setTribeFixed } from './tribe-fixed.ts';

const RECRUIT_CHOICES: Array<{ id: Recruitment; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'application', label: 'By application' },
  { id: 'invite', label: 'Invite only' },
];

/** The dark tag badge of a tribe row (decorative: the name next to it says the same). */
function TagBadge({ tag }: { tag: string }) {
  return (
    <span className={`frn-tg${tag.length > 3 ? ' is-long' : ''}`} aria-hidden="true">
      {tag}
    </span>
  );
}

// ---- Header -------------------------------------------------------------------------------------------------------------

function DominationTile() {
  const { navigate } = useGame();
  const { status } = useDomination();
  const share = status?.leader?.share ?? 0;
  return (
    <div className="frt-st frn-dom">
      <dt className="fv-up frn-dom-h">
        Domination
        <button
          type="button"
          className="fv-lk"
          onClick={() => {
            openRanksDomination();
            navigate('ranks');
          }}
        >
          Details <Chev size={14} />
        </button>
      </dt>
      <dd className="frn-dom-v">
        {status ? (
          <>
            <span>{status.leader ? `${status.leader.tag} ${percentText(share)}` : 'No leader'}</span>
            <span className="frn-dom-bar" role="img" aria-label={`${status.leader ? `${status.leader.name} holds ${percentText(share)}` : 'No tribe owns a village yet'}; ${percentText(status.winShare)} is needed`}>
              <i style={{ width: `${barWidth(share)}%` }} />
              <em style={{ left: `${barWidth(status.winShare)}%` }} />
            </span>
          </>
        ) : (
          <span className="fv-mut">…</span>
        )}
      </dd>
    </div>
  );
}

// ---- Left: Find a tribe -------------------------------------------------------------------------------------------------

function ActionCell({ t, onApply }: { t: TribeSummaryDto; onApply: () => void }) {
  const { data, busy, run } = useTribe();
  const maxMembers = useRules().tribe.maxMembers;
  const act = joinAction(t, { maxMembers, appliedTo: data.applications.map((a) => a.tribe.id), invitedBy: data.invites.map((i) => i.tribe.id) });
  if (act === 'invited') return <span className="fv-tag frn-tag-info">Invited</span>;
  if (act === 'full') return <span className="fv-tag">Full</span>;
  if (act === 'invite-only') return <span className="fv-tag">Invite only</span>;
  if (act === 'applied') return <span className="fv-tag frn-tag-ok">Applied</span>;
  if (act === 'join') {
    return (
      <button type="button" className="fv-btn fv-btn-g frn-b" disabled={busy} onClick={() => void run(() => api.joinTribe(t.id), { ok: `You joined ${t.name}.` })}>
        Join
      </button>
    );
  }
  const atLimit = data.applications.length >= PLAYER_MAX_APPLICATIONS;
  return (
    <button type="button" className="fv-btn frn-b" disabled={busy || atLimit} title={atLimit ? `You can have ${PLAYER_MAX_APPLICATIONS} applications open` : undefined} onClick={onApply}>
      Apply
    </button>
  );
}

function FindPanel({ tribes, error, reload }: { tribes: TribeSummaryDto[] | null; error: string | null; reload: () => void }) {
  const { data, openTribe } = useTribe();
  const maxMembers = useRules().tribe.maxMembers;
  const [q, setQ] = useState('');
  const [applying, setApplying] = useState<TribeSummaryDto | null>(null);
  const rows = useMemo(() => searchTribes(tribes ?? [], q), [tribes, q]);
  const { pg, slice, setPage, paged } = usePaged(rows, NOTRIBE_ROWS);
  const invitedIds = new Set(data.invites.map((i) => i.tribe.id));
  return (
    <section className="fv-pn frn-find" aria-label="Find a tribe">
      <div className="fv-ph frn-fh">
        <h2>Find a tribe</h2>
        {tribes && <span className="fv-cnt">{tribes.length}</span>}
        <span className="fv-sp" />
        <label className="frn-srch">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="M13 13l4.5 4.5" />
          </svg>
          <input
            type="search"
            value={q}
            placeholder="Name or tag"
            aria-label="Search tribes by name or tag"
            autoComplete="off"
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
          />
        </label>
      </div>
      {error ? (
        <p className="frn-msg" role="alert">
          {error} <button type="button" className="link" onClick={reload}>Retry</button>
        </p>
      ) : tribes === null ? (
        <p className="frn-msg" role="status">Loading…</p>
      ) : slice.length === 0 ? (
        <p className="frn-msg">{q.trim() ? 'No tribe matches that search.' : 'No tribes yet. Found the first one.'}</p>
      ) : (
        <div className="frn-tw">
          <table className="frn-t">
            <thead>
              <tr>
                <th scope="col" className="c-r">Rank</th>
                <th scope="col">Tribe</th>
                <th scope="col">Members</th>
                <th scope="col" className="n">Points</th>
                <th scope="col">Who may join</th>
                <th scope="col" className="c-a"><span className="visually-hidden">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {slice.map((t) => (
                <tr key={t.id} className={invitedIds.has(t.id) ? 'is-inv' : undefined}>
                  <td className="c-r"><span className="frn-rk">#{t.rank}</span></td>
                  <td>
                    <span className="frn-nm">
                      <TagBadge tag={t.tag} />
                      <button type="button" className="frn-lk" onClick={() => openTribe({ id: t.id })}>
                        {t.name}
                        <span className="visually-hidden"> [{t.tag}]</span>
                      </button>
                    </span>
                  </td>
                  <td>
                    <span className="frn-mb">
                      <b>{t.members}</b>
                      <span className="fv-mut">/ {maxMembers}</span>
                      <span className="frn-mbar" aria-hidden="true"><i style={{ width: `${memberFill(t.members, maxMembers)}%` }} /></span>
                    </span>
                  </td>
                  <td className="n"><b>{formatInt(t.points)}</b></td>
                  <td>{WHO_MAY_JOIN[t.recruitment]}</td>
                  <td className="c-a"><ActionCell t={t} onApply={() => setApplying(t)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="frn-foot">
        <span className="fv-mut">
          {rows.length === 0 ? '0 tribes' : `${pg.from}–${pg.to} of ${rows.length} tribes`} · click a name for its page
        </span>
        <span className="fv-sp" />
        {paged && <PageButtons page={pg.page} pages={pg.pages} onPage={setPage} label="tribes" />}
      </div>
      {applying && (
        <Dialog title={`Apply to ${applying.name}`} onClose={() => setApplying(null)}>
          <ApplyForm t={applying} onDone={() => setApplying(null)} />
        </Dialog>
      )}
    </section>
  );
}

// ---- Right: invitations, applications, found ----------------------------------------------------------------------------

function Invitations() {
  const { data, busy, run, openTribe } = useTribe();
  const { now } = useGame();
  const { pg, slice, setPage, paged } = usePaged(data.invites, NOTRIBE_INVITES);
  return (
    <section className="fv-pn" aria-label="Your invitations">
      <div className="fv-ph">
        <h2>Your invitations</h2>
        <span className="fv-cnt">{data.invites.length}</span>
        <span className="fv-sp" />
        {paged && <PageButtons page={pg.page} pages={pg.pages} onPage={setPage} label="invitations" />}
      </div>
      {slice.length === 0 ? (
        <p className="frn-none">No invitations right now.</p>
      ) : (
        <ul className="frn-rows">
          {slice.map((i) => (
            <li key={i.id}>
              <TagBadge tag={i.tribe.tag} />
              <span className="frn-rt">
                <button type="button" className="frn-lk" onClick={() => openTribe({ id: i.tribe.id })}>{i.tribe.name}</button>
                <small>from {i.invitedBy} · {formatLeft(i.expiresAt - now)} left</small>
              </span>
              <button type="button" className="fv-btn fv-btn-g frn-b" disabled={busy} onClick={() => void run(() => api.acceptInvite(i.id), { ok: `You joined ${i.tribe.name}.` })}>
                Accept
              </button>
              <button type="button" className="fv-btn frn-b" disabled={busy} onClick={() => void run(() => api.declineInvite(i.id))}>
                Decline
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Applications() {
  const { data, busy, run, openTribe } = useTribe();
  return (
    <section className="fv-pn" aria-label="Your applications">
      <div className="fv-ph">
        <h2>Your applications</h2>
        <span className="fv-cnt">{data.applications.length} / {PLAYER_MAX_APPLICATIONS}</span>
      </div>
      {data.applications.length === 0 ? (
        <p className="frn-none">You have not applied anywhere.</p>
      ) : (
        <ul className="frn-rows">
          {data.applications.map((a) => (
            <li key={a.id}>
              <TagBadge tag={a.tribe.tag} />
              <span className="frn-rt">
                <button type="button" className="frn-lk" onClick={() => openTribe({ id: a.tribe.id })}>{a.tribe.name}</button>
                <small>
                  sent {shortDate(a.createdAt)}
                  {a.message && <> · <PlainText className="frn-q" text={a.message} /></>}
                </small>
              </span>
              <button type="button" className="fv-btn frn-b" disabled={busy} onClick={() => void run(() => api.withdrawApplication(a.id), { ok: 'Application withdrawn.' })}>
                Withdraw
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FoundPanel() {
  const { live } = useGame();
  const { run, busy } = useTribe();
  const hall = live.buildings.hall;
  const locked = hall < TRIBE_FOUND_HALL_LEVEL;
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [recruitment, setRecruitment] = useState<Recruitment>('application');
  const [error, setError] = useState<string | null>(null);

  const identity = checkTribeIdentity(normalizeTribeName(name), normalizeTribeTag(tag));
  let why: string | null = null;
  if (locked) why = `Needs Town Hall ${TRIBE_FOUND_HALL_LEVEL}. Yours is level ${hall}.`;
  else if (name.trim() === '' || tag.trim() === '') why = 'Give it a name and a tag.';
  else if (!identity.ok) why = identity.message;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (why || busy || !identity.ok) return;
    setError(await run(() => api.createTribe({ name: identity.name, tag: identity.tag, recruitment }), { ok: `You founded ${identity.name}.`, toastError: false }));
  }

  return (
    <section className="fv-pn" aria-label="Found a tribe">
      <div className="fv-ph">
        <h2>Found a tribe</h2>
        <span className="fv-sp" />
        <span className={`fv-tag ${locked ? 'frn-tag-lock' : 'frn-tag-ok'}`}>
          {locked ? <Icon name="lock" size={14} /> : <span aria-hidden="true">✓</span>} Town Hall {hall} of {TRIBE_FOUND_HALL_LEVEL}
        </span>
      </div>
      <form className="frn-form" onSubmit={(e) => void submit(e)}>
        <fieldset className="frn-fs" disabled={locked}>
          <div className="frn-two">
            <label className="frn-f">
              <span className="fv-up">Name <i>3-{TRIBE_NAME_MAX} letters</i></span>
              <input
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
            <label className="frn-f frn-f-tag">
              <span className="fv-up">Tag <i>2-{TRIBE_TAG_MAX}</i></span>
              <input
                value={tag}
                maxLength={TRIBE_TAG_MAX}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="IRW"
                onChange={(e) => {
                  setTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                  setError(null);
                }}
              />
            </label>
          </div>
          <div className="frn-f" role="radiogroup" aria-label="Who may join">
            <span className="fv-up">Who may join</span>
            <span className="frn-seg">
              {RECRUIT_CHOICES.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={recruitment === c.id} className={recruitment === c.id ? 'on' : undefined} onClick={() => setRecruitment(c.id)}>
                  {c.label}
                </button>
              ))}
            </span>
          </div>
        </fieldset>
        {(why || error) && (
          <p className={error || locked ? 'frn-why is-lock' : 'frn-why'} role={error ? 'alert' : undefined}>
            {error ?? why}
          </p>
        )}
        <button type="submit" className="fv-btn fv-btn-g frn-found" disabled={!!why || busy}>
          <Icon name="tribe" size={18} /> {busy ? 'Founding…' : 'Found tribe'}
        </button>
        <p className="fv-mut frn-perm">Name and tag are permanent.</p>
      </form>
    </section>
  );
}

// ---- The page -----------------------------------------------------------------------------------------------------------

export function FrameNoTribe() {
  const { data } = useTribe();
  const [tribes, setTribes] = useState<TribeSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);

  useLayoutEffect(() => {
    setTribeFixed(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .tribes('')
      .then((res) => {
        if (cancelled) return;
        setTribes([...res.tribes].sort((a, b) => a.rank - b.rank));
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [tries]);

  const stats: Array<[string, string]> = [
    ['Tribes', tribes ? String(tribes.length) : '—'],
    ['Invitations', String(data.invites.length)],
    ['Applications', `${data.applications.length} / ${PLAYER_MAX_APPLICATIONS}`],
  ];
  return (
    <div className="frt frt-fixed frn">
      <div className="frt-head">
        <span className="frn-ico" aria-hidden="true">
          <Icon name="tribe" size={30} />
        </span>
        <h1 className="frt-name">
          <b>Tribes</b>
          <small>You are not in a tribe yet · join one, or found your own</small>
        </h1>
        <span className="fv-sp" />
        <dl className="frt-stats">
          {stats.map(([label, value]) => (
            <div key={label} className="frt-st">
              <dt className="fv-up">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          <DominationTile />
        </dl>
      </div>
      <div className="frn-body">
        <FindPanel tribes={tribes} error={error} reload={() => setTries((n) => n + 1)} />
        <div className="frn-side">
          <Invitations />
          <Applications />
          <FoundPanel />
        </div>
      </div>
    </div>
  );
}
