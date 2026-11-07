// The public Domination bar: who leads, how far from the win line, and why the world does not count yet.
// Shown to everyone in the Tribe tab, compactly in Rankings, and in full on the world-end screen.

import { useId, useState } from 'react';
import type { DominationStatusDto } from '@clanfire/engine';
import { barWidth, conditionRows, dominationHeadline, dominationPhase, leaderLine, percentText, reasonList, topTribeRows } from '../domination.ts';
import { useDomination } from '../hooks/useDomination.ts';

function Details({ status }: { status: DominationStatusDto }) {
  const rows = conditionRows(status);
  const reasons = reasonList(status);
  const tribes = topTribeRows(status);
  return (
    <>
      <dl className="dom-conds">
        {rows.map((r) => (
          <div key={r.key} className={`dom-cond${r.ok ? ' is-ok' : ''}`}>
            <dt>
              <span className="dom-mark" aria-hidden="true">{r.ok ? '✓' : '•'}</span>
              {r.label}
              {r.ok && <span className="visually-hidden"> (met)</span>}
            </dt>
            <dd>
              {r.value}
              <span className="dom-mini" aria-hidden="true">
                <span style={{ width: `${barWidth(r.fraction)}%` }} />
              </span>
            </dd>
          </div>
        ))}
      </dl>
      {reasons.length > 0 && !status.ended && (
        <div className="dom-why">
          <h3 className="subtitle">Not counting yet</h3>
          <ul>
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {tribes.length > 0 && (
        <div className="dom-top">
          <h3 className="subtitle">Biggest tribes</h3>
          <ol>
            {tribes.map((t, i) => (
              <li key={t.tribeId}>
                <span className="dom-top-name">
                  <span className="dom-top-rank">{i + 1}</span>
                  {t.name} <span className="tribe-tag">[{t.tag}]</span>
                </span>
                <span className="dom-top-share">{t.text}</span>
                <span className="dom-mini dom-top-bar" aria-hidden="true">
                  <span style={{ width: `${t.width}%` }} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}

/** The bar itself (pure view). `compact` shows the headline and the bar, with a button for the rest. */
export function DominationBar({ status, compact = false }: { status: DominationStatusDto; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const detailsId = useId();
  const share = status.leader?.share ?? 0;
  const phase = dominationPhase(status);
  const line = `${leaderLine(status)}; ${percentText(status.winShare)} is needed`;
  const showDetails = !compact || open;
  return (
    <section className={`card dom dom-${phase}${compact ? ' dom-compact' : ''}`} aria-labelledby={titleId}>
      <h2 id={titleId} className="card-title dom-title">Domination</h2>
      <p className="dom-headline">{dominationHeadline(status)}</p>
      <p className="muted small dom-leader">{leaderLine(status)}</p>
      <div className="dom-bar" role="img" aria-label={line}>
        <div className="dom-fill" style={{ width: `${barWidth(share)}%` }} />
        <div className="dom-line" style={{ left: `${barWidth(status.winShare)}%` }}>
          <span className="dom-line-label">{percentText(status.winShare)}</span>
        </div>
      </div>
      <div className="dom-scale muted small" aria-hidden="true">
        <span>0%</span>
        <span>{percentText(share)} now</span>
        <span>100%</span>
      </div>
      {compact && (
        <button type="button" className="btn btn-small dom-toggle" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Details'}
        </button>
      )}
      <div id={detailsId} hidden={!showDetails}>
        {showDetails && <Details status={status} />}
      </div>
    </section>
  );
}

/** The bar with its own data (GET /api/domination). Says nothing at all while the first answer is missing or the route is absent. */
export function DominationCard({ compact = false }: { compact?: boolean }) {
  const { status, error, reload } = useDomination();
  if (!status) {
    if (!error) return <p className="muted small" role="status">Loading…</p>;
    return (
      <p className="muted small" role="status">
        Domination unavailable. <button className="link" onClick={reload}>Retry</button>
      </p>
    );
  }
  return <DominationBar status={status} compact={compact} />;
}
