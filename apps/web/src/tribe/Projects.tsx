// Tribe tab, "Projects": the Tribe Store, the store village, the running project, Roads / Watchtower / Wards, and the ledger.
// Data: GET /api/tribe/projects. Funding is a normal shipment to the store village (map send form, "To Tribe Store").

import { useCallback, useEffect, useRef, useState } from 'react';
import { CANCEL_REFUND_PERCENT, RESOURCE_IDS } from '@clanfire/engine';
import type { Resources, TribeProjectId, TribeProjectOptionDto, TribeProjectsResponse } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { Icon } from '../art/Icon.tsx';
import type { IconName } from '../art/Icon.tsx';
import { ProgressBar } from '../components/ui.tsx';
import { formatAgo, formatClock, formatCompact, formatCoords, formatDuration, formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { pollMs } from '../hooks/live.ts';
import { useLiveConnected, useLiveTopic } from '../hooks/useLive.tsx';
import { RESOURCE_ICON, RESOURCE_NAME } from '../icons.ts';
import { useTribe } from './context.ts';

const POLL_MS = 30_000;

const PROJECT_NAME: Record<TribeProjectId, string> = { roads: 'Roads', watchtower: 'Watchtower', wards: 'Wards' };
const PROJECT_ICON: Record<TribeProjectId, IconName> = { roads: 'road', watchtower: 'watchtower', wards: 'ward' };

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** One plain sentence for a level of a project. `effect` is the value from the server (a fraction for Roads/Wards, the level for the Watchtower). */
export function effectText(project: TribeProjectId, effect: number): string {
  if (project === 'roads') return effect > 0 ? `Support and shipments between members ${pct(effect)} faster` : 'No faster trips yet';
  if (project === 'wards') return effect > 0 ? `Sites you hold defend ${pct(effect)} better` : 'No defence bonus yet';
  if (effect >= 3) return 'Warnings show rough size, slowest unit and about how many troops';
  if (effect >= 2) return 'Warnings show rough size and the slowest unit';
  if (effect >= 1) return 'Warnings show rough size';
  return 'Warnings show no size yet';
}

/** Terse effect for a level: a value and a short label (Roads/Wards: a percentage; Watchtower: what warnings show). */
export function shortEffect(project: TribeProjectId, effect: number): { value: string; label: string } {
  if (project === 'roads') return { value: effect > 0 ? pct(effect) : '0%', label: 'faster trips between members' };
  if (project === 'wards') return { value: effect > 0 ? pct(effect) : '0%', label: 'defence at held sites' };
  const value = effect >= 3 ? 'size, slowest, count' : effect >= 2 ? 'size, slowest' : effect >= 1 ? 'size' : '–';
  return { value, label: 'in warnings' };
}

/** The "next level" value: same as shortEffect, except the Watchtower shows only what the level adds. */
export function shortNext(project: TribeProjectId, effect: number): string {
  if (project !== 'watchtower') return shortEffect(project, effect).value;
  return effect >= 3 ? '+ count' : effect >= 2 ? '+ slowest' : shortEffect(project, effect).value;
}

function CostLine({ cost }: { cost: Resources }) {
  return (
    <span className="loot">
      {RESOURCE_IDS.map((r) => (
        <span key={r} className="loot-item">
          <Icon name={RESOURCE_ICON[r]} size={16} className="inline-icon" />
          <span className="visually-hidden">{RESOURCE_NAME[r]} </span>
          <span title={formatInt(cost[r])}>{formatCompact(cost[r])}</span>
        </span>
      ))}
    </span>
  );
}

function StoreBars({ d }: { d: TribeProjectsResponse }) {
  return (
    <ul className="store-bars" aria-label="Tribe Store">
      {RESOURCE_IDS.map((r) => (
        <li key={r}>
          <span className="store-bar-num">
            <Icon name={RESOURCE_ICON[r]} size={20} className="inline-icon" />
            <span className="visually-hidden">{RESOURCE_NAME[r]} </span>
            {formatInt(d.store[r])}
          </span>
          <ProgressBar value={d.store[r] / Math.max(1, d.storeCap)} tone="brand" label={`${RESOURCE_NAME[r]} in the Tribe Store`} />
        </li>
      ))}
    </ul>
  );
}

export function Projects() {
  const { now, showOnMap } = useGame();
  const { confirm } = useTribe();
  const [d, setD] = useState<TribeProjectsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState('');
  const [moving, setMoving] = useState(false);
  const seq = useRef(0);
  const applied = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const res = await api.tribeProjects();
      if (my < applied.current) return;
      applied.current = my;
      setD(res);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  const pollEvery = pollMs(POLL_MS, useLiveConnected());
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden && !busy) void load();
    }, pollEvery);
    return () => window.clearInterval(id);
  }, [load, pollEvery, busy]);
  useLiveTopic('tribe', () => void load());

  // A project that finished while the page was open: reload once.
  const endsAt = d?.running?.endsAt ?? 0;
  useEffect(() => {
    if (endsAt > 0 && now >= endsAt) void load();
  }, [endsAt, now, load]);

  async function act(fn: () => Promise<TribeProjectsResponse>) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fn();
      applied.current = ++seq.current;
      setD(res);
    } catch (e) {
      setActionError(errorMessage(e));
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!d?.running) return;
    const ok = await confirm({
      title: `Cancel ${PROJECT_NAME[d.running.project]}?`,
      body: <p>{CANCEL_REFUND_PERCENT}% of what it cost goes back into the Tribe Store. The rest is lost.</p>,
      confirmLabel: 'Cancel project',
      danger: true,
    });
    if (ok) await act(() => api.cancelProject());
  }

  if (!d) {
    return error ? (
      <section className="card card-light">
        <p className="form-error" role="alert">{error}</p>
        <button className="btn" onClick={() => void load()}>Try again</button>
      </section>
    ) : (
      <p className="muted" role="status">Loading projects…</p>
    );
  }

  const home = d.storeVillage;
  const waitingChange = d.storeVillageChangeableAt !== null && d.storeVillageChangeableAt > now;
  let giveReason: string | null = null;
  if (!home) giveReason = 'No store village yet.';
  else if (d.myGiveFrom !== null && d.myGiveFrom > now) giveReason = `You can give from ${formatClock(d.myGiveFrom, now)}.`;
  else if (d.myDailyLeft <= 0) giveReason = 'Daily limit reached.';
  const showPick = d.canManage && (!home || moving);

  /** Only a specific reason is shown on a card (the store is short of a resource). */
  function startReason(p: TribeProjectOptionDto): string | null {
    if (!d || p.nextCost === null) return 'Fully built.';
    if (d.running) return 'Another project is being built.';
    const short = RESOURCE_IDS.find((r) => d.store[r] < (p.nextCost?.[r] ?? 0));
    return short ? `Need more ${RESOURCE_NAME[short].toLowerCase()}` : null;
  }

  return (
    <>
      <section className="card card-light" aria-labelledby="store-title">
        <div className="store-title-row">
          <h2 id="store-title" className="card-title">Tribe Store</h2>
          <details className="help-pop">
            <summary aria-label="How the Tribe Store works">?</summary>
            <p className="small">
              Members send resources here; the tribe spends them on projects. The store village can be raided. Max {formatInt(d.storeCap)} each.
            </p>
          </details>
        </div>
        <StoreBars d={d} />

        <p className="store-home">
          <Icon name="pin" size={18} className="inline-icon" />
          {home ? (
            <>
              <span>
                <strong>{home.name}</strong>
                {home.ownerName ? ` (${home.ownerName})` : ''} {formatCoords(home.x, home.y)}
              </span>
              <button className="link link-touch" onClick={() => showOnMap(home.x, home.y)}>Map</button>
            </>
          ) : (
            <span className="muted">No store village yet.</span>
          )}
        </p>

        {d.canManage && (
          <div className="store-move">
            {home && (
              <div className="store-move-bar">
                <button className="btn btn-small" aria-expanded={moving} disabled={busy || waitingChange} onClick={() => setMoving((m) => !m)}>
                  Move store
                </button>
                {waitingChange && d.storeVillageChangeableAt !== null && (
                  <span className="muted small">next {formatClock(d.storeVillageChangeableAt, now)}</span>
                )}
              </div>
            )}
            {showPick && (
              <div className="store-pick">
                <label className="field">
                  <span className="visually-hidden">{home ? 'Move the store to' : 'Choose a village'}</span>
                  <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy || waitingChange}>
                    <option value="">Pick a member village…</option>
                    {d.memberVillages.map((v) => (
                      <option key={v.villageId} value={v.villageId}>
                        {v.ownerName ?? 'Member'}: {v.name} ({formatCoords(v.x, v.y)})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="btn btn-tall"
                  disabled={busy || !pick || waitingChange}
                  onClick={() =>
                    void act(() => api.setStoreVillage(Number(pick))).then(() => {
                      setPick('');
                      setMoving(false);
                    })
                  }
                >
                  {home ? 'Move here' : 'Set'}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="store-give">
          <button
            className="btn btn-primary btn-tall"
            disabled={!!giveReason || !home}
            onClick={() => home && showOnMap(home.x, home.y, { ship: true })}
          >
            Send resources
          </button>
          <span className="muted small">{giveReason ?? `${formatInt(d.myDailyLeft)} left today`}</span>
        </div>
        {actionError && <p className="form-error" role="alert">{actionError}</p>}
      </section>

      {d.running && (
        <section className="card card-light" aria-labelledby="running-title">
          <div className="running-head">
            <h2 id="running-title" className="card-title">
              <Icon name={PROJECT_ICON[d.running.project]} size={24} className="inline-icon" /> {PROJECT_NAME[d.running.project]} → level {d.running.level}
            </h2>
            <strong className="running-time">{d.running.endsAt > now ? formatDuration(d.running.endsAt - now) : 'finishing…'}</strong>
          </div>
          <ProgressBar
            value={(now - d.running.startedAt) / Math.max(1, d.running.endsAt - d.running.startedAt)}
            tone="ok"
            label="Project progress"
          />
          {d.canManage && (
            <button className="btn btn-small btn-danger-outline" disabled={busy} onClick={() => void cancel()}>
              Cancel
            </button>
          )}
        </section>
      )}

      <section className="card card-light" aria-labelledby="projects-title">
        <h2 id="projects-title" className="card-title">Projects</h2>
        {d.running && d.canManage && <p className="muted small pad-bottom">One project at a time.</p>}
        <ul className="project-grid">
          {d.projects.map((p) => {
            const reason = startReason(p);
            const now1 = shortEffect(p.project, p.effectNow);
            const next = p.effectNext !== null ? shortNext(p.project, p.effectNext) : null;
            const maxed = p.nextCost === null;
            return (
              <li key={p.project} className="project-card" title={effectText(p.project, p.effectNow)}>
                <div className="project-head">
                  <Icon name={PROJECT_ICON[p.project]} size={32} />
                  <h3 className="project-name">{PROJECT_NAME[p.project]}</h3>
                  <span className="level-pips" role="img" aria-label={`Level ${p.level} of ${p.maxLevel}`}>
                    {Array.from({ length: p.maxLevel }, (_, i) => (
                      <span key={i} className={i < p.level ? 'pip pip-on' : 'pip'} />
                    ))}
                  </span>
                </div>
                <p className="project-effect">
                  <strong>{now1.value}</strong>
                  {next && (
                    <>
                      {' → '}
                      <strong>{next}</strong>
                    </>
                  )}
                  {maxed && <span className="tag tag-ok project-max">Max</span>}
                  <span className="muted small project-effect-label"> {now1.label}</span>
                </p>
                {p.nextCost && (
                  <p className="project-cost small">
                    <CostLine cost={p.nextCost} />
                    {p.nextBuildMs !== null && (
                      <span className="loot-item">
                        <Icon name="time" size={16} className="inline-icon" /> {formatDuration(p.nextBuildMs)}
                      </span>
                    )}
                  </p>
                )}
                {d.canManage && !maxed && (
                  <>
                    <button className="btn btn-primary btn-tall" disabled={busy || !!reason} onClick={() => void act(() => api.startProject(p.project))}>
                      Build level {p.level + 1}
                    </button>
                    {reason && !d.running && <p className="muted small">{reason}</p>}
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {!d.canManage && <p className="muted small">Leaders start projects.</p>}
      </section>

      <section className="card card-light" aria-labelledby="ledger-title">
        <h2 id="ledger-title" className="card-title">Who gave</h2>
        {d.totals.length === 0 ? (
          <p className="muted">Nobody has given yet.</p>
        ) : (
          <div className="ledger-cols">
            <table className="ledger-table">
              <caption className="visually-hidden">Totals</caption>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col" className="num">Total</th>
                  <th scope="col" className="num">24 h</th>
                </tr>
              </thead>
              <tbody>
                {d.totals.map((t) => (
                  <tr key={t.player.id}>
                    <td className="ledger-name">{t.player.name}</td>
                    <td className="num"><strong>{formatInt(t.total)}</strong></td>
                    <td className="num">{formatInt(t.last24h)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="ledger-table">
              <caption className="visually-hidden">Recent gifts</caption>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col" className="num">Amount</th>
                  <th scope="col" className="num">When</th>
                </tr>
              </thead>
              <tbody>
                {d.ledger.map((e, i) => (
                  <tr key={`${e.at}-${e.player.id}-${i}`}>
                    <td className="ledger-name">{e.player.name}</td>
                    <td className="num">{formatInt(RESOURCE_IDS.reduce((s, r) => s + e.resources[r], 0))}</td>
                    <td className="num">{formatAgo(e.at, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
