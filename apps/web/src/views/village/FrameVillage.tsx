// The desktop Village page inside the fixed 1440x900 frame (owner-approved mockup mix-village-1440): a left column (build queue,
// movements, per hour), the framed village picture with troops, First steps and Renown (or Standing) in the middle, and the list of
// all buildings with a quick "Up" on the right. Everything is real client data; actions call the same endpoints as the panels.
// Clicking a building opens its own page (`#village/b/<id>`): the left column stays, the main area shows the building panel.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BUILDINGS,
  BUILDING_IDS,
  CANCEL_REFUND_PERCENT,
  RESOURCE_IDS,
  UNITS,
  UNIT_IDS,
  buildTimeMs,
  buildingCost,
  checkBuild,
  populationCap,
  populationUsage,
  productionPerHour,
  storageCap,
  villagePoints,
} from '@clanfire/engine';
import type { BuildingId, MovementDto } from '@clanfire/engine';
import { api } from '../../api.ts';
import { BuildingArt } from '../../art/BuildingArt.tsx';
import { Icon } from '../../art/Icon.tsx';
import type { IconName } from '../../art/Icon.tsx';
import { Mags } from '../../art/Mags.tsx';
import { UnitFigure } from '../../art/UnitFigure.tsx';
import { Cost } from '../../components/ui.tsx';
import { FIRST_STEP_LABEL, claimableSteps, doneCount, firstStepsVisible, nextOpenStep } from '../../firstSteps.ts';
import { formatCompact, formatCoords, formatDuration, formatInt, formatLeft, formatRate } from '../../format.ts';
import { useGame, useRules } from '../../game.ts';
import { RESOURCE_ICON, RESOURCE_NAME } from '../../icons.ts';
import { reasonText, requirementText, unmetRequirements } from '../../rules.ts';
import { hearthBuildReason } from '../../villages.ts';
import { useCancelJob } from '../cancelJob.tsx';
import { Advisor, BuildingPanel } from './Panels.tsx';
import { useFirstSteps } from './FirstSteps.tsx';
import { movementCargo, movementLabel } from './MovementsSummary.tsx';
import { VillageScene } from './VillageScene.tsx';
import { useBuild } from './useBuild.ts';

/** "15:47" today, "Tue 15:47" on another day. */
function clockShort(ts: number, now: number): string {
  const d = new Date(ts);
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date(now).toDateString() ? t : `${d.toLocaleDateString([], { weekday: 'short' })} ${t}`;
}

function Panel({ title, count, children, className = '' }: { title: string; count?: ReactNode; children: ReactNode; className?: string }) {
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
function Chev({ flip = false, size = 13 }: { flip?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

/** 946, 1.4k, 12k: the narrow cost columns of the buildings list. */
function costShort(n: number): string {
  const v = Math.floor(n + 1e-9);
  if (v < 1000) return String(v);
  if (v < 10_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return v < 1_000_000 ? `${Math.round(v / 1000)}k` : formatCompact(v);
}

// ---- Left column ---------------------------------------------------------------------------------------------------

function QueueSection({ onPick }: { onPick: (id: BuildingId) => void }) {
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
                <small>{started ? `Building · done ${clockShort(job.finishAt, now)}` : `Next · takes ${formatDuration(total)}`}</small>
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

const MOVE_SHOWN = 3;

function moveIcon(mv: MovementDto): { icon: IconName; tone: string } {
  if (mv.kind === 'shipment') return { icon: 'chest', tone: 'm' };
  if (mv.kind === 'return') return { icon: 'return', tone: 'r' };
  if (mv.kind === 'support') return { icon: 'support', tone: 'd' };
  if (mv.kind === 'scout') return { icon: 'scout', tone: 'c' };
  return mv.direction === 'incoming' ? { icon: 'warning', tone: 'm' } : { icon: 'send', tone: 'x' };
}

function MovementsSection() {
  const { movements, now, navigate, viewMovement } = useGame();
  const list = movements
    .filter((m) => m.arriveAt > now)
    .sort((a, b) => {
      const ia = a.direction === 'incoming' && a.kind === 'attack' ? 0 : 1;
      const ib = b.direction === 'incoming' && b.kind === 'attack' ? 0 : 1;
      return ia - ib || a.arriveAt - b.arriveAt;
    });
  const shown = list.slice(0, MOVE_SHOWN);
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

function PerHourSection() {
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

// ---- Centre ----------------------------------------------------------------------------------------------------------

function TroopsPanel() {
  const { live, navigate } = useGame();
  const chiefs = live.troops.chieftain ?? 0;
  return (
    <section className="fv-pn fv-troops" aria-label="Troops at home">
      <div className="fv-ph">
        <h2>Troops at home</h2>
        <span className="fv-sp" />
        {chiefs > 0 && (
          <span className="fv-chf">
            <UnitFigure unit="chieftain" pose="icon" size={26} />
            <span>
              <b>
                {chiefs} {chiefs === 1 ? 'Chieftain' : 'Chieftains'}
              </b>{' '}
              ready
            </span>
          </span>
        )}
        <button type="button" className="fv-lk" onClick={() => navigate('army')}>
          Army <Chev />
        </button>
      </div>
      <ul className="fv-trow">
        {UNIT_IDS.map((u) => {
          const n = live.troops[u] ?? 0;
          return (
            <li key={u} className={`fv-tq${n === 0 ? ' is-off' : ''}`} aria-label={`${n} ${UNITS[u].name}`} title={UNITS[u].name}>
              <UnitFigure unit={u} pose="icon" size={38} />
              <b>{n > 0 ? formatInt(n) : '–'}</b>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FirstStepsPanel({ onShowBuilding }: { onShowBuilding: (id: BuildingId) => void }) {
  const { firstSteps, busy, claim, show } = useFirstSteps(onShowBuilding);
  if (!firstStepsVisible(firstSteps)) return null;
  const total = firstSteps.steps.length;
  const done = doneCount(firstSteps);
  const waiting = claimableSteps(firstSteps)[0] ?? null;
  const next = nextOpenStep(firstSteps);
  const step = waiting ?? next;
  return (
    <section className="fv-pn fv-fs" aria-label="First steps">
      <div className="fv-ph">
        <h2>First steps</h2>
        <span className="fv-sp" />
        <span className="fv-cnt" aria-label={`${done} of ${total} done`}>
          {done} / {total}
        </span>
      </div>
      <div className="fv-qc">
        <Mags size={58} className="fv-mags" />
        <div className="fv-qc-body">
          <div className="fv-qline">{step ? (waiting ? `${FIRST_STEP_LABEL[step.id]}: done` : FIRST_STEP_LABEL[step.id]) : 'Everything done'}</div>
          <div className="fv-qmeta">
            <span className="fv-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="First steps done">
              <i style={{ width: `${(done / total) * 100}%` }} />
            </span>
            <span>
              {done} of {total}
            </span>
          </div>
          {step && (
            <div className="fv-qmeta fv-qreward">
              <span className="fv-rw">
                Reward: <Cost cost={step.reward} />
              </span>
              <span className="fv-sp" />
              {waiting ? (
                <button type="button" className="fv-btn fv-btn-g sm" disabled={busy !== null} onClick={() => claim(waiting)}>
                  {busy === waiting.id ? '...' : 'Claim'}
                </button>
              ) : (
                <button type="button" className="fv-btn sm" onClick={() => show(step)}>
                  Go
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** My rank by Renown from the existing ranking endpoint (my own row, also outside the top 100). Refreshes while the page is open. */
function useRenownRank(active: boolean): number | null {
  const [rank, setRank] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    let dead = false;
    const load = () =>
      api
        .renownRanking()
        .then((r) => {
          if (!dead) setRank(r.me?.rank ?? null);
        })
        .catch(() => undefined);
    load();
    const id = window.setInterval(load, 120_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [active]);
  return rank;
}

function useStanding(active: boolean) {
  const { renown, villages, player } = useGame();
  const rank = useRenownRank(active);
  const points = villages.reduce((sum, v) => sum + villagePoints(v.state), 0);
  return { renown, rank: rank === null ? '–' : `#${formatInt(rank)}`, points: formatInt(points), tag: player.tribe ? player.tribe.tag : '–', villages: renown.villages };
}

function RenownPanel({ active }: { active: boolean }) {
  const s = useStanding(active);
  return (
    <section className="fv-pn fv-rn" aria-label="Renown">
      <div className="fv-ph">
        <h2>Renown</h2>
      </div>
      <div className="fv-rn2">
        <Icon name="renown" size={40} />
        <span>
          <b>{formatInt(s.renown.balance)}</b>
          <small>Next village {formatInt(s.renown.nextVillageCost)}</small>
        </span>
      </div>
      <div className="fv-rn3">
        <span className="fv-up">Rank</span>
        <b>{s.rank}</b>
        <span className="fv-up fv-gap">Points</span>
        <b>{s.points}</b>
      </div>
    </section>
  );
}

/** Replaces First steps and Renown once the steps are finished (or hidden). */
function StandingPanel({ active }: { active: boolean }) {
  const s = useStanding(active);
  const toGo = Math.max(0, s.renown.nextVillageCost - s.renown.balance);
  return (
    <section className="fv-pn fv-standing" aria-label="Standing">
      <div className="fv-ph">
        <h2>Standing</h2>
      </div>
      <div className="fv-stb">
        <div className="fv-stren">
          <Icon name="renown" size={44} />
          <span>
            <b>{formatInt(s.renown.balance)}</b>
            <small>{toGo > 0 ? `${formatInt(toGo)} to go` : 'Village affordable'}</small>
          </span>
        </div>
        <div className="fv-stf">
          <span className="fv-up">Rank</span>
          <b>{s.rank}</b>
        </div>
        <div className="fv-stf">
          <span className="fv-up">Points</span>
          <b>{s.points}</b>
        </div>
        <div className="fv-stf">
          <span className="fv-up">Tribe</span>
          <b>{s.tag}</b>
        </div>
        <div className="fv-stf">
          <span className="fv-up">Villages</span>
          <b>{formatInt(s.villages)}</b>
        </div>
      </div>
    </section>
  );
}

// ---- Right column: all buildings ---------------------------------------------------------------------------------

function BuildingsList({ busy, build, onPick }: { busy: boolean; build: (id: BuildingId) => void; onPick: (id: BuildingId) => void }) {
  const { live, now, settings, village } = useGame();
  const limit = useRules().queues.build;
  const cap = storageCap(live);
  return (
    <section className="fv-pn fv-blist" aria-label="Buildings">
      <div className="fv-ph">
        <h2>Buildings</h2>
        <span className="fv-cnt">{BUILDING_IDS.length}</span>
        <span className="fv-sp" />
        <span className="fv-mut">next level</span>
      </div>
      <ul className="fv-bt">
        {BUILDING_IDS.map((b) => {
          const def = BUILDINGS[b];
          const level = live.buildings[b];
          const jobs = live.buildQueue.filter((j) => j.building === b);
          const active = jobs.find((j) => now >= j.startAt);
          const target = level + jobs.length + 1;
          const atMax = target > def.maxLevel;
          const unmet = unmetRequirements(live.buildings, def.requires);
          const locked = level === 0 && unmet.length > 0;
          const check = checkBuild(live, b, now, settings, limit);
          const reason = atMax ? 'Max level' : hearthBuildReason(!!village.hearth, b) ?? (!check.ok ? reasonText(check, unmet) : null);
          const cost = atMax ? null : check.ok ? check.cost : buildingCost(b, target);
          let sub: ReactNode = null;
          let right: ReactNode = null;
          if (active) {
            sub = `Upgrading to ${active.targetLevel} · ${formatDuration(active.finishAt - now)}`;
            right = <span className="fv-cd is-teal">{formatDuration(active.finishAt - now)}</span>;
          } else if (jobs.length > 0) {
            sub = `Queued: level ${jobs[jobs.length - 1]?.targetLevel ?? target}`;
            right = <span className="fv-tag">Next</span>;
          } else if (atMax) {
            sub = 'Max level';
            right = <span className="fv-tag">Max</span>;
          } else if (locked) {
            sub = `Needs ${requirementText(unmet)}`;
            right = (
              <span className="fv-tag">
                <Icon name="lock" size={14} /> Locked
              </span>
            );
          } else if (cost) {
            sub = (
              <span className="fv-bcost">
                {RESOURCE_IDS.filter((r) => cost[r] > 0).map((r) => {
                  const short = Math.floor(live.resources[r] + 1e-9) < cost[r] || cost[r] > cap;
                  return (
                    <span key={r} className={short ? 'is-short' : ''} title={`${RESOURCE_NAME[r]}${short ? ' (not enough)' : ''}`}>
                      <Icon name={RESOURCE_ICON[r]} size={16} />
                      <b>{costShort(cost[r])}</b>
                      {short && <span className="visually-hidden"> (not enough)</span>}
                    </span>
                  );
                })}
              </span>
            );
            const blocked = !!reason || busy;
            right = (
              <button
                type="button"
                className={`fv-btn fv-btn-g sm${reason ? ' is-dis' : ''}`}
                disabled={blocked}
                title={reason ?? undefined}
                aria-label={`${level === 0 ? 'Build' : 'Upgrade'} ${def.name} to level ${target}${reason ? `. ${reason}` : ''}`}
                onClick={() => build(b)}
              >
                <Icon name="upgrade" size={16} />
                {level === 0 ? 'Build' : 'Up'}
              </button>
            );
          }
          return (
            <li key={b} className={`fv-br${locked ? ' is-locked' : ''}`}>
              <button type="button" className="fv-bpick" onClick={() => onPick(b)} aria-label={`${def.name}, level ${level}. Open its page`}>
                <BuildingArt id={b} level={level} size={38} building={jobs.length > 0} className="fv-th" />
                <span className="fv-mt">
                  <b>
                    {def.name} <span className="fv-lv">{level}</span>
                  </b>
                  <small>{sub}</small>
                </span>
              </button>
              {right}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---- A building's own page -----------------------------------------------------------------------------------------

function BuildingPage({ id, busy, build }: { id: BuildingId; busy: boolean; build: (id: BuildingId) => void }) {
  const { openBuilding } = useGame();
  const at = BUILDING_IDS.indexOf(id);
  const step = (d: number) => openBuilding(BUILDING_IDS[(at + d + BUILDING_IDS.length) % BUILDING_IDS.length] ?? null);
  return (
    <section className="fv-pn fv-bpage" aria-label={BUILDINGS[id].name}>
      <div className="fv-ph fv-crumb">
        <nav aria-label="Breadcrumb" className="fv-crumbs">
          <button type="button" className="fv-lk" onClick={() => openBuilding(null)}>
            Village
          </button>
          <span aria-hidden="true">›</span>
          <h2>{BUILDINGS[id].name}</h2>
        </nav>
        <span className="fv-sp" />
        <button type="button" className="fv-xb" onClick={() => step(-1)} aria-label="Previous building" title="Previous building">
          <Chev flip size={16} />
        </button>
        <button type="button" className="fv-xb" onClick={() => step(1)} aria-label="Next building" title="Next building">
          <Chev size={16} />
        </button>
      </div>
      <div className="fv-bbody">
        <BuildingPanel id={id} busy={busy} onBuild={build} headingId="bpanel-title" onPick={openBuilding} />
        <Advisor id={id} />
      </div>
    </section>
  );
}

// ---- The page ---------------------------------------------------------------------------------------------------------

export function FrameVillage({
  active,
  notices,
  levelOverride,
}: {
  active: boolean;
  /** Abandoned / hearth notices and the design preview bar: shown in a slim line above the picture. */
  notices: ReactNode;
  levelOverride: Parameters<typeof VillageScene>[0]['levelOverride'];
}) {
  const { village, firstSteps, building, openBuilding } = useGame();
  const { busy, build } = useBuild();
  // Escape on a building's page goes back to the Village page.
  useEffect(() => {
    if (!active || !building) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) openBuilding(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, building, openBuilding]);
  const steps = firstStepsVisible(firstSteps);
  return (
    <div className="fv" hidden={!active}>
      <aside className="fv-pn fv-left" aria-label="Queue, movements and production">
        <QueueSection onPick={openBuilding} />
        <MovementsSection />
        <PerHourSection />
      </aside>
      {building && <BuildingPage id={building} busy={busy} build={build} />}
      <div className="fv-main" hidden={!!building}>
        <div className="fv-centre">
          <div className="fv-notes">{notices}</div>
          <section className="fv-pic" aria-label={`${village.name}, village`}>
            <h1 className="visually-hidden">{village.name}</h1>
            <VillageScene mode="fit" selected={null} onSelect={openBuilding} levelOverride={levelOverride} />
            <span className="fv-pcap">
              <Icon name="village" size={16} />
              Click a building to open its page
            </span>
          </section>
          <TroopsPanel />
          <div className="fv-bottom">
            {steps ? (
              <>
                <FirstStepsPanel onShowBuilding={openBuilding} />
                <RenownPanel active={active} />
              </>
            ) : (
              <StandingPanel active={active} />
            )}
          </div>
        </div>
        <BuildingsList busy={busy} build={build} onPick={openBuilding} />
      </div>
    </div>
  );
}
