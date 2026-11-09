// The desktop Ranks page inside the fixed 1440 x 900 frame (owner pick "B · List + your card", design/proposals/ingame-pages/b-ranks-1440.png):
// header (title, Players / Tribes / Renown, search, sample switch), one 20-row table on the left with paging, and on the right
// the "You" card, Top three and the Domination bar. Same data, search, paging and pop-ups as the phone's RankingsView. Phones keep RankingsView.

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { PlayerProfileDto, PlayerRankDto, PlayerRankingResponse, RenownRankDto, RenownRankingResponse, TribeSummaryDto } from '@clanfire/engine';
import { api, errorMessage } from '../../api.ts';
import { ChieftainAvatar } from '../../art/Chieftain.tsx';
import { Icon } from '../../art/Icon.tsx';
import { DominationBar } from '../../components/DominationBar.tsx';
import { barWidth, dominationHeadline, leaderLine, percentText } from '../../domination.ts';
import { formatInt } from '../../format.ts';
import { useGame, useRules } from '../../game.ts';
import { useDomination } from '../../hooks/useDomination.ts';
import { Dialog } from '../army/FrameArmy.tsx';
import { ProfileExtras } from '../ProfileExtras.tsx';
import { makeSample } from '../rankingsSample.ts';
import { paging, pageSlice } from '../reports/frame-reports-logic.ts';
import { Chev } from '../village/FrameParts.tsx';
import { RANKS_PER_PAGE, RANK_SECTIONS, averagePoints, pageItems, pageOfIndex, playerRows, renownRows, searchPlayers, searchTribes, tribeRows } from './frame-ranks-logic.ts';
import type { RankSection } from './frame-ranks-logic.ts';
import { TopThree } from './TopThree.tsx';
import type { TopThreeItem } from './TopThree.tsx';
import '../../frame-ranks.css';

/** Remembered while the player moves between tabs (like the phone page). */
let lastSection: RankSection = 'players';
let lastSample: boolean | null = null;

function Medal({ rank }: { rank: number }) {
  if (rank > 3) return <span className="frk-rn">{rank}</span>;
  return (
    <span className={`frk-md g${rank}`} aria-label={`Rank ${rank}`}>
      {rank}
    </span>
  );
}

// ---- Pop-up of a pressed player or tribe ------------------------------------------------------------------------------

interface PopData {
  title: string;
  subtitle: string;
  facts: Array<[string, string]>;
  actions: Array<{ label: string; disabled?: boolean; onClick: () => void }>;
  extra?: ReactNode;
  note?: string;
}

function Pop({ data, onClose }: { data: PopData; onClose: () => void }) {
  return (
    <Dialog title={data.title} onClose={onClose}>
      <div className="frk-pop">
        <p className="frk-pop-sub">{data.subtitle}</p>
        <dl className="frk-pop-facts">
          {data.facts.map(([k, v]) => (
            <div key={k}>
              <dt className="fv-up">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {data.extra}
        <div className="frk-pop-act">
          {data.actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className="fv-btn"
              disabled={a.disabled}
              onClick={() => {
                onClose();
                a.onClick();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
        {data.note && <p className="frk-pop-note">{data.note}</p>}
      </div>
    </Dialog>
  );
}

// ---- Left: the table ---------------------------------------------------------------------------------------------------

function Pager({ page, pages, onPage, summary }: { page: number; pages: number; onPage: (p: number) => void; summary: string }) {
  return (
    <nav className="frk-pgr" aria-label="Pages">
      <span className="fv-mut frk-sum">{summary}</span>
      <span className="fv-sp" />
      <button type="button" className="fv-pg" aria-label="Previous page" disabled={page <= 0} onClick={() => onPage(page - 1)}>
        <Chev flip size={16} />
      </button>
      {pageItems(page, pages).map((it, i) =>
        it === 'gap' ? (
          <span key={`g${i}`} className="frk-gap" aria-hidden="true">…</span>
        ) : (
          <button key={it} type="button" className={`fv-pg frk-pn${it === page ? ' on' : ''}`} aria-current={it === page ? 'page' : undefined} aria-label={`Page ${it + 1}`} onClick={() => onPage(it)}>
            {it + 1}
          </button>
        ),
      )}
      <button type="button" className="fv-pg" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
        <Chev size={16} />
      </button>
    </nav>
  );
}

function TribeTag({ tribe, onOpen }: { tribe: { id: number; tag: string } | null; onOpen: (id: number) => void }) {
  if (!tribe) return <span className="fv-mut">—</span>;
  if (tribe.id <= 0) return <span className="frk-ttl">[{tribe.tag}]</span>;
  return (
    <button type="button" className="frk-lk frk-ttl" onClick={(e) => { e.stopPropagation(); onOpen(tribe.id); }}>
      [{tribe.tag}]
    </button>
  );
}

function Table({ cols, empty, children }: { cols: Array<{ label: string; cls?: string }>; empty: string | null; children: ReactNode }) {
  return (
    <div className="frk-tw">
      {empty ? (
        <p className="frk-empty">{empty}</p>
      ) : (
        <table className="frk-t">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.label} scope="col" className={c.cls}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      )}
    </div>
  );
}

const sumText = (from: number, to: number, total: number, tail: string) => (total === 0 ? `0 ${tail}` : `${from}–${to} of ${formatInt(total)} ${tail}`);

// ---- The page ----------------------------------------------------------------------------------------------------------

export function FrameRanks() {
  const { viewTribe, showOnMap, composeMail, player } = useGame();
  const maxMembers = useRules().tribe.maxMembers;
  const meId = player.id;
  const [section, setSection] = useState<RankSection>(lastSection);
  const [players, setPlayers] = useState<PlayerRankingResponse | null>(null);
  const [tribes, setTribes] = useState<TribeSummaryDto[] | null>(null);
  const [renown, setRenown] = useState<RenownRankingResponse | null>(null);
  const [renownError, setRenownError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sampleOn, setSampleOn] = useState<boolean | null>(lastSample);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<{ kind: 'player' | 'tribe'; id: number } | null>(null);
  const [domOpen, setDomOpen] = useState(false);
  const [me, setMe] = useState<PlayerProfileDto | null>(null);
  const sample = useMemo(makeSample, []);
  const dom = useDomination();

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.playerRanking(), api.tribes('')])
      .then(([p, t]) => {
        if (cancelled) return;
        setPlayers(p);
        setTribes(t.tribes);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The Renown list loads when its tab is first opened.
  useEffect(() => {
    if (section !== 'renown' || renown) return;
    let cancelled = false;
    setRenownError(null);
    api
      .renownRanking()
      .then((r) => {
        if (!cancelled) setRenown(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setRenownError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [section, renown]);

  // My own profile: Renown, joined date, protection, tribe role (the You card).
  useEffect(() => {
    let cancelled = false;
    api
      .playerProfile(meId)
      .then((p) => {
        if (!cancelled) setMe(p);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [meId]);

  // The pop-up's profile (real players only).
  const [profile, setProfile] = useState<PlayerProfileDto | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const pickedPlayer = picked?.kind === 'player' ? picked.id : null;
  useEffect(() => {
    setProfile(null);
    setProfileError(null);
    if (pickedPlayer === null || pickedPlayer < 0) return;
    let cancelled = false;
    api
      .playerProfile(pickedPlayer)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((e: unknown) => {
        if (!cancelled) setProfileError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [pickedPlayer]);

  // Default: sample data on while the world is still small, so there is something to browse.
  const showSample = sampleOn ?? (players !== null && players.total < 15);
  const samplePlayers = showSample ? sample.players : null;

  const playerAll = useMemo(() => (players ? playerRows(players, samplePlayers) : []), [players, samplePlayers]);
  const tribeAll = useMemo(() => (tribes ? tribeRows(tribes, showSample ? sample.tribes : null) : []), [tribes, showSample, sample]);
  const renownAll = useMemo(() => (renown ? renownRows(renown, samplePlayers) : []), [renown, samplePlayers]);

  const pRows = useMemo(() => searchPlayers(playerAll, query), [playerAll, query]);
  const tRows = useMemo(() => searchTribes(tribeAll, query), [tribeAll, query]);
  const rRows = useMemo(() => searchPlayers(renownAll, query), [renownAll, query]);
  const rows: Array<PlayerRankDto | TribeSummaryDto | RenownRankDto> = section === 'players' ? pRows : section === 'tribes' ? tRows : rRows;
  const pg = paging(rows.length, page, RANKS_PER_PAGE);

  const myTribeId = player.tribe?.id ?? null;
  const myRow = playerAll.find((p) => p.playerId === meId) ?? null;
  const myRenownRow = renownAll.find((p) => p.playerId === meId) ?? null;
  const pageLoading = section === 'renown' ? !renown && !renownError : !players || !tribes;
  const failure = section === 'renown' ? renownError : error;

  const switchSection = (s: RankSection) => {
    lastSection = s;
    setSection(s);
    setQuery('');
    setPage(0);
  };

  /** Show the page with my own row (clears a search that would hide it). */
  const jumpToMe = () => {
    setQuery('');
    const list = section === 'players' ? playerAll : section === 'tribes' ? tribeAll : renownAll;
    const idx = list.findIndex((r) => ('playerId' in r ? r.playerId === meId : r.id === myTribeId));
    if (idx >= 0) setPage(pageOfIndex(idx));
  };
  const canJump = section === 'tribes' ? tribeAll.some((t) => t.id === myTribeId) : section === 'players' ? myRow !== null : myRenownRow !== null;

  // ---- pop-up ----
  let pop: PopData | null = null;
  if (picked?.kind === 'player') {
    const row = playerAll.find((p) => p.playerId === picked.id) ?? null;
    if (row) {
      const prof = profile && profile.playerId === picked.id ? profile : null;
      const mine = row.playerId === meId;
      pop = {
        title: row.username,
        subtitle: mine ? 'This is you' : row.tribe ? `Member of [${row.tribe.tag}]` : 'No tribe',
        facts: [
          ['Rank', `#${row.rank}`],
          ['Points', formatInt(row.points)],
          ['Villages', String(row.villages)],
          ['Tribe', prof?.tribe ? `${prof.tribe.name} [${prof.tribe.tag}] · ${prof.tribe.role}` : row.tribe ? `[${row.tribe.tag}]` : '—'],
          ...(prof
            ? ([
                ['Renown', `${formatInt(prof.renown)} · #${prof.renownRank}`],
                ['Joined', new Date(prof.joinedAt).toLocaleDateString()],
                ['Protection', prof.protectedNow ? 'Beginner protection' : 'None'],
              ] as Array<[string, string]>)
            : []),
        ],
        actions: [
          { label: 'Show on map', disabled: row.playerId < 0, onClick: () => showOnMap(row.villageX, row.villageY) },
          ...(row.playerId > 0 && !mine ? [{ label: 'Send mail', onClick: () => composeMail(row.username) }] : []),
          ...(row.tribe && row.tribe.id > 0 ? [{ label: 'View tribe', onClick: () => viewTribe({ id: row.tribe!.id }) }] : []),
        ],
        extra: prof ? <ProfileExtras stats={prof.stats} achievements={prof.achievements} badges={prof.badges} worldBadges={prof.worldBadges} /> : undefined,
        note:
          row.playerId < 0
            ? 'Sample player: not a real account, so there is nothing to open.'
            : profileError
              ? profileError
              : prof
                ? prof.villages.slice(0, 5).map((v) => `${v.name} (${v.x}|${v.y})`).join(' · ') + (prof.villageCount > 5 ? ` · +${prof.villageCount - 5} more` : '')
                : 'Loading profile…',
      };
    }
  } else if (picked?.kind === 'tribe') {
    const t = tribeAll.find((x) => x.id === picked.id);
    if (t) {
      pop = {
        title: t.name,
        subtitle: `[${t.tag}]${t.id === myTribeId ? ' · your tribe' : ''}`,
        facts: [
          ['Rank', `#${t.rank}`],
          ['Points', formatInt(t.points)],
          ['Members', `${t.members}/${maxMembers}`],
          ['Villages', String(t.villages)],
          ['Avg. points', t.members ? formatInt(Math.round(t.points / t.members)) : '—'],
        ],
        actions: [{ label: 'Open tribe page', disabled: t.id < 0, onClick: () => viewTribe({ id: t.id }) }],
        note: t.id < 0 ? 'Sample tribe: not real, so there is no page to open.' : undefined,
      };
    }
  }

  // ---- table body ----
  let table: ReactNode = null;
  let summary = '';
  if (section === 'players') {
    const slice = pageSlice(pRows, page, RANKS_PER_PAGE);
    summary = sumText(pg.from, pg.to, pRows.length, `players${query.trim() ? '' : ` · average ${formatInt(averagePoints(playerAll))} points`}`);
    table = (
      <Table
        cols={[{ label: 'Rank', cls: 'c-r' }, { label: 'Player' }, { label: 'Tribe' }, { label: 'Villages', cls: 'n' }, { label: 'Points', cls: 'n' }]}
        empty={slice.length === 0 ? (query.trim() ? 'Nobody matches that search.' : 'No players yet.') : null}
      >
        {slice.map((p) => (
          <tr key={p.playerId} className={p.playerId === meId ? 'me' : undefined} aria-current={p.playerId === meId ? 'true' : undefined} onClick={() => setPicked({ kind: 'player', id: p.playerId })}>
            <td className="c-r"><Medal rank={p.rank} /></td>
            <td>
              <button type="button" className="frk-who" onClick={(e) => { e.stopPropagation(); setPicked({ kind: 'player', id: p.playerId }); }}>{p.username}</button>
              {p.playerId === meId && <span className="frk-you">you</span>}
            </td>
            <td><TribeTag tribe={p.tribe} onOpen={(id) => viewTribe({ id })} /></td>
            <td className="n">{p.villages}</td>
            <td className="n"><b>{formatInt(p.points)}</b></td>
          </tr>
        ))}
      </Table>
    );
  } else if (section === 'tribes') {
    const slice = pageSlice(tRows, page, RANKS_PER_PAGE);
    summary = sumText(pg.from, pg.to, tRows.length, 'tribes');
    table = (
      <Table
        cols={[{ label: 'Rank', cls: 'c-r' }, { label: 'Tribe' }, { label: 'Members', cls: 'n' }, { label: 'Villages', cls: 'n' }, { label: 'Avg. points', cls: 'n' }, { label: 'Points', cls: 'n' }]}
        empty={slice.length === 0 ? (query.trim() ? 'No tribe matches that search.' : 'No tribes yet.') : null}
      >
        {slice.map((t) => {
          const mine = t.id === myTribeId;
          return (
            <tr key={t.id} className={mine ? 'me' : undefined} aria-current={mine ? 'true' : undefined} onClick={() => setPicked({ kind: 'tribe', id: t.id })}>
              <td className="c-r"><Medal rank={t.rank} /></td>
              <td>
                <button type="button" className="frk-who" onClick={(e) => { e.stopPropagation(); setPicked({ kind: 'tribe', id: t.id }); }}>{t.name}</button>
                <span className="frk-ttl frk-tg">[{t.tag}]</span>
                {mine && <span className="frk-you">your tribe</span>}
              </td>
              <td className="n">{t.members}<span className="fv-mut">/{maxMembers}</span></td>
              <td className="n">{t.villages}</td>
              <td className="n">{t.members ? formatInt(Math.round(t.points / t.members)) : '—'}</td>
              <td className="n"><b>{formatInt(t.points)}</b></td>
            </tr>
          );
        })}
      </Table>
    );
  } else {
    const slice = pageSlice(rRows, page, RANKS_PER_PAGE);
    summary = sumText(pg.from, pg.to, rRows.length, 'players');
    table = (
      <Table
        cols={[{ label: 'Rank', cls: 'c-r' }, { label: 'Player' }, { label: 'Tribe' }, { label: 'Villages', cls: 'n' }, { label: 'Renown', cls: 'n' }]}
        empty={slice.length === 0 ? (query.trim() ? 'Nobody matches that search.' : 'Nobody has earned Renown yet.') : null}
      >
        {slice.map((p) => (
          <tr key={p.playerId} className={p.playerId === meId ? 'me' : undefined} aria-current={p.playerId === meId ? 'true' : undefined}>
            <td className="c-r"><Medal rank={p.rank} /></td>
            <td>
              <button type="button" className="frk-who" onClick={() => showOnMap(p.villageX, p.villageY)} aria-label={`${p.username}, show on the map`}>{p.username}</button>
              {p.playerId === meId && <span className="frk-you">you</span>}
            </td>
            <td><TribeTag tribe={p.tribe} onOpen={(id) => viewTribe({ id })} /></td>
            <td className="n">{p.villages}</td>
            <td className="n"><b>{formatInt(p.renown)}</b></td>
          </tr>
        ))}
      </Table>
    );
  }

  // ---- Top three (of the list shown, before any search) ----
  const top: TopThreeItem[] =
    section === 'players'
      ? playerAll.slice(0, 3).map((p) => ({ key: p.playerId, rank: p.rank, name: p.username, tag: p.tribe?.tag ?? null, value: formatInt(p.points), chieftain: p.playerId === meId ? player.chieftain : null }))
      : section === 'tribes'
        ? tribeAll.slice(0, 3).map((t) => ({ key: t.id, rank: t.rank, name: t.name, tag: t.tag, value: formatInt(t.points), tribe: true }))
        : renownAll.slice(0, 3).map((p) => ({ key: p.playerId, rank: p.rank, name: p.username, tag: p.tribe?.tag ?? null, value: formatInt(p.renown), chieftain: p.playerId === meId ? player.chieftain : null }));
  const pickTop = (key: number) => {
    if (section === 'players') setPicked({ kind: 'player', id: key });
    else if (section === 'tribes') setPicked({ kind: 'tribe', id: key });
    else {
      const r = renownAll.find((p) => p.playerId === key);
      if (r) showOnMap(r.villageX, r.villageY);
    }
  };

  // ---- You card ----
  const total = showSample ? playerAll.length : (players?.total ?? 0);
  const tribeLine = me?.tribe ? `${me.tribe.name} [${me.tribe.tag}]` : player.tribe ? `[${player.tribe.tag}]` : 'No tribe';
  const you: Array<[string, string]> = [
    ['Points', myRow ? formatInt(myRow.points) : '—'],
    ['Villages', myRow ? String(myRow.villages) : '—'],
    ['Renown', me ? `${formatInt(me.renown)} · #${me.renownRank}` : '—'],
    ['Tribe', me?.tribe ? `[${me.tribe.tag}] · ${me.tribe.role}` : player.tribe ? `[${player.tribe.tag}]` : 'None'],
    ['Joined', me ? new Date(me.joinedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'],
    ['Protection', me ? (me.protectedNow ? 'Beginner' : 'None') : '—'],
  ];

  return (
    <div className="frk">
      <div className="frk-head">
        <span className="frk-tk" aria-hidden="true">
          <Icon name="ranks" size={28} />
        </span>
        <h1>Rankings</h1>
        <nav className="frk-subs" role="tablist" aria-label="Rankings">
          {RANK_SECTIONS.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={section === s.id} aria-controls="rank-panel" className={`frk-sub${section === s.id ? ' on' : ''}`} onClick={() => switchSection(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
        <span className="fv-sp" />
        <label className="frk-srch">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="M13 13l4.5 4.5" />
          </svg>
          <input
            type="search"
            value={query}
            placeholder={section === 'tribes' ? 'Find a tribe by name or tag' : 'Find a player or tribe tag'}
            aria-label={section === 'tribes' ? 'Find a tribe by name or tag' : 'Find a player or tribe tag'}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className="frk-sw" title="Made-up players and tribes are mixed in so you can try the page out.">
          <input
            type="checkbox"
            checked={showSample}
            onChange={(e) => {
              lastSample = e.target.checked;
              setSampleOn(e.target.checked);
              setPage(0);
            }}
          />
          <i aria-hidden="true" />
          <span>Sample data</span>
        </label>
      </div>
      <div className="frk-body">
        <section className="fv-pn frk-list" id="rank-panel" role="tabpanel" aria-label={RANK_SECTIONS.find((s) => s.id === section)?.label}>
          {failure ? (
            <p className="form-error frk-pad" role="alert">{failure}</p>
          ) : pageLoading ? (
            <p className="fv-empty frk-pad" role="status">Loading…</p>
          ) : (
            <>
              {table}
              <Pager page={pg.page} pages={pg.pages} onPage={setPage} summary={summary} />
            </>
          )}
        </section>
        <div className="frk-side">
          <section className="fv-pn" aria-label="You">
            <div className="fv-ph">
              <h2>You</h2>
              <span className="fv-sp" />
              <span className="fv-mut">This is you</span>
            </div>
            <div className="frk-you-b">
              <div className="frk-you-h">
                <span className="frk-ring">
                  <ChieftainAvatar id={player.chieftain} size={56} />
                </span>
                <span className="frk-you-n">
                  <b>{player.username}</b>
                  <small>{tribeLine}</small>
                </span>
                <span className="frk-rk">
                  <span className="fv-up">Rank</span>
                  <b>{myRow ? `#${myRow.rank}` : '—'}</b>
                  <small>{total ? `of ${formatInt(total)}` : ''}</small>
                </span>
              </div>
              <dl className="frk-yf">
                {you.map(([k, v]) => (
                  <div key={k}>
                    <dt className="fv-up">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="frk-yact">
                <button type="button" className="fv-btn fv-btn-g" disabled={!canJump || pageLoading} onClick={jumpToMe}>
                  Jump to me
                </button>
                <button type="button" className="fv-btn" disabled={!myRow} onClick={() => myRow && showOnMap(myRow.villageX, myRow.villageY)}>
                  Show on map
                </button>
                <button type="button" className="fv-btn" disabled={!player.tribe} onClick={() => player.tribe && viewTribe({ id: player.tribe.id })}>
                  View tribe
                </button>
              </div>
            </div>
          </section>
          <TopThree items={top} valueLabel={section === 'renown' ? 'Renown' : 'Points'} onPick={pickTop} />
          <section className="fv-pn frk-dom" aria-label="Domination">
            <div className="fv-ph">
              <h2>Domination</h2>
              <span className="fv-sp" />
              <button type="button" className="fv-btn" disabled={!dom.status} onClick={() => setDomOpen(true)}>
                Details
              </button>
            </div>
            {dom.status ? (
              <div className="frk-dm">
                <span className="frk-dh">{dominationHeadline(dom.status)}</span>
                <span className="frk-dl">{leaderLine(dom.status)}</span>
                <div className="frk-dwr" role="img" aria-label={`${leaderLine(dom.status)}; ${percentText(dom.status.winShare)} is needed`}>
                  <div className="frk-dbar">
                    <i style={{ width: `${barWidth(dom.status.leader?.share ?? 0)}%` }} />
                  </div>
                  <span className="frk-dln" style={{ left: `${barWidth(dom.status.winShare)}%` }} />
                </div>
                <div className="frk-dsc" aria-hidden="true">
                  <span>0%</span>
                  <span>{percentText(dom.status.leader?.share ?? 0)} now</span>
                  <span>100%</span>
                  <em style={{ left: `${barWidth(dom.status.winShare)}%` }}>{percentText(dom.status.winShare)} wins</em>
                </div>
              </div>
            ) : (
              <p className="fv-empty frk-pad" role="status">
                {dom.error ? (
                  <>
                    Domination unavailable. <button type="button" className="link" onClick={dom.reload}>Retry</button>
                  </>
                ) : (
                  'Loading…'
                )}
              </p>
            )}
          </section>
        </div>
      </div>
      {pop && <Pop data={pop} onClose={() => setPicked(null)} />}
      {domOpen && dom.status && (
        <Dialog title="Domination" onClose={() => setDomOpen(false)}>
          <DominationBar status={dom.status} />
        </Dialog>
      )}
    </div>
  );
}
