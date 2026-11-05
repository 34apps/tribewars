// Tribe alerts: attacks on their way to any member's village, soonest first. Scouts never show up (stealthy).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TribeAlertDto, TribeHoldDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { HoldCard } from '../components/HoldCard.tsx';
import { ProgressBar } from '../components/ui.tsx';
import { formatAgo, formatClock, formatCoords, formatDuration } from '../format.ts';
import { useGame } from '../game.ts';
import { pollMs } from '../hooks/live.ts';
import { useLiveConnected, useLiveTopic } from '../hooks/useLive.tsx';
import { DESKTOP_QUERY, useMediaQuery } from '../hooks/useMediaQuery.ts';
import { RELIEF_LABEL, alertCount, sortHolds } from '../villages.ts';

const POLL_MS = 10_000; // slower while live updates are connected

function AlertRow({ a }: { a: TribeAlertDto }) {
  const { now, villages, showOnMap, viewMovement } = useGame();
  const mine = villages.some((v) => v.id === a.target.villageId);
  const left = a.arriveAt - now;
  const total = Math.max(1, a.arriveAt - a.departAt);
  const owner = mine ? 'you' : (a.target.ownerName ?? 'a member');
  return (
    <li className="movement is-incoming alert-row">
      <div className="movement-head">
        <span className="movement-title">
          <span className="tag tag-bad">Attack</span> on {owner},{' '}
          <button className="link link-touch" onClick={() => showOnMap(a.target.x, a.target.y)} title="Show on map">
            {a.target.name} ({formatCoords(a.target.x, a.target.y)})
          </button>
        </span>
        <span className="movement-time">
          <strong>{left > 0 ? formatDuration(left) : 'landing…'}</strong>
        </span>
      </div>
      <ProgressBar value={(now - a.departAt) / total} tone="danger" label="Attack progress" />
      <div className="movement-foot">
        <span>
          from {a.attacker.ownerName ?? 'unknown'}
          {a.attackerTribeTag && <> <span className="tribe-tag">[{a.attackerTribeTag}]</span></>},{' '}
          <button className="link link-touch" onClick={() => showOnMap(a.attacker.x, a.attacker.y)} title="Show on map">
            {a.attacker.name} ({formatCoords(a.attacker.x, a.attacker.y)})
          </button>
        </span>
        <span className="muted">
          departed {formatClock(a.departAt, now)} ({formatAgo(a.departAt, now)}) · arrives {formatClock(a.arriveAt, now)}
        </span>
      </div>
      <div className="alert-actions">
        {mine ? (
          <button className="btn btn-tall" onClick={() => viewMovement(a.movementId)}>
            View in Army
          </button>
        ) : (
          <button className="btn btn-primary btn-tall" onClick={() => showOnMap(a.target.x, a.target.y, { mission: 'support' })}>
            Send support
          </button>
        )}
      </div>
    </li>
  );
}

/** A tribe member's village whose hearth is out: who holds it and the clock. Chieftains only show up here, never in an attack row. */
function HoldRow({ h }: { h: TribeHoldDto }) {
  const { villages, showOnMap, selectVillage, navigate } = useGame();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const mine = villages.some((v) => v.id === h.village.villageId);
  const owner = mine ? 'you' : (h.village.ownerName ?? 'a member');
  return (
    <li className="movement is-incoming alert-row alert-hold">
      <div className="movement-head">
        <span className="movement-title">
          <span className="tag tag-bad">Hearth out</span> at {owner},{' '}
          <button className="link link-touch" onClick={() => showOnMap(h.village.x, h.village.y)} title="Show on map">
            {h.village.name} ({formatCoords(h.village.x, h.village.y)})
          </button>
        </span>
      </div>
      <HoldCard hearth={h.hearth} viewpoint="other" compact={!desktop} />
      <div className="alert-actions">
        {mine ? (
          <button
            className="btn btn-tall"
            onClick={() => {
              selectVillage(h.village.villageId);
              navigate('village');
            }}
          >
            View village
          </button>
        ) : (
          <>
            <button className="btn btn-primary btn-tall" onClick={() => showOnMap(h.village.x, h.village.y, { mission: 'support' })}>
              Send support
            </button>
            <button className="btn btn-tall" onClick={() => showOnMap(h.village.x, h.village.y, { mission: 'attack' })}>
              {RELIEF_LABEL}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export function Alerts() {
  const { tribeAlerts } = useGame();
  const [alerts, setAlerts] = useState<TribeAlertDto[] | null>(null);
  const [holds, setHolds] = useState<TribeHoldDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const applied = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const res = await api.tribeAlerts();
      if (my < applied.current) return;
      applied.current = my;
      setAlerts([...res.alerts].sort((a, b) => a.arriveAt - b.arriveAt));
      setHolds(sortHolds(res.holds ?? []));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  // Load on open and whenever the state poll says the number of alerts changed.
  useEffect(() => {
    void load();
  }, [load, tribeAlerts]);

  // Refresh every 10 s (60 s with live updates) while this section is on screen and the page is visible.
  const pollEvery = pollMs(POLL_MS, useLiveConnected());
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, pollEvery);
    const wake = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [load, pollEvery]);

  useLiveTopic('tribe', () => void load());

  const count = alertCount(alerts, holds);
  return (
    <section className="card" aria-labelledby="alerts-title">
      <h2 id="alerts-title" className="card-title">
        Alerts {count > 0 && <span className="badge badge-inline" aria-label={`${count} alerts`}>{count}</span>}
      </h2>
      <p className="muted small pad-bottom">
        Villages with the hearth out come first, then attacks on their way to your tribe's villages, soonest first. Send support to stand beside a member.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error} <button className="link" onClick={() => void load()}>Retry</button>
        </p>
      )}
      {alerts === null && !error && <p className="muted" role="status">Loading…</p>}
      {alerts !== null && count === 0 && <p className="muted">No attacks or held villages on your tribe right now.</p>}
      {holds.length > 0 && (
        <ul className="movement-list" aria-label="Tribe villages with the hearth out">
          {holds.map((h) => (
            <HoldRow key={h.village.villageId} h={h} />
          ))}
        </ul>
      )}
      {alerts !== null && alerts.length > 0 && (
        <ul className="movement-list" aria-label="Incoming attacks on tribe members">
          {alerts.map((a) => (
            <AlertRow key={a.movementId} a={a} />
          ))}
        </ul>
      )}
    </section>
  );
}
