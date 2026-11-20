// Auto mode (Premium): per village on/off plus goals (troop amounts, building levels). The server does the buying
// (engine autoSummary / settleVillage); this page only edits the goals and words what comes next.
// One responsive page: a grid of village cards on the desktop frame, stacked cards on the phone. Without the tools the same cards
// are greyed with a note and no control works (no POST is ever sent).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AUTO_GOAL_MAX_TROOPS, AUTO_UNIT_IDS, BUILDING_IDS, BUILDINGS, UNITS } from '@clanfire/engine';
import type { AutoOverviewResponse, AutoVillageDto, BuildingId, UnitId } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { BuildingArt } from '../art/BuildingArt.tsx';
import { UnitFigure } from '../art/UnitFigure.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import {
  AUTO_INTRO,
  AUTO_NOT_ENTITLED,
  AUTO_SAVE_DELAY_MS,
  RESEARCH_NOTE,
  addableBuildings,
  cleanGoals,
  controlsOff,
  goalCount,
  nextLine,
  parseTroopGoal,
  progressPct,
  progressText,
  queuedLine,
  startGoalLevel,
  stepLevel,
} from '../auto.ts';
import { formatCoords } from '../format.ts';
import { useGame } from '../game.ts';
import { useIsDesktop } from '../hooks/useLayout.ts';
import { useLock } from '../hooks/useLock.ts';

const REFRESH_MS = 60_000;

interface Draft {
  on: boolean;
  troopGoals: Partial<Record<UnitId, number>>;
  buildingGoals: Partial<Record<BuildingId, number>>;
}

const draftOf = (v: AutoVillageDto): Draft => ({ on: v.on, troopGoals: cleanGoals(v.troopGoals), buildingGoals: cleanGoals(v.buildingGoals) });

function Bar({ have, goal, label }: { have: number; goal: number; label: string }) {
  const pct = progressPct(have, goal);
  return (
    <div className="au-prog">
      <div className="au-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(have, goal)}>
        <span className="au-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="au-prog-t">{progressText(have, goal)}</span>
    </div>
  );
}

function VillageCard({ v, locked, now, onSaved }: { v: AutoVillageDto; locked: boolean; now: number; onSaved: (v: AutoVillageDto) => void }) {
  const lock = useLock();
  const [draft, setDraft] = useState<Draft>(() => draftOf(v));
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const latest = useRef(draft);
  latest.current = draft;

  // Follow the server's answer (refresh, other tab) unless a change of mine is still waiting to be sent.
  useEffect(() => {
    if (timer.current === null && !lock.busy) setDraft(draftOf(v));
  }, [v, lock.busy]);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const send = useCallback(async () => {
    timer.current = null;
    if (!lock.begin()) {
      timer.current = window.setTimeout(() => void send(), 300);
      return;
    }
    try {
      const d = latest.current;
      onSaved(await api.autoSettings(v.id, { on: d.on, troopGoals: { ...d.troopGoals }, buildingGoals: { ...d.buildingGoals } }));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
      setDraft(draftOf(v));
    } finally {
      lock.end();
    }
  }, [lock, onSaved, v]);

  const change = (patch: Partial<Draft>, delay: number) => {
    if (locked) return;
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setDraft(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void send(), delay);
  };
  const setTroop = (u: UnitId, n: number) => change({ troopGoals: cleanGoals({ ...latest.current.troopGoals, [u]: n }) }, AUTO_SAVE_DELAY_MS);
  const setBuilding = (b: BuildingId, n: number) => change({ buildingGoals: cleanGoals({ ...latest.current.buildingGoals, [b]: n }) }, n === 0 ? 300 : AUTO_SAVE_DELAY_MS);

  const dis = controlsOff(locked, false);
  const shown: AutoVillageDto = { ...v, on: draft.on };
  const goalBuildings = BUILDING_IDS.filter((b) => (draft.buildingGoals[b] ?? 0) > 0);
  const addable = addableBuildings(draft.buildingGoals);
  const any = goalCount({ troopGoals: draft.troopGoals, buildingGoals: draft.buildingGoals }) > 0;
  return (
    <section className={`au-card${draft.on ? '' : ' is-off'}${locked ? ' is-locked' : ''}`} aria-label={`Auto mode, ${v.name}`}>
      <header className="au-head">
        <div className="au-who">
          <strong className="au-name">{v.name}</strong>
          <span className="au-xy">{formatCoords(v.x, v.y)}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={draft.on}
          aria-label={`Auto mode in ${v.name}`}
          className={`au-switch${draft.on ? ' is-on' : ''}`}
          disabled={dis}
          onClick={() => change({ on: !draft.on }, 0)}
        >
          <span className="au-knob" aria-hidden="true" />
          <span className="au-switch-t">{draft.on ? 'On' : 'Off'}</span>
        </button>
      </header>

      <p className="au-next" aria-live="polite">{lock.busy ? 'Saving…' : nextLine(shown, now)}</p>

      <h4 className="au-h">Troop goals</h4>
      <ul className="au-rows" aria-label={`Troop goals in ${v.name}`}>
        {AUTO_UNIT_IDS.map((u: UnitId) => {
          const goal = draft.troopGoals[u] ?? 0;
          const research = v.needsResearch.includes(u);
          return (
            <li key={u} className={`au-row${goal > 0 ? ' has-goal' : ''}`}>
              <UnitFigure unit={u} pose="icon" size={28} />
              <div className="au-row-main">
                <span className="au-row-name">{UNITS[u].name}</span>
                {goal > 0 && research ? (
                  <small className="au-warn">{RESEARCH_NOTE}</small>
                ) : goal > 0 ? (
                  <Bar have={v.have[u] ?? 0} goal={goal} label={`${UNITS[u].name} progress`} />
                ) : null}
              </div>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={String(AUTO_GOAL_MAX_TROOPS).length}
                className="au-amount"
                placeholder="0"
                value={goal > 0 ? String(goal) : ''}
                disabled={dis}
                aria-label={`${UNITS[u].name} goal in ${v.name}`}
                onChange={(e) => setTroop(u, parseTroopGoal(e.target.value))}
              />
            </li>
          );
        })}
      </ul>

      <h4 className="au-h">Building goals</h4>
      {goalBuildings.length === 0 && <p className="au-mut">No building goal yet.</p>}
      {goalBuildings.length > 0 && (
        <ul className="au-rows" aria-label={`Building goals in ${v.name}`}>
          {goalBuildings.map((b) => {
            const goal = draft.buildingGoals[b] ?? 0;
            const max = BUILDINGS[b].maxLevel;
            return (
              <li key={b} className="au-row has-goal">
                <BuildingArt id={b} level={Math.max(1, v.levels[b] ?? 1)} size={28} className="au-bicon" />
                <div className="au-row-main">
                  <span className="au-row-name">{BUILDINGS[b].name}</span>
                  <Bar have={v.levels[b] ?? 0} goal={goal} label={`${BUILDINGS[b].name} progress`} />
                </div>
                <div className="au-step" role="group" aria-label={`${BUILDINGS[b].name} goal level in ${v.name}`}>
                  <button type="button" className="au-sb" disabled={dis || goal <= 1} aria-label={`Lower the ${BUILDINGS[b].name} goal`} onClick={() => setBuilding(b, stepLevel(b, goal, -1))}>
                    −
                  </button>
                  <output className="au-lv">{goal}</output>
                  <button type="button" className="au-sb" disabled={dis || goal >= max} aria-label={`Raise the ${BUILDINGS[b].name} goal`} onClick={() => setBuilding(b, stepLevel(b, goal, 1))}>
                    +
                  </button>
                </div>
                <button type="button" className="au-x" disabled={dis} aria-label={`Remove the ${BUILDINGS[b].name} goal`} onClick={() => setBuilding(b, 0)}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="au-tools">
        <select
          className="au-add"
          value=""
          disabled={dis || addable.length === 0}
          aria-label={`Add building goal in ${v.name}`}
          onChange={(e) => {
            const b = e.target.value as BuildingId;
            if (b) setBuilding(b, startGoalLevel(b, v.levels[b] ?? 0));
          }}
        >
          <option value="">Add building goal…</option>
          {addable.map((b) => (
            <option key={b} value={b}>
              {BUILDINGS[b].name}
            </option>
          ))}
        </select>
        <button type="button" className="au-clear" disabled={dis || !any} onClick={() => change({ troopGoals: {}, buildingGoals: {} }, 300)}>
          Clear goals
        </button>
      </div>

      <p className="au-queued">{queuedLine(v)}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** The rule in plain words (docs/GAME_DESIGN.md section 23), shown under the cards. */
const AUTO_HOW: readonly string[] = [
  'It always works on the goal that is furthest behind (troops have / goal, or building level / goal). A goal already met is skipped, and when all are met it stops: "All goals reached".',
  'First what a goal needs: a building it requires, the Longhouse when people room is almost full, the Storehouse when a store is almost full or a step costs more than it holds.',
  'It waits until the village can pay and never skips to something cheaper. Troops are ordered in batches of up to 10. A unit that still needs research at the Drillyard is skipped.',
  'At most one auto job per queue: one building in the build queue and one batch in each training building, the next one only when the last has finished. Your own orders keep the other slots.',
  'Troops count at home, away and in training. Cancel a job it queued and auto mode switches off in that village.',
];

export function AutoView() {
  const desktop = useIsDesktop();
  const { now } = useGame();
  const [data, setData] = useState<AutoOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api.autoOverview());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);
  const saved = useCallback((v: AutoVillageDto) => setData((d) => (d ? { ...d, villages: d.villages.map((o) => (o.id === v.id ? v : o)) } : d)), []);

  const premium = <span className="tag au-tag">Premium</span>;
  const frame = (body: ReactNode) =>
    desktop ? (
      <section className="fv-pn au-solo" aria-label="Auto mode">
        <div className="fv-ph au-ph">
          <h2>Auto mode</h2>
          {premium}
        </div>
        <div className="au-body">{body}</div>
      </section>
    ) : (
      <div className="page au-page">
        <PageHeader icon="train" title="Auto mode" actions={premium} />
        {body}
      </div>
    );

  if (error && !data) {
    return frame(
      <p className="form-error" role="alert">
        {error}{' '}
        <button type="button" className="fv-lk" onClick={() => void load()}>
          Retry
        </button>
      </p>,
    );
  }
  if (!data) return frame(<p className="au-mut">Loading…</p>);
  if (!data.feature) return frame(<p className="au-mut">Auto mode is not switched on in this world.</p>);
  const locked = !data.entitled;
  return frame(
    <>
      <p className="au-intro">{AUTO_INTRO}</p>
      {locked && <p className="au-note" role="note">{AUTO_NOT_ENTITLED}</p>}
      <div className={`au-grid${locked ? ' is-locked' : ''}`}>
        {data.villages.map((v) => (
          <VillageCard key={v.id} v={v} locked={locked} now={now} onSaved={saved} />
        ))}
      </div>
      <section className="au-how" aria-label="How auto mode chooses">
        <h3>How auto mode chooses</h3>
        <ol>
          {AUTO_HOW.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </section>
    </>,
  );
}
