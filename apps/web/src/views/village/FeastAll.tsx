// "Feast in all villages" (Premium): the second view of the Banner Hall page. One row per own village (GET /api/feasts): Banner Hall
// level, price of one Feast, what the stock pays for, a tick and a number. One button holds the ticked Feasts (POST /api/feasts).
// Without the tools the same list is greyed, no control works and no POST is ever sent. The server re-checks everything.

import { useCallback, useEffect, useState } from 'react';
import { FEAST_RENOWN } from '@clanfire/engine';
import type { FeastOverviewResponse, FeastVillageDto } from '@clanfire/engine';
import { api, errorMessage } from '../../api.ts';
import { Icon } from '../../art/Icon.tsx';
import { Cost } from '../../components/ui.tsx';
import {
  FEAST_ALL_INTRO,
  FEAST_ALL_NOT_ENTITLED,
  buildFeastRequest,
  defaultPicks,
  pickCount,
  pickTotals,
  resultLine,
  rowNote,
  rowState,
  skippedLines,
  toggleAll,
} from '../../feastAll.ts';
import type { FeastPick } from '../../feastAll.ts';
import { formatCoords, formatInt } from '../../format.ts';
import { useGame } from '../../game.ts';
import { LOBBY_URL } from '../../hooks/useWorldInfo.ts';
import { useLock } from '../../hooks/useLock.ts';
import { clampFeastCount } from '../../renown.ts';

function Row({
  v,
  pick,
  off,
  onPick,
}: {
  v: FeastVillageDto;
  pick: FeastPick;
  off: boolean;
  onPick: (p: FeastPick) => void;
}) {
  const state = rowState(v);
  const ready = state === 'ready';
  const note = rowNote(state);
  const count = pickCount(v, pick);
  const dis = off || !ready;
  return (
    <li className={`fa-row${ready && pick.on ? ' is-on' : ''}${ready ? '' : ' is-idle'}`}>
      <label className="fa-tick">
        <input
          type="checkbox"
          checked={ready && pick.on}
          disabled={dis}
          onChange={(e) => onPick({ ...pick, on: e.target.checked })}
        />
        <span className="visually-hidden">Feast in {v.name}</span>
      </label>
      <div className="fa-who">
        <strong className="fa-name">{v.name}</strong>
        <span className="fa-xy">{formatCoords(v.x, v.y)}</span>
      </div>
      <span className="fa-hall">
        <span className="fa-lbl">Banner Hall </span>
        {v.bannerhall < 1 ? '0' : `level ${v.bannerhall}`}
      </span>
      {note ? (
        <p className="fa-note">{note}</p>
      ) : (
        <>
          <span className="fa-price" title="Price of one Feast">
            <Cost cost={v.price} have={v.resources} />
          </span>
          <span className="fa-can">
            Pays for <b>{formatInt(v.max)}</b> · <Icon name="renown" size={16} className="inline-icon" /> +{formatInt(v.max * FEAST_RENOWN)}
          </span>
        </>
      )}
      {ready && (
        <>
          <label className="visually-hidden" htmlFor={`fa-n-${v.id}`}>
            Feasts in {v.name}
          </label>
          <input
            id={`fa-n-${v.id}`}
            className="bh-amount fa-num"
            type="number"
            inputMode="numeric"
            min={1}
            max={v.max}
            step={1}
            value={pick.text}
            disabled={dis}
            onChange={(e) => onPick({ ...pick, text: e.target.value })}
            onBlur={() => onPick({ ...pick, text: String(clampFeastCount(Number.parseInt(pick.text, 10), v.max)) })}
          />
        </>
      )}
    </li>
  );
}

export function FeastAll() {
  const { refresh, toast } = useGame();
  const { busy, begin, end } = useLock();
  const [data, setData] = useState<FeastOverviewResponse | null>(null);
  const [picks, setPicks] = useState<Record<number, FeastPick>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ line: string; skipped: string[] } | null>(null);

  const show = useCallback((o: FeastOverviewResponse) => {
    setData(o);
    setPicks(defaultPicks(o.villages));
  }, []);
  const load = useCallback(async () => {
    try {
      show(await api.feastsOverview());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [show]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) {
    return (
      <p className="form-error" role="alert">
        {error}{' '}
        <button type="button" className="fv-lk" onClick={() => void load()}>
          Retry
        </button>
      </p>
    );
  }
  if (!data) return <p className="au-mut">Loading…</p>;
  if (!data.feature) return <p className="au-mut">Feast in all villages is not switched on in this world.</p>;

  const locked = !data.entitled;
  const totals = pickTotals(data.villages, picks);
  const off = locked || busy;
  const canGo = !off && totals.feasts > 0;
  const allReady = data.villages.filter((v) => rowState(v) === 'ready');

  async function go() {
    if (locked || !data || !begin()) return;
    try {
      const body = buildFeastRequest(data.villages, picks);
      if (body.length < 1) return;
      const res = await api.feastAll(body);
      setDone({ line: resultLine(res), skipped: skippedLines(res, data.villages) });
      show(res.overview);
      toast(`+${formatInt(res.gained)} Renown`);
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      end();
      // The open village's stock and the Renown in the header come from the game state.
      void refresh();
    }
  }

  const footer = (
    <div className="fa-total">
      <span className="fa-sum" aria-live="polite">
        {totals.feasts > 0 ? (
          <>
            <b>{formatInt(totals.feasts)}</b> {totals.feasts === 1 ? 'Feast' : 'Feasts'} in {totals.villages}{' '}
            {totals.villages === 1 ? 'village' : 'villages'} · <Icon name="renown" size={18} className="inline-icon" /> +
            {formatInt(totals.renown)} Renown
          </>
        ) : (
          'Nothing ticked'
        )}
      </span>
      <button
        type="button"
        className="btn bh-max-btn"
        disabled={off || allReady.length < 1}
        onClick={() => setPicks(toggleAll(data.villages, picks))}
      >
        {allReady.every((v) => picks[v.id]?.on) ? 'Untick all' : 'Tick all'}
      </button>
      <button type="button" className="btn btn-primary bh-go fa-go" disabled={!canGo} onClick={() => void go()}>
        <Icon name="renown" size={22} /> Feast in ticked villages
      </button>
    </div>
  );

  return (
    <section className={`fv-pn fa-panel${locked ? ' is-locked' : ''}`} aria-label="Feast in all villages">
      <div className="fv-ph">
        <h2>Feast in all villages</h2>
        <span className="tag au-tag">Premium</span>
        {!locked && !done && <span className="fa-intro">{FEAST_ALL_INTRO}</span>}
      </div>
      <div className="fa-body">
        {locked ? (
          <div className="au-note fa-lock" role="note">
            <span>{FEAST_ALL_NOT_ENTITLED}</span>{' '}
            <a className="btn btn-small" href={`${LOBBY_URL}#shop`}>
              <Icon name="flame" size={18} className="inline-icon" /> Open the Flames shop
            </a>
          </div>
        ) : null}
        {done && (
          <div className="fa-done" role="status">
            <b>{done.line}</b>
            {done.skipped.length > 0 && <span className="fa-skip"> · Skipped: {done.skipped.join(' · ')}</span>}
          </div>
        )}
        <div className="fa-head" aria-hidden="true">
          <span />
          <span>Village</span>
          <span>Hall</span>
          <span>One Feast costs</span>
          <span>Stock pays for</span>
          <span>Feasts</span>
        </div>
        <ul className="fa-list" aria-label="Your villages">
          {data.villages.map((v) => (
            <Row
              key={v.id}
              v={v}
              pick={picks[v.id] ?? { on: false, text: '0' }}
              off={off}
              onPick={(p) => setPicks((cur) => ({ ...cur, [v.id]: p }))}
            />
          ))}
        </ul>
        {footer}
      </div>
    </section>
  );
}
