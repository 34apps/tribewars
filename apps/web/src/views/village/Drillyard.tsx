// Drillyard panel: unit research (a queue) and Training Point ranks. Rules come from the engine; the server decides.

import {
  CANCEL_REFUND_PERCENT,
  RANK_COST,
  RANK_MAX,
  UNITS,
  UNIT_IDS,
  checkRank,
  checkResearch,
  checkRespec,
  isResearched,
  pointsSpent,
  pointsTotal,
  productionPerHour,
  rankOf,
  storageCap,
} from '@clanfire/engine';
import type { RankTrack, UnitId } from '@clanfire/engine';
import { useEffect, useRef, useState } from 'react';
import { takeResearchFocus } from './drillFocus.ts';
import { api, errorMessage } from '../../api.ts';
import { Icon } from '../../art/Icon.tsx';
import { UnitFigure } from '../../art/UnitFigure.tsx';
import { Cost, ProgressBar } from '../../components/ui.tsx';
import { formatDuration, formatInt } from '../../format.ts';
import { useGame, useRules } from '../../game.ts';
import { useLock } from '../../hooks/useLock.ts';
import { useSync } from '../../hooks/useSync.ts';
import { reasonText } from '../../rules.ts';
import { goldNeverArrives, needsGoldText } from '../../shortfall.ts';
import { useConfirm } from '../../tribe/Confirm.tsx';
import { useCancelJob } from '../cancelJob.tsx';
import { TRACK_NAME, nextRankPoints, pointsRuleText, rankCardUnits, rankRows, trackBonusPct, trackEffect } from './drillyardLogic.ts';

/** `part` splits the panel for the desktop building page (research in the side column, ranks in the main area); omitted = everything. */
export function DrillyardPanel({ part }: { part?: 'research' | 'ranks' } = {}) {
  const { live, now, settings, village, applyVillage, toast } = useGame();
  const { confirm, dialog } = useConfirm();
  const { busy, begin, end } = useLock();
  const sync = useSync();
  const cancel = useCancelJob();
  const level = live.buildings.drillyard;

  async function run(call: () => Promise<Parameters<typeof applyVillage>[0]>, okText?: string) {
    if (!begin()) return;
    let ok = false;
    try {
      applyVillage(await call());
      ok = true;
      if (okText) toast(okText);
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      end();
      sync(ok);
    }
  }

  async function reset(unit: UnitId, track: RankTrack, refund: number) {
    const ok = await confirm({
      title: `Reset ${UNITS[unit].name} ${TRACK_NAME[track]}?`,
      body: (
        <p>
          Free. +{refund} {refund === 1 ? 'point' : 'points'} back; resources spent are lost.
        </p>
      ),
      confirmLabel: 'Reset',
      danger: true,
    });
    if (ok) await run(() => api.respec(village.id, unit, track), 'Rank reset');
  }

  const total = pointsTotal(live);
  const spent = pointsSpent(live);
  const queue = live.researchQueue ?? [];
  const limit = useRules().queues.research;
  const researchable = UNIT_IDS.filter((u) => UNITS[u].research);
  const trained = rankCardUnits(live);

  const focusRef = useRef<HTMLLIElement>(null);
  const [focusUnit] = useState(takeResearchFocus);
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusUnit]);

  if (level < 1) return null;

  const free = Math.max(0, total - spent);

  return (
    <div className={`drill${part ? ' drill-compact' : ''}`}>
      {part !== 'ranks' && (
        <>
          <h3 className="eyebrow">
            Research · queue {queue.length}/{limit}
          </h3>
          <ul className="drill-rlist">
            {researchable.map((u) => {
              const def = UNITS[u];
              const rule = def.research!;
              const done = isResearched(live, u);
              const qi = queue.findIndex((j) => j.unit === u);
              const job = qi >= 0 ? queue[qi] : undefined;
              const active = !!job;
              const check = checkResearch(live, u, now, settings, limit);
              const levelOk = level >= rule.drillyard;
              const full = done || active ? null : !check.ok ? (check.reason === 'not_enough_resources' && goldNeverArrives(live.resources, productionPerHour(live, settings), rule.cost, storageCap(live)) ? needsGoldText(live.buildings) : reasonText(check)) : null;
              let state: string;
              if (done) state = 'Researched';
              else if (active && job) state = qi === 0 ? `Ready in ${formatDuration(job.finishAt - now)}` : `Queued #${qi + 1}, starts in ${formatDuration(job.startAt - now)}`;
              else if (!levelOk) state = `Needs Drillyard ${rule.drillyard} · you have ${level}`;
              else if (!full) state = 'Ready to research';
              else if (check.ok === false && check.reason === 'not_enough_resources') state = 'Not enough resources';
              else if (check.ok === false && check.reason === 'queue_full') state = 'Research queue full';
              else state = full;
              const focus = focusUnit === u;
              return (
                <li key={u} ref={focus ? focusRef : undefined} className={`drill-rc${done ? ' is-done' : ''}${focus ? ' is-focus' : ''}${!levelOk && !done ? ' is-off' : ''}`}>
                  <span className="drill-icon" aria-hidden="true">
                    <UnitFigure unit={u} pose="icon" size={40} />
                  </span>
                  <div className="drill-rc-main">
                    <div className="drill-rc-head">
                      <span className="drill-name">{def.name}</span>
                      {!done && (
                        <span className="drill-time">
                          <Icon name="time" size={16} className="inline-icon" /> {formatDuration(check.ok ? check.timeMs : (rule.timeSec / settings.speed) * 1000)}
                        </span>
                      )}
                    </div>
                    {!done && !active && (
                      <div className="drill-cost">
                        <Cost cost={rule.cost} have={live.resources} />
                      </div>
                    )}
                    {active && job && qi === 0 && <ProgressBar value={(now - job.startAt) / Math.max(1, job.finishAt - job.startAt)} label={`${def.name} research progress`} />}
                    <span className={`drill-state${done ? ' is-ok' : active ? ' is-run' : !levelOk || full ? ' is-warn' : ''}`}>{state}</span>
                  </div>
                  {active && (
                    <button
                      type="button"
                      className="btn btn-small drill-btn"
                      disabled={busy || cancel.busy}
                      title={`${CANCEL_REFUND_PERCENT}% back`}
                      onClick={() => void cancel.cancelResearch(`${def.name} research`, rule.cost, qi)}
                    >
                      Cancel
                    </button>
                  )}
                  {/* Only research that can start now gets a button (gold, like Up and Rank); the rest just say why on the
                      state line, so the one to press stands out (owner 2026-11-11). */}
                  {!done && !active && !full && (
                    <button
                      type="button"
                      className="btn btn-primary drill-btn"
                      disabled={busy}
                      onClick={() => void run(() => api.research(village.id, u), `Researching ${def.name}`)}
                    >
                      Research
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {part !== 'research' && (
        <>
          <div className="drill-points">
            <h3 className="drill-ptitle">Training Points</h3>
            <span className="drill-pfree">
              <strong>{formatInt(free)}</strong> free
            </span>
            <ProgressBar value={total > 0 ? spent / total : 0} label="Training Points spent" />
            <span className="drill-pmut">
              {formatInt(spent)}/{formatInt(total)} used
            </span>
          </div>
          <p className="drill-howto">{pointsRuleText()}</p>
          <ul className="drill-units">
            {rankRows(trained).map(({ unit: u, track, first }) => {
              const def = UNITS[u];
              const name = TRACK_NAME[track];
              const rank = rankOf(live.ranks, u, track);
              const check = checkRank(live, u, track, now, settings);
              const respec = rank > 0 ? checkRespec(live, u, track, now, settings) : null;
              const atMax = rank >= RANK_MAX;
              const points = nextRankPoints(rank);
              const refusal = atMax || check.ok ? null : reasonText(check);
              const needsPoints = points !== null && points > free;
              const lowOnResources = !check.ok && check.reason === 'not_enough_resources';
              return (
                <li key={`${u}-${track}`} className="drill-uc">
                  <div className="drill-tr">
                    <span className="drill-icon" aria-hidden="true">
                      {first && <UnitFigure unit={u} pose="icon" size={32} />}
                    </span>
                    <span className="drill-head">
                      <span className="drill-name">{def.name}</span>
                      <span className="drill-tag">{name}</span>
                    </span>
                    <span className="drill-fx" title={trackEffect(track, u)}>
                      {trackEffect(track, u)}
                      {rank > 0 && <strong className="drill-bonus"> · now +{trackBonusPct(track, rank)}%</strong>}
                    </span>
                    <span className="drill-pips" role="img" aria-label={`${def.name} ${name} rank ${rank} of ${RANK_MAX}`}>
                      {Array.from({ length: RANK_MAX }, (_, i) => (
                        <span key={i} className={`drill-pip${i < rank ? ' is-on' : ''}`} />
                      ))}
                    </span>
                    {/* The next rank: what it costs (points and resources), or why it cannot be bought. */}
                    <span className={`drill-tinfo${needsPoints || (refusal && !lowOnResources) ? ' is-warn' : ''}`}>
                      {atMax ? null : needsPoints ? (
                        `Needs ${points} ${points === 1 ? 'point' : 'points'} · ${free} free`
                      ) : refusal && !lowOnResources ? (
                        refusal
                      ) : (
                        <>
                          {points} {points === 1 ? 'pt' : 'pts'} <Cost cost={RANK_COST[rank] ?? RANK_COST[RANK_MAX - 1]!} have={live.resources} />
                        </>
                      )}
                    </span>
                    <span className="drill-tbtns">
                      {atMax ? (
                        <span className="drill-max">Max</span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary drill-buy"
                          disabled={!check.ok || busy}
                          title={refusal ?? undefined}
                          aria-label={`Buy ${def.name} ${name} rank ${rank + 1}`}
                          onClick={() => void run(() => api.rank(village.id, u, track), `${def.name} ${name} rank ${rank + 1}`)}
                        >
                          Buy rank {rank + 1}
                        </button>
                      )}
                      {rank > 0 && (
                        <button
                          type="button"
                          className="drill-reset"
                          disabled={!respec?.ok || busy}
                          title={respec && !respec.ok ? reasonText(respec) : `Reset: free, +${respec?.ok ? respec.refund : 0} points back`}
                          aria-label={`Reset ${def.name} ${name}`}
                          onClick={() => respec?.ok && void reset(u, track, respec.refund)}
                        >
                          Reset{respec?.ok ? ` +${respec.refund}` : ''}
                        </button>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {dialog}
      {cancel.dialog}
    </div>
  );
}
