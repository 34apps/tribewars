// Lobby "Hall of Fame": one card per finished world (end date, winner, top 3 players). Hidden while the list is empty
// or cannot be loaded (it is a nice-to-have, never an error screen).

import { useEffect, useState } from 'react';
import type { HallOfFameEntryDto } from '@clanfire/engine';
import { api } from '../api.ts';
import { formatDate, formatInt } from '../format.ts';
import { BADGE_HELP } from './Badges.tsx';

export function HallOfFameList({ worlds }: { worlds: readonly HallOfFameEntryDto[] }) {
  if (worlds.length === 0) return null;
  return (
    <section className="hof" aria-labelledby="hof-title">
      <div className="title-row">
        <h2 id="hof-title" className="lobby-title hof-title">Hall of Fame</h2>
        <details className="help-pop on-light">
          <summary aria-label="About badges">?</summary>
          <p className="small">{BADGE_HELP}</p>
        </details>
      </div>
      <ul className="lobby-grid">
        {worlds.map((w) => (
          <li key={w.worldId} className="lobby-card dark hof-card">
            <div className="lobby-card-head">
              <h3 className="lobby-card-name">{w.worldName}</h3>
              <span className="world-status world-status-finished">{formatDate(w.endedAt)}</span>
            </div>
            {w.winner && (
              <p className="hof-winner">
                <span className="hof-crown" aria-hidden="true">★</span>
                <span className="tribe-tag">[{w.winner.tag}]</span> {w.winner.name}
              </p>
            )}
            {w.topPlayers.length > 0 && (
              <ol className="hof-players">
                {w.topPlayers.map((p) => (
                  <li key={p.rank}>
                    <span className="hof-rank">{p.rank}</span>
                    <span className="hof-name">
                      {p.name}
                      {p.tribeTag ? <span className="muted small"> [{p.tribeTag}]</span> : null}
                    </span>
                    <span className="hof-pts">{formatInt(p.points)}</span>
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HallOfFame() {
  const [worlds, setWorlds] = useState<HallOfFameEntryDto[]>([]);
  useEffect(() => {
    let cancelled = false;
    api
      .lobbyHallOfFame()
      .then((r) => {
        if (!cancelled) setWorlds(r.worlds);
      })
      .catch(() => {
        /* hidden when it cannot load */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return <HallOfFameList worlds={worlds} />;
}
