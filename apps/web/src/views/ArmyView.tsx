import { useEffect, useRef, useState } from 'react';
import {
  BUILDINGS,
  CANCEL_REFUND_PERCENT,
  MAX_TRAIN_BATCH,
  MAX_TRAIN_QUEUE,
  RESOURCE_IDS,
  UNITS,
  UNIT_IDS,
  checkTrain,
  emptyUnits,
  isResearched,
  normalizeUnits,
  POP_PER_UNIT,
  populationCap,
  populationUsage,
  productionPerHour,
  trainTimeMs,
  upkeepPerHour,
} from '@clanfire/engine';
import type { MovementDto, Resources, StationedDto, TrainJob, TrainingBuildingId, UnitId, Units, VillageRefDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { ChieftainPanel } from '../components/ChieftainPanel.tsx';
import { Cost, ProgressBar } from '../components/ui.tsx';
import { formatAgo, formatClock, formatCoords, formatDuration, formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { BuildingArt } from '../art/BuildingArt.tsx';
import { Icon } from '../art/Icon.tsx';
import { MISSION_NAME, RESOURCE_ICON, RESOURCE_NAME, UNIT_ICON } from '../icons.ts';
import { useConfirm } from '../tribe/Confirm.tsx';
import { useCancelJob } from './cancelJob.tsx';
import { maxTrainable, reasonText, requirementText, unitListText, unmetRequirements } from '../rules.ts';

// ---- Troops table -------------------------------------------------------------------------------------

function TroopsTable() {
  const { live, settings } = useGame();
  const training = emptyUnits();
  for (const q of [live.trainQueues.barracks, live.trainQueues.stables, live.trainQueues.bannerhall]) for (const j of q) training[j.unit] += j.count - j.done;
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
                    <Icon name={UNIT_ICON[u]} size={20} className="inline-icon" /> {UNITS[u].name}
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
        <Icon name={RESOURCE_ICON.food} size={20} className="inline-icon" /> Troops eat {formatInt(upkeep)}/h of the {formatInt(farm)}/h your farms grow. Population {formatInt(populationUsage(live).total)} / {formatInt(populationCap(live))} (buildings and troops; the Farm raises the cap).
      </p>
    </section>
  );
}

// ---- Movements ----------------------------------------------------------------------------------------

function VillageLink({ v }: { v: VillageRefDto }) {
  const { showOnMap } = useGame();
  return (
    <button className="link link-touch" onClick={() => showOnMap(v.x, v.y)} title="Show on map">
      {v.name} ({formatCoords(v.x, v.y)})
    </button>
  );
}

const KIND_TAG: Record<MovementDto['kind'], string> = { attack: 'tag-warn', scout: 'tag-info', support: 'tag-ok', found: 'tag-ok', occupy: 'tag-ok', return: 'tag-muted', shipment: 'tag-ok' };

function MovementRow({ m }: { m: MovementDto }) {
  const { now, village, villages, highlightMovementId, refresh, toast } = useGame();
  const ref = useRef<HTMLLIElement>(null);
  const [cancelling, setCancelling] = useState(false);
  const cancelLeft = m.cancellableUntil === null ? 0 : m.cancellableUntil - now;
  async function cancel() {
    if (cancelling) return;
    setCancelling(true);
    try {
      const res = await api.cancelMovement(m.id);
      toast(`Called back. They are home in ${formatDuration(res.movement.arriveAt - res.movement.departAt)}.`);
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setCancelling(false);
      await refresh();
    }
  }
  const highlighted = highlightMovementId === m.id;
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  const incoming = m.direction === 'incoming';
  const attackIn = incoming && m.kind === 'attack';
  const supportIn = incoming && m.kind === 'support';
  // The village on the other end: with several villages of mine both ends can be mine, then show the one that is not current.
  const originMine = villages.some((v) => v.id === m.origin.villageId);
  const targetMine = villages.some((v) => v.id === m.target.villageId);
  const other = originMine && !targetMine ? m.target : targetMine && !originMine ? m.origin : m.origin.villageId === village.id ? m.target : m.origin;
  const left = m.arriveAt - now;
  const total = Math.max(1, m.arriveAt - m.departAt);
  const cargo = m.kind === 'shipment' ? m.resources : m.loot;
  const lootItems = cargo ? RESOURCE_IDS.filter((r) => (cargo[r] ?? 0) > 0) : [];
  const carriers = m.units ? UNIT_IDS.some((u) => (m.units?.[u] ?? 0) > 0 && UNITS[u].carry > 0) : false;

  let label: string;
  let tagClass: string;
  let preposition = 'to';
  if (attackIn) {
    label = 'Incoming attack';
    tagClass = 'tag-bad';
    preposition = 'from';
  } else if (supportIn) {
    label = 'Incoming support';
    tagClass = 'tag-ok';
    preposition = 'from';
  } else if (incoming && m.kind === 'shipment') {
    label = 'Incoming resources';
    tagClass = 'tag-ok';
    preposition = 'from';
  } else {
    label = MISSION_NAME[m.kind];
    tagClass = KIND_TAG[m.kind];
    if (m.kind === 'return') preposition = 'from';
  }
  const title = (
    <>
      <span className={`tag ${tagClass}`}>{label}</span> {preposition}{' '}
      {incoming && m.origin.ownerName ? `${m.origin.ownerName}, ` : ''}
      <VillageLink v={other} />
    </>
  );

  let foot: string;
  if (attackIn) foot = 'Army size unknown';
  else foot = m.units ? unitListText(m.units) : '';

  return (
    <li
      ref={ref}
      className={`movement${attackIn ? ' is-incoming' : ''}${supportIn ? ' is-support' : ''}${highlighted ? ' is-highlight' : ''}`}
    >
      <div className="movement-head">
        <span className="movement-title">{title}</span>
        <span className="movement-time">
          <strong>{left > 0 ? formatDuration(left) : 'arriving…'}</strong>
        </span>
      </div>
      <ProgressBar value={(now - m.departAt) / total} tone={attackIn ? 'danger' : supportIn ? 'ok' : 'brand'} label="Movement progress" />
      <div className="movement-foot">
        <span>
          {foot}
          {(m.kind === 'return' || m.kind === 'shipment') &&
            (lootItems.length > 0 ? (
              <>
                {' '}
                {m.kind === 'shipment' ? '' : '· Loot: '}
                {lootItems.map((r) => (
                  <span key={r} className="loot-item">
                    <Icon name={RESOURCE_ICON[r]} size={16} className="inline-icon" />
                    <span className="visually-hidden">{RESOURCE_NAME[r]} </span>
                    {formatInt(cargo?.[r] ?? 0)}{' '}
                  </span>
                ))}
              </>
            ) : carriers ? (
              <> · No loot</>
            ) : null)}
        </span>
        <span className="muted">arrives {formatClock(m.arriveAt, now)}</span>
      </div>
      {cancelLeft > 0 && (
        <div className="movement-foot">
          <button className="btn btn-small" disabled={cancelling} onClick={() => void cancel()}>
            Cancel ({formatDuration(cancelLeft)})
          </button>
          <span className="muted">They come back in the time already travelled.</span>
        </div>
      )}
    </li>
  );
}

/** Incoming attacks first (most urgent), then incoming support, then my own troops; each by arrival. */
function movementRank(m: MovementDto): number {
  if (m.direction === 'incoming') return m.kind === 'attack' ? 0 : 1;
  return 2;
}

function Movements() {
  const { movements } = useGame();
  const sorted = [...movements].sort((a, b) => movementRank(a) - movementRank(b) || a.arriveAt - b.arriveAt);
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

// ---- Support (stationed troops) -----------------------------------------------------------------------

function RecallSome({ s, busy, onRecall }: { s: StationedDto; busy: boolean; onRecall: (units: Partial<Units>) => void }) {
  const have = normalizeUnits(s.units);
  const [counts, setCounts] = useState<Partial<Record<UnitId, string>>>({});
  const present = UNIT_IDS.filter((u) => have[u] > 0);
  const chosen: Partial<Units> = {};
  let total = 0;
  for (const u of present) {
    const n = Number(counts[u] ?? '');
    const v = Number.isInteger(n) ? Math.max(0, Math.min(have[u], n)) : 0;
    if (v > 0) {
      chosen[u] = v;
      total += v;
    }
  }
  return (
    <form
      className="recall-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (total > 0 && !busy) onRecall(chosen);
      }}
    >
      <ul className="send-units">
        {present.map((u) => (
          <li key={u}>
            <label htmlFor={`recall-${s.id}-${u}`} className="send-label">
              <Icon name={UNIT_ICON[u]} size={20} className="inline-icon" /> {UNITS[u].name}
              <span className="muted"> / {formatInt(have[u])}</span>
            </label>
            <input
              id={`recall-${s.id}-${u}`}
              className="input"
              type="number"
              inputMode="numeric"
              min={0}
              max={have[u]}
              step={1}
              placeholder="0"
              value={counts[u] ?? ''}
              onChange={(e) => setCounts((c) => ({ ...c, [u]: e.target.value }))}
            />
            <button type="button" className="btn" onClick={() => setCounts((c) => ({ ...c, [u]: String(have[u]) }))}>
              all
            </button>
          </li>
        ))}
      </ul>
      <button className="btn btn-primary btn-block" type="submit" disabled={total < 1 || busy}>
        {total > 0 ? `Recall ${formatInt(total)} troops` : 'Choose troops to recall'}
      </button>
    </form>
  );
}

function SupportPanel() {
  const { stationed, now, refresh, toast } = useGame();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [recalling, setRecalling] = useState<number | null>(null);

  async function act(fn: () => Promise<{ movement: MovementDto }>, okText: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fn();
      setRecalling(null);
      toast(`${okText} They arrive in ${formatDuration(res.movement.arriveAt - now)}.`);
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function sendBack(s: StationedDto) {
    const who = s.home.ownerName ? `${s.home.ownerName}'s` : 'These';
    const ok = await confirm({
      title: `Send ${who} troops back?`,
      body: (
        <p>
          {unitListText(s.units)} stationed in {s.host.name} will march home to {s.home.name}. Your village loses their help in defense.
        </p>
      ),
      confirmLabel: 'Send back',
      danger: true,
    });
    if (ok) await act(() => api.sendBack(s.id), 'Troops are on their way home.');
  }

  return (
    <section className="card" aria-labelledby="support-title">
      <h2 id="support-title" className="card-title">Support</h2>

      <div className="subsection">
        <h3 className="subtitle">
          Troops stationed in my village <span className="muted">{stationed.here.length > 0 ? stationed.here.length : ''}</span>
        </h3>
        {stationed.here.length === 0 ? (
          <p className="muted">No one's troops are defending your village.</p>
        ) : (
          <ul className="movement-list" aria-label="Troops stationed in my village">
            {stationed.here.map((s) => (
              <li key={s.id} className="movement is-support stationed">
                <div className="stationed-main">
                  <div>
                    <span className="tag tag-ok">Support</span> from {s.home.ownerName ? `${s.home.ownerName}, ` : ''}
                    <VillageLink v={s.home} />
                  </div>
                  <div className="stationed-units">{unitListText(s.units)}</div>
                  <div className="muted small">
                    at {s.host.name} · arrived {formatAgo(s.arrivedAt, now)}
                  </div>
                </div>
                <div className="stationed-actions">
                  <button className="btn btn-danger-outline btn-tall" disabled={busy} onClick={() => void sendBack(s)}>
                    Send back
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="subsection">
        <h3 className="subtitle">
          My troops abroad <span className="muted">{stationed.abroad.length > 0 ? stationed.abroad.length : ''}</span>
        </h3>
        {stationed.abroad.length === 0 ? (
          <p className="muted">You have no troops stationed in other villages. Pick a tribe-mate on the Map and choose Support.</p>
        ) : (
          <ul className="movement-list" aria-label="My troops abroad">
            {stationed.abroad.map((s) => (
              <li key={s.id} className="movement stationed">
                <div className="stationed-main">
                  <div>
                    <span className="tag tag-info">Abroad</span> in {s.host.ownerName ? `${s.host.ownerName}, ` : ''}
                    <VillageLink v={s.host} />
                  </div>
                  <div className="stationed-units">{unitListText(s.units)}</div>
                  <div className="muted small">arrived {formatAgo(s.arrivedAt, now)}</div>
                </div>
                <div className="stationed-actions">
                  <button className="btn btn-primary btn-tall" disabled={busy} onClick={() => void act(() => api.recall(s.id), 'Troops recalled.')}>
                    Recall all
                  </button>
                  <button
                    className="btn btn-tall"
                    aria-expanded={recalling === s.id}
                    disabled={busy}
                    onClick={() => setRecalling((cur) => (cur === s.id ? null : s.id))}
                  >
                    Recall some
                  </button>
                </div>
                {recalling === s.id && (
                  <RecallSome s={s} busy={busy} onRecall={(units) => void act(() => api.recall(s.id, units), 'Troops recalled.')} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {dialog}
    </section>
  );
}

// ---- Training -----------------------------------------------------------------------------------------

function TrainBatchRow({ job, onCancel, disabled }: { job: TrainJob; onCancel: () => void; disabled: boolean }) {
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
          <Icon name={UNIT_ICON[job.unit]} size={20} className="inline-icon" /> {formatInt(job.count)} × {def.name}
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
      <button type="button" className="btn btn-small" disabled={disabled} onClick={onCancel}>
        Cancel ({CANCEL_REFUND_PERCENT}% back)
      </button>
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
  else if (!isResearched(live, unit)) reason = 'Research it in the Drillyard';
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
        <span className="building-icon" aria-hidden="true">
          <Icon name={UNIT_ICON[unit]} size={30} />
        </span>
        <div className="building-title">
          <h4 id={`u-${unit}`}>{def.name}</h4>
          <div className="level">{def.unitClass === 'cavalry' ? 'Cavalry' : 'Infantry'} · {formatInt(live.troops[unit])} at home</div>
        </div>
      </header>
      <p className="building-desc">{def.description}</p>
      <dl className="stats">
        <div><dt>Attack</dt><dd>{def.attack}</dd></div>
        <div><dt>Defence vs infantry</dt><dd>{def.defenseInfantry}</dd></div>
        <div><dt>Defence vs cavalry</dt><dd>{def.defenseCavalry}</dd></div>
        <div><dt>Speed</dt><dd>{formatInt(speed)} tiles/h</dd></div>
        <div><dt>Carry</dt><dd>{def.carry}</dd></div>
        <div><dt>Upkeep</dt><dd>{formatInt(upkeep)} food/h</dd></div>
        <div><dt>Population</dt><dd>{POP_PER_UNIT[unit]}</dd></div>
      </dl>
      {locked ? (
        <p className="requirements">
          <Icon name="lock" size={18} className="inline-icon" /> Requires {requirementText(unmet)}
        </p>
      ) : (
        <>
          <div className="building-cost">
            <Cost cost={def.cost} have={live.resources} />
            <span className="time" title="Time per unit">
              <Icon name="time" size={18} className="inline-icon" /> {formatDuration(perUnit)} each
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
  const cancel = useCancelJob();
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
      {cancel.dialog}
      <h2 id={`t-${building}`} className="card-title">
        <BuildingArt id={building} level={1} size={24} className="inline-icon" /> {def.name}
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
                  <TrainBatchRow
                    key={`${job.unit}-${job.startAt}-${i}`}
                    job={job}
                    disabled={cancel.busy}
                    onCancel={() => {
                      const left = job.count - job.done;
                      const paid = Object.fromEntries(RESOURCE_IDS.map((r) => [r, UNITS[job.unit].cost[r] * left])) as Resources;
                      void cancel.cancelTrain(`${formatInt(left)} × ${UNITS[job.unit].name}`, paid, building, i);
                    }}
                  />
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
      <SupportPanel />
      <TrainingPanel building="barracks" />
      <TrainingPanel building="stables" />
      <ChieftainPanel />
    </div>
  );
}
