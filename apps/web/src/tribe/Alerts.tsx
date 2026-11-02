// Tribe alerts: attacks on their way to any member's village, soonest first. Scouts never show up (stealthy).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TribeAlertDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { ProgressBar } from '../components/ui.tsx';
import { formatAgo, formatClock, formatCoords, formatDuration } from '../format.ts';
import { useGame } from '../game.ts';

const POLL_MS = 10_000;

function AlertRow({ a }: { a: TribeAlertDto }) {
  const { now, village, showOnMap, viewMovement } = useGame();
  const mine = a.target.villageId === village.id;
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

export function Alerts() {
  const { tribeAlerts } = useGame();
  const [alerts, setAlerts] = useState<TribeAlertDto[] | null>(null);
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
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  // Load on open and whenever the state poll says the number of alerts changed.
  useEffect(() => {
    void load();
  }, [load, tribeAlerts]);

  // Refresh every 10 s while this section is on screen and the page is visible.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    const wake = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [load]);

  return (
    <section className="card" aria-labelledby="alerts-title">
      <h2 id="alerts-title" className="card-title">
        Alerts {alerts && alerts.length > 0 && <span className="badge badge-inline" aria-label={`${alerts.length} incoming`}>{alerts.length}</span>}
      </h2>
      <p className="muted small pad-bottom">Attacks on their way to your tribe's villages, soonest first. Send support to stand beside a member.</p>
      {error && (
        <p className="form-error" role="alert">
          {error} <button className="link" onClick={() => void load()}>Retry</button>
        </p>
      )}
      {alerts === null && !error && <p className="muted" role="status">Loading…</p>}
      {alerts !== null && alerts.length === 0 && <p className="muted">No attacks on your tribe right now.</p>}
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
