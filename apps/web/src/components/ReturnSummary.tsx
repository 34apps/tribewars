// "While you were away": shown once to a player whose villages were abandoned after a long absence (docs/GAME_DESIGN.md 17, "Return summary").
// Lists each village and what became of it. A player left with nothing already has a fresh village (the server made it at sign-in):
// "Start again" closes the summary and opens it. A player who still owns villages only gets "OK".

import { useEffect, useId, useRef, useState } from 'react';
import type { AbandonedNoticeDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { formatAgo, formatCoords, formatDate } from '../format.ts';
import { useGame } from '../game.ts';

export function awayText(n: AbandonedNoticeDto): string {
  const days = `${n.idleDays} ${n.idleDays === 1 ? 'day' : 'days'}`;
  return `You were away for ${days}. ${n.villages === 1 ? '1 village' : `${n.villages} villages`} of yours turned abandoned.`;
}

/** What the dialog shows; no data fetching, so it can be tested and photographed. */
export function ReturnSummaryView({
  notice,
  username,
  now,
  busy,
  onDismiss,
}: {
  notice: AbandonedNoticeDto;
  username: string;
  now: number;
  busy: boolean;
  onDismiss: () => void;
}) {
  const titleId = useId();
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus({ preventScroll: true }), []);
  const list = notice.list ?? [];
  const startAgain = notice.newVillageId !== undefined;
  return (
    <div className="rs-wrap">
      <div className="rs-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>While you were away</h2>
        <p className="rs-lead">{awayText(notice)}</p>
        {list.length > 0 && (
          <ul className="rs-list">
            {list.map((v) => {
              const mine = v.takenBy === username;
              return (
                <li key={v.id} className="rs-row">
                  <div className="rs-main">
                    <strong className="rs-name">{v.name}</strong>
                    <span className="rs-coords">{formatCoords(v.x, v.y)}</span>
                  </div>
                  <span className={`tag ${v.status === 'taken' ? (mine ? 'tag-ok' : 'tag-bad') : 'tag-muted'}`}>
                    {v.status === 'taken' ? (mine ? 'You own it again' : `Taken by ${v.takenBy ?? 'a player'}`) : 'Still abandoned'}
                  </span>
                  <span className="rs-when" title={formatDate(v.abandonedAt)}>
                    Abandoned {formatAgo(v.abandonedAt, now)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="rs-note">
          {startAgain
            ? 'You start again like a new player: a fresh village with beginner protection. Your account, tribe and Renown stay.'
            : 'You still have villages of your own.'}
        </p>
        <button ref={btn} type="button" className="btn btn-primary rs-btn" onClick={onDismiss} disabled={busy}>
          {startAgain ? 'Start again' : 'OK'}
        </button>
      </div>
    </div>
  );
}

export function ReturnSummary() {
  const { player, now, refresh, toast, selectVillage } = useGame();
  const [busy, setBusy] = useState(false);
  const n = player.abandonedNotice;
  if (!n) return null;
  const dismiss = () => {
    setBusy(true);
    const target = n.newVillageId;
    api
      .dismissAbandonedNotice()
      .then(() => refresh())
      .then(() => {
        if (target !== undefined) selectVillage(target);
      })
      .catch((e) => toast(errorMessage(e), { kind: 'error' }))
      .finally(() => setBusy(false));
  };
  return <ReturnSummaryView notice={n} username={player.username} now={now} busy={busy} onDismiss={dismiss} />;
}
