// A building's own page on the desktop (route `#village/b/<id>`, owner-approved mockup mix-building-1440). Left: the village column with a
// mini picture. Top card: art, name, level, step / jump controls, what it does now vs next level and the upgrade box with ONE state
// control (components/BuildState.tsx). Main area: Barracks and Stables get the Recruit table, training queue and "Your order";
// the Town Hall lists every building; Drillyard and Banner Hall show their own panels; the rest show their next levels.
// All numbers come from the engine; every action calls the same endpoint as the Army page and the Village list.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BUILDINGS,
  BUILDING_IDS,
  CANCEL_REFUND_PERCENT,
  POP_PER_UNIT,
  RESOURCE_IDS,
  UNITS,
  UNIT_IDS,
  buildTimeMs,
  buildingCost,
  buildingPop,
  levelPoints,
  populationCap,
  populationUsage,
} from '@clanfire/engine';
import type { BuildingId, Resources, TrainingBuildingId, UnitId } from '@clanfire/engine';
import { api, errorMessage } from '../../api.ts';
import { BuildingArt } from '../../art/BuildingArt.tsx';
import { snapshotScene } from './miniSnapshot.ts';
import type { MiniShot } from './miniSnapshot.ts';
import { Icon } from '../../art/Icon.tsx';
import { Mags } from '../../art/Mags.tsx';
import { UnitFigure } from '../../art/UnitFigure.tsx';
import { BuildState } from '../../components/BuildState.tsx';
import { useUnitInfo } from '../../components/UnitInfo.tsx';
import { formatDuration, formatInt } from '../../format.ts';
import { useGame, useRules } from '../../game.ts';
import { RESOURCE_ICON, RESOURCE_NAME } from '../../icons.ts';
import { buildingEffects, requirementText, unmetRequirements } from '../../rules.ts';
import { UNIT_HINT, UNIT_ROLE } from '../../unitRole.ts';
import { useCancelJob } from '../cancelJob.tsx';
import { trainRowState } from '../trainRow.ts';
import { BannerHallPanel } from './BannerHall.tsx';
import { DrillyardPanel } from './Drillyard.tsx';
import { BuildingRow, Chev, LeftColumn, clockShort, pluralUnit } from './FrameParts.tsx';
import { VillageScene } from './VillageScene.tsx';
import { useBuildingInfo, whyText } from './buildingInfo.ts';
import type { BuildingInfo } from './buildingInfo.ts';
import { tipFor } from './tips.ts';

const TRAINING_BUILDINGS: readonly BuildingId[] = ['barracks', 'stables'];

/** Resource costs with icons; `have` turns the short ones red. */
function CostLine({ cost, have, className = '' }: { cost: Resources; have?: Resources; className?: string }) {
  return (
    <span className={`fv-cost ${className}`}>
      {RESOURCE_IDS.filter((r) => cost[r] > 0 || r !== 'gold').map((r) => {
        const short = have ? Math.floor(have[r] + 1e-9) < cost[r] : false;
        return (
          <span key={r} className={short ? 'is-short' : ''}>
            <Icon name={RESOURCE_ICON[r]} size={18} />
            <b>{formatInt(cost[r])}</b>
            <span className="visually-hidden">
              {' '}
              {RESOURCE_NAME[r]}
              {short ? ' (not enough)' : ''}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function sumCost(list: Resources[]): Resources {
  const out = Object.fromEntries(RESOURCE_IDS.map((r) => [r, 0])) as Resources;
  for (const c of list) for (const r of RESOURCE_IDS) out[r] += c[r];
  return out;
}

// ---- Left column: mini village ---------------------------------------------------------------------------------

/** Kept still picture of the mini village per village (see miniSnapshot.ts): shown at once on every page and tab switch. */
const miniCache = new Map<number, { key: string; shot: MiniShot }>();

export function MiniVillage({ warm, onWarm }: { warm?: boolean; onWarm?: () => void }) {
  const { village, live, openBuilding, now } = useGame();
  const key = JSON.stringify([live.buildings, live.buildQueue.filter((j) => j.startAt <= now).map((j) => `${j.building}:${j.targetLevel}`), !!village.hearth]);
  const cached = miniCache.get(village.id);
  const exact = cached?.key === key;
  // Drawing the live scene is heavy: show the kept picture (also a slightly old one) at once; draw the live scene only when there is none
  // for the current buildings, after the page is up, take a new picture of it, then swap the live scene out for the picture.
  const [ready, setReady] = useState(false);
  const [, bump] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (exact) {
      if (warm) onWarm?.();
      return;
    }
    let t = 0;
    let poll = 0;
    let alive = true;
    const raf = requestAnimationFrame(() => {
      t = window.setTimeout(() => {
        setReady(true);
        let last = '';
        let tries = 0;
        poll = window.setInterval(() => {
          const view = box.current?.querySelector('.vv-view');
          const html = view ? view.outerHTML : '';
          tries += 1;
          if (view && box.current && html && html === last) {
            window.clearInterval(poll);
            void snapshotScene(box.current, view).then((shot) => {
              if (shot && alive) miniCache.set(village.id, { key, shot });
              if (alive) bump((n) => n + 1);
              if (warm) onWarm?.();
            });
          } else if (tries > 30) window.clearInterval(poll);
          last = html;
        }, 150);
      }, 0);
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      window.clearInterval(poll);
    };
  }, [exact, key, village.id, warm, onWarm]);
  const showShot = !!cached && (exact || !ready);
  return (
    <div className="fv-cs fv-minicell">
      <div ref={box} className="fv-minipic" role="img" aria-label={`${village.name}, village`}>
        {showShot ? <img className="fv-minishot" src={cached.shot.url} alt="" draggable={false} /> : ready && <VillageScene mode="fit" selected={null} onSelect={() => undefined} />}
      </div>
      {!warm && (
        <button type="button" className="fv-go" onClick={() => openBuilding(null)}>
          <Icon name="village" size={16} />
          Open village
        </button>
      )}
    </div>
  );
}

// ---- Top card ----------------------------------------------------------------------------------------------------

function JumpTo({ id }: { id: BuildingId }) {
  const { live, openBuilding } = useGame();
  const at = BUILDING_IDS.indexOf(id);
  return (
    <label className="fv-cur">
      <BuildingArt id={id} level={live.buildings[id]} size={24} className="fv-th" />
      <span className="fv-curname">{BUILDINGS[id].name}</span>
      <span className="fv-mut">
        {at + 1} of {BUILDING_IDS.length}
      </span>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 6l5 5 5-5" />
      </svg>
      <select value={id} onChange={(e) => openBuilding(e.target.value as BuildingId)} aria-label="Jump to a building">
        {BUILDING_IDS.map((b) => (
          <option key={b} value={b}>
            {BUILDINGS[b].name} · level {live.buildings[b]}
          </option>
        ))}
      </select>
    </label>
  );
}

function BuildingTop({ id, info, busy, build }: { id: BuildingId; info: BuildingInfo; busy: boolean; build: (id: BuildingId) => void }) {
  const { settings, openBuilding } = useGame();
  const def = BUILDINGS[id];
  const at = BUILDING_IDS.indexOf(id);
  const step = (d: number) => openBuilding(BUILDING_IDS[(at + d + BUILDING_IDS.length) % BUILDING_IDS.length] ?? null);
  const { level, target, atMax, jobs } = info;
  const effects = atMax ? buildingEffects(id, level - 1, level, settings.speed) : buildingEffects(id, target - 1, target, settings.speed);
  const why = whyText(info);
  const popCost = atMax ? 0 : buildingPop(id, target) - buildingPop(id, target - 1);
  const { live } = useGame();
  const warn = ['queuefull', 'afford', 'blocked', 'locked'].includes(info.actionPick.kind);
  return (
    <section className="fv-pn fv-bhm" aria-label={`${def.name} summary`}>
      <span className="fv-bart">
        <BuildingArt id={id} level={level} size={96} building={jobs.length > 0} />
      </span>
      <div className="fv-bti">
        <div className="fv-bnav">
          <nav aria-label="Breadcrumb" className="fv-crumb">
            <button type="button" className="fv-lk fv-lk-b" onClick={() => openBuilding(null)}>
              <Icon name="village" size={16} />
              Village
            </button>
            <Chev size={12} />
            <b>{def.name}</b>
          </nav>
          <span className="fv-sp" />
          <button type="button" className="fv-pg" onClick={() => step(-1)} aria-label="Previous building">
            <Chev flip size={16} />
          </button>
          <JumpTo id={id} />
          <button type="button" className="fv-pg" onClick={() => step(1)} aria-label="Next building">
            <Chev size={16} />
          </button>
        </div>
        <div className="fv-bt1">
          <h1>{def.name}</h1>
          <span className="fv-tag fv-tag-dk">{level === 0 ? 'Not built' : `Level ${level}`}</span>
          {info.upgradingLeftMs !== null && (
            <span className="fv-tag fv-tag-tl">
              Upgrading to {info.active?.targetLevel} · {formatDuration(info.upgradingLeftMs)}
            </span>
          )}
          {info.upgradingLeftMs === null && jobs.length > 0 && <span className="fv-tag">{jobs.length} queued</span>}
        </div>
        <div className="fv-nnl">
          {effects.slice(0, 2).map((e) => (
            <span key={e.label} className="fv-nn">
              {e.label} <b>{atMax ? e.to : e.from}</b>
              {!atMax && (
                <>
                  <Chev size={11} />
                  <b className="nx">
                    {e.to} at level {target}
                  </b>
                </>
              )}
            </span>
          ))}
          {effects.length === 0 && <span className="fv-nn is-text">{def.description}</span>}
        </div>
      </div>
      <div className="fv-ubwrap">
        <div className="fv-ubh">
          <span className="fv-up">{atMax ? 'Top level' : 'Next upgrade'}</span>
          <b>{atMax ? `Level ${level}` : `Level ${target - 1} → ${target}`}</b>
          <span className="fv-sp" />
          {!atMax && (
            <>
              <span className="fv-ubp">+{formatInt(levelPoints(id, target))} points</span>
              {popCost !== 0 && (
                <span className="fv-ubp">
                  {popCost > 0 ? '+' : ''}
                  {popCost} people
                </span>
              )}
            </>
          )}
        </div>
        {info.cost && info.timeMs !== null ? (
          <div className="fv-ubc">
            <CostLine cost={info.cost} have={live.resources} />
            <span className="fv-ubt">
              <Icon name="time" size={18} />
              <b>{formatDuration(info.timeMs)}</b>
            </span>
          </div>
        ) : (
          <div className="fv-ubc fv-mut">Nothing more to build here.</div>
        )}
        <div className="fv-ubb">
          <BuildState info={info} size="lg" action busy={busy} onBuild={() => build(id)} />
          {why && (
            <span className={`fv-why${warn ? ' is-warn' : ''}`}>
              {warn && <Icon name="warning" size={16} />}
              <span>{why}</span>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

// ---- Mags ----------------------------------------------------------------------------------------------------------

function MagsTip({ id }: { id: BuildingId }) {
  const { live, settings } = useGame();
  return (
    <section className="fv-tip" aria-label="Advice from Mags the Tinker">
      <Mags size={46} />
      <span>
        <b>Mags the Tinker:</b> {tipFor(id, live, settings)}
      </span>
    </section>
  );
}

// ---- Recruit (Barracks, Stables) ---------------------------------------------------------------------------------

function RecruitPanel({ building }: { building: TrainingBuildingId }) {
  const { live, now, settings, village, applyVillage, refresh, toast } = useGame();
  const rules = useRules();
  const info = useUnitInfo();
  const cancel = useCancelJob();
  const [texts, setTexts] = useState<Partial<Record<UnitId, string>>>({});
  const [busy, setBusy] = useState(false);
  const def = BUILDINGS[building];
  const queue = live.trainQueues[building];
  const units = UNIT_IDS.filter((u) => UNITS[u].building === building && (rules.features.siege || !UNITS[u].siege));
  const rows = units.map((u) => ({
    unit: u,
    st: trainRowState({ live, unit: u, building, text: texts[u] ?? '', now, settings, trainQueueLimit: rules.queues.train, hearthOut: !!village.hearth }),
  }));
  const freePop = Math.max(0, populationCap(live) - populationUsage(live).total);
  const typed = rows.filter((r) => r.st.count >= 1);
  const total = sumCost(typed.map((r) => r.st.batchCost));
  const totalMs = typed.reduce((ms, r) => ms + r.st.perUnitMs * r.st.count, 0);
  const totalPop = typed.reduce((n, r) => n + POP_PER_UNIT[r.unit] * r.st.count, 0);

  let orderBlock: string | null = null;
  const bad = typed.find((r) => r.st.reason);
  if (typed.length === 0) orderBlock = 'Type an amount in a row';
  else if (bad) orderBlock = `${UNITS[bad.unit].name}: ${bad.st.reason}`;
  else if (RESOURCE_IDS.some((r) => total[r] > Math.floor(live.resources[r] + 1e-9))) orderBlock = 'Not enough resources for all of it';
  else if (totalPop > freePop) orderBlock = 'Not enough free population for all of it';
  else if (queue.length + typed.length > rules.queues.train) orderBlock = 'Not enough free queue slots';

  async function train(list: { unit: UnitId; count: number }[]) {
    if (busy) return;
    setBusy(true);
    try {
      for (const { unit, count } of list) {
        applyVillage(await api.train(village.id, unit, count));
        toast(`Training ${formatInt(count)} ${UNITS[unit].name}`);
        setTexts((t) => ({ ...t, [unit]: '' }));
      }
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  const lastEnd = queue.length > 0 ? Math.max(...queue.map((j) => j.startAt + j.count * j.perUnitMs)) : null;
  const orderLabel =
    typed.length === 1 && typed[0]
      ? `Train ${formatInt(typed[0].st.count)} ${typed[0].st.count === 1 ? UNITS[typed[0].unit].name : pluralUnit(typed[0].unit)}`
      : typed.length > 1
        ? `Train ${typed.length} groups`
        : 'Train';

  return (
    <>
      {cancel.dialog}
      {info.dialog}
      <section className="fv-pn fv-recruit" aria-label={`Recruit at the ${def.name}`}>
        <div className="fv-ph">
          <h2>Recruit</h2>
          <span className="fv-mut">{formatInt(freePop)} free population</span>
          <span className="fv-sp" />
          <span className="fv-mut">Tap a name for the unit guide</span>
        </div>
        <ul className="fv-wrs">
          {rows.map(({ unit, st }) => {
            const u = UNITS[unit];
            const role = UNIT_ROLE[unit];
            const off = st.locked || st.unresearched;
            const away = live.away[unit] ?? 0;
            return (
              <li key={unit} className={`fv-wr${off ? ' is-off' : ''}`}>
                <button type="button" className="uc-lab uc-pic" onClick={() => info.open(unit)} aria-haspopup="dialog" aria-label={`About the ${u.name}`} {...info.bind(unit)}>
                  <UnitFigure unit={unit} size={84} className="fv-fg" />
                </button>
                <span className="fv-mt fv-wname">
                  <button type="button" className="fv-unitname" onClick={() => info.open(unit)} aria-haspopup="dialog" {...info.bind(unit)}>
                    {u.name}
                  </button>
                  <small>
                    {role.label} · {UNIT_HINT[unit]}
                  </small>
                </span>
                <span className="fv-wc">
                  <CostLine cost={u.cost} className="sm" have={off ? undefined : live.resources} />
                  <span className="fv-wm">
                    <Icon name="time" size={16} />
                    {formatDuration(st.perUnitMs)}
                    <span className="fv-mut">·</span>
                    have <b>{formatInt(live.troops[unit] ?? 0)}</b>
                    {away > 0 && <span className="fv-mut">+{formatInt(away)} away</span>}
                  </span>
                </span>
                {off ? (
                  <span className="fv-lock">
                    <Icon name="lock" size={18} />
                    <span>
                      {st.locked
                        ? `Needs ${st.unmet.map((r) => `${BUILDINGS[r.building].name} ${r.need} · you have ${r.have}`).join(', ')}`
                        : 'Research it at the Drillyard'}
                    </span>
                  </span>
                ) : (
                  <span className="fv-tr">
                    <label className="visually-hidden" htmlFor={`rn-${unit}`}>
                      How many {u.name}
                    </label>
                    <input
                      id={`rn-${unit}`}
                      className="fv-inp"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      placeholder="0"
                      value={texts[unit] ?? ''}
                      onChange={(e) => setTexts((t) => ({ ...t, [unit]: e.target.value }))}
                    />
                    <button type="button" className="fv-mx" disabled={st.max < 1} onClick={() => setTexts((t) => ({ ...t, [unit]: String(st.max) }))}>
                      max {formatInt(st.max)}
                    </button>
                    <button
                      type="button"
                      className="fv-btn fv-btn-g sm"
                      disabled={!!st.reason || busy}
                      aria-describedby={st.reason ? `rw-${unit}` : undefined}
                      onClick={() => void train([{ unit, count: st.count }])}
                    >
                      Train
                    </button>
                    {st.reason && st.count >= 1 && (
                      <span id={`rw-${unit}`} className="visually-hidden">
                        {st.reason}
                      </span>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="fv-rcol">
        <section className="fv-pn" aria-label="Training queue">
          <div className="fv-ph">
            <h2>Training</h2>
            <span className="fv-cnt" aria-label={`${queue.length} of ${rules.queues.train} slots used`}>
              {queue.length} / {rules.queues.train}
            </span>
            <span className="fv-sp" />
            {lastEnd !== null && <span className="fv-mut">done {clockShort(lastEnd, now)}</span>}
          </div>
          {queue.length === 0 && <p className="fv-empty fv-pad">Nothing is training.</p>}
          {queue.map((job, i) => {
            const total = job.count * job.perUnitMs;
            const endAt = job.startAt + total;
            const started = now >= job.startAt;
            const left = job.count - job.done;
            const name = left === 1 ? UNITS[job.unit].name : pluralUnit(job.unit);
            return (
              <div key={`${job.unit}-${job.startAt}-${i}`} className="fv-tq2">
                <UnitFigure unit={job.unit} pose="icon" size={40} />
                <span className="fv-mt">
                  <b>
                    {formatInt(job.count)} {job.count === 1 ? UNITS[job.unit].name : pluralUnit(job.unit)}
                  </b>
                  <small>{started ? `done ${clockShort(endAt, now)}` : `waits, done ${clockShort(endAt, now)}`}</small>
                  {started && (
                    <span className="fv-bar" aria-hidden="true">
                      <i style={{ width: `${Math.max(0, Math.min(1, (now - job.startAt) / total)) * 100}%` }} />
                    </span>
                  )}
                </span>
                <span className={`fv-cd${started ? '' : ' is-wait'}`}>{formatDuration(started ? endAt - now : total)}</span>
                <button
                  type="button"
                  className="fv-xb"
                  disabled={cancel.busy}
                  title={`Cancel (${CANCEL_REFUND_PERCENT}% back)`}
                  aria-label={`Cancel ${formatInt(left)} ${name}`}
                  onClick={() => {
                    const paid = Object.fromEntries(RESOURCE_IDS.map((r) => [r, UNITS[job.unit].cost[r] * left])) as Resources;
                    void cancel.cancelTrain(`${formatInt(left)} × ${UNITS[job.unit].name}`, paid, building, i);
                  }}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            );
          })}
        </section>

        <section className="fv-pn" aria-label="Your order">
          <div className="fv-ph">
            <h2>Your order</h2>
          </div>
          <div className="fv-ord">
            {typed.length === 0 && <p className="fv-empty">Type an amount in a row, or tap "max".</p>}
            {typed.map((r) => (
              <div key={r.unit} className="fv-ordrow">
                <UnitFigure unit={r.unit} pose="icon" size={34} />
                <b>
                  {formatInt(r.st.count)} {r.st.count === 1 ? UNITS[r.unit].name : pluralUnit(r.unit)}
                </b>
                <span className="fv-sp" />
                <span className="fv-mut">{formatDuration(r.st.perUnitMs * r.st.count)}</span>
              </div>
            ))}
            {typed.length > 0 && (
              <div className="fv-ordsum">
                <CostLine cost={total} className="sm" have={live.resources} />
                {typed.length > 1 && <span className="fv-mut">{formatDuration(totalMs)}</span>}
              </div>
            )}
            <button
              type="button"
              className="fv-btn fv-btn-g fv-ordgo"
              disabled={!!orderBlock || busy}
              onClick={() => void train(typed.map((r) => ({ unit: r.unit, count: r.st.count })))}
            >
              {orderLabel}
            </button>
            {orderBlock && typed.length > 0 && <p className="fv-why is-warn">{orderBlock}</p>}
          </div>
        </section>
        <MagsTip id={building} />
      </div>
    </>
  );
}

// ---- Other buildings ---------------------------------------------------------------------------------------------

/** "What it does": the description and the effect now and at the next level. */
function WhatItDoes({ id, info }: { id: BuildingId; info: BuildingInfo }) {
  const { settings } = useGame();
  const def = BUILDINGS[id];
  const { level, target, atMax } = info;
  const effects = atMax ? [] : buildingEffects(id, target - 1, target, settings.speed);
  return (
    <section className="fv-pn" aria-label="What it does">
      <div className="fv-ph">
        <h2>What it does</h2>
      </div>
      <div className="fv-ord">
        <p className="fv-desc">{def.description}</p>
        {id === 'bannerhall' && <p className="fv-desc">Chieftains also need War Chest gold, paid in here.</p>}
        {effects.length > 0 ? (
          <div className="fv-nownext">
            <div>
              <span className="fv-up">{level === 0 ? 'Now' : `Level ${target - 1}`}</span>
              {effects.map((e) => (
                <p key={e.label}>
                  {e.label} <b>{level === 0 && target === 1 ? 'Not built' : e.from}</b>
                </p>
              ))}
            </div>
            <div className="is-next">
              <span className="fv-up">Level {target}</span>
              {effects.map((e) => (
                <p key={e.label}>
                  {e.label} <b>{e.to}</b>
                </p>
              ))}
            </div>
          </div>
        ) : atMax ? (
          <p className="fv-empty">Top level reached.</p>
        ) : null}
      </div>
    </section>
  );
}

/** Next levels of any building: effect, cost, build time and points, so the page is never empty. */
function NextLevels({ id, info }: { id: BuildingId; info: BuildingInfo }) {
  const { live, settings } = useGame();
  const def = BUILDINGS[id];
  const levels: number[] = [];
  for (let l = info.target; l <= def.maxLevel && levels.length < 7; l++) levels.push(l);
  const effectText = (l: number) => {
    const eff = buildingEffects(id, l - 1, l, settings.speed);
    return eff.length > 0 ? eff.map((e) => `${e.label} ${e.to}`).join(' · ') : def.description;
  };
  return (
    <section className="fv-pn fv-nl" aria-label="Next levels">
      <div className="fv-ph">
        <h2>Next levels</h2>
        <span className="fv-mut">level {info.level} of {def.maxLevel} built</span>
      </div>
      {levels.length === 0 && <p className="fv-empty fv-pad">This building is at its top level.</p>}
      <ul className="fv-nlr">
        {levels.map((l, i) => (
          <li key={l} className={i === 0 ? 'is-first' : ''}>
            <span className="fv-lv">{l}</span>
            <span className="fv-mt">
              <b>{effectText(l)}</b>
              <small>
                {i === 0 ? 'Next upgrade' : `+${formatInt(levelPoints(id, l))} points`}
                {buildingPop(id, l) - buildingPop(id, l - 1) !== 0 &&
                  ` · ${buildingPop(id, l) - buildingPop(id, l - 1) > 0 ? '+' : ''}${buildingPop(id, l) - buildingPop(id, l - 1)} people`}
              </small>
            </span>
            <CostLine cost={buildingCost(id, l)} className="sm" have={i === 0 ? live.resources : undefined} />
            <span className="fv-ubt">
              <Icon name="time" size={16} />
              <b>{formatDuration(buildTimeMs(id, l, live.buildings.hall, settings))}</b>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Town Hall: every other building in two columns, each with the same state control as the Village page. */
function HallList({ busy, build }: { busy: boolean; build: (id: BuildingId) => void }) {
  const { live, openBuilding } = useGame();
  const pop = populationUsage(live);
  const ids = BUILDING_IDS.filter((b) => b !== 'hall');
  return (
    <section className="fv-pn fv-hall" aria-label="All buildings">
      <div className="fv-ph">
        <h2>All buildings</h2>
        <span className="fv-cnt">{ids.length}</span>
        <span className="fv-sp" />
        <span className="fv-mut">
          Population {formatInt(pop.total)} / {formatInt(populationCap(live))}
        </span>
      </div>
      <ul className="fv-bt is-2col" style={{ ['--rows' as string]: Math.ceil(ids.length / 2) }}>
        {ids.map((b) => (
          <BuildingRow key={b} id={b} busy={busy} build={build} onPick={openBuilding} />
        ))}
      </ul>
    </section>
  );
}

function PanelBox({ title, children, fit = false }: { title: string; children: ReactNode; fit?: boolean }) {
  return (
    <section className="fv-pn fv-boxed" aria-label={title}>
      <div className="fv-ph">
        <h2>{title}</h2>
      </div>
      <div className={`fv-boxin${fit ? ' is-fit' : ''}`}>{children}</div>
    </section>
  );
}

// ---- The page ------------------------------------------------------------------------------------------------------

export function BuildingPage({ id, busy, build }: { id: BuildingId; busy: boolean; build: (id: BuildingId) => void }) {
  const { openBuilding, live } = useGame();
  const info = useBuildingInfo(id);
  const trains = TRAINING_BUILDINGS.includes(id);
  const level = live.buildings[id];
  return (
    <>
      <LeftColumn onPick={openBuilding} top={<MiniVillage />} />
      <div className="fv-bmain" aria-label={BUILDINGS[id].name}>
        <BuildingTop id={id} info={info} busy={busy} build={build} />
        <div className="fv-bbody">
          {trains ? (
            level > 0 ? (
              <RecruitPanel building={id as TrainingBuildingId} />
            ) : (
              <>
                <section className="fv-pn fv-recruit" aria-label="Recruit">
                  <div className="fv-ph">
                    <h2>Recruit</h2>
                  </div>
                  <div className="fv-lockedmsg">
                    <Icon name="lock" size={28} />
                    <p>
                      Build the {BUILDINGS[id].name} first to train troops here.
                      {unmetRequirements(live.buildings, BUILDINGS[id].requires).length > 0 && (
                        <>
                          <br />
                          <span className="fv-mut">Needs {requirementText(unmetRequirements(live.buildings, BUILDINGS[id].requires))}</span>
                        </>
                      )}
                    </p>
                  </div>
                </section>
                <div className="fv-rcol">
                  <MagsTip id={id} />
                </div>
              </>
            )
          ) : (
            <>
              {id === 'hall' ? (
                <HallList busy={busy} build={build} />
              ) : id === 'drillyard' ? (
                <PanelBox title="Training Points and ranks" fit>
                  <DrillyardPanel part="ranks" />
                </PanelBox>
              ) : id === 'bannerhall' ? (
                <PanelBox title="Banner Hall" fit>
                  <BannerHallPanel />
                </PanelBox>
              ) : (
                <NextLevels id={id} info={info} />
              )}
              <div className="fv-rcol">
                {id === 'drillyard' ? (
                  <PanelBox title="Research">
                    <DrillyardPanel part="research" />
                  </PanelBox>
                ) : (
                  <WhatItDoes id={id} info={info} />
                )}
                <MagsTip id={id} />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
