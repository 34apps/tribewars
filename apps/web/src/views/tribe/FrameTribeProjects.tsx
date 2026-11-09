// The Projects sub-tab of the desktop Tribe page (picture: design/proposals/ingame-pages/mix-tribe-projects-1440.png): the Tribe Store with
// its store village, the three projects (the running one shows its clock and Cancel), and who gave. Data and actions: tribe/Projects.tsx.

import { useState } from 'react';
import { RESOURCE_IDS } from '@clanfire/engine';
import type { TribeProjectOptionDto, TribeProjectsResponse } from '@clanfire/engine';
import { api } from '../../api.ts';
import { ChieftainAvatar } from '../../art/Chieftain.tsx';
import { Icon } from '../../art/Icon.tsx';
import { formatAgo, formatCompact, formatCoords, formatDuration, formatInt } from '../../format.ts';
import { useGame } from '../../game.ts';
import { RESOURCE_ICON, RESOURCE_NAME } from '../../icons.ts';
import type { MemberProps } from '../../tribe/context.ts';
import { PROJECT_ICON, PROJECT_NAME, giveReasonOf, shortEffect, shortNext, startReason, useTribeProjects } from '../../tribe/Projects.tsx';
import { LEDGER_LATEST_SHOWN, LEDGER_TOTALS_SHOWN, landsAt } from './frame-tribe-logic.ts';

function StorePanel({ d, act, busy, actionError, now }: { d: TribeProjectsResponse; act: (fn: () => Promise<TribeProjectsResponse>) => Promise<void>; busy: boolean; actionError: string | null; now: number }) {
  const { showOnMap } = useGame();
  const [pick, setPick] = useState('');
  const [moving, setMoving] = useState(false);
  const home = d.storeVillage;
  const waitingChange = d.storeVillageChangeableAt !== null && d.storeVillageChangeableAt > now;
  const giveReason = giveReasonOf(d, now, landsAt);
  const showPick = d.canManage && (!home || moving);
  return (
    <section className="fv-pn frt-store" aria-label="Tribe Store">
      <div className="fv-ph frt-ph">
        <h2>Tribe Store</h2>
        <span className="fv-sp" />
        <span className="fv-mut">max {formatCompact(d.storeCap)} each</span>
      </div>
      <div className="frt-sb">
        <div className="frt-home">
          <span className="frt-hi" aria-hidden="true">
            <Icon name="pin" size={26} />
          </span>
          {home ? (
            <>
              <span className="frt-holdt">
                <b>
                  {home.name} ({formatCoords(home.x, home.y)})
                </b>
                <small>store village{home.ownerName ? ` · ${home.ownerName}` : ''}</small>
              </span>
              <button type="button" className="fv-btn" onClick={() => showOnMap(home.x, home.y)}>
                Map
              </button>
            </>
          ) : (
            <span className="fv-mut">No store village yet.</span>
          )}
        </div>
        <ul className="frt-bars" aria-label="Tribe Store">
          {RESOURCE_IDS.map((r) => (
            <li key={r}>
              <Icon name={RESOURCE_ICON[r]} size={28} />
              <span className="frt-bn">
                <b title={formatInt(d.store[r])}>{formatInt(d.store[r])}</b>
                <small>{RESOURCE_NAME[r]}</small>
                <span className="fv-bar" role="img" aria-label={`${RESOURCE_NAME[r]} in the Tribe Store`}>
                  <i style={{ width: `${Math.min(100, (d.store[r] / Math.max(1, d.storeCap)) * 100)}%`, background: 'var(--c-moss)' }} />
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="frt-note">
          Members send resources with the map's send form: To Tribe Store. {giveReason ?? `${formatInt(d.myDailyLeft)} left for you today.`} Bars show the share of the cap.
        </p>
        {showPick && (
          <div className="frt-pick">
            <label className="visually-hidden" htmlFor="frt-store-pick">{home ? 'Move the store to' : 'Choose a village'}</label>
            <select id="frt-store-pick" className="frt-in" value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy || waitingChange}>
              <option value="">Pick a member village…</option>
              {d.memberVillages.map((v) => (
                <option key={v.villageId} value={v.villageId}>
                  {v.ownerName ?? 'Member'}: {v.name} ({formatCoords(v.x, v.y)})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="fv-btn fv-btn-g"
              disabled={busy || !pick || waitingChange}
              onClick={() =>
                void act(() => api.setStoreVillage(Number(pick))).then(() => {
                  setPick('');
                  setMoving(false);
                })
              }
            >
              {home ? 'Move here' : 'Set'}
            </button>
          </div>
        )}
        <div className="frt-sbb">
          <button type="button" className="fv-btn fv-btn-g" disabled={!!giveReason || !home} onClick={() => home && showOnMap(home.x, home.y, { ship: true })}>
            Send resources
          </button>
          {d.canManage && home && (
            <button type="button" className="fv-btn" aria-expanded={moving} disabled={busy || waitingChange} onClick={() => setMoving((m) => !m)}>
              Move store
            </button>
          )}
          {waitingChange && d.storeVillageChangeableAt !== null && <span className="fv-mut">next {landsAt(d.storeVillageChangeableAt, now)}</span>}
        </div>
        {actionError && <p className="form-error" role="alert">{actionError}</p>}
      </div>
    </section>
  );
}

function ProjectCard({ p, d, busy, act, cancel, now }: { p: TribeProjectOptionDto; d: TribeProjectsResponse; busy: boolean; act: (fn: () => Promise<TribeProjectsResponse>) => Promise<void>; cancel: () => Promise<void>; now: number }) {
  const reason = startReason(d, p);
  const nowE = shortEffect(p.project, p.effectNow);
  const next = p.effectNext !== null ? shortNext(p.project, p.effectNext) : null;
  const maxed = p.nextCost === null;
  const run = d.running && d.running.project === p.project ? d.running : null;
  return (
    <li className="frt-pj">
      <div className="frt-pjh">
        <Icon name={PROJECT_ICON[p.project]} size={30} />
        <b>{PROJECT_NAME[p.project]}</b>
        <span className="frt-pips" role="img" aria-label={`Level ${p.level} of ${p.maxLevel}`}>
          {Array.from({ length: p.maxLevel }, (_, i) => (
            <i key={i} className={i < p.level ? 'on' : undefined} />
          ))}
        </span>
        <span className="fv-mut">level {p.level} of {p.maxLevel}</span>
        {maxed && <span className="frt-lvl">Max</span>}
      </div>
      <p className="frt-pje">
        <span>
          Now <b>{nowE.value}</b> {nowE.label}
        </span>
        {next && (
          <span className="frt-pjn">
            Next <b>{next}</b>
          </span>
        )}
      </p>
      {run && (
        <div className="frt-run">
          <span>Building level {run.level}</span>
          <span className="frt-prog2" role="img" aria-label="Project progress">
            <i style={{ width: `${Math.max(0, Math.min(1, (now - run.startedAt) / Math.max(1, run.endsAt - run.startedAt))) * 100}%` }} />
          </span>
          <span className="frt-cd is-dark">{run.endsAt > now ? formatDuration(run.endsAt - now) : 'finishing…'}</span>
          {d.canManage && (
            <button type="button" className="fv-btn" disabled={busy} onClick={() => void cancel()}>
              Cancel
            </button>
          )}
        </div>
      )}
      {!run && p.nextCost && (
        <div className="frt-pjc">
          <span className="frt-cost">
            {RESOURCE_IDS.map((r) => (
              <span key={r}>
                <Icon name={RESOURCE_ICON[r]} size={20} />
                <span className="visually-hidden">{RESOURCE_NAME[r]} </span>
                <b title={formatInt(p.nextCost?.[r] ?? 0)}>{formatCompact(p.nextCost?.[r] ?? 0)}</b>
              </span>
            ))}
            {p.nextBuildMs !== null && (
              <span>
                <Icon name="time" size={20} />
                <b>{formatDuration(p.nextBuildMs)}</b>
              </span>
            )}
          </span>
          <span className="fv-sp" />
          {d.canManage && (
            <button type="button" className="fv-btn" disabled={busy || !!reason} title={reason ?? undefined} onClick={() => void act(() => api.startProject(p.project))}>
              Build level {p.level + 1}
            </button>
          )}
        </div>
      )}
      {!run && reason && !maxed && d.canManage && !d.running && <p className="frt-why">{reason}</p>}
    </li>
  );
}

function Ledger({ d, tribe, now }: { d: TribeProjectsResponse; tribe: MemberProps['tribe']; now: number }) {
  const chieftain = (id: number) => tribe.memberList.find((m) => m.playerId === id)?.chieftain;
  return (
    <section className="fv-pn frt-led" aria-label="Who gave">
      <div className="fv-ph frt-ph">
        <h2>Who gave</h2>
      </div>
      {d.totals.length === 0 ? (
        <p className="fv-empty frt-pad">Nobody has given yet.</p>
      ) : (
        <>
          <table className="frt-lt">
            <caption className="visually-hidden">Totals</caption>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col" className="n">Total</th>
              </tr>
            </thead>
            <tbody>
              {d.totals.slice(0, LEDGER_TOTALS_SHOWN).map((t) => (
                <tr key={t.player.id}>
                  <td>
                    <span className="frt-pl">
                      {chieftain(t.player.id) ? <ChieftainAvatar id={chieftain(t.player.id)} size={26} className="frt-av" /> : <span className="frt-noav" aria-hidden="true" />}
                      {t.player.name}
                    </span>
                  </td>
                  <td className="n"><b>{formatInt(t.total)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.ledger.length > 0 && (
            <table className="frt-lt">
              <caption className="visually-hidden">Recent gifts</caption>
              <thead>
                <tr>
                  <th scope="col">Latest</th>
                  <th scope="col" className="n">Amount</th>
                  <th scope="col" className="n">When</th>
                </tr>
              </thead>
              <tbody>
                {d.ledger.slice(0, LEDGER_LATEST_SHOWN).map((e, i) => (
                  <tr key={`${e.at}-${e.player.id}-${i}`}>
                    <td>{e.player.name}</td>
                    <td className="n">{formatInt(RESOURCE_IDS.reduce((s, r) => s + e.resources[r], 0))}</td>
                    <td className="n fv-mut">{formatAgo(e.at, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

export function FrameTribeProjects({ tribe }: MemberProps) {
  const { d, error, actionError, busy, load, act, cancel, now } = useTribeProjects();
  if (!d) {
    return (
      <div className="frt-two">
        <section className="fv-pn frt-grow">
          <div className="fv-ph frt-ph"><h2>Projects</h2></div>
          {error ? (
            <p className="form-error frt-pad" role="alert">
              {error}{' '}
              <button type="button" className="fv-lk" onClick={() => void load()}>
                Try again
              </button>
            </p>
          ) : (
            <p className="fv-empty frt-pad" role="status">Loading projects…</p>
          )}
        </section>
      </div>
    );
  }
  return (
    <div className="frt-three">
      <StorePanel d={d} act={act} busy={busy} actionError={actionError} now={now} />
      <section className="fv-pn frt-pjs" aria-label="Projects">
        <div className="fv-ph frt-ph">
          <h2>Projects</h2>
          <span className="fv-sp" />
          <span className="fv-mut">{d.canManage ? 'one project at a time' : 'leaders start projects'}</span>
        </div>
        <ul className="frt-pjl">
          {d.projects.map((p) => (
            <ProjectCard key={p.project} p={p} d={d} busy={busy} act={act} cancel={cancel} now={now} />
          ))}
        </ul>
      </section>
      <Ledger d={d} tribe={tribe} now={now} />
    </div>
  );
}
