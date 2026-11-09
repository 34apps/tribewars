// The Diplomacy sub-tab of the desktop Tribe page (picture: design/proposals/ingame-pages/mix-tribe-diplomacy-1440.png): the relations
// grouped as allies / non-aggression / enemies, the proposals waiting, and the New relation form. Same endpoints and rules as the phone.

import { TRIBE_MAX_ALLIES, TRIBE_MAX_NAPS, TRIBE_TAG_MAX, canTribe } from '@clanfire/engine';
import type { DiplomacyKind, DiplomacyProposalDto, TribeRelationDto } from '@clanfire/engine';
import { api } from '../../api.ts';
import { formatAgo, formatLeft } from '../../format.ts';
import { useGame } from '../../game.ts';
import { DIPLOMACY_SHORT } from '../../relations.ts';
import { useTribe } from '../../tribe/context.ts';
import type { MemberProps } from '../../tribe/context.ts';
import { KIND_HINT, KIND_OPTIONS, useCancelRelation, useProposeForm } from '../../tribe/Diplomacy.tsx';
import { PROPOSALS_PER_PAGE, RELATIONS_PER_PAGE, relationSection, shortDate, sortRelations, tribeTagName } from './frame-tribe-logic.ts';
import { PageButtons, usePaged } from './frame-tribe-bits.tsx';

function RelationRow({ r, canEdit }: { r: TribeRelationDto; canEdit: boolean }) {
  const { now } = useGame();
  const { busy, openTribe } = useTribe();
  const cancel = useCancelRelation(r);
  const ending = r.endsAt !== null;
  const pact = r.kind !== 'enemy';
  return (
    <div className="frt-rel">
      <span className={`frt-kd is-${r.kind}`}>{DIPLOMACY_SHORT[r.kind]}</span>
      <span className="frt-relt">
        <button type="button" className="frt-rn" onClick={() => openTribe({ id: r.other.id })}>
          {tribeTagName(r.other)}
        </button>
        <small>
          since {shortDate(r.since)}
          {r.kind === 'enemy' && ` · declared by ${r.declaredByUs ? 'us' : 'them'}`}
          {r.endsAt !== null && ` · ends in ${r.endsAt > now ? formatLeft(r.endsAt - now) : 'a moment'} (notice given)`}
        </small>
      </span>
      {canEdit && !ending && (
        <button type="button" className="fv-btn" disabled={busy} onClick={() => void cancel()}>
          {pact ? 'Cancel' : 'End war'}
        </button>
      )}
    </div>
  );
}

function ProposalRow({ p, canEdit, relations }: { p: DiplomacyProposalDto; canEdit: boolean; relations: TribeRelationDto[] }) {
  const { now } = useGame();
  const { busy, run, openTribe } = useTribe();
  const incoming = p.direction === 'incoming';
  const war = relations.some((r) => r.other.id === p.other.id && r.kind === 'enemy');
  const what = p.kind === 'ally' ? 'an alliance' : 'non-aggression';
  return (
    <div className="frt-prop">
      <span className="frt-relt">
        <button type="button" className="frt-rn" onClick={() => openTribe({ id: p.other.id })}>
          {tribeTagName(p.other)}
        </button>
        <small>
          {incoming ? `wants ${what} with you${war ? ' · ends the war' : ''}` : `you proposed ${p.kind === 'ally' ? 'an alliance' : 'non-aggression'}`} · {formatAgo(p.createdAt, now)}
        </small>
      </span>
      {canEdit && incoming && (
        <>
          <button type="button" className="fv-btn fv-btn-g" disabled={busy} onClick={() => void run(() => api.acceptProposal(p.id), { ok: 'Proposal accepted.' })}>
            Accept
          </button>
          <button type="button" className="fv-btn" disabled={busy} onClick={() => void run(() => api.declineProposal(p.id))}>
            Decline
          </button>
        </>
      )}
      {canEdit && !incoming && (
        <button type="button" className="fv-btn" disabled={busy} onClick={() => void run(() => api.withdrawProposal(p.id), { ok: 'Proposal withdrawn.' })}>
          Withdraw
        </button>
      )}
    </div>
  );
}

function NewRelation({ tribe }: Pick<MemberProps, 'tribe'>) {
  const { tag, setTag, kind, setKind, error, setError, why, allies, naps, submit, submitLabel, busy } = useProposeForm(tribe);
  return (
    <form className="fv-pn frt-new" onSubmit={(e) => void submit(e)} aria-label="New relation">
      <div className="fv-ph frt-ph">
        <h2>New relation</h2>
        <span className="fv-sp" />
        <span className="fv-mut">
          Alliances {allies}/{TRIBE_MAX_ALLIES} · NAPs {naps}/{TRIBE_MAX_NAPS}
        </span>
      </div>
      <div className="frt-form">
        <div className="frt-fld">
          <span className="frt-fl">Kind</span>
          <div className="frt-seg" role="radiogroup" aria-label="Kind">
            {KIND_OPTIONS.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={kind === o.value} className={kind === o.value ? 'on' : undefined} onClick={() => setKind(o.value as DiplomacyKind)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <label className="frt-fld">
          <span className="frt-fl">Tribe tag</span>
          <input
            className="frt-in"
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
        <p className="frt-hint">{why ?? KIND_HINT[kind]}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className={`fv-btn ${kind === 'enemy' ? 'frt-redbtn' : 'fv-btn-g'} frt-wide`} disabled={!!why || busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function FrameTribeDiplomacy({ tribe, role }: MemberProps) {
  const { data } = useTribe();
  const canEdit = canTribe(role, 'diplomacy');
  const relations = sortRelations(tribe.relations);
  const rel = usePaged(relations, RELATIONS_PER_PAGE);
  const proposals = [...data.proposals.filter((p) => p.direction === 'incoming'), ...data.proposals.filter((p) => p.direction === 'outgoing')];
  const prop = usePaged(proposals, PROPOSALS_PER_PAGE);
  const start = rel.pg.page * RELATIONS_PER_PAGE;
  return (
    <div className="frt-two">
      <section className="fv-pn frt-grow" aria-label="Relations">
        <div className="fv-ph frt-ph">
          <h2>Relations</h2>
          {relations.length > 0 && <span className="frt-cnt">{relations.length}</span>}
          <span className="fv-sp" />
          {rel.paged && <PageButtons page={rel.pg.page} pages={rel.pg.pages} onPage={rel.setPage} label="relations" />}
        </div>
        {relations.length === 0 && <p className="fv-empty frt-pad">No relations yet. Propose one on the right.</p>}
        {rel.slice.map((r, i) => {
          const heading = relationSection(relations, start + i) ?? (i === 0 ? relationSection([{ kind: r.kind }], 0) : null);
          return (
            <div key={r.id}>
              {heading && <div className="frt-sec fv-up">{heading}</div>}
              <RelationRow r={r} canEdit={canEdit} />
            </div>
          );
        })}
      </section>
      <div className="frt-side frt-side-d">
        <section className="fv-pn" aria-label="Proposals">
          <div className="fv-ph frt-ph">
            <h2>Proposals</h2>
            {proposals.length > 0 && <span className="frt-cnt">{proposals.length}</span>}
            <span className="fv-sp" />
            {prop.paged && <PageButtons page={prop.pg.page} pages={prop.pg.pages} onPage={prop.setPage} label="proposals" />}
          </div>
          {proposals.length === 0 && <p className="fv-empty frt-pad">No proposals waiting.</p>}
          {prop.slice.map((p) => (
            <ProposalRow key={p.id} p={p} canEdit={canEdit} relations={tribe.relations} />
          ))}
        </section>
        {canEdit && <NewRelation tribe={tribe} />}
      </div>
    </div>
  );
}
