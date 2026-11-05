// World-end screen: the winner, the frozen Domination bar and the final tribe and player tables (top 50 of each).
// Reached from the banner every screen shows once the world has ended; the page scrolls, no inner scrollbars.

import { useMemo } from 'react';
import type { WorldEndDto } from '@clanfire/engine';
import { DominationCard } from '../components/DominationBar.tsx';
import { endKindText, finalRows, winnerLine } from '../domination.ts';
import { formatClock, formatDate, formatInt } from '../format.ts';
import { useGame } from '../game.ts';

function Rank({ rank }: { rank: number }) {
  if (rank > 3) return <span className="rk-num">{rank}</span>;
  return (
    <span className={`rk-medal rk-medal-${rank}`} aria-label={`Rank ${rank}`}>
      {rank}
    </span>
  );
}

function endedAtText(end: WorldEndDto, now: number): string {
  return `${formatDate(end.endedAt)}, ${formatClock(end.endedAt, now)}`;
}

export function WorldEndView({ end }: { end: WorldEndDto }) {
  const { now, player, village, viewTribe, showOnMap } = useGame();
  const tribes = useMemo(() => finalRows(end.finalTribes), [end.finalTribes]);
  const players = useMemo(() => finalRows(end.finalPlayers), [end.finalPlayers]);
  const myTag = player.tribe?.tag ?? null;

  return (
    <div className="rk-stage end-stage">
      <h1 className="page-title">World results</h1>

      <section className="card rk-card end-winner" aria-labelledby="end-winner-title">
        <h2 id="end-winner-title" className="card-title end-winner-title">{winnerLine(end)}</h2>
        {end.winner && (
          <p className="end-winner-tag">
            <button type="button" className="link link-touch" onClick={() => viewTribe({ id: end.winner!.tribeId })}>
              Open {end.winner.name} <span className="tribe-tag">[{end.winner.tag}]</span>
            </button>
          </p>
        )}
        {end.reason.trim() && <p className="end-reason">{end.reason}</p>}
        <dl className="facts end-facts">
          <div>
            <dt>How it ended</dt>
            <dd>{endKindText(end.kind)}</dd>
          </div>
          <div>
            <dt>Ended</dt>
            <dd>{endedAtText(end, now)}</dd>
          </div>
        </dl>
        <p className="muted small end-note">
          The world is frozen: no more orders. You can still read the map, reports, mail and rankings, and write in your tribe's chat and forum.
        </p>
      </section>

      <DominationCard />

      <section className="card rk-card" aria-labelledby="end-tribes-title">
        <h2 id="end-tribes-title" className="card-title">Final tribe ranking</h2>
        {tribes.length === 0 ? (
          <p className="muted">No tribes at the end.</p>
        ) : (
          <div className="rk-scroll">
            <table className="rk-table">
              <thead>
                <tr>
                  <th scope="col" className="rk-c-rank">Rank</th>
                  <th scope="col">Tribe</th>
                  <th scope="col" className="num">Members</th>
                  <th scope="col" className="num">Villages</th>
                  <th scope="col" className="num">Points</th>
                </tr>
              </thead>
              <tbody>
                {tribes.map((t) => {
                  const mine = myTag !== null && t.tag === myTag;
                  return (
                    <tr key={t.tribeId} className={mine ? 'rk-me' : undefined} aria-current={mine ? 'true' : undefined}>
                      <td className="rk-c-rank"><Rank rank={t.rank} /></td>
                      <td className="rk-name">
                        <button type="button" className="rk-who" onClick={() => viewTribe({ id: t.tribeId })}>{t.name}</button>
                        <span className="muted small end-sub">[{t.tag}]{mine ? ' · your tribe' : ''}</span>
                      </td>
                      <td className="num">{t.members}</td>
                      <td className="num">{t.villages}</td>
                      <td className="num rk-pts">{formatInt(t.points)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card rk-card" aria-labelledby="end-players-title">
        <h2 id="end-players-title" className="card-title">Final player ranking</h2>
        {players.length === 0 ? (
          <p className="muted">No players at the end.</p>
        ) : (
          <div className="rk-scroll">
            <table className="rk-table">
              <thead>
                <tr>
                  <th scope="col" className="rk-c-rank">Rank</th>
                  <th scope="col">Player</th>
                  <th scope="col" className="num">Villages</th>
                  <th scope="col" className="num">Points</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => {
                  const mine = p.playerId === player.id;
                  return (
                    <tr key={p.playerId} className={mine ? 'rk-me' : undefined} aria-current={mine ? 'true' : undefined}>
                      <td className="rk-c-rank"><Rank rank={p.rank} /></td>
                      <td className="rk-name">
                        <span>{p.name}</span>
                        <span className="muted small end-sub">
                          {p.tribeTag ? `[${p.tribeTag}]` : 'No tribe'}
                          {mine ? ' · you' : ''}
                        </span>
                      </td>
                      <td className="num">{p.villages}</td>
                      <td className="num rk-pts">{formatInt(p.points)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="end-back">
        <button type="button" className="btn btn-tall" onClick={() => showOnMap(village.x, village.y)}>
          Look at the final map
        </button>
      </p>
    </div>
  );
}
