// Tribe tab, "Projects": the Tribe Store, the store village, the running project, Roads / Watchtower / Wards, and the ledger.
// Data: GET /api/tribe/projects. Funding is a normal shipment to the store village (map send form, "To Tribe Store").

import { useCallback, useEffect, useRef, useState } from 'react';
import { CANCEL_REFUND_PERCENT, RESOURCE_IDS } from '@clanfire/engine';
import type { Resources, TribeProjectId, TribeProjectOptionDto, TribeProjectsResponse } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { Icon } from '../art/Icon.tsx';
import type { IconName } from '../art/Icon.tsx';
import { ProgressBar } from '../components/ui.tsx';
import { formatAgo, formatClock, formatCoords, formatDuration, formatInt } from '../format.ts';
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

function CostLine({ cost }: { cost: Resources }) {
  return (
    <span className="loot">
      {RESOURCE_IDS.map((r) => (
        <span key={r} className="loot-item">
          <Icon name={RESOURCE_ICON[r]} size={16} className="inline-icon" />
          <span className="visually-hidden">{RESOURCE_NAME[r]} </span>
          {formatInt(cost[r])}
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
          <span className="store-bar-name">
            <Icon name={RESOURCE_ICON[r]} size={18} className="inline-icon" /> {RESOURCE_NAME[r]}
          </span>
          <ProgressBar value={d.store[r] / Math.max(1, d.storeCap)} tone="brand" label={`${RESOURCE_NAME[r]} in the Tribe Store`} />
          <span className="store-bar-num">
            {formatInt(d.store[r])} <span className="muted">/ {formatInt(d.storeCap)}</span>
          </span>
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
      <section className="card">
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
  if (!home) giveReason = 'Your tribe has no store village yet.';
  else if (d.myGiveFrom !== null && d.myGiveFrom > now) giveReason = `Your account can give from ${formatClock(d.myGiveFrom, now)}.`;
  else if (d.myDailyLeft <= 0) giveReason = 'You gave the most you can today. Try again later.';

  function startReason(p: TribeProjectOptionDto): string | null {
    if (!d || p.nextCost === null) return 'Fully built.';
    if (d.running) return 'Another project is being built.';
    const short = RESOURCE_IDS.find((r) => d.store[r] < (p.nextCost?.[r] ?? 0));
    return short ? `The Tribe Store is short of ${RESOURCE_NAME[short].toLowerCase()}.` : null;
  }

  return (
    <>
      <section className="card" aria-labelledby="store-title">
        <h2 id="store-title" className="card-title">Tribe Store</h2>
        <p className="muted small pad-bottom">
          Members send resources to the store village. The tribe spends them on projects that help every member. Anyone can raid the store village, so defend it.
        </p>
        <StoreBars d={d} />

        <div className="store-home">
          <h3 className="subtitle">Store village</h3>
          {home ? (
            <p>
              <strong>{home.name}</strong>{home.ownerName ? ` (${home.ownerName})` : ''}, {formatCoords(home.x, home.y)}{' '}
              <button className="link link-touch" onClick={() => showOnMap(home.x, home.y)}>Show on map</button>
            </p>
          ) : (
            <p className="muted">No store village yet. {d.canManage ? 'Pick one below.' : 'The leader picks one.'}</p>
          )}
          {d.canManage && (
            <div className="store-pick">
              <label className="field">
                <span>{home ? 'Move the store to' : 'Choose a village'}</span>
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
                onClick={() => void act(() => api.setStoreVillage(Number(pick))).then(() => setPick(''))}
              >
                Set store village
              </button>
              {waitingChange && d.storeVillageChangeableAt !== null && (
                <p className="muted small">You can change it again {formatClock(d.storeVillageChangeableAt, now)}. The contents move with it.</p>
              )}
            </div>
          )}
        </div>

        <div className="store-give">
          <button
            className="btn btn-primary btn-tall btn-wide"
            disabled={!!giveReason || !home}
            onClick={() => home && showOnMap(home.x, home.y, { ship: true })}
          >
            Send resources to the Tribe Store
          </button>
          {giveReason ? (
            <p className="muted small">{giveReason}</p>
          ) : (
            <p className="muted small">You can still give {formatInt(d.myDailyLeft)} today.</p>
          )}
        </div>
        {actionError && <p className="form-error" role="alert">{actionError}</p>}
      </section>

      {d.running && (
        <section className="card" aria-labelledby="running-title">
          <h2 id="running-title" className="card-title">
            <Icon name={PROJECT_ICON[d.running.project]} size={24} className="inline-icon" /> Building {PROJECT_NAME[d.running.project]}, level {d.running.level}
          </h2>
          <p>
            <strong>{d.running.endsAt > now ? formatDuration(d.running.endsAt - now) : 'finishing…'}</strong> left
          </p>
          <ProgressBar
            value={(now - d.running.startedAt) / Math.max(1, d.running.endsAt - d.running.startedAt)}
            tone="ok"
            label="Project progress"
          />
          {d.canManage && (
            <button className="btn btn-danger-outline" disabled={busy} onClick={() => void cancel()}>
              Cancel
            </button>
          )}
        </section>
      )}

      <section className="card" aria-labelledby="projects-title">
        <h2 id="projects-title" className="card-title">Projects</h2>
        <p className="muted small pad-bottom">One at a time, level by level. They last for good and help every member.</p>
        <ul className="project-grid">
          {d.projects.map((p) => {
            const reason = startReason(p);
            return (
              <li key={p.project} className="project-card">
                <div className="project-head">
                  <Icon name={PROJECT_ICON[p.project]} size={36} />
                  <div>
                    <h3 className="project-name">{PROJECT_NAME[p.project]}</h3>
                    <span className="muted small">Level {p.level}/{p.maxLevel}</span>
                  </div>
                </div>
                <p>Now: {effectText(p.project, p.effectNow)}.</p>
                {p.effectNext !== null && p.nextCost && (
                  <>
                    <p>Next: {effectText(p.project, p.effectNext)}.</p>
                    <p className="small">
                      <CostLine cost={p.nextCost} />
                      {p.nextBuildMs !== null && <span className="muted"> · builds in {formatDuration(p.nextBuildMs)}</span>}
                    </p>
                  </>
                )}
                {d.canManage && (
                  <>
                    <button className="btn btn-primary btn-tall" disabled={busy || !!reason} onClick={() => void act(() => api.startProject(p.project))}>
                      Start level {p.level + 1}
                    </button>
                    {reason && p.nextCost !== null && <p className="muted small">{reason}</p>}
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {!d.canManage && <p className="muted small">The leader, or a member with the "Tribe projects" right, starts projects.</p>}
      </section>

      <section className="card" aria-labelledby="ledger-title">
        <h2 id="ledger-title" className="card-title">Who gave</h2>
        {d.totals.length === 0 ? (
          <p className="muted">Nobody has given yet.</p>
        ) : (
          <div className="ledger-cols">
            <div>
              <h3 className="subtitle">Totals</h3>
              <ol className="ledger-list">
                {d.totals.map((t) => (
                  <li key={t.player.id}>
                    <span className="ledger-name">{t.player.name}</span>
                    <span>
                      <strong>{formatInt(t.total)}</strong> <span className="muted small">({formatInt(t.last24h)} in 24 h)</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="subtitle">Recent gifts</h3>
              <ul className="ledger-list">
                {d.ledger.map((e, i) => (
                  <li key={`${e.at}-${e.player.id}-${i}`}>
                    <span className="ledger-name">{e.player.name}</span>
                    <span>
                      {formatInt(RESOURCE_IDS.reduce((s, r) => s + e.resources[r], 0))} <span className="muted small">{formatAgo(e.at, now)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
