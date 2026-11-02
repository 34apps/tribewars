import { useState } from 'react';
import {
  BUILDINGS,
  BUILDING_IDS,
  MAX_BUILD_QUEUE,
  buildTimeMs,
  buildingCost,
  checkBuild,
  netProductionPerHour,
  storageCap,
} from '@tribewars/engine';
import type { BuildingId } from '@tribewars/engine';
import { api, errorMessage } from '../api.ts';
import { Cost, ProgressBar } from '../components/ui.tsx';
import { formatClock, formatDuration } from '../format.ts';
import { useGame } from '../game.ts';
import { BUILDING_ICON } from '../icons.ts';
import { buildingEffects, reasonText, requirementText, timeToAfford, unmetRequirements } from '../rules.ts';

function BuildQueue() {
  const { live, now } = useGame();
  const jobs = live.buildQueue;
  return (
    <section className="card queue" aria-labelledby="queue-title">
      <h2 id="queue-title" className="card-title">
        Construction <span className="muted">{jobs.length}/{MAX_BUILD_QUEUE}</span>
      </h2>
      {jobs.length === 0 ? (
        <p className="muted">Nothing is being built. Pick an upgrade below.</p>
      ) : (
        <ol className="job-list">
          {jobs.map((job) => {
            const def = BUILDINGS[job.building];
            const started = now >= job.startAt;
            const total = job.finishAt - job.startAt;
            return (
              <li key={`${job.building}-${job.targetLevel}`} className="job">
                <div className="job-head">
                  <span className="job-name">
                    <span aria-hidden="true">{BUILDING_ICON[job.building]}</span> {def.name} <span className="muted">to level</span> {job.targetLevel}
                  </span>
                  <span className="job-time">
                    {started ? (
                      <strong>{formatDuration(job.finishAt - now)}</strong>
                    ) : (
                      <span className="muted">starts in {formatDuration(job.startAt - now)}</span>
                    )}
                  </span>
                </div>
                <ProgressBar value={started ? (now - job.startAt) / total : 0} label={`${def.name} progress`} />
                <div className="job-foot muted">
                  {started ? `Done at ${formatClock(job.finishAt, now)}` : `Starts at ${formatClock(job.startAt, now)}`} · takes {formatDuration(total)}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function BuildingCard({ id, busy, onBuild }: { id: BuildingId; busy: boolean; onBuild: (id: BuildingId) => void }) {
  const { live, now, settings } = useGame();
  const def = BUILDINGS[id];
  const level = live.buildings[id];
  const queued = live.buildQueue.filter((j) => j.building === id).length;
  const target = level + queued + 1;
  const atMax = target > def.maxLevel;
  const unmet = unmetRequirements(live.buildings, def.requires);
  const locked = unmet.length > 0;
  const check = checkBuild(live, id, now, settings);
  const cap = storageCap(live);

  const cost = atMax ? null : check.ok ? check.cost : buildingCost(id, target);
  const timeMs = atMax ? null : check.ok ? check.timeMs : buildTimeMs(id, target, live.buildings.hall, settings);
  const effects = atMax ? [] : buildingEffects(id, level, target, settings.speed);

  let reason: string | null = null;
  if (atMax) reason = 'Max level';
  else if (!check.ok) reason = reasonText(check, unmet);

  let affordHint: string | null = null;
  if (!check.ok && check.reason === 'not_enough_resources' && cost) {
    const wait = timeToAfford(live.resources, netProductionPerHour(live, settings), cost, cap);
    affordHint = wait === null ? 'Production is too low to afford this' : `Affordable in ${formatDuration(wait)}`;
  }

  const verb = level === 0 && queued === 0 ? 'Build' : 'Upgrade';
  const cls = ['card', 'building', locked ? 'is-locked' : '', atMax ? 'is-max' : ''].filter(Boolean).join(' ');

  return (
    <article className={cls} aria-labelledby={`b-${id}`}>
      <header className="building-head">
        <span className="building-icon" aria-hidden="true">{BUILDING_ICON[id]}</span>
        <div className="building-title">
          <h3 id={`b-${id}`}>{def.name}</h3>
          <div className="level">
            Level <strong>{level}</strong>/{def.maxLevel}
            {queued > 0 && <span className="queued"> · {queued} queued</span>}
          </div>
        </div>
      </header>
      <p className="building-desc">{def.description}</p>

      {locked ? (
        <p className="requirements">
          <span aria-hidden="true">🔒</span> Requires {requirementText(unmet)}
          <span className="muted"> (you have {unmet.map((u) => u.have).join(', ')})</span>
        </p>
      ) : (
        effects.length > 0 && (
          <dl className="effects">
            {effects.map((e) => (
              <div key={e.label} className="effect">
                <dt>{e.label}</dt>
                <dd>
                  {e.from && <span className="effect-from">{e.from}</span>}
                  {e.from && <span className="effect-arrow" aria-label="becomes"> → </span>}
                  <strong className="effect-to">{e.to}</strong>
                </dd>
              </div>
            ))}
          </dl>
        )
      )}

      {cost && timeMs !== null && (
        <div className="building-cost">
          <Cost cost={cost} have={live.resources} cap={cap} />
          <span className="time" title="Build time">
            <span aria-hidden="true">⏱</span> {formatDuration(timeMs)}
          </span>
        </div>
      )}

      <div className="building-action">
        <button
          className="btn btn-primary btn-block"
          disabled={!!reason || busy}
          onClick={() => onBuild(id)}
          aria-describedby={reason ? `why-${id}` : undefined}
        >
          {atMax ? 'Max level' : `${verb} to level ${target}`}
        </button>
        {(reason && !atMax) || affordHint ? (
          <div id={`why-${id}`} className="why">
            {reason && !atMax ? reason : null}
            {reason && !atMax && affordHint ? ' · ' : null}
            {affordHint}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function VillageView() {
  const { village, applyVillage, refresh, toast } = useGame();
  const [busy, setBusy] = useState(false);

  async function build(id: BuildingId) {
    if (busy) return;
    setBusy(true);
    try {
      applyVillage(await api.build(village.id, id));
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">{village.name}</h1>
      <BuildQueue />
      <div className="building-grid">
        {BUILDING_IDS.map((id) => (
          <BuildingCard key={id} id={id} busy={busy} onBuild={(b) => void build(b)} />
        ))}
      </div>
    </div>
  );
}
