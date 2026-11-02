import { useEffect, useRef, useState } from 'react';
import {
  BUILDINGS,
  MAX_TRAIN_BATCH,
  MAX_TRAIN_QUEUE,
  RESOURCE_IDS,
  UNITS,
  UNIT_IDS,
  checkTrain,
  productionPerHour,
  trainTimeMs,
  upkeepPerHour,
} from '@clanfire/engine';
import type { MovementDto, TrainJob, TrainingBuildingId, UnitId, VillageRefDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { Cost, ProgressBar } from '../components/ui.tsx';
import { formatClock, formatCoords, formatDuration, formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { BUILDING_ICON, RESOURCE_ICON, UNIT_ICON } from '../icons.ts';
import { maxTrainable, reasonText, requirementText, unitListText, unmetRequirements } from '../rules.ts';

// ---- Troops table -------------------------------------------------------------------------------------

function TroopsTable() {
  const { live, settings } = useGame();
  const training: Record<UnitId, number> = { pikeman: 0, guard: 0, raider: 0, outrider: 0, knight: 0 };
  for (const q of [live.trainQueues.barracks, live.trainQueues.stables]) for (const j of q) training[j.unit] += j.count - j.done;
  const upkeep = upkeepPerHour(live, settings);
  const farm = productionPerHour(live, settings).food;
  return (
    <section className="card" aria-labelledby="troops-title">
      <h2 id="troops-title" className="card-title">Troops</h2>
      <div className="table-wrap">
        <table className="table troops">
          <thead>
            <tr>
              <th scope="col">Unit</th>
              <th scope="col" className="num">At home</th>
              <th scope="col" className="num">Away</th>
              <th scope="col" className="num">Training</th>
            </tr>
          </thead>
          <tbody>
            {UNIT_IDS.map((u) => {
              const none = live.troops[u] + live.away[u] + training[u] === 0;
              return (
                <tr key={u} className={none ? 'is-zero' : ''}>
                  <th scope="row">
                    <span aria-hidden="true">{UNIT_ICON[u]}</span> {UNITS[u].name}
                  </th>
                  <td className="num">{formatInt(live.troops[u])}</td>
                  <td className="num">{formatInt(live.away[u])}</td>
                  <td className="num">{formatInt(training[u])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted upkeep">
        <span aria-hidden="true">{RESOURCE_ICON.food}</span> Troops eat {formatInt(upkeep)}/h of the {formatInt(farm)}/h your farms grow.
      </p>
    </section>
  );
}

// ---- Movements ----------------------------------------------------------------------------------------

function VillageLink({ v }: { v: VillageRefDto }) {
  const { showOnMap } = useGame();
  return (
    <button className="link" onClick={() => showOnMap(v.x, v.y)} title="Show on map">
      {v.name} ({formatCoords(v.x, v.y)})
    </button>
  );
}

function MovementRow({ m }: { m: MovementDto }) {
  const { now, village, highlightMovementId } = useGame();
  const ref = useRef<HTMLLIElement>(null);
  const highlighted = highlightMovementId === m.id;
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  const incoming = m.direction === 'incoming';
  const other = m.origin.villageId === village.id ? m.target : m.origin;
  const left = m.arriveAt - now;
  const total = Math.max(1, m.arriveAt - m.departAt);
  const lootText = m.loot ? RESOURCE_IDS.filter((r) => (m.loot?.[r] ?? 0) > 0).map((r) => `${RESOURCE_ICON[r]} ${formatInt(m.loot?.[r] ?? 0)}`) : [];

  let title;
  if (incoming) {
    title = (
      <>
        <span aria-hidden="true">⚠️</span> Incoming attack from {m.origin.ownerName ? `${m.origin.ownerName}, ` : ''}
        <VillageLink v={m.origin} />
      </>
    );
  } else if (m.kind === 'attack') {
    title = (
      <>
        <span aria-hidden="true">⚔️</span> Attacking <VillageLink v={other} />
      </>
    );
  } else {
    title = (
      <>
        <span aria-hidden="true">↩️</span> Returning from <VillageLink v={other} />
      </>
    );
  }

  return (
    <li ref={ref} className={`movement${incoming ? ' is-incoming' : ''}${highlighted ? ' is-highlight' : ''}`}>
      <div className="movement-head">
        <span className="movement-title">{title}</span>
        <span className="movement-time">
          <strong>{left > 0 ? formatDuration(left) : 'arriving…'}</strong>
        </span>
      </div>
      <ProgressBar value={(now - m.departAt) / total} tone={incoming ? 'danger' : 'brand'} label="Movement progress" />
      <div className="movement-foot">
        <span>
          {incoming ? 'Army size unknown' : m.units ? unitListText(m.units) : ''}
          {m.kind === 'return' && (lootText.length > 0 ? <> · Loot: {lootText.join('  ')}</> : <> · No loot</>)}
        </span>
        <span className="muted">arrives {formatClock(m.arriveAt, now)}</span>
      </div>
    </li>
  );
}

function Movements() {
  const { movements } = useGame();
  const sorted = [...movements].sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === 'incoming' ? -1 : 1;
    return a.arriveAt - b.arriveAt;
  });
  return (
    <section className="card" aria-labelledby="mov-title">
      <h2 id="mov-title" className="card-title">Movements</h2>
      {sorted.length === 0 ? (
        <p className="muted">No troops on the road. Open the Map and send raiders to an abandoned village.</p>
      ) : (
        <ul className="movement-list">
          {sorted.map((m) => (
            <MovementRow key={m.id} m={m} />
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- Training -----------------------------------------------------------------------------------------

function TrainBatchRow({ job }: { job: TrainJob }) {
  const { now } = useGame();
  const def = UNITS[job.unit];
  const total = job.count * job.perUnitMs;
  const endAt = job.startAt + total;
  const started = now >= job.startAt;
  const nextAt = job.startAt + (job.done + 1) * job.perUnitMs;
  return (
    <li className="job">
      <div className="job-head">
        <span className="job-name">
          <span aria-hidden="true">{UNIT_ICON[job.unit]}</span> {formatInt(job.count)} × {def.name}
          <span className="muted"> ({job.done}/{job.count})</span>
        </span>
        <span className="job-time">
          {started ? (
            <>
              next <strong>{formatDuration(nextAt - now)}</strong>
            </>
          ) : (
            <span className="muted">starts in {formatDuration(job.startAt - now)}</span>
          )}
        </span>
      </div>
      <ProgressBar value={(now - job.startAt) / total} label={`${def.name} batch progress`} />
      <div className="job-foot muted">
        Batch done in {formatDuration(endAt - now)} · {formatClock(endAt, now)}
      </div>
    </li>
  );
}

function UnitCard({ unit, building, busy, setBusy }: { unit: UnitId; building: TrainingBuildingId; busy: boolean; setBusy: (b: boolean) => void }) {
  const { live, now, settings, village, applyVillage, refresh, toast } = useGame();
  const def = UNITS[unit];
  const [text, setText] = useState('');
  const unmet = unmetRequirements(live.buildings, def.requires);
  const locked = unmet.length > 0;
  const parsed = text.trim() === '' ? 0 : Number(text);
  const count = Number.isInteger(parsed) ? Math.max(0, Math.min(MAX_TRAIN_BATCH, parsed)) : 0;
  const perUnit = trainTimeMs(unit, live, settings);
  const max = locked ? 0 : maxTrainable(live, unit, now, settings);
  const check = checkTrain(live, unit, Math.max(1, count), now, settings);
  const queueFull = live.trainQueues[building].length >= MAX_TRAIN_QUEUE;

  let reason: string | null = null;
  if (locked) reason = `Needs ${requirementText(unmet)}`;
  else if (queueFull) reason = 'Queue full';
  else if (count < 1) reason = max < 1 ? 'Not enough resources or food for even one' : 'Enter how many to train';
  else if (!check.ok) reason = reasonText(check, unmet);

  const batchCost = Object.fromEntries(RESOURCE_IDS.map((r) => [r, def.cost[r] * Math.max(1, count)])) as typeof def.cost;

  async function train() {
    if (busy || reason) return;
    setBusy(true);
    try {
      applyVillage(await api.train(village.id, unit, count));
      toast(`Training ${formatInt(count)} ${def.name}`);
      setText('');
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  const speed = def.speed * settings.speed;
  const upkeep = def.upkeep * settings.speed;
  return (
    <article className={`card unit${locked ? ' is-locked' : ''}`} aria-labelledby={`u-${unit}`}>
      <header className="unit-head">
        <span className="building-icon" aria-hidden="true">{UNIT_ICON[unit]}</span>
        <div className="building-title">
          <h4 id={`u-${unit}`}>{def.name}</h4>
          <div className="level">{def.unitClass === 'cavalry' ? 'Cavalry' : 'Infantry'} · {formatInt(live.troops[unit])} at home</div>
        </div>
      </header>
      <p className="building-desc">{def.description}</p>
      <dl className="stats">
        <div><dt>⚔️ Attack</dt><dd>{def.attack}</dd></div>
        <div><dt>🛡️ vs infantry</dt><dd>{def.defenseInfantry}</dd></div>
        <div><dt>🐎 vs cavalry</dt><dd>{def.defenseCavalry}</dd></div>
        <div><dt>👟 Speed</dt><dd>{formatInt(speed)} tiles/h</dd></div>
        <div><dt>🎒 Carry</dt><dd>{def.carry}</dd></div>
        <div><dt>🍖 Upkeep</dt><dd>{formatInt(upkeep)} food/h</dd></div>
      </dl>
      {locked ? (
        <p className="requirements">
          <span aria-hidden="true">🔒</span> Requires {requirementText(unmet)}
        </p>
      ) : (
        <>
          <div className="building-cost">
            <Cost cost={def.cost} have={live.resources} />
            <span className="time" title="Time per unit">
              <span aria-hidden="true">⏱</span> {formatDuration(perUnit)} each
            </span>
          </div>
          <div className="train-row">
            <label className="visually-hidden" htmlFor={`n-${unit}`}>
              How many {def.name}
            </label>
            <input
              id={`n-${unit}`}
              className="input"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_TRAIN_BATCH}
              step={1}
              placeholder="0"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="btn" onClick={() => setText(String(max))} disabled={max < 1} title={`You can afford ${max}`}>
              Max{max > 0 ? ` ${formatInt(max)}` : ''}
            </button>
            <button className="btn btn-primary" onClick={() => void train()} disabled={!!reason || busy}>
              Train
            </button>
          </div>
          {count >= 1 && (
            <div className="muted batch-preview">
              {formatInt(count)} × <Cost cost={batchCost} have={live.resources} /> · {formatDuration(perUnit * count)}
            </div>
          )}
          {reason && <div className="why">{reason}</div>}
        </>
      )}
    </article>
  );
}

function TrainingPanel({ building }: { building: TrainingBuildingId }) {
  const { live, navigate } = useGame();
  const [busy, setBusy] = useState(false);
  const def = BUILDINGS[building];
  const level = live.buildings[building];
  const queue = live.trainQueues[building];
  const units = UNIT_IDS.filter((u) => UNITS[u].building === building);
  const nav = (
    <button className="btn btn-small" onClick={() => navigate('village')}>
      Go to Village
    </button>
  );
  return (
    <section className="card training" aria-labelledby={`t-${building}`}>
      <h2 id={`t-${building}`} className="card-title">
        <span aria-hidden="true">{BUILDING_ICON[building]}</span> {def.name}
        {level > 0 && <span className="muted"> level {level}</span>}
      </h2>
      {level === 0 ? (
        <div className="empty-state">
          <p>Build the {def.name} first.</p>
          {unmetRequirements(live.buildings, def.requires).length > 0 && (
            <p className="muted">Requires {requirementText(unmetRequirements(live.buildings, def.requires))}.</p>
          )}
          {nav}
        </div>
      ) : (
        <>
          {queue.length > 0 && (
            <div className="subsection">
              <h3 className="subtitle">
                Training queue <span className="muted">{queue.length}/{MAX_TRAIN_QUEUE}</span>
              </h3>
              <ol className="job-list">
                {queue.map((job, i) => (
                  <TrainBatchRow key={`${job.unit}-${job.startAt}-${i}`} job={job} />
                ))}
              </ol>
            </div>
          )}
          <div className="unit-grid">
            {units.map((u) => (
              <UnitCard key={u} unit={u} building={building} busy={busy} setBusy={setBusy} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function ArmyView() {
  return (
    <div className="page">
      <h1 className="page-title">Army</h1>
      <div className="army-top">
        <TroopsTable />
        <Movements />
      </div>
      <TrainingPanel building="barracks" />
      <TrainingPanel building="stables" />
    </div>
  );
}
