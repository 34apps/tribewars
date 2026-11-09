// World-end screen: the winner, the frozen Domination bar and the final tribe and player tables (top 50 of each).
// Reached from the banner every screen shows once the world has ended; the page scrolls, no inner scrollbars.

import { PageHeader } from '../components/PageHeader.tsx';
import { useMemo } from 'react';
import { BADGE_KINDS } from '@clanfire/engine';
import type { WorldEndDto } from '@clanfire/engine';
import { BADGE_HELP, BadgeChip, BadgeIcons, badgeLabel } from '../components/Badges.tsx';
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
  const countsLine = BADGE_KINDS.filter((k) => (end.badgeCounts[k] ?? 0) > 0)
    .map((k) => `${badgeLabel({ badge: k })}: ${end.badgeCounts[k]}`)
    .join(' · ');

  return (
    <div className="page rk-stage end-stage">
      <PageHeader icon="renown" title="World results" />

      <section className="card rk-card end-winner" aria-labelledby="end-winner-title">
        <div className="title-row">
          <h2 id="end-winner-title" className="card-title end-winner-title">{winnerLine(end)}</h2>
          <details className="help-pop">
            <summary aria-label="About the ended world">?</summary>
            <p className="small">Orders closed. Map, reports, mail, rankings and chat stay open.</p>
          </details>
        </div>
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
            <dt>Result</dt>
            <dd>{endKindText(end.kind)}</dd>
          </div>
          <div>
            <dt>Ended</dt>
            <dd>{endedAtText(end, now)}</dd>
          </div>
        </dl>
      </section>

      {end.myBadges.length > 0 && (
        <section className="card rk-card" aria-labelledby="end-badges-title">
          <div className="title-row">
            <h2 id="end-badges-title" className="card-title">Your badges</h2>
            <details className="help-pop">
              <summary aria-label="About badges">?</summary>
              <p className="small">{BADGE_HELP}</p>
            </details>
          </div>
          <ul className="badge-row">
            {end.myBadges.map((b) => (
              <BadgeChip key={b.badge} badge={b.badge} place={b.place} />
            ))}
          </ul>
          {countsLine && <p className="muted small">{countsLine}</p>}
        </section>
      )}

      <DominationCard />

      <section className="card rk-card" aria-labelledby="end-tribes-title">
        <h2 id="end-tribes-title" className="card-title">Tribes</h2>
        {tribes.length === 0 ? (
          <p className="muted">No tribes.</p>
        ) : (
          <div className="rk-scroll">
            <table className="rk-table">
              <thead>
                <tr>
                  <th scope="col" className="rk-c-rank">Rank</th>
                  <th scope="col">Tribe</th>
                  <th scope="col" className="num end-hide-sm">Members</th>
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
                        <span className="muted small end-sub">[{t.tag}]{mine ? ' · you' : ''}</span>
                      </td>
                      <td className="num end-hide-sm">{t.members}</td>
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
        <h2 id="end-players-title" className="card-title">Players</h2>
        {players.length === 0 ? (
          <p className="muted">No players.</p>
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
                        <BadgeIcons badges={end.playerBadges[p.playerId]} />
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
          Final map
        </button>
      </p>
    </div>
  );
}
