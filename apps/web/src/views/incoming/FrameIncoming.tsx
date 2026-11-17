// The Incoming-attack page (route `#incoming`): every attack on one of MY villages in one place, grouped by the village it hits, with the
// ways to answer: recruit defenders, send support, ship the stock away, ask the tribe. One component for desktop (the fixed 1440 x 900
// frame, nothing scrolls: pages of eight lines) and phone (the page scrolls, 44 px buttons). Attacks on tribe-mates stay in Tribe > Alerts.
//
// Data: own attacks come from `movements` (units hidden); the tribe alert feed adds the attacker's tribe tag and the Watchtower size
// (src/incoming.ts merges them). Never shows troop counts or the attacker's chosen siege target.
// Styles: src/frame-incoming.css, imported by Game.tsx (no CSS import here, so the tests can render the page).

import { UNITS } from '@clanfire/engine';
import type { TribeAlertDto } from '@clanfire/engine';
import { useMemo, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { Icon } from '../../art/Icon.tsx';
import { PageHeader } from '../../components/PageHeader.tsx';
import { formatClock, formatDuration } from '../../format.ts';
import { useGame } from '../../game.ts';
import { useAlertFeed } from '../../hooks/useAlertFeed.ts';
import { useIsDesktop } from '../../hooks/useLayout.ts';
import { useLock } from '../../hooks/useLock.ts';
import { knownAttacks } from '../../incoming.ts';
import type { KnownAttack } from '../../incoming.ts';
import { groupLine, groupByVillage, ownAttacks, pageChunks, pickOtherVillage, sizeClass, sizeText, tribeHelpText, villageSpot } from './incoming-logic.ts';
import type { PageChunk } from './incoming-logic.ts';

/** The route component: the tribe alert feed is only fetched for players in a tribe. */
export function FrameIncoming() {
  const { player } = useGame();
  const { alerts, error } = useAlertFeed(!!player.tribe);
  return <IncomingBody alerts={alerts} feedError={player.tribe ? error : null} />;
}

/** The page for a given alert feed (null = none: no tribe, or not loaded yet). Split from the data hook so tests render it directly. */
export function IncomingBody({ alerts, feedError }: { alerts: TribeAlertDto[] | null; feedError: string | null }) {
  const { now, movements, villages, player, navigate } = useGame();
  const desktop = useIsDesktop();
  const [page, setPage] = useState(0);
  const attacks = useMemo(() => {
    const ids = new Set(villages.map((v) => v.id));
    return ownAttacks(knownAttacks(movements, alerts, ids), now);
  }, [movements, alerts, villages, now]);
  const pages = useMemo(() => pageChunks(groupByVillage(attacks)), [attacks]);
  const pageNo = Math.min(page, Math.max(0, pages.length - 1));
  const shown = pages[pageNo] ?? [];
  const attackedIds = useMemo(() => new Set(attacks.map((a) => a.target.villageId)), [attacks]);
  const villageCount = new Set(attacks.map((a) => a.target.villageId)).size;
  const countText = attacks.length > 0 ? `${attacks.length}` : '';

  const tribeLink = player.tribe ? (
    <button type="button" className="fin-link" onClick={() => navigate('tribe')}>
      Tribe alerts
    </button>
  ) : null;

  return (
    <div className={`fin${desktop ? ' is-desktop' : ' is-phone'}`}>
      {desktop ? (
        <section className="fv-pn fin-pn" aria-label="Incoming attacks">
          <div className="fv-ph fin-ph">
            <h2>Incoming attacks</h2>
            {countText && <span className="fin-cnt" aria-label={`${attacks.length} ${attacks.length === 1 ? 'attack' : 'attacks'} on ${villageCount} ${villageCount === 1 ? 'village' : 'villages'}`}>{countText}</span>}
            <span className="fv-sp" />
            <span className="fin-hint">Attacks on your villages only.</span>
            {tribeLink}
          </div>
          <Body attacks={attacks} shown={shown} attackedIds={attackedIds} pageNo={pageNo} pageCount={pages.length} onPage={setPage} feedError={feedError} desktop />
        </section>
      ) : (
        <div className="page fin-page">
          <PageHeader icon="warning" title="Incoming attacks" count={countText || undefined} actions={tribeLink}>
            <p className="muted small">Attacks on your villages only.</p>
          </PageHeader>
          <Body attacks={attacks} shown={shown} attackedIds={attackedIds} pageNo={pageNo} pageCount={pages.length} onPage={setPage} feedError={feedError} desktop={false} />
        </div>
      )}
    </div>
  );
}

function Body({ attacks, shown, attackedIds, pageNo, pageCount, onPage, feedError, desktop }: { attacks: KnownAttack[]; shown: PageChunk[]; attackedIds: ReadonlySet<number>; pageNo: number; pageCount: number; onPage: (p: number) => void; feedError: string | null; desktop: boolean }) {
  return (
    <div className="fin-body">
      {feedError && (
        <p className="fin-note" role="status">
          The tribe feed could not be loaded, so sizes may be missing.
        </p>
      )}
      {attacks.length === 0 && (
        <p className="fin-empty" role="status">
          No attacks on the way. All quiet.
        </p>
      )}
      {shown.map((chunk) => (
        <VillageBlock key={`${chunk.village.villageId}-${chunk.continued ? 'c' : 'f'}`} chunk={chunk} attackedIds={attackedIds} desktop={desktop} />
      ))}
      {pageCount > 1 && (
        <nav className="fin-pager" aria-label="Pages of incoming attacks">
          <button type="button" className="fin-pg" disabled={pageNo <= 0} onClick={() => onPage(pageNo - 1)}>
            Previous
          </button>
          <span className="fin-pgn" aria-live="polite">
            Page {pageNo + 1} of {pageCount}
          </span>
          <button type="button" className="fin-pg" disabled={pageNo >= pageCount - 1} onClick={() => onPage(pageNo + 1)}>
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

/** One village heading (name, how many attacks, the soonest landing, the answers) and its attack rows. */
function VillageBlock({ chunk, attackedIds, desktop }: { chunk: PageChunk; attackedIds: ReadonlySet<number>; desktop: boolean }) {
  const { now } = useGame();
  const { village } = chunk;
  return (
    <section className="fin-vg" aria-label={`Attacks on ${village.name}`}>
      <header className="fin-gh">
        <span className="fin-gt">
          <b>
            {village.name} <span className="fin-xy">{villageSpot(village)}</span>
            {chunk.continued && <span className="fin-cont"> (continued)</span>}
          </b>
          <small>{groupLine(chunk.total, chunk.soonestAt, now)}</small>
        </span>
        <Actions chunk={chunk} attackedIds={attackedIds} desktop={desktop} />
      </header>
      <ul className="fin-rows">
        {chunk.attacks.map((a) => (
          <AttackRow key={a.movementId} a={a} />
        ))}
      </ul>
    </section>
  );
}

function AttackRow({ a }: { a: KnownAttack }) {
  const { now, showOnMap } = useGame();
  const left = a.arriveAt - now;
  const owner = a.attacker.ownerName ?? 'Unknown';
  const slowest = a.slowestUnit ? UNITS[a.slowestUnit].name : null;
  return (
    <li className="fin-row" aria-label={`Attack from ${owner}, lands ${formatClock(a.arriveAt, now)}`}>
      <span className="fin-tag">Attack</span>
      <span className="fin-who">
        <b>
          {owner}
          {a.attackerTribeTag ? <span className="fin-ttag"> [{a.attackerTribeTag}]</span> : null}
        </b>
        <small>
          from{' '}
          <button type="button" className="fin-link" onClick={() => showOnMap(a.attacker.x, a.attacker.y)} title="Show on map">
            {a.attacker.name} {villageSpot(a.attacker)}
          </button>
        </small>
      </span>
      <span className="fin-size">
        <span className={`size-chip ${sizeClass(a.sizeBand)}`}>{sizeText(a)}</span>
        {slowest && <small>slowest: {slowest}</small>}
      </span>
      <span className="fin-when">
        <span className="fin-cd">{left > 0 ? formatDuration(left) : 'landing…'}</span>
        <small>lands {formatClock(a.arriveAt, now)}</small>
      </span>
    </li>
  );
}

/** The four answers for one village. Each jumps to an existing feature; nothing new is decided here. */
function Actions({ chunk, attackedIds, desktop }: { chunk: PageChunk; attackedIds: ReadonlySet<number>; desktop: boolean }) {
  const { villages, selectVillage, openBuilding, showOnMap, player } = useGame();
  const btn = desktop ? 'fv-btn' : 'btn';
  const { village } = chunk;
  const other = pickOtherVillage(villages, village, attackedIds);
  const otherVillage = villages.find((v) => v.id === other) ?? null;
  const noOther = otherVillage === null;
  return (
    <div className="fin-acts">
      <button
        type="button"
        className={`${btn} ${desktop ? 'fv-btn-g' : 'btn-primary'}`}
        onClick={() => {
          selectVillage(village.villageId);
          openBuilding('barracks');
        }}
      >
        Recruit defenders
      </button>
      <button
        type="button"
        className={btn}
        disabled={noOther}
        title={noOther ? 'No other village to send from' : undefined}
        onClick={() => {
          // The send form sends from the current village: make it another one of mine, then open the attacked village on the map in Support mode.
          if (otherVillage) selectVillage(otherVillage.id);
          showOnMap(village.x, village.y, { mission: 'support' });
        }}
      >
        Send support
      </button>
      <button
        type="button"
        className={btn}
        disabled={noOther}
        title={noOther ? 'No other village to ship to' : undefined}
        onClick={() => {
          // The shipment form sends from the current village: make the attacked one current and open the form on another village of mine.
          if (!otherVillage) return;
          selectVillage(village.villageId);
          showOnMap(otherVillage.x, otherVillage.y, { ship: true });
        }}
      >
        Ship resources away
      </button>
      {player.tribe && <TribeHelp chunk={chunk} btn={btn} />}
      {noOther && (
        <span className="fin-why" role="note">
          No other village to send from
        </span>
      )}
    </div>
  );
}

/** Posts one ready-made line to the tribe chat (api.sendChat). The lock refuses a second press while the first is on its way. */
function TribeHelp({ chunk, btn }: { chunk: PageChunk; btn: string }) {
  const { now } = useGame();
  const lock = useLock();
  const [state, setState] = useState<{ kind: 'sent' } | { kind: 'error'; message: string } | null>(null);
  async function ask() {
    if (!lock.begin()) return;
    setState(null);
    try {
      await api.sendChat(tribeHelpText(chunk.village, chunk.all, now));
      setState({ kind: 'sent' });
    } catch (e) {
      setState({ kind: 'error', message: errorMessage(e) });
    } finally {
      lock.end();
    }
  }
  return (
    <>
      <button type="button" className={`${btn} fin-ask`} disabled={lock.busy} onClick={() => void ask()}>
        {lock.busy ? 'Posting…' : 'Ask the tribe for help'}
      </button>
      {state?.kind === 'sent' && (
        <span className="fin-ok" role="status">
          <Icon name="shield" size={16} /> Posted to tribe chat.
        </span>
      )}
      {state?.kind === 'error' && (
        <span className="fin-err" role="alert">
          {state.message}
        </span>
      )}
    </>
  );
}
