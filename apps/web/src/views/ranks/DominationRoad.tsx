// The Domination tab of the desktop Ranks page (owner pick "B · The road", design/proposals/ingame-pages/domination-b-1440.png):
// who owns the world (one bar split by tribe share with the win line), the road to the end of the world (the steps the game really
// has, with the world's real numbers) and what happens when a tribe wins. All numbers come from GET /api/domination.

import type { DominationStatusDto } from '@clanfire/engine';
import { Icon } from '../../art/Icon.tsx';
import { barWidth, leaderLine, percentText } from '../../domination.ts';
import { formatInt } from '../../format.ts';
import { useRules } from '../../game.ts';
import { DOMINATION_EVAL_INTERVAL_MINUTES } from '@clanfire/engine';
import { Chev } from '../village/FrameParts.tsx';
import { roadSteps, shareSegments } from './frame-ranks-logic.ts';

/** Fill colours of the tribe slices, biggest first (the toy palette; text on them is always dark ink). */
const SLICE_COLORS = ['var(--c-sun)', 'var(--c-teal-hi)', 'var(--c-terra-hi)', 'var(--c-leaf)', 'var(--c-dust)'];

/** What the game really does when a tribe wins (docs/GAME_DESIGN.md 18.1, "World end"). */
const WHEN_WON: Array<{ icon: 'warning' | 'ranks' | 'tribe' | 'flame'; title: string; text: string }> = [
  { icon: 'warning', title: 'Orders close', text: 'No more sends, builds or training. Mail, tribe chat and forum stay open; armies already on the way still land.' },
  { icon: 'ranks', title: 'Final tables', text: 'The tribe and player rankings are saved for good at that moment, and the world-end screen names the winner.' },
  { icon: 'tribe', title: 'Badges', text: 'Champion for the winning tribe, Second and Third tribe, Top 10 players, Veteran for everyone still holding a village.' },
  { icon: 'flame', title: 'Hall of Fame', text: 'The lobby marks the world Finished and lists it in the Hall of Fame.' },
];

function Slices({ status, otherTribes }: { status: DominationStatusDto; otherTribes: number | null }) {
  const segs = shareSegments(status);
  const lineLeft = barWidth(status.winShare);
  const aria = `${leaderLine(status)}; ${percentText(status.winShare)} is needed`;
  return (
    <div className="frk-own" role="img" aria-label={aria}>
      <div className="frk-own-bar">
        {segs.map((g, i) => {
          const w = barWidth(g.share);
          const rest = g.tag === null;
          const label = rest ? (otherTribes && otherTribes > 0 ? `${otherTribes} other tribes and players without a tribe` : 'Other tribes and players without a tribe') : g.tag;
          return (
            <span
              key={g.key}
              className={`frk-seg${rest ? ' is-rest' : ''}`}
              style={{ width: `${w}%`, background: rest ? undefined : SLICE_COLORS[i % SLICE_COLORS.length] }}
              title={`${label} ${percentText(g.share)}`}
            >
              {w >= 7 && (
                <>
                  <b>{rest ? label : g.tag}</b>
                  <small>{percentText(g.share)}</small>
                </>
              )}
            </span>
          );
        })}
        <i className="frk-own-line" style={{ left: `${lineLeft}%` }} />
      </div>
      <span className="frk-own-lbl" style={{ left: `${lineLeft}%` }}>{percentText(status.winShare)} line</span>
    </div>
  );
}

export function DominationRoad({ status, otherTribes, reload, error }: { status: DominationStatusDto | null; otherTribes: number | null; reload: () => void; error: string | null }) {
  const speed = useRules().pace.speed;
  if (!status) {
    return (
      <section className="fv-pn">
        <p className="fv-empty frk-pad" role="status">
          {error ? (
            <>
              Domination unavailable. <button type="button" className="link" onClick={reload}>Retry</button>
            </>
          ) : (
            'Loading…'
          )}
        </p>
      </section>
    );
  }
  const steps = roadSteps(status);
  const everyMin = Math.max(1, Math.round(DOMINATION_EVAL_INTERVAL_MINUTES / (speed > 0 ? speed : 1)));
  return (
    <div className="frk-dom">
      <section className="fv-pn" aria-label="Who owns the world">
        <div className="fv-ph">
          <h2>Who owns the world</h2>
          <span className="fv-sp" />
          <span className="fv-mut">
            all village points owned by players = {formatInt(status.totalPoints)} · abandoned villages not counted
          </span>
        </div>
        <div className="frk-own-b">
          <Slices status={status} otherTribes={otherTribes} />
          <p className="frk-own-p">
            To win, <b>one</b> tribe&apos;s own slice must reach the line by itself.{' '}
            {status.leader ? (
              <>
                Today the biggest, <b>{status.leader.name}</b>, has {percentText(status.leader.share)}.
              </>
            ) : (
              'No tribe owns a village yet.'
            )}
          </p>
        </div>
      </section>
      <section className="fv-pn" aria-label="The road to the end of the world">
        <div className="fv-ph">
          <h2>The road to the end of the world</h2>
          <span className="fv-sp" />
          <span className="fv-mut">checked every {everyMin === 1 ? 'minute' : `${everyMin} minutes`}</span>
        </div>
        <ol className="frk-road">
          {steps.map((st, i) => (
            <li key={st.key} className={`frk-step${st.ok ? ' is-ok' : ''}${st.key === 'end' ? ' is-end' : ''}`}>
              <span className="frk-sn" aria-hidden="true">
                {st.key === 'end' ? <Icon name="flame" size={22} /> : st.ok ? '✓' : i + 1}
              </span>
              <span className="frk-st-t">
                {st.title}
                {st.ok && st.key !== 'end' && <span className="visually-hidden"> (met)</span>}
              </span>
              <b className="frk-st-v">{st.value}</b>
              {st.fraction !== null && (
                <span className="frk-st-bar" aria-hidden="true">
                  <i style={{ width: `${barWidth(st.fraction)}%` }} />
                </span>
              )}
              <small className="frk-st-n">{st.note}</small>
              {i < steps.length - 1 && (
                <span className="frk-arrow" aria-hidden="true">
                  <Chev size={18} />
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
      <section className="fv-pn frk-won" aria-label="When a tribe wins">
        <div className="fv-ph">
          <h2>When a tribe wins</h2>
          <span className="fv-sp" />
          <span className="fv-mut">the world ends and stays readable</span>
        </div>
        <ul className="frk-won-l">
          {WHEN_WON.map((w) => (
            <li key={w.title}>
              <Icon name={w.icon} size={26} />
              <b>{w.title}</b>
              <p>{w.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
