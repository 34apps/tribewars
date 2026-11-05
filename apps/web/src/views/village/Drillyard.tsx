// Drillyard panel: unit research (a queue) and Training Point ranks. Rules come from the engine; the server decides.

import {
  CANCEL_REFUND_PERCENT,
  KEEN_BONUS,
  RANK_BONUS,
  RANK_MAX,
  SCOUT_UNIT,
  UNITS,
  UNIT_IDS,
  checkRank,
  checkResearch,
  checkRespec,
  isResearched,
  pointsSpent,
  pointsTotal,
  rankOf,
} from '@clanfire/engine';
import type { RankTrack, UnitId } from '@clanfire/engine';
import { useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { Icon } from '../../art/Icon.tsx';
import { Cost, ProgressBar } from '../../components/ui.tsx';
import { formatDuration, formatInt } from '../../format.ts';
import { useGame, useRules } from '../../game.ts';
import { UNIT_ICON } from '../../icons.ts';
import { reasonText } from '../../rules.ts';
import { useConfirm } from '../../tribe/Confirm.tsx';
import { useCancelJob } from '../cancelJob.tsx';

const TRACKS: readonly { id: RankTrack; name: string; hint: string }[] = [
  { id: 'might', name: 'Might', hint: 'attack' },
  { id: 'bulwark', name: 'Bulwark', hint: 'both defences' },
  { id: 'keen', name: 'Keen', hint: 'scouting' },
];

const trackApplies = (unit: UnitId, track: RankTrack) =>
  track === 'keen' ? unit === SCOUT_UNIT : track === 'might' ? unit !== SCOUT_UNIT : true;

export function DrillyardPanel() {
  const { live, now, settings, village, applyVillage, refresh, toast } = useGame();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const cancel = useCancelJob();
  const level = live.buildings.drillyard;

  async function run(call: () => Promise<Parameters<typeof applyVillage>[0]>, okText?: string) {
    if (busy) return;
    setBusy(true);
    try {
      applyVillage(await call());
      if (okText) toast(okText);
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  async function reset(unit: UnitId, track: RankTrack, refund: number) {
    const ok = await confirm({
      title: `Reset ${UNITS[unit].name} ${trackName(track)}?`,
      body: (
        <p>
          Resetting is free. You get {refund} Training {refund === 1 ? 'Point' : 'Points'} back, but the resources you paid for the ranks are lost.
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
  const trained = UNIT_IDS.filter((u) => isResearched(live, u));

  if (level < 1) return null;

  return (
    <div className="drill">
      <h3 className="eyebrow">
        Research · queue {queue.length}/{limit}
      </h3>
      <ul className="drill-list">
        {researchable.map((u) => {
          const def = UNITS[u];
          const rule = def.research!;
          const done = isResearched(live, u);
          const qi = queue.findIndex((j) => j.unit === u);
          const job = qi >= 0 ? queue[qi] : undefined;
          const active = !!job;
          const check = checkResearch(live, u, now, settings, limit);
          const reason = done || active ? null : !check.ok ? reasonText(check) : null;
          let status: string;
          if (done) status = 'Researched';
          else if (active && job) {
            status = qi === 0 ? `Researching · ${formatDuration(job.finishAt - now)} left` : `Waiting (#${qi + 1}) · starts in ${formatDuration(job.startAt - now)}`;
          }
          else if (level < rule.drillyard) status = `Needs Drillyard level ${rule.drillyard}`;
          else status = 'Available';
          return (
            <li key={u} className={`drill-row${done ? ' is-done' : ''}`}>
              <span className="drill-icon" aria-hidden="true">
                <Icon name={UNIT_ICON[u]} size={26} />
              </span>
              <div className="drill-main">
                <div className="drill-name">{def.name}</div>
                <div className="drill-status">{status}</div>
                {active && job && qi === 0 && <ProgressBar value={(now - job.startAt) / Math.max(1, job.finishAt - job.startAt)} label={`${def.name} research progress`} />}
                {!done && !active && (
                  <div className="drill-cost">
                    <Cost cost={rule.cost} have={live.resources} />
                    <span className="time">
                      <Icon name="time" size={16} className="inline-icon" /> {formatDuration(check.ok ? check.timeMs : (rule.timeSec / settings.speed) * 1000)}
                    </span>
                  </div>
                )}
                {reason && level >= rule.drillyard && <div className="why drill-why">{reason}</div>}
              </div>
              {active && (
                <button
                  type="button"
                  className="btn btn-small drill-btn"
                  disabled={busy || cancel.busy}
                  onClick={() => void cancel.cancelResearch(`${def.name} research`, rule.cost, qi)}
                >
                  Cancel ({CANCEL_REFUND_PERCENT}% back)
                </button>
              )}
              {!done && !active && (
                <button
                  type="button"
                  className="btn btn-teal drill-btn"
                  disabled={!!reason || busy}
                  onClick={() => void run(() => api.research(village.id, u), `Researching ${def.name}`)}
                >
                  Research
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <h3 className="eyebrow">Training Points</h3>
      <div className="drill-points">
        <span>
          <strong>{formatInt(Math.max(0, total - spent))}</strong> free · {formatInt(spent)} of {formatInt(total)} spent
        </span>
        <ProgressBar value={total > 0 ? spent / total : 0} label="Training Points spent" />
      </div>
      <ul className="drill-list">
        {trained.map((u) => {
          const def = UNITS[u];
          return (
            <li key={u} className="drill-unit">
              <div className="drill-unit-head">
                <span className="drill-icon" aria-hidden="true">
                  <Icon name={UNIT_ICON[u]} size={22} />
                </span>
                <span className="drill-name">{def.name}</span>
              </div>
              {TRACKS.filter((t) => trackApplies(u, t.id)).map((t) => {
                const rank = rankOf(live.ranks, u, t.id);
                const per = t.id === 'keen' ? KEEN_BONUS : RANK_BONUS;
                const check = checkRank(live, u, t.id, now, settings);
                const respec = rank > 0 ? checkRespec(live, u, t.id, now, settings) : null;
                const atMax = rank >= RANK_MAX;
                const reason = atMax ? null : !check.ok ? reasonText(check) : null;
                return (
                  <div key={t.id} className="drill-track">
                    <div className="drill-track-info">
                      <div className="drill-track-name">
                        {t.name} <span className="muted">{t.hint}</span>
                      </div>
                      <div className="drill-pips" role="img" aria-label={`${t.name} rank ${rank} of ${RANK_MAX}`}>
                        {Array.from({ length: RANK_MAX }, (_, i) => (
                          <span key={i} className={`drill-pip${i < rank ? ' is-on' : ''}`} />
                        ))}
                        <span className="drill-bonus">+{Math.round(per * rank * 100)}%</span>
                      </div>
                      {atMax ? (
                        <div className="drill-status">Top rank</div>
                      ) : check.ok ? (
                        <div className="drill-cost">
                          <span>
                            {check.points} {check.points === 1 ? 'point' : 'points'}
                          </span>
                          <Cost cost={check.cost} have={live.resources} />
                        </div>
                      ) : null}
                      {reason && <div className="why drill-why">{reason}</div>}
                    </div>
                    <div className="drill-track-btns">
                      {!atMax && (
                        <button
                          type="button"
                          className="btn btn-primary drill-btn"
                          disabled={!!reason || busy}
                          onClick={() => void run(() => api.rank(village.id, u, t.id), `${def.name} ${t.name} rank ${rank + 1}`)}
                        >
                          Buy rank {rank + 1}
                        </button>
                      )}
                      {rank > 0 && (
                        <button
                          type="button"
                          className="btn btn-small drill-reset"
                          disabled={!respec?.ok || busy}
                          title={respec && !respec.ok ? reasonText(respec) : `Free, returns ${respec?.ok ? respec.refund : 0} points`}
                          onClick={() => respec?.ok && void reset(u, t.id, respec.refund)}
                        >
                          Reset · free
                          {respec?.ok ? ` · +${respec.refund} pts` : ''}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>
      {dialog}
      {cancel.dialog}
    </div>
  );
}

function trackName(t: RankTrack): string {
  return TRACKS.find((x) => x.id === t)?.name ?? t;
}
