// Pieces shared by the desktop Village page and a building's page (FrameVillage.tsx, FrameBuilding.tsx): the left column (build
// queue, movements, per hour), panel chrome, small helpers and one row of the buildings list with its state control.

import type { ReactNode } from 'react';
import {
  BUILDINGS,
  CANCEL_REFUND_PERCENT,
  RESOURCE_IDS,
  UNITS,
  buildingCost,
  populationCap,
  populationUsage,
  productionPerHour,
  storageCap,
} from '@clanfire/engine';
import type { BuildingId, MovementDto, UnitId } from '@clanfire/engine';
import { BuildingArt } from '../../art/BuildingArt.tsx';
import { Icon } from '../../art/Icon.tsx';
import type { IconName } from '../../art/Icon.tsx';
import { BuildState } from '../../components/BuildState.tsx';
import { formatCompact, formatCoords, formatDuration, formatInt, formatLeft, formatRate } from '../../format.ts';
import { useGame, useRules } from '../../game.ts';
import { RESOURCE_ICON, RESOURCE_NAME } from '../../icons.ts';
import { requirementText } from '../../rules.ts';
import { queueDoneAt, queueUnitsLeft } from '../army/frame-army-logic.ts';
import { useCancelJob } from '../cancelJob.tsx';
import { movementCargo, movementLabel } from './MovementsSummary.tsx';
import { buildingInfo } from './buildingInfo.ts';

/** "15:47" today, "Tue 15:47" on another day. */
export function clockShort(ts: number, now: number): string {
  const d = new Date(ts);
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date(now).toDateString() ? t : `${d.toLocaleDateString([], { weekday: 'short' })} ${t}`;
}

/** "Raiders", "Pikemen": the plural of a unit's name (by its own rule: ends in man -> men, else + s). */
export function pluralUnit(u: UnitId): string {
  const n = UNITS[u].name;
  if (/man$/.test(n)) return `${n.slice(0, -3)}men`;
  if (/(s|x)$/.test(n)) return n;
  return `${n}s`;
}

export function Panel({ title, count, children, className = '' }: { title: string; count?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`fv-pn ${className}`} aria-label={title}>
      <div className="fv-ph">
        <h2>{title}</h2>
        {count !== undefined && <span className="fv-cnt">{count}</span>}
      </div>
      {children}
    </section>
  );
}

/** Dark chevron for links and the step buttons (the drawn arrow icon is gold). */
export function Chev({ flip = false, size = 13 }: { flip?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

/** 946, 1.4k, 12k: the narrow cost columns of the buildings list. */
export function costShort(n: number): string {
  const v = Math.floor(n + 1e-9);
  if (v < 1000) return String(v);
  if (v < 10_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return v < 1_000_000 ? `${Math.round(v / 1000)}k` : formatCompact(v);
}

// ---- Left column ---------------------------------------------------------------------------------------------------

export function QueueSection({ onPick }: { onPick: (id: BuildingId) => void }) {
  const { live, now } = useGame();
  const max = useRules().queues.build;
  const jobs = live.buildQueue;
  const cancel = useCancelJob();
  return (
    <div className="fv-cs">
      {cancel.dialog}
      <div className="fv-csh">
        <h3>Build queue</h3>
        <span className="fv-sp" />
        <span className="fv-cnt" aria-label={`${jobs.length} of ${max} slots used`}>
          {jobs.length} / {max}
        </span>
      </div>
      {jobs.length === 0 && <p className="fv-empty">Nothing is being built.</p>}
      {jobs.map((job, i) => {
        const def = BUILDINGS[job.building];
        const started = now >= job.startAt;
        const total = job.finishAt - job.startAt;
        const last = i === jobs.length - 1;
        return (
          <div key={`${job.building}-${job.targetLevel}`} className="fv-qr">
            <button type="button" className="fv-qpick" onClick={() => onPick(job.building)} aria-label={`${def.name} to level ${job.targetLevel}. Show`}>
              <BuildingArt id={job.building} level={job.targetLevel - 1} building size={40} className="fv-th" />
              <span className="fv-mt">
                <b>
                  {def.name} → {job.targetLevel}
                </b>
                <small>{started ? `Done at ${clockShort(job.finishAt, now)}` : `Next · takes ${formatDuration(total)}`}</small>
                {started && (
                  <span className="fv-bar" aria-hidden="true">
                    <i style={{ width: `${Math.max(0, Math.min(1, (now - job.startAt) / total)) * 100}%` }} />
                  </span>
                )}
              </span>
            </button>
            {started && <span className="fv-cd">{formatDuration(job.finishAt - now)}</span>}
            {last && (
              <button
                type="button"
                className="fv-xb"
                disabled={cancel.busy}
                title={`Cancel (${CANCEL_REFUND_PERCENT}% back)`}
                aria-label={`Cancel ${def.name} level ${job.targetLevel}`}
                onClick={() => void cancel.cancelBuild(`${def.name} level ${job.targetLevel}`, buildingCost(job.building, job.targetLevel), i)}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Rows of the left column's Movements block: 3 on the Village page, 2 where the mini village picture takes the room. */
const MOVE_SHOWN = 3;
const MOVE_SHOWN_CMP = 2;

function moveIcon(mv: MovementDto): { icon: IconName; tone: string } {
  if (mv.kind === 'shipment') return { icon: 'chest', tone: 'm' };
  if (mv.kind === 'return') return { icon: 'return', tone: 'r' };
  if (mv.kind === 'support') return { icon: 'support', tone: 'd' };
  if (mv.kind === 'scout') return { icon: 'scout', tone: 'c' };
  return mv.direction === 'incoming' ? { icon: 'warning', tone: 'm' } : { icon: 'send', tone: 'x' };
}

export function MovementsSection({ compact = false }: { compact?: boolean }) {
  const { movements, now, navigate, viewMovement } = useGame();
  const list = movements
    .filter((m) => m.arriveAt > now)
    .sort((a, b) => {
      const ia = a.direction === 'incoming' && a.kind === 'attack' ? 0 : 1;
      const ib = b.direction === 'incoming' && b.kind === 'attack' ? 0 : 1;
      return ia - ib || a.arriveAt - b.arriveAt;
    });
  const shown = list.slice(0, compact ? MOVE_SHOWN_CMP : MOVE_SHOWN);
  return (
    <div className="fv-cs">
      <div className="fv-csh">
        <h3>Movements</h3>
        <span className="fv-sp" />
        {list.length > 0 && <span className="fv-cnt">{list.length}</span>}
        <button type="button" className="fv-lk" onClick={() => navigate('army')}>
          Army <Chev />
        </button>
      </div>
      <div className="fv-mvs">
        {shown.length === 0 && <p className="fv-empty">Nothing on the road.</p>}
        {shown.map((mv) => {
          const atk = mv.direction === 'incoming' && mv.kind === 'attack';
          const { icon, tone } = moveIcon(mv);
          const title = atk ? `Attack from ${mv.origin.ownerName || mv.origin.name}` : movementLabel(mv);
          const sub = atk ? `${mv.origin.name} (${formatCoords(mv.origin.x, mv.origin.y)})` : movementCargo(mv) || mv.target.name;
          return (
            <button key={mv.id} type="button" className={`fv-mv${atk ? ' is-atk' : ''}`} onClick={() => viewMovement(mv.id)} title={`${title}. Show in Army`}>
              <span className={`fv-tk ${tone}`}>
                <Icon name={icon} size={20} />
              </span>
              <span className="fv-mt">
                <b>{title}</b>
                <small>{sub}</small>
              </span>
              <span className="fv-mc">
                <span className="fv-cd">{formatDuration(mv.arriveAt - now)}</span>
                <span className="fv-at">at {clockShort(mv.arriveAt, now)}</span>
              </span>
            </button>
          );
        })}
        {list.length > shown.length && <span className="fv-more">+{list.length - shown.length} more in Army</span>}
      </div>
    </div>
  );
}

const TRAIN_HOUSES = ['barracks', 'stables', 'bannerhall'] as const;

/** The Army page's middle block: one line per building that is training troops (what, done at) with a link to that building's page. */
export function TrainingSection({ onPick }: { onPick: (id: BuildingId) => void }) {
  const { live, now } = useGame();
  const rows = TRAIN_HOUSES.flatMap((b) => {
    const queue = live.trainQueues[b];
    const doneAt = queueDoneAt(queue);
    if (doneAt === null) return [];
    const kinds = [...new Set(queue.map((j) => j.unit))];
    const left = queueUnitsLeft(queue);
    const first = kinds[0];
    const what = kinds.length === 1 && first ? `${formatInt(left)} ${left === 1 ? UNITS[first].name : pluralUnit(first)}` : `${formatInt(left)} units`;
    return [{ b, what, doneAt }];
  });
  return (
    <div className="fv-cs">
      <div className="fv-csh">
        <h3>Training</h3>
        <span className="fv-sp" />
        {rows.length > 0 && <span className="fv-cnt">{rows.length}</span>}
      </div>
      {rows.length === 0 && <p className="fv-empty">Nobody is being trained.</p>}
      {rows.map(({ b, what, doneAt }) => (
        <div key={b} className="fv-qr fv-trn">
          <BuildingArt id={b} level={1} building size={40} className="fv-th" />
          <span className="fv-mt">
            <b>{BUILDINGS[b].name}</b>
            <small>
              {what} · done {clockShort(doneAt, now)}
            </small>
          </span>
          <button type="button" className="fv-lk" onClick={() => onPick(b)} aria-label={`Open the ${BUILDINGS[b].name}`}>
            Open <Chev />
          </button>
        </div>
      ))}
    </div>
  );
}

export function PerHourSection() {
  const { live, settings } = useGame();
  const cap = storageCap(live);
  const net = productionPerHour(live, settings);
  const pop = populationUsage(live);
  const popCap = populationCap(live);
  const popRatio = popCap > 0 ? pop.total / popCap : 0;
  // The first resource to run into the storage limit.
  let fullIn: { r: (typeof RESOURCE_IDS)[number]; ms: number } | null = null;
  for (const r of RESOURCE_IDS) {
    if (live.resources[r] >= cap - 1e-9) {
      fullIn = { r, ms: 0 };
      break;
    }
    if (net[r] > 0) {
      const ms = ((cap - live.resources[r]) / net[r]) * 3_600_000;
      if (!fullIn || ms < fullIn.ms) fullIn = { r, ms };
    }
  }
  return (
    <div className="fv-cs fv-cs-grow">
      <div className="fv-csh">
        <h3>Per hour</h3>
        <span className="fv-sp" />
        <span className="fv-mut">Storehouse {live.buildings.storehouse}</span>
      </div>
      {RESOURCE_IDS.map((r) => {
        const ratio = cap > 0 ? live.resources[r] / cap : 0;
        return (
          <div key={r} className="fv-cpr">
            <Icon name={RESOURCE_ICON[r]} size={26} label={RESOURCE_NAME[r]} />
            <b>{formatCompact(live.resources[r])}</b>
            <span className="fv-sf" aria-hidden="true">
              <i className={ratio >= 0.9 ? 'hi' : ''} style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }} />
            </span>
            <span className="fv-rt">{formatRate(net[r]).replace(/\/h$/, '')}</span>
          </div>
        );
      })}
      <div className="fv-cpr" aria-label={`Population ${formatInt(pop.total)} of ${formatInt(popCap)}`}>
        <Icon name="pop" size={26} />
        <b>{formatInt(pop.total)}</b>
        <span className="fv-sf" aria-hidden="true">
          <i className="hi" style={{ width: `${Math.max(0, Math.min(1, popRatio)) * 100}%` }} />
        </span>
        <span className="fv-rt is-mu">of {formatInt(popCap)}</span>
      </div>
      <div className="fv-cap">
        Each resource holds up to <b>{formatInt(cap)}</b>
        {fullIn && (
          <>
            {' · '}
            {RESOURCE_NAME[fullIn.r].toLowerCase()} {fullIn.ms <= 0 ? 'is full' : <>full in <b>{formatLeft(fullIn.ms)}</b></>}
          </>
        )}
      </div>
    </div>
  );
}

/** The left column of both pages. `top` (the mini village picture on a building's page) sits above the queue; `compact` tightens it to fit. */
export function LeftColumn({ onPick, top, middle = 'movements' }: { onPick: (id: BuildingId) => void; top?: ReactNode; middle?: 'movements' | 'training' }) {
  return (
    <aside className={`fv-pn fv-left${top ? ' is-cmp' : ''}`} aria-label="Queue, movements and production">
      {top}
      <QueueSection onPick={onPick} />
      {middle === 'training' ? <TrainingSection onPick={onPick} /> : <MovementsSection compact={!!top} />}
      <PerHourSection />
    </aside>
  );
}

/** One building of the Village page's list (and the Town Hall page's list): art, name + level, cost or reason, the state control. */
export function BuildingRow({ id, busy, build, onPick }: { id: BuildingId; busy: boolean; build: (id: BuildingId) => void; onPick: (id: BuildingId) => void }) {
  const { live, now, settings, village } = useGame();
  const limit = useRules().queues.build;
  const info = buildingInfo(live, now, settings, !!village.hearth, limit, id);
  const def = BUILDINGS[id];
  const { kind } = info.pick;
  let sub: ReactNode = null;
  if (kind === 'upgrading') sub = `Upgrading to ${info.active?.targetLevel ?? info.target} · ${formatDuration(info.upgradingLeftMs ?? 0)}`;
  else if (kind === 'queued') sub = `Queued: level ${info.jobs[info.jobs.length - 1]?.targetLevel ?? info.target}`;
  else if (kind === 'max') sub = 'Max level';
  else if (kind === 'locked') sub = `Needs ${requirementText(info.unmet)}`;
  else if (info.cost) {
    const cost = info.cost;
    sub = (
      <span className="fv-bcost">
        {RESOURCE_IDS.filter((r) => cost[r] > 0).map((r) => {
          const short = info.short(r);
          return (
            <span key={r} className={short ? 'is-short' : ''}>
              <Icon name={RESOURCE_ICON[r]} size={16} />
              <b>{costShort(cost[r])}</b>
              {short && <span className="visually-hidden"> (not enough {RESOURCE_NAME[r]})</span>}
            </span>
          );
        })}
      </span>
    );
  }
  return (
    <li className={`fv-br${kind === 'locked' ? ' is-locked' : ''}`}>
      <button type="button" className="fv-bpick" onClick={() => onPick(id)} aria-label={`${def.name}, level ${info.level}. Open its page`}>
        <BuildingArt id={id} level={info.level} size={38} building={info.jobs.length > 0} className="fv-th" />
        <span className="fv-mt">
          <b>
            {def.name} <span className="fv-lv">{info.level}</span>
          </b>
          <small>{sub}</small>
        </span>
      </button>
      <BuildState info={info} busy={busy} onBuild={() => build(id)} />
    </li>
  );
}
