import { useEffect, useRef, useState } from 'react';
import { CommandPost } from './army/CommandPost.tsx';
import {
  BUILDINGS,
  CANCEL_REFUND_PERCENT,
  MAX_TRAIN_BATCH,
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
  trainTimeMs,
} from '@clanfire/engine';
import type { MovementDto, Resources, StationedDto, TrainJob, TrainingBuildingId, UnitId, Units, VillageRefDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { ChieftainPanel } from '../components/ChieftainPanel.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { Cost, ProgressBar } from '../components/ui.tsx';
import { formatAgo, formatClock, formatCoords, formatDuration, formatInt } from '../format.ts';
import { useGame, useRules } from '../game.ts';
import { BuildingArt } from '../art/BuildingArt.tsx';
import { Icon } from '../art/Icon.tsx';
import { UnitFigure } from '../art/UnitFigure.tsx';
import { timePerTileMs, useUnitInfo } from '../components/UnitInfo.tsx';
import { UNIT_ROLE } from '../unitRole.ts';
import '../army.css';
import { MISSION_ICON, MISSION_NAME, RESOURCE_ICON, RESOURCE_NAME, UNIT_ICON } from '../icons.ts';
import { useConfirm } from '../tribe/Confirm.tsx';
import { useCancelJob } from './cancelJob.tsx';
import { maxTrainable, reasonText, requirementText, unitListText, unmetRequirements } from '../rules.ts';
import { HEARTH_OUT_REASON } from '../villages.ts';

// ---- Troops table -------------------------------------------------------------------------------------

function TroopsList() {
  const { live } = useGame();
  const info = useUnitInfo();
  const training = emptyUnits();
  for (const q of [live.trainQueues.barracks, live.trainQueues.stables, live.trainQueues.bannerhall]) for (const j of q) training[j.unit] += j.count - j.done;
  const used = populationUsage(live).total;
  const cap = populationCap(live);
  return (
    <section className="ar-section" aria-labelledby="troops-title">
      <h2 id="troops-title" className="ar-label">Troops · {formatInt(used)}/{formatInt(cap)}</h2>
      <ul className="ar-troops">
        {UNIT_IDS.map((u) => {
          const none = live.troops[u] + live.away[u] + training[u] === 0;
          const locked = none && unmetRequirements(live.buildings, UNITS[u].requires).length > 0;
          return (
            <li key={u}>
              <button
                type="button"
                className={`ar-unit${none ? ' is-zero' : ''}${locked ? ' is-locked' : ''}`}
                onClick={() => info.open(u)}
                aria-haspopup="dialog"
                title={`About the ${UNITS[u].name}`}
              >
                <span className="ar-pic" aria-hidden="true">
                  <UnitFigure unit={u} pose="icon" size={38} />
                </span>
                <span className="ar-name">{UNITS[u].name}</span>
                {live.away[u] > 0 && <span className="ar-chip">{formatInt(live.away[u])} away</span>}
                {training[u] > 0 && <span className="ar-chip ar-chip-train">+{formatInt(training[u])} training</span>}
                <span className="ar-count">{locked ? <span className="ar-locked">Locked</span> : formatInt(live.troops[u])}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {info.dialog}
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
      toast(`Called back, home in ${formatDuration(res.movement.arriveAt - res.movement.departAt)}`);
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
  } else if (m.kind === 'shipment' && m.toTribeStore) {
    label = 'To Tribe Store';
    tagClass = KIND_TAG.shipment;
  } else {
    label = MISSION_NAME[m.kind];
    tagClass = KIND_TAG[m.kind];
    if (m.kind === 'return') preposition = 'from';
  }
  const who = incoming && m.origin.ownerName ? `${m.origin.ownerName}, ` : '';
  const title = attackIn ? `${m.origin.ownerName ?? other.name} attacks` : label;
  const icon = attackIn ? 'warning' : m.kind === 'return' ? MISSION_ICON.return : MISSION_ICON[m.kind];

  let foot: string;
  if (attackIn) foot = 'size unknown';
  else foot = m.units ? unitListText(m.units) : '';

  return (
    <li
      ref={ref}
      className={`movement mv${attackIn ? ' is-incoming' : ''}${supportIn ? ' is-support' : ''}${highlighted ? ' is-highlight' : ''}`}
    >
      <div className="mv-head">
        <span className="mv-ic" aria-hidden="true">
          <Icon name={icon} size={24} />
        </span>
        <div className="mv-main">
          <div className="mv-title">
            <span className="visually-hidden">{label}: </span>
            {attackIn ? title : <>{title} <span className="mv-prep">{preposition} {who}</span></>}
            <VillageLink v={other} />
          </div>
          <div className="mv-sub">
            {foot}
            {(m.kind === 'return' || m.kind === 'shipment') &&
              (lootItems.length > 0 ? (
                <>
                  {foot ? ' ' : ''}
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
            <span className="mv-arrive"> · arrives {formatClock(m.arriveAt, now)}</span>
          </div>
        </div>
        <strong className="mv-time">{left > 0 ? formatDuration(left) : 'arriving…'}</strong>
      </div>
      <ProgressBar value={(now - m.departAt) / total} tone={attackIn ? 'danger' : supportIn ? 'ok' : 'brand'} label="Movement progress" />
      {cancelLeft > 0 && (
        <div className="movement-foot">
          <button className="btn btn-small" disabled={cancelling} onClick={() => void cancel()} title="Troops come back in the time already travelled">
            Cancel ({formatDuration(cancelLeft)})
          </button>
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
    <section className="ar-section" aria-labelledby="mov-title">
      <h2 id="mov-title" className="ar-label">Moving</h2>
      {sorted.length === 0 ? (
        <p className="muted ar-none">No movements.</p>
      ) : (
        <ul className="movement-list mv-list">
          {sorted.map((m) => (
            <MovementRow key={m.id} m={m} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One calm line per batch in the barracks, stables and banner hall: what is coming next and when. */
function TrainingSummary() {
  const { live, now } = useGame();
  const jobs = (['barracks', 'stables', 'bannerhall'] as const).flatMap((b) => live.trainQueues[b].map((j) => ({ ...j, b })));
  if (jobs.length === 0) return null;
  return (
    <section className="ar-section" aria-labelledby="trainsum-title">
      <h2 id="trainsum-title" className="ar-label">Training</h2>
      <ul className="mv-list">
        {jobs.map((j, i) => {
          const started = now >= j.startAt;
          const nextAt = j.startAt + (j.done + 1) * j.perUnitMs;
          return (
            <li key={`${j.b}-${j.unit}-${j.startAt}-${i}`} className="mv mv-train">
              <div className="mv-head">
                <span className="ar-pic" aria-hidden="true"><UnitFigure unit={j.unit} pose="icon" size={38} /></span>
                <div className="mv-main">
                  <div className="mv-title">{formatInt(j.count - j.done)} {UNITS[j.unit].name}</div>
                  <div className="mv-sub">{started ? `next in ${formatDuration(Math.max(0, nextAt - now))}` : `starts in ${formatDuration(j.startAt - now)}`}</div>
                </div>
                <strong className="mv-time">{formatDuration(Math.max(0, (started ? nextAt : j.startAt) - now))}</strong>
              </div>
            </li>
          );
        })}
      </ul>
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
        {total > 0 ? `Recall ${formatInt(total)}` : 'Recall'}
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
      toast(`${okText}, home in ${formatDuration(res.movement.arriveAt - now)}`);
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
          {unitListText(s.units)} leave {s.host.name} and your village loses their defence.
        </p>
      ),
      confirmLabel: 'Send back',
      danger: true,
    });
    if (ok) await act(() => api.sendBack(s.id), 'Troops sent back');
  }

  return (
    <section className="card" aria-labelledby="support-title">
      <h2 id="support-title" className="card-title">Support</h2>

      <div className="subsection">
        <h3 className="subtitle">
          Stationed here <span className="muted">{stationed.here.length > 0 ? stationed.here.length : ''}</span>
        </h3>
        {stationed.here.length === 0 ? (
          <p className="muted">None.</p>
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
          Abroad <span className="muted">{stationed.abroad.length > 0 ? stationed.abroad.length : ''}</span>
        </h3>
        {stationed.abroad.length === 0 ? (
          <p className="muted">None.</p>
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
                  <button className="btn btn-primary btn-tall" disabled={busy} onClick={() => void act(() => api.recall(s.id), 'Recalled')}>
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
                  <RecallSome s={s} busy={busy} onRecall={(units) => void act(() => api.recall(s.id, units), 'Recalled')} />
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
          <UnitFigure unit={job.unit} pose="icon" size={22} className="inline-icon" /> {formatInt(job.count)} × {def.name}
          <span className="muted"> ({job.done}/{job.count})</span>
        </span>
        <span className="job-time">
          {started ? (
            <>
              <Icon name="time" size={16} className="inline-icon" /> <strong>{formatDuration(nextAt - now)}</strong>
            </>
          ) : (
            <span className="muted">in {formatDuration(job.startAt - now)}</span>
          )}
        </span>
      </div>
      <ProgressBar value={(now - job.startAt) / total} label={`${def.name} batch progress`} />
      <div className="job-foot muted">
        <Icon name="time" size={16} className="inline-icon" /> {formatDuration(endAt - now)} · {formatClock(endAt, now)}
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
  const role = UNIT_ROLE[unit];
  const info = useUnitInfo();
  const [text, setText] = useState('');
  const unmet = unmetRequirements(live.buildings, def.requires);
  const locked = unmet.length > 0;
  const parsed = text.trim() === '' ? 0 : Number(text);
  const count = Number.isInteger(parsed) ? Math.max(0, Math.min(MAX_TRAIN_BATCH, parsed)) : 0;
  const perUnit = trainTimeMs(unit, live, settings);
  const max = locked ? 0 : maxTrainable(live, unit, now, settings);
  const check = checkTrain(live, unit, Math.max(1, count), now, settings);
  const queueFull = live.trainQueues[building].length >= useRules().queues.train;

  let reason: string | null = null;
  if (village.hearth) reason = HEARTH_OUT_REASON;
  else if (locked) reason = `Needs ${requirementText(unmet)}`;
  else if (!isResearched(live, unit)) reason = 'Research in Drillyard';
  else if (queueFull) reason = 'Queue full';
  else if (count < 1) reason = max < 1 ? 'Cannot afford one' : 'Enter amount';
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

  return (
    <article className={`card unit unit-card${locked ? ' is-locked' : ''}`} aria-labelledby={`u-${unit}`}>
      <button type="button" className="unit-stage" onClick={() => info.open(unit)} aria-haspopup="dialog" title={`About the ${def.name}`}>
        <UnitFigure unit={unit} size={168} />
        {locked && (
          <span className="unit-lock">
            <Icon name="lock" size={18} label="Locked" />
          </span>
        )}
      </button>
      <header className="unit-head unit-head-row">
        <div className="building-title">
          <h4 id={`u-${unit}`}>
            <button type="button" className="unit-name" onClick={() => info.open(unit)} aria-haspopup="dialog">
              {def.name}
            </button>
          </h4>
          <div className="level">{formatInt(live.troops[unit])} at home</div>
        </div>
        <span className={`urole urole-${role.tone}`}>{role.label}</span>
      </header>
      <ul className="chips" aria-label="Stats">
        <li className="chip" title="Attack"><span className="chip-k">Atk</span> {def.attack}</li>
        <li className="chip" title="Defence vs infantry"><span className="chip-k">Def foot</span> {def.defenseInfantry}</li>
        <li className="chip" title="Defence vs cavalry"><span className="chip-k">Def riders</span> {def.defenseCavalry}</li>
        <li className="chip" title="Speed"><span className="chip-k">Per field</span> {formatDuration(timePerTileMs(unit, settings))}</li>
        <li className="chip" title="Carry"><span className="chip-k">Carry</span> {def.carry}</li>
        <li className="chip" title="Population"><span className="chip-k">Pop</span> {POP_PER_UNIT[unit]}</li>
      </ul>
      {locked ? (
        <p className="requirements">
          <Icon name="lock" size={18} className="inline-icon" /> Requires {requirementText(unmet)}
        </p>
      ) : (
        <>
          <div className="building-cost">
            <Cost cost={def.cost} have={live.resources} />
            <span className="time" title="Time per unit">
              <Icon name="time" size={18} className="inline-icon" /> {formatDuration(perUnit)}
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
      {info.dialog}
    </article>
  );
}

function TrainingPanel({ building }: { building: TrainingBuildingId }) {
  const { live, navigate } = useGame();
  const rules = useRules();
  const [busy, setBusy] = useState(false);
  const cancel = useCancelJob();
  const def = BUILDINGS[building];
  const level = live.buildings[building];
  const queue = live.trainQueues[building];
  // A world without siege (features.siege off) does not offer the siege units for training.
  const units = UNIT_IDS.filter((u) => UNITS[u].building === building && (rules.features.siege || !UNITS[u].siege));
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
            <p className="muted">Needs {requirementText(unmetRequirements(live.buildings, def.requires))}</p>
          )}
          {nav}
        </div>
      ) : (
        <>
          {queue.length > 0 && (
            <div className="subsection">
              <h3 className="subtitle">
                Training queue <span className="muted">{queue.length}/{rules.queues.train}</span>
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

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function ArmyView() {
  const { openSimulator, live } = useGame();
  const used = populationUsage(live).total;
  const cap = populationCap(live);
  return (
    <div className="page ar-page">
      <PageHeader
        icon="army"
        title="Army"
        count={`${formatInt(used)} / ${formatInt(cap)}`}
        actions={
          <>
            <button type="button" className="btn btn-primary btn-small" onClick={() => scrollToId('army-command')}>
              Send troops
            </button>
            <button type="button" className="btn btn-small" onClick={() => scrollToId('army-training')}>
              Train
            </button>
            <button type="button" className="btn btn-small" onClick={() => openSimulator()}>
              Battle simulator
            </button>
          </>
        }
      />
      <div className="ar-top">
        <TroopsList />
        <div className="ar-side">
          <Movements />
          <TrainingSummary />
        </div>
      </div>
      <div id="army-command">
        <CommandPost />
      </div>
      <SupportPanel />
      <div id="army-training">
        <TrainingPanel building="barracks" />
        <TrainingPanel building="stables" />
      </div>
      <ChieftainPanel />
    </div>
  );
}
