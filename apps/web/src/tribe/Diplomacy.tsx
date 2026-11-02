import { useState } from 'react';
import type { FormEvent } from 'react';
import { TRIBE_MAX_ALLIES, TRIBE_MAX_NAPS, TRIBE_TAG_MAX, TRIBE_TAG_PATTERN, canTribe, normalizeTribeTag, pactNoticeMs } from '@tribewars/engine';
import type { DiplomacyKind, DiplomacyProposalDto, TribeRelationDto } from '@tribewars/engine';
import { api } from '../api.ts';
import { formatAgo, formatLeft } from '../format.ts';
import { useGame } from '../game.ts';
import { DIPLOMACY_NAME } from '../relations.ts';
import { KindBadge, Segmented, TribeLabel } from './bits.tsx';
import { useTribe } from './context.ts';
import type { MemberProps } from './context.ts';

const KIND_OPTIONS = [
  { value: 'ally', label: 'Alliance' },
  { value: 'nap', label: 'NAP' },
  { value: 'enemy', label: 'Enemy' },
] as const;

const KIND_HINT: Record<DiplomacyKind, string> = {
  ally: 'The other tribe must accept. Allies cannot attack each other.',
  nap: 'The other tribe must accept. Partners cannot attack each other.',
  enemy: 'Takes effect at once and both tribes see it. It only marks who you are at war with.',
};

function RelationRow({ r, canEdit }: { r: TribeRelationDto; canEdit: boolean }) {
  const { now, settings } = useGame();
  const { busy, run, confirm, openTribe } = useTribe();
  const ending = r.endsAt !== null;
  const pact = r.kind !== 'enemy';

  async function cancel() {
    if (pact) {
      const ok = await confirm({
        title: `Cancel the ${DIPLOMACY_NAME[r.kind].toLowerCase()} with [${r.other.tag}]?`,
        body: (
          <p>
            It keeps protecting both tribes for another <strong>{formatLeft(pactNoticeMs(settings))}</strong>, then it ends. Both tribes
            see the countdown. You cannot undo this.
          </p>
        ),
        confirmLabel: 'Start notice',
        danger: true,
      });
      if (!ok) return;
    }
    await run(() => api.cancelRelation(r.id), { ok: pact ? 'Notice started.' : 'War ended.' });
  }

  return (
    <li className={`relation-row${ending ? ' is-ending' : ''}`}>
      <KindBadge kind={r.kind} />
      <div className="relation-main">
        <button className="link" onClick={() => openTribe({ id: r.other.id })}>
          <TribeLabel tag={r.other.tag} name={r.other.name} />
        </button>
        <div className="muted small">
          since {formatAgo(r.since, now)}
          {r.kind === 'enemy' && ` · declared by ${r.declaredByUs ? 'us' : 'them'}`}
        </div>
        {r.endsAt !== null && (
          <div className="countdown">
            Cancelled: ends in <strong>{r.endsAt > now ? formatLeft(r.endsAt - now) : 'a moment'}</strong>
            <span className="muted"> (still protects until then)</span>
          </div>
        )}
      </div>
      {canEdit && !ending && (
        <button className="btn btn-small" disabled={busy} onClick={() => void cancel()}>
          {pact ? 'Cancel' : 'End war'}
        </button>
      )}
    </li>
  );
}

function ProposalRow({ p, canEdit, relations }: { p: DiplomacyProposalDto; canEdit: boolean; relations: TribeRelationDto[] }) {
  const { now } = useGame();
  const { busy, run, openTribe } = useTribe();
  const incoming = p.direction === 'incoming';
  const noun = p.kind === 'ally' ? 'an alliance' : 'a non-aggression pact';
  const war = relations.some((r) => r.other.id === p.other.id && r.kind === 'enemy');
  return (
    <li className="relation-row">
      <KindBadge kind={p.kind} />
      <div className="relation-main">
        <div>
          {incoming ? (
            <>
              <button className="link" onClick={() => openTribe({ id: p.other.id })}>
                <TribeLabel tag={p.other.tag} name={p.other.name} />
              </button>{' '}
              proposes {noun}
            </>
          ) : (
            <>
              You proposed {noun} to{' '}
              <button className="link" onClick={() => openTribe({ id: p.other.id })}>
                <TribeLabel tag={p.other.tag} name={p.other.name} />
              </button>
            </>
          )}
        </div>
        <div className="muted small">{formatAgo(p.createdAt, now)}{incoming && war ? ' · accepting ends the war between you' : ''}</div>
      </div>
      {canEdit && incoming && (
        <div className="row-actions">
          <button className="btn btn-primary btn-small" disabled={busy} onClick={() => void run(() => api.acceptProposal(p.id), { ok: 'Proposal accepted.' })}>
            Accept
          </button>
          <button className="btn btn-small" disabled={busy} onClick={() => void run(() => api.declineProposal(p.id))}>
            Decline
          </button>
        </div>
      )}
      {canEdit && !incoming && (
        <button className="btn btn-small" disabled={busy} onClick={() => void run(() => api.withdrawProposal(p.id), { ok: 'Proposal withdrawn.' })}>
          Withdraw
        </button>
      )}
    </li>
  );
}

function ProposeForm({ tribe }: Pick<MemberProps, 'tribe'>) {
  const { data, busy, run, confirm } = useTribe();
  const [tag, setTag] = useState('');
  const [kind, setKind] = useState<DiplomacyKind>('ally');
  const [error, setError] = useState<string | null>(null);

  const normTag = normalizeTribeTag(tag);
  const tagValid = new RegExp(TRIBE_TAG_PATTERN).test(normTag);
  const own = normTag === tribe.tag.toUpperCase();
  let why: string | null = null;
  if (normTag === '') why = 'Enter the other tribe\'s tag';
  else if (!tagValid) why = 'A tag is 2-6 letters or digits';
  else if (own) why = 'That is your own tribe';

  const allies = tribe.relations.filter((r) => r.kind === 'ally').length + data.proposals.filter((p) => p.kind === 'ally' && p.direction === 'outgoing').length;
  const naps = tribe.relations.filter((r) => r.kind === 'nap').length + data.proposals.filter((p) => p.kind === 'nap' && p.direction === 'outgoing').length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (why || busy) return;
    if (kind === 'enemy') {
      const ok = await confirm({
        title: `Declare [${normTag}] an enemy?`,
        body: <p>It takes effect at once and both tribes see it. You cannot declare war on a tribe you have a pact with.</p>,
        confirmLabel: 'Declare enemy',
        danger: true,
      });
      if (!ok) return;
    }
    const err = await run(() => api.proposeDiplomacy(normTag, kind), {
      ok: kind === 'enemy' ? `[${normTag}] is now your enemy.` : `Proposal sent to [${normTag}].`,
      toastError: false,
    });
    setError(err);
    if (!err) setTag('');
  }

  const submitLabel = kind === 'enemy' ? 'Declare enemy' : kind === 'ally' ? 'Propose alliance' : 'Propose NAP';
  return (
    <form className="card stack" onSubmit={(e) => void submit(e)} aria-labelledby="dip-new">
      <h2 id="dip-new" className="card-title">New relation</h2>
      <label className="field">
        <span>Other tribe's tag</span>
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
        <span>Kind</span>
        <Segmented label="Kind" value={kind} options={KIND_OPTIONS} onChange={setKind} />
        <span className="hint">{KIND_HINT[kind]}</span>
      </div>
      <p className="muted small">
        Alliances {allies}/{TRIBE_MAX_ALLIES} · NAPs {naps}/{TRIBE_MAX_NAPS} (active plus your pending proposals)
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className={`btn btn-block ${kind === 'enemy' ? 'btn-danger' : 'btn-primary'}`} type="submit" disabled={!!why || busy}>
        {submitLabel}
      </button>
      {why && <div className="why">{why}</div>}
    </form>
  );
}

export function Diplomacy({ tribe, role }: MemberProps) {
  const { data } = useTribe();
  const canEdit = canTribe(role, 'diplomacy');
  const incoming = data.proposals.filter((p) => p.direction === 'incoming');
  const outgoing = data.proposals.filter((p) => p.direction === 'outgoing');
  return (
    <>
      <section className="card" aria-labelledby="rel-title">
        <h2 id="rel-title" className="card-title">Relations</h2>
        {tribe.relations.length === 0 ? (
          <p className="muted">No alliances, pacts or wars.</p>
        ) : (
          <ul className="stack">
            {tribe.relations.map((r) => (
              <RelationRow key={r.id} r={r} canEdit={canEdit} />
            ))}
          </ul>
        )}
      </section>

      {(incoming.length > 0 || outgoing.length > 0) && (
        <section className="card" aria-labelledby="prop-title">
          <h2 id="prop-title" className="card-title">Proposals</h2>
          <ul className="stack">
            {[...incoming, ...outgoing].map((p) => (
              <ProposalRow key={p.id} p={p} canEdit={canEdit} relations={tribe.relations} />
            ))}
          </ul>
        </section>
      )}

      {canEdit ? <ProposeForm tribe={tribe} /> : <p className="muted small">Only the leader and officers can change diplomacy.</p>}
    </>
  );
}
