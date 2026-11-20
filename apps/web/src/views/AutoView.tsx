// Auto mode (Premium): per village on/off, a building-versus-troops balance and the units to recruit. The server does the buying
// (engine autoNext / settleVillage); this page only edits the settings and words what comes next.
// One responsive page: a grid of village cards on the desktop frame, stacked cards on the phone. Without the tools the same cards
// are greyed with a note and no control works (no POST is ever sent).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AUTO_SHARE_STEP, AUTO_UNIT_IDS, UNITS } from '@clanfire/engine';
import type { AutoOverviewResponse, AutoVillageDto, UnitId } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { UnitFigure } from '../art/UnitFigure.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import {
  AUTO_INTRO,
  AUTO_NOT_ENTITLED,
  AUTO_SLIDER_DELAY_MS,
  chipDisabled,
  controlsOff,
  nextLine,
  queuedLine,
  shareText,
  snapShare,
  toggleUnit,
  whyNotTrainable,
} from '../auto.ts';
import { formatCoords } from '../format.ts';
import { useGame } from '../game.ts';
import { useIsDesktop } from '../hooks/useLayout.ts';
import { useLock } from '../hooks/useLock.ts';

const REFRESH_MS = 60_000;

function VillageCard({ v, locked, now, onSaved }: { v: AutoVillageDto; locked: boolean; now: number; onSaved: (v: AutoVillageDto) => void }) {
  const { villages } = useGame();
  const buildings = villages.find((o) => o.id === v.id)?.state.buildings;
  const lock = useLock();
  const [draft, setDraft] = useState({ on: v.on, buildShare: v.buildShare, units: v.units });
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const latest = useRef(draft);
  latest.current = draft;

  // Follow the server's answer (refresh, other tab) unless a change of mine is still waiting to be sent.
  useEffect(() => {
    if (timer.current === null && !lock.busy) setDraft({ on: v.on, buildShare: v.buildShare, units: v.units });
  }, [v, lock.busy]);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const send = useCallback(async () => {
    timer.current = null;
    if (!lock.begin()) return;
    try {
      const d = latest.current;
      onSaved(await api.autoSettings(v.id, { on: d.on, buildShare: d.buildShare, units: [...d.units] }));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
      setDraft({ on: v.on, buildShare: v.buildShare, units: v.units });
    } finally {
      lock.end();
    }
  }, [lock, onSaved, v]);

  const change = (patch: Partial<typeof draft>, delay: number) => {
    if (locked || lock.busy) return;
    setDraft((d) => ({ ...d, ...patch }));
    latest.current = { ...latest.current, ...patch };
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void send(), delay);
  };

  const off = !draft.on;
  const dis = controlsOff(locked, lock.busy);
  const shown: AutoVillageDto = { ...v, on: draft.on };
  return (
    <section className={`au-card${off ? ' is-off' : ''}${locked ? ' is-locked' : ''}`} aria-label={`Auto mode, ${v.name}`}>
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

      <div className="au-bal">
        <div className="au-bal-ends" aria-hidden="true">
          <span>More building</span>
          <span>More troops</span>
        </div>
        <input
          type="range"
          className="au-range"
          min={0}
          max={100}
          step={AUTO_SHARE_STEP}
          value={draft.buildShare}
          disabled={dis}
          aria-label={`Balance in ${v.name}: more building or more troops`}
          aria-valuetext={shareText(draft.buildShare)}
          onChange={(e) => change({ buildShare: snapShare(Number(e.target.value)) }, AUTO_SLIDER_DELAY_MS)}
        />
        <p className="au-share">{shareText(draft.buildShare)}</p>
      </div>

      <div className="au-units" role="group" aria-label={`Units to recruit in ${v.name}`}>
        {AUTO_UNIT_IDS.map((u: UnitId) => {
          const can = v.trainable.includes(u);
          const picked = draft.units.includes(u);
          return (
            <button
              key={u}
              type="button"
              className={`au-chip${picked ? ' is-picked' : ''}${can ? '' : ' is-grey'}`}
              aria-pressed={picked}
              disabled={chipDisabled(locked, lock.busy, can, picked)}
              title={can ? UNITS[u].name : whyNotTrainable(u, buildings)}
              onClick={() => change({ units: toggleUnit(draft.units, u, AUTO_UNIT_IDS) }, 700)}
            >
              <UnitFigure unit={u} pose="icon" size={24} />
              <span className="au-chip-t">
                <span>{UNITS[u].name}</span>
                {!can && <small>{whyNotTrainable(u, buildings)}</small>}
              </span>
            </button>
          );
        })}
      </div>

      <p className="au-next" aria-live="polite">{lock.busy ? 'Saving…' : nextLine(shown, now)}</p>
      <p className="au-queued">{queuedLine(v)}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** The rule in plain words (docs/GAME_DESIGN.md "Auto mode"), shown under the cards. */
const AUTO_HOW: readonly string[] = [
  'Buildings or troops: it keeps its spending close to your balance. If buildings got less than their share so far, a building is next; otherwise 10 troops of the next unit you picked.',
  'It waits until the village can pay and a queue slot is free, and never skips. Only when one side cannot happen at all (nothing left to build, no unit it can train) does the other side go.',
  'Which building: the Longhouse when people room is almost full, the Storehouse when a store is almost full, the Town Hall when it is 2 levels behind, otherwise the cheapest next level of Lumber Camp, Farm, Iron Mine or Gold Mine.',
  'It never builds army buildings, the Wall or the Market, and never trains Chieftains or siege units. Cancel a job it queued and auto mode switches off in that village.',
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
