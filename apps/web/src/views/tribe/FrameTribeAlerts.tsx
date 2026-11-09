// The Alerts sub-tab of the desktop Tribe page (picture: design/proposals/ingame-pages/mix-tribe-alerts-1440.png): incoming attacks on
// members (4 per page, soonest first), held villages with the hearth out, what the Watchtower shows, and the Lookout when sites are on.

import { UNITS } from '@clanfire/engine';
import type { LookoutSightingDto, TribeAlertDto, TribeHoldDto } from '@clanfire/engine';
import { Icon } from '../../art/Icon.tsx';
import { formatCoords, formatDuration } from '../../format.ts';
import { useGame, useRules } from '../../game.ts';
import { useSightings } from '../../hooks/useSightings.ts';
import { LOOKOUT_NONE_HELD, LOOKOUT_NONE_SEEN, SIZE_LABEL, sightingWho } from '../../tribe/Lookout.tsx';
import { holdText } from '../../villages.ts';
import { RELIEF_LABEL, alertCount } from '../../villages.ts';
import { ALERTS_PER_PAGE, HOLDS_PER_PAGE, landsAt, watchtowerSteps } from './frame-tribe-logic.ts';
import { PageButtons, usePaged } from './frame-tribe-bits.tsx';
import { useAlertFeed } from './FrameTribeOverview.tsx';
import type { TribeSection } from './FrameTribeOverview.tsx';

function chips(a: TribeAlertDto, level: number): string[] {
  const out: string[] = [];
  if (a.sizeBand) out.push(`${a.sizeBand} army${a.sizeAbout !== undefined && a.sizeAbout > 0 ? ` ~${a.sizeAbout.toLocaleString('en-US')}` : ''}`);
  if (a.slowestUnit) out.push(`slowest: ${UNITS[a.slowestUnit].name}`);
  if (out.length === 0 && level <= 0) out.push('No Watchtower');
  return out;
}

function AttackCard({ a, level }: { a: TribeAlertDto; level: number }) {
  const { now, villages, showOnMap, viewMovement } = useGame();
  const mine = villages.some((v) => v.id === a.target.villageId);
  const owner = mine ? 'you' : (a.target.ownerName ?? 'member');
  const left = a.arriveAt - now;
  const total = Math.max(1, a.arriveAt - a.departAt);
  const ratio = Math.max(0, Math.min(1, (now - a.departAt) / total));
  return (
    <article className="frt-ac" aria-label={`Attack on ${owner}, ${a.target.name}, lands ${landsAt(a.arriveAt, now)}`}>
      <span className="frt-tg">Attack</span>
      <div className="frt-acm">
        <b>
          On {owner} ·{' '}
          <button type="button" className="fv-lk frt-lkb" onClick={() => showOnMap(a.target.x, a.target.y)}>
            {a.target.name} ({formatCoords(a.target.x, a.target.y)})
          </button>
        </b>
        <small>
          from {a.attacker.ownerName ?? 'unknown'}
          {a.attackerTribeTag ? ` [${a.attackerTribeTag}]` : ''} · {a.attacker.name} ({formatCoords(a.attacker.x, a.attacker.y)})
        </small>
        <span className="frt-chips">
          {chips(a, level).map((c) => (
            <span key={c} className="frt-chip">{c}</span>
          ))}
        </span>
      </div>
      <span className="frt-alc">
        <span className="frt-alr">
          {mine ? (
            <button type="button" className="fv-btn" onClick={() => viewMovement(a.movementId)}>
              Army
            </button>
          ) : (
            <button type="button" className="fv-btn fv-btn-g" onClick={() => showOnMap(a.target.x, a.target.y, { mission: 'support' })}>
              Support
            </button>
          )}
          <span className="frt-cd">{left > 0 ? formatDuration(left) : 'landing…'}</span>
        </span>
        <small>lands {landsAt(a.arriveAt, now)}</small>
      </span>
      <span className="frt-prog" role="img" aria-label="Attack progress">
        <i style={{ width: `${ratio * 100}%` }} />
      </span>
    </article>
  );
}

function HoldRow({ h }: { h: TribeHoldDto }) {
  const { now, villages, showOnMap, selectVillage, navigate } = useGame();
  const mine = villages.some((v) => v.id === h.village.villageId);
  const owner = mine ? 'You' : (h.village.ownerName ?? 'Member');
  return (
    <div className="frt-hold">
      <span className="frt-hi" aria-hidden="true">
        <Icon name="flame" size={26} />
      </span>
      <span className="frt-holdt">
        <b>
          {owner} · {h.village.name} ({formatCoords(h.village.x, h.village.y)})
        </b>
        <small>{holdText(h.hearth, now)}</small>
        <span className="frt-holdb">
          <button type="button" className="fv-lk frt-lkb" onClick={() => showOnMap(h.village.x, h.village.y)}>
            Map
          </button>
          {mine ? (
            <button
              type="button"
              className="fv-btn"
              onClick={() => {
                selectVillage(h.village.villageId);
                navigate('village');
              }}
            >
              Village
            </button>
          ) : (
            <>
              <button type="button" className="fv-btn" onClick={() => showOnMap(h.village.x, h.village.y, { mission: 'support' })}>
                Support
              </button>
              <button type="button" className="fv-btn" onClick={() => showOnMap(h.village.x, h.village.y, { mission: 'attack' })}>
                {RELIEF_LABEL}
              </button>
            </>
          )}
        </span>
      </span>
    </div>
  );
}

function Watchtower({ level, onOpen }: { level: number; onOpen: (s: TribeSection) => void }) {
  return (
    <section className="fv-pn frt-wt" aria-label="Watchtower">
      <div className="fv-ph frt-ph">
        <h2>Watchtower</h2>
        <span className="frt-lvl">{level > 0 ? `Level ${level}` : 'Not built'}</span>
        <span className="fv-sp" />
        {level < 3 && (
          <button type="button" className="fv-lk" onClick={() => onOpen('projects')}>
            Projects
          </button>
        )}
      </div>
      <ol className="frt-steps">
        {watchtowerSteps(level).map((s) => (
          <li key={s.n} className={s.on ? 'is-on' : undefined}>
            <i aria-hidden="true">{s.n}</i>
            <span>
              {s.text}
              <span className="visually-hidden">{s.on ? ' (built)' : ' (not built yet)'}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function LookoutPanel({ shown }: { shown: number }) {
  const { now, showOnMap } = useGame();
  const { sightings, lookouts } = useSightings(true);
  const live = sightings.filter((s: LookoutSightingDto) => s.arriveAt > now - 1500);
  return (
    <section className="fv-pn frt-lo" aria-label="Lookout">
      <div className="fv-ph frt-ph">
        <h2>Lookout</h2>
        <span className="frt-lvl">{lookouts} held</span>
      </div>
      {lookouts <= 0 && <p className="fv-empty frt-pad">{LOOKOUT_NONE_HELD}</p>}
      {lookouts > 0 && live.length === 0 && <p className="fv-empty frt-pad">{LOOKOUT_NONE_SEEN}</p>}
      {live.slice(0, shown).map((s) => {
        const left = s.arriveAt - now;
        return (
          <button key={s.movementId} type="button" className="frt-sight" title={`Seen by ${s.lookoutName}`} onClick={() => showOnMap(s.to.x, s.to.y)}>
            <span className={`frt-tg${s.mission === 'attack' ? '' : ' is-info'}`}>{s.mission === 'attack' ? 'Attack' : 'Support'}</span>
            <span className="frt-holdt">
              <b>{sightingWho(s)}</b>
              <small>
                to {s.to.name} · {SIZE_LABEL[s.size]} · lands {landsAt(s.arriveAt, now)}
              </small>
            </span>
            <span className="frt-cd">{left > 0 ? formatDuration(left) : 'landing…'}</span>
          </button>
        );
      })}
      {live.length > shown && <p className="fv-empty frt-pad">+{live.length - shown} more armies seen</p>}
    </section>
  );
}

export function FrameTribeAlerts({ onOpen }: { onOpen: (s: TribeSection) => void }) {
  const { alerts, holds, level, error, retry } = useAlertFeed();
  const sitesOn = useRules().features.sites;
  const attacks = alerts ?? [];
  const att = usePaged(attacks, ALERTS_PER_PAGE);
  const hold = usePaged(holds, sitesOn ? 1 : HOLDS_PER_PAGE);
  const count = alertCount(alerts, holds);
  return (
    <div className="frt-two">
      <section className="fv-pn frt-grow" aria-label="Incoming attacks">
        <div className="fv-ph frt-ph">
          <h2>Incoming attacks on members</h2>
          {attacks.length > 0 && <span className="frt-cnt is-red" aria-label={`${attacks.length} attacks`}>{attacks.length}</span>}
          <span className="fv-sp" />
          <span className="fv-mut">soonest first</span>
          {att.paged && <PageButtons page={att.pg.page} pages={att.pg.pages} onPage={att.setPage} label="attacks" />}
        </div>
        <div className="frt-cards">
          {error && (
            <p className="form-error" role="alert">
              {error}{' '}
              <button type="button" className="fv-lk" onClick={retry}>
                Retry
              </button>
            </p>
          )}
          {alerts === null && !error && <p className="fv-empty" role="status">Loading…</p>}
          {alerts !== null && count === 0 && <p className="fv-empty frt-quiet">No attacks on the way. All quiet.</p>}
          {alerts !== null && attacks.length === 0 && count > 0 && <p className="fv-empty frt-quiet">No attacks on the way, but a village has its hearth out.</p>}
          {att.slice.map((a) => (
            <AttackCard key={a.movementId} a={a} level={level} />
          ))}
        </div>
      </section>
      <div className="frt-side frt-side-a">
        {holds.length > 0 && (
          <section className="fv-pn" aria-label="Hearth out">
            <div className="fv-ph frt-ph">
              <h2>Hearth out</h2>
              <span className="frt-cnt">{holds.length}</span>
              <span className="fv-sp" />
              {hold.paged && <PageButtons page={hold.pg.page} pages={hold.pg.pages} onPage={hold.setPage} label="villages" />}
            </div>
            {hold.slice.map((h) => (
              <HoldRow key={h.village.villageId} h={h} />
            ))}
          </section>
        )}
        <Watchtower level={level} onOpen={onOpen} />
        {sitesOn && <LookoutPanel shown={holds.length > 0 ? 1 : 2} />}
      </div>
    </div>
  );
}
