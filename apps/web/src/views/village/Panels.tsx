// Village side panels: selected building, construction queue, production, and Mags with a tip.

import {
  BUILDINGS,
  BUILDING_IDS,
  CANCEL_REFUND_PERCENT,
  RESOURCE_IDS,
  UNITS,
  UNIT_IDS,
  buildTimeMs,
  buildingCost,
  buildingPop,
  checkBuild,
  levelPoints,
  populationCap,
  productionPerHour,
  populationUsage,
  storageCap,
} from '@clanfire/engine';
import type { BuildingId, ResourceId } from '@clanfire/engine';
import type { ReactNode } from 'react';
import { BuildingArt } from '../../art/BuildingArt.tsx';
import { Icon } from '../../art/Icon.tsx';
import type { IconName } from '../../art/Icon.tsx';
import { Mags } from '../../art/Mags.tsx';
import { ProgressBar } from '../../components/ui.tsx';
import { formatClock, formatCompact, formatDuration, formatInt, formatRate } from '../../format.ts';
import { useGame, useRules } from '../../game.ts';
import { RESOURCE_ICON, RESOURCE_NAME } from '../../icons.ts';
import { goldNeverArrives, needsGoldText } from '../../shortfall.ts';
import { buildingEffects, reasonText, requirementText, timeToAfford, unmetRequirements } from '../../rules.ts';
import { hearthBuildReason } from '../../villages.ts';
import { useCancelJob } from '../cancelJob.tsx';
import { BannerHallPanel } from './BannerHall.tsx';
import { DrillyardPanel } from './Drillyard.tsx';
import { tipFor } from './tips.ts';

function Chip({ icon, children, short, label }: { icon: IconName; children: ReactNode; short?: boolean; label: string }) {
  return (
    <li className={`chip${short ? ' is-short' : ''}`} aria-label={label}>
      <span className="chip-token" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <span aria-hidden="true">{children}</span>
    </li>
  );
}

// ---- Selected building -------------------------------------------------------------------------------------

export function BuildingPanel({
  id,
  busy,
  onBuild,
  headingId,
  onPick,
}: {
  id: BuildingId;
  busy: boolean;
  onBuild: (id: BuildingId) => void;
  headingId: string;
  onPick?: (id: BuildingId) => void;
}) {
  const { live, now, settings, navigate, village } = useGame();
  const def = BUILDINGS[id];
  const level = live.buildings[id];
  const jobs = live.buildQueue.filter((j) => j.building === id);
  const queued = jobs.length;
  const target = level + queued + 1;
  const atMax = target > def.maxLevel;
  const unmet = unmetRequirements(live.buildings, def.requires);
  const check = checkBuild(live, id, now, settings, useRules().queues.build);
  const cap = storageCap(live);
  const net = productionPerHour(live, settings);
  const cost = atMax ? null : check.ok ? check.cost : buildingCost(id, target);
  const timeMs = atMax ? null : check.ok ? check.timeMs : buildTimeMs(id, target, live.buildings.hall, settings);
  const effects = atMax ? [] : buildingEffects(id, target - 1, target, settings.speed);
  const active = jobs.find((j) => now >= j.startAt);

  let status: string;
  if (active) status = `Upgrading → ${active.targetLevel} · ${formatDuration(active.finishAt - now)}`;
  else if (queued > 0) status = `Level ${level} · +${queued} queued`;
  else if (level === 0 && unmet.length > 0)
    status = `Locked · needs ${requirementText(unmet)}`;
  else if (level === 0) status = 'Not built';
  else status = `Level ${level}/${def.maxLevel}`;

  // A cold village (hearth out) builds only the Wall; the server refuses the rest too.
  const reason = atMax ? 'Max level' : hearthBuildReason(!!village.hearth, id) ?? (!check.ok ? reasonText(check, unmet) : null);
  let affordHint: string | null = null;
  let goldHint = false;
  if (!check.ok && check.reason === 'not_enough_resources' && cost) {
    const wait = timeToAfford(live.resources, net, cost, cap);
    goldHint = wait === null && goldNeverArrives(live.resources, net, cost, cap);
    affordHint = wait === null ? (goldHint ? needsGoldText(live.buildings) : 'Production too low') : `Ready in ${formatDuration(wait)}`;
  }
  const verb = level === 0 && queued === 0 ? 'Build' : 'Upgrade';
  const cta = atMax ? 'Max level' : level === 0 && queued === 0 ? `Build ${def.name}` : `${verb} to level ${target}`;
  const trains = UNIT_IDS.filter((u) => UNITS[u].building === id);
  const nowLines = effects.filter((e) => e.from);
  const nextTitle = queued > 0 ? `Level ${target} (after the queue)` : `Level ${target}`;
  const shortOf = (r: ResourceId) => (cost ? Math.max(0, cost[r] - Math.floor(live.resources[r] + 1e-9)) : 0);

  return (
    <section className="vv-card bpanel" aria-labelledby={headingId}>
      <div className="bpanel-head">
        <BuildingArt id={id} level={level} size={96} building={queued > 0} className="bpanel-art" />
        <div className="bpanel-title">
          <div className="bpanel-name-row">
            <h2 id={headingId} className="bpanel-name">
              {def.name}
            </h2>
            <details className="help-pop">
              <summary aria-label={`About ${def.name}`}>?</summary>
              <p className="small">{def.description}</p>
            </details>
            <span className="lvl-step" aria-label={atMax ? `Level ${level}, max` : `Level ${level}, next ${target}`}>
              <span className="lvl-now">{level}</span>
              {!atMax && (
                <>
                  <Icon name="arrowRight" size={14} />
                  <span className="lvl-next">{target}</span>
                </>
              )}
            </span>
          </div>
          <div className="bpanel-status">{status}</div>
        </div>
      </div>

      {effects.length > 0 && (
        <div className="nownext">
          <div className="nn nn-now">
            <div className="nn-title">{level === 0 ? 'Now' : queued > 0 ? `Level ${target - 1}` : `Now · level ${level}`}</div>
            {nowLines.length > 0 && level > 0 ? (
              nowLines.map((e) => (
                <div key={e.label} className="nn-line">
                  {e.label} <strong>{e.from}</strong>
                </div>
              ))
            ) : (
              <div className="nn-line">{level === 0 ? 'Not built' : 'Nothing yet'}</div>
            )}
          </div>
          <div className="nn nn-next">
            <div className="nn-title">{nextTitle}</div>
            {effects.map((e) => (
              <div key={e.label} className="nn-line">
                {e.label} <strong>{e.to}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      {cost && timeMs !== null && (
        <>
          <ul className="chips">
            {RESOURCE_IDS.filter((r) => cost[r] > 0 || r !== 'gold').map((r) => {
              const short = shortOf(r) > 0 || cost[r] > cap;
              return (
                <Chip
                  key={r}
                  icon={RESOURCE_ICON[r]}
                  short={short}
                  label={`${RESOURCE_NAME[r]} ${formatInt(cost[r])}${short ? `, short by ${formatInt(Math.max(shortOf(r), cost[r] - cap))}` : ''}`}
                >
                  {formatCompact(cost[r])}
                  {short && shortOf(r) > 0 && <span className="chip-short">−{formatCompact(shortOf(r))}</span>}
                </Chip>
              );
            })}
            <Chip icon="time" label={`Build time ${formatDuration(timeMs)}`}>
              {formatDuration(timeMs)}
            </Chip>
            <Chip icon="ranks" label={`Adds ${levelPoints(id, target)} village points when done`}>
              +{formatInt(levelPoints(id, target))} pts
            </Chip>
          </ul>
        </>
      )}

      <div className="bpanel-actions">
        <button
          className="btn btn-primary btn-cta"
          disabled={!!reason || busy}
          onClick={() => onBuild(id)}
          aria-describedby={reason || affordHint ? `why-${id}` : undefined}
        >
          {!reason && <Icon name="upgrade" size={20} />}
          {cta}
        </button>
        {trains.length > 0 && (
          <button className="btn btn-teal btn-cta-side" onClick={() => navigate('army')} disabled={level === 0}>
            <Icon name="train" size={22} />
            Train
          </button>
        )}
      </div>
      {(reason && !atMax) || affordHint ? (
        <div id={`why-${id}`} className="why">
          {reason && !atMax && !goldHint ? reason : null}
          {reason && !atMax && !goldHint && affordHint ? ' · ' : null}
          {affordHint}
        </div>
      ) : null}
      {trains.length > 0 && <div className="bpanel-note">Trains {trains.map((u) => UNITS[u].name).join(' · ')}</div>}
      {id === 'drillyard' && <DrillyardPanel />}
      {id === 'bannerhall' && <BannerHallPanel />}
      {id === 'hall' && <HallBuildings busy={busy} onBuild={onBuild} onPick={onPick} />}
    </section>
  );
}

// ---- Town Hall: every building in one list ---------------------------------------------------------------------

/** All buildings at a glance: built / buildable ones with a quick build button, then the ones still locked. */
function HallBuildings({
  busy,
  onBuild,
  onPick,
}: {
  busy: boolean;
  onBuild: (id: BuildingId) => void;
  onPick?: (id: BuildingId) => void;
}) {
  const { live, now, settings, village } = useGame();
  const limit = useRules().queues.build;
  const pop = populationUsage(live);
  const ids = BUILDING_IDS.filter((b) => b !== 'hall');
  const isLocked = (b: BuildingId) => live.buildings[b] === 0 && unmetRequirements(live.buildings, BUILDINGS[b].requires).length > 0;
  const open = ids.filter((b) => !isLocked(b));
  const locked = ids.filter(isLocked);

  const row = (b: BuildingId) => {
    const def = BUILDINGS[b];
    const level = live.buildings[b];
    const queued = live.buildQueue.filter((j) => j.building === b).length;
    const target = level + queued + 1;
    const atMax = target > def.maxLevel;
    const unmet = unmetRequirements(live.buildings, def.requires);
    const check = checkBuild(live, b, now, settings, limit);
    const reason = atMax ? 'Max level' : hearthBuildReason(!!village.hearth, b) ?? (!check.ok ? reasonText(check, unmet) : null);
    const cost = atMax ? null : check.ok ? check.cost : buildingCost(b, target);
    const timeMs = atMax ? null : check.ok ? check.timeMs : buildTimeMs(b, target, live.buildings.hall, settings);
    const popCost = atMax ? 0 : buildingPop(b, target) - buildingPop(b, target - 1);
    return (
      <li key={b} className={`hb-row${unmet.length > 0 && level === 0 ? ' is-locked' : ''}`}>
        <button type="button" className="hb-pick" onClick={() => onPick?.(b)} aria-label={`${def.name}, level ${level}. Show details`}>
          <BuildingArt id={b} level={level} size={44} building={queued > 0} className="hb-art" />
          <span className="hb-name">
            {def.name}
            <span className="hb-sub">
              {level === 0 ? (unmet.length > 0 ? `Needs ${requirementText(unmet)}` : 'Not built') : `Level ${level}`}
              {queued > 0 ? ` · +${queued} queued` : ''}
            </span>
          </span>
        </button>
        {unmet.length === 0 || level > 0 ? (
          <span className="hb-cost" aria-hidden="true">
            {cost ? RESOURCE_IDS.filter((r) => cost[r] > 0).map((r) => `${formatCompact(cost[r])}`).join(' · ') : ''}
          </span>
        ) : null}
        {(unmet.length === 0 || level > 0) && timeMs !== null ? (
          <span className="hb-time" aria-label={`Build time ${formatDuration(timeMs)}, population ${popCost}`}>
            <Icon name="time" size={14} /> {formatDuration(timeMs)} · {popCost} pop
          </span>
        ) : null}
        {unmet.length === 0 || level > 0 ? (
          <button
            type="button"
            className="btn btn-primary hb-btn"
            disabled={!!reason || busy}
            title={reason ?? undefined}
            onClick={() => onBuild(b)}
          >
            {atMax ? 'Max' : level === 0 && queued === 0 ? 'Build' : `Level ${target}`}
          </button>
        ) : null}
      </li>
    );
  };

  return (
    <div className="hb">
      <div className="eyebrow">Buildings</div>
      <div className="hb-pop" title={`Buildings ${pop.buildings}, troops ${pop.troops}`}>
        Population {formatInt(pop.total)} / {formatInt(populationCap(live))}
      </div>
      <ul className="hb-list">{open.map(row)}</ul>
      {locked.length > 0 && (
        <>
          <div className="eyebrow">Locked</div>
          <ul className="hb-list">{locked.map(row)}</ul>
        </>
      )}
    </div>
  );
}

// ---- Construction queue --------------------------------------------------------------------------------------

export function BuildQueue({ onPick }: { onPick?: (id: BuildingId) => void }) {
  const { live, now, settings } = useGame();
  const maxQueue = useRules().queues.build;
  const jobs = live.buildQueue;
  const cancel = useCancelJob();
  return (
    <section className="vv-card queue" aria-labelledby="queue-title">
      {cancel.dialog}
      <div className="queue-head">
        <Icon name="queue" size={22} />
        <h2 id="queue-title" className="vv-h2">
          Queue
        </h2>
        <span className="queue-count" aria-label={`${jobs.length} of ${maxQueue} slots used`}>
          {jobs.length}/{maxQueue}
        </span>
      </div>
      {jobs.length > 0 && (
        <ol className="qjobs">
          {jobs.map((job, index) => {
            const def = BUILDINGS[job.building];
            const started = now >= job.startAt;
            const total = job.finishAt - job.startAt;
            const effect = buildingEffects(job.building, job.targetLevel - 1, job.targetLevel, settings.speed).find((e) => e.from);
            const left = started ? formatDuration(job.finishAt - now) : `starts ${formatClock(job.startAt, now)}`;
            return (
              <li key={`${job.building}-${job.targetLevel}`} className="qjob">
                <button
                  type="button"
                  className="qjob-art"
                  onClick={() => onPick?.(job.building)}
                  aria-label={`Show ${def.name}`}
                  tabIndex={onPick ? 0 : -1}
                >
                  <BuildingArt id={job.building} level={job.targetLevel - 1} building size={54} />
                </button>
                <div className="qjob-body">
                  <div className="qjob-row">
                    <span className="qjob-name">{def.name}</span>
                    <span className="qjob-lv">
                      {job.targetLevel - 1} → {job.targetLevel}
                    </span>
                    <span className="qjob-time">{left}</span>
                  </div>
                  <div className="qjob-sub">
                    {effect ? `${effect.label} ${effect.from} → ${effect.to}` : started ? `Done ${formatClock(job.finishAt, now)}` : 'Waiting'}
                    {` · +${formatInt(levelPoints(job.building, job.targetLevel))} pts`}
                  </div>
                  <ProgressBar value={started ? (now - job.startAt) / total : 0} label={`${def.name} progress`} />
                  {index === jobs.length - 1 && (
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={cancel.busy}
                      title={`${CANCEL_REFUND_PERCENT}% back`}
                      onClick={() =>
                        void cancel.cancelBuild(`${def.name} level ${job.targetLevel}`, buildingCost(job.building, job.targetLevel), index)
                      }
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {jobs.length < maxQueue && (
        <div className="qfree">
          <span className="qfree-plus" aria-hidden="true">
            +
          </span>
          <span>Free slot</span>
        </div>
      )}
    </section>
  );
}

// ---- Production summary --------------------------------------------------------------------------------------

export function Production() {
  const { live, settings } = useGame();
  const rates = productionPerHour(live, settings);
  return (
    <section className="vv-prod" aria-labelledby="prod-title">
      <h2 id="prod-title" className="eyebrow">
        Production
      </h2>
      <ul>
        {RESOURCE_IDS.map((r) => (
          <li key={r}>
            <span className="token" aria-hidden="true">
              <Icon name={RESOURCE_ICON[r]} size={20} />
            </span>
            <span className="vv-prod-name">{RESOURCE_NAME[r]}</span>
            <span className="vv-prod-rate">{formatRate(rates[r])}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- Mags the Tinker --------------------------------------------------------------------------------------------

export function Advisor({ id, compact }: { id: BuildingId; compact?: boolean }) {
  const { live, settings } = useGame();
  return (
    <section className={`advisor${compact ? ' advisor-compact' : ''}`} aria-label="Advice from Mags the Tinker">
      <Mags size={compact ? 64 : 150} className="advisor-art" />
      <div className="bubble">
        <div className="bubble-name">Mags, the Tinker</div>
        <p>{tipFor(id, live, settings)}</p>
        <span className="bubble-tail" aria-hidden="true">
          <Icon name="tail" size={22} />
        </span>
      </div>
    </section>
  );
}
