import { useState } from 'react';
import type { FormEvent } from 'react';
import { TRIBE_MAX_ALLIES, TRIBE_MAX_NAPS, TRIBE_TAG_MAX, TRIBE_TAG_PATTERN, canTribe, normalizeTribeTag, pactNoticeMs } from '@clanfire/engine';
import type { DiplomacyKind, DiplomacyProposalDto, TribeRelationDto } from '@clanfire/engine';
import { api } from '../api.ts';
import { formatAgo, formatLeft } from '../format.ts';
import { useGame } from '../game.ts';
import { DIPLOMACY_NAME } from '../relations.ts';
import { KindBadge, Segmented, TribeLabel } from './bits.tsx';
import { useTribe } from './context.ts';
import type { MemberProps } from './context.ts';

export const KIND_OPTIONS = [
  { value: 'ally', label: 'Alliance' },
  { value: 'nap', label: 'NAP' },
  { value: 'enemy', label: 'Enemy' },
] as const;

export const KIND_HINT: Record<DiplomacyKind, string> = {
  ally: 'Needs their accept.',
  nap: 'Needs their accept.',
  enemy: 'Instant.',
};

/** Cancel a pact (after a confirm that explains the notice) or end a war. Shared by the phone list and the desktop frame page. */
export function useCancelRelation(r: TribeRelationDto): () => Promise<void> {
  const { settings } = useGame();
  const { run, confirm } = useTribe();
  const pact = r.kind !== 'enemy';
  async function cancel() {
    if (pact) {
      const ok = await confirm({
        title: `Cancel the ${DIPLOMACY_NAME[r.kind].toLowerCase()} with [${r.other.tag}]?`,
        body: (
          <p>
            Protects both tribes for <strong>{formatLeft(pactNoticeMs(settings))}</strong> more, then ends. Cannot be undone.
          </p>
        ),
        confirmLabel: 'Start notice',
        danger: true,
      });
      if (!ok) return;
    }
    await run(() => api.cancelRelation(r.id), { ok: pact ? 'Notice started.' : 'War ended.' });
  }
  return cancel;
}

function RelationRow({ r, canEdit }: { r: TribeRelationDto; canEdit: boolean }) {
  const { now } = useGame();
  const { busy, openTribe } = useTribe();
  const ending = r.endsAt !== null;
  const pact = r.kind !== 'enemy';

  const cancel = useCancelRelation(r);

  return (
    <li className={`relation-row${ending ? ' is-ending' : ''}`}>
      <KindBadge kind={r.kind} />
      <div className="relation-main">
        <button className="link" onClick={() => openTribe({ id: r.other.id })}>
          <TribeLabel tag={r.other.tag} name={r.other.name} />
        </button>
        <div className="muted small">
          {formatAgo(r.since, now)}
          {r.kind === 'enemy' && ` · by ${r.declaredByUs ? 'us' : 'them'}`}
        </div>
        {r.endsAt !== null && (
          <div className="countdown">
            Ends in <strong>{r.endsAt > now ? formatLeft(r.endsAt - now) : 'a moment'}</strong>
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
              </button>
            </>
          ) : (
            <>
              To{' '}
              <button className="link" onClick={() => openTribe({ id: p.other.id })}>
                <TribeLabel tag={p.other.tag} name={p.other.name} />
              </button>
            </>
          )}
        </div>
        <div className="muted small">{formatAgo(p.createdAt, now)}{incoming && war ? ' · ends the war' : ''}</div>
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

/** State and submit of the "New relation" form; shared by the phone card and the desktop frame page. */
export function useProposeForm(tribe: MemberProps['tribe']) {
  const { data, busy, run, confirm } = useTribe();
  const [tag, setTag] = useState('');
  const [kind, setKind] = useState<DiplomacyKind>('ally');
  const [error, setError] = useState<string | null>(null);

  const normTag = normalizeTribeTag(tag);
  const tagValid = new RegExp(TRIBE_TAG_PATTERN).test(normTag);
  const own = normTag === tribe.tag.toUpperCase();
  let why: string | null = null;
  if (normTag === '') why = 'Enter a tag';
  else if (!tagValid) why = '2-6 letters or digits';
  else if (own) why = 'Your own tribe';

  const allies = tribe.relations.filter((r) => r.kind === 'ally').length + data.proposals.filter((p) => p.kind === 'ally' && p.direction === 'outgoing').length;
  const naps = tribe.relations.filter((r) => r.kind === 'nap').length + data.proposals.filter((p) => p.kind === 'nap' && p.direction === 'outgoing').length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (why || busy) return;
    if (kind === 'enemy') {
      const ok = await confirm({
        title: `Declare [${normTag}] an enemy?`,
        body: <p>Takes effect at once. Not possible with a pact partner.</p>,
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
  return { tag, setTag, kind, setKind, error, setError, why, allies, naps, submit, submitLabel, busy };
}

function ProposeForm({ tribe }: Pick<MemberProps, 'tribe'>) {
  const { tag, setTag, kind, setKind, error, setError, why, allies, naps, submit, submitLabel, busy } = useProposeForm(tribe);
  return (
    <form className="card stack" onSubmit={(e) => void submit(e)} aria-labelledby="dip-new">
      <h2 id="dip-new" className="card-title">New relation</h2>
      <label className="field">
        <span>Tribe tag</span>
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
        Alliances {allies}/{TRIBE_MAX_ALLIES} · NAPs {naps}/{TRIBE_MAX_NAPS}
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
          <p className="muted">None.</p>
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

      {canEdit && <ProposeForm tribe={tribe} />}
    </>
  );
}
