// Ranks tab: top players and tribes by points, as a searchable, paged table (a "statistics" page).
// Tribe names open the public tribe page (Tribe tab). Sample data can be switched on to try the screen out.

import { useEffect, useMemo, useState } from 'react';
import { TRIBE_MAX_MEMBERS } from '@clanfire/engine';
import type { PlayerProfileDto, PlayerRankDto, PlayerRankingResponse, TribeSummaryDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { makeSample } from './rankingsSample.ts';

type Section = 'players' | 'tribes';
const SECTION_LABEL: Record<Section, string> = { players: 'Players', tribes: 'Tribes' };
const PAGE_SIZE = 20;

/** Remembered while the player moves between tabs. */
let lastSection: Section = 'players';
let lastSample: boolean | null = null;

/** Sort by points (high first) and give ties the same rank (1, 2, 2, 4). */
function rerank<T extends { rank: number; points: number }>(rows: T[]): T[] {
  const sorted = [...rows].sort((a, b) => b.points - a.points);
  let prevPoints = -1;
  let prevRank = 0;
  return sorted.map((r, i) => {
    const rank = r.points === prevPoints ? prevRank : i + 1;
    prevPoints = r.points;
    prevRank = rank;
    return { ...r, rank };
  });
}

function Medal({ rank }: { rank: number }) {
  if (rank > 3) return <span className="rk-num">{rank}</span>;
  return (
    <span className={`rk-medal rk-medal-${rank}`} aria-label={`Rank ${rank}`}>
      {rank}
    </span>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const shown = new Set<number>([1, pages, page - 1, page, page + 1]);
  const list = [...shown].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const items: (number | 'gap')[] = [];
  list.forEach((p, i) => {
    if (i > 0 && p - list[i - 1]! > 1) items.push('gap');
    items.push(p);
  });
  return (
    <nav className="rk-pager" aria-label="Pages">
      <button className="btn btn-small" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        ‹
      </button>
      {items.map((it, i) =>
        it === 'gap' ? (
          <span key={`g${i}`} className="muted" aria-hidden="true">…</span>
        ) : (
          <button
            key={it}
            className={`btn btn-small rk-page${it === page ? ' is-active' : ''}`}
            aria-current={it === page ? 'page' : undefined}
            onClick={() => onPage(it)}
          >
            {it}
          </button>
        ),
      )}
      <button className="btn btn-small" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        ›
      </button>
    </nav>
  );
}

/** Original backdrop for the page: parchment, a lone guard on a rise at the left, a tree and birds at the right. */
function Backdrop() {
  return (
    <div className="rk-backdrop" aria-hidden="true">
      <svg className="rk-bd-left" viewBox="0 0 200 420" preserveAspectRatio="xMinYMax meet">
        <ellipse cx="100" cy="410" rx="120" ry="40" fill="#b98a56" opacity="0.35" />
        <g fill="#7a5530" stroke="#2b211c" strokeWidth="3" strokeLinejoin="round">
          <path d="M100 40 l22 14 v20 h-44 v-20z" />
          <rect x="82" y="74" width="36" height="20" rx="6" />
          <path d="M62 100 h76 l10 130 h-96z" />
          <path d="M78 230 h18 l-4 150 h-26z M104 230 h18 l12 150 h-26z" />
          <path d="M152 70 v200" strokeWidth="5" />
        </g>
        <path d="M152 70 l-8 -26 l8 -8 l8 8z" fill="#cdba98" stroke="#2b211c" strokeWidth="3" />
      </svg>
      <svg className="rk-bd-right" viewBox="0 0 220 420" preserveAspectRatio="xMaxYMax meet">
        <path d="M120 420 q-4 -120 6 -190 q-30 -20 -50 -60 q20 -40 55 -40 q-25 -45 15 -75 q35 -20 65 10 q30 30 10 70 q35 10 40 45 q-10 40 -55 50 q8 80 -4 190z" fill="#2b211c" opacity="0.88" />
        <g fill="#2b211c" opacity="0.8">
          <path d="M30 60 q8 -10 16 0 q8 -10 16 0 q-8 4 -16 10 q-8 -6 -16 -10z" />
          <path d="M70 30 q6 -8 12 0 q6 -8 12 0 q-6 3 -12 8 q-6 -5 -12 -8z" />
          <path d="M20 110 q6 -8 12 0 q6 -8 12 0 q-6 3 -12 8 q-6 -5 -12 -8z" />
        </g>
      </svg>
    </div>
  );
}

function Crown({ tone }: { tone: 1 | 2 | 3 }) {
  const fill = tone === 1 ? '#f2b33d' : tone === 2 ? '#d9d5cc' : '#c98a52';
  return (
    <svg className="rk-crown" viewBox="0 0 64 48" aria-hidden="true">
      <path d="M6 40 L2 12 L18 24 L32 6 L46 24 L62 12 L58 40z" fill={fill} stroke="#2b211c" strokeWidth="3" strokeLinejoin="round" />
      <rect x="6" y="40" width="52" height="6" rx="2" fill={fill} stroke="#2b211c" strokeWidth="3" />
      <circle cx="32" cy="30" r="3" fill="#c4623a" stroke="#2b211c" strokeWidth="1.5" />
    </svg>
  );
}

interface PodiumItem {
  key: number;
  rank: number;
  name: string;
  sub: string;
}

/** The three best, as wooden plaques with crowns (middle one tallest). Each one opens the options sheet. */
function Podium({ items, onPick }: { items: PodiumItem[]; onPick: (key: number) => void }) {
  if (items.length < 3) return null;
  const order = [items[1]!, items[0]!, items[2]!];
  return (
    <ol className="rk-podium" aria-label="Top three">
      {order.map((it) => (
        <li key={it.key} className={`rk-pod rk-pod-${it.rank}`}>
          <button type="button" className="rk-plaque" onClick={() => onPick(it.key)} aria-label={`${it.name}, rank ${it.rank}. Open options`}>
            <Crown tone={it.rank as 1 | 2 | 3} />
            <span className="rk-plaque-name">{it.name}</span>
            <span className="rk-plaque-sub">{it.sub}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

interface SheetAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}
interface SheetData {
  title: string;
  subtitle: string;
  facts: [string, string][];
  actions: SheetAction[];
  note?: string;
}

/** Options for a pressed player or tribe. Closes on Escape, on the backdrop and after any action. */
function Sheet({ data, onClose }: { data: SheetData; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="rk-sheet-wrap" onClick={onClose}>
      <div className="rk-sheet" role="dialog" aria-modal="true" aria-label={data.title} onClick={(e) => e.stopPropagation()}>
        <div className="rk-sheet-grip" aria-hidden="true" />
        <h2 className="rk-sheet-title">{data.title}</h2>
        <p className="muted small rk-sheet-sub">{data.subtitle}</p>
        <dl className="rk-sheet-facts">
          {data.facts.map(([k, v]) => (
            <div key={k}>
              <dt className="muted small">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="rk-sheet-actions">
          {data.actions.map((a) => (
            <button
              key={a.label}
              className="btn"
              disabled={a.disabled}
              onClick={() => {
                onClose();
                a.onClick();
              }}
            >
              {a.label}
            </button>
          ))}
          <button className="btn btn-small" autoFocus onClick={onClose}>Close</button>
        </div>
        {data.note && <p className="muted small rk-sheet-note">{data.note}</p>}
      </div>
    </div>
  );
}

function Tiles({ items }: { items: { label: string; value: string; sub?: string }[] }) {
  return (
    <ul className="rk-tiles">
      {items.map((t) => (
        <li key={t.label} className="rk-tile">
          <span className="rk-tile-label muted small">{t.label}</span>
          <strong className="rk-tile-value">{t.value}</strong>
          {t.sub && <span className="rk-tile-sub muted small">{t.sub}</span>}
        </li>
      ))}
    </ul>
  );
}

function Players({ real, sample, meId }: { real: PlayerRankingResponse; sample: PlayerRankDto[] | null; meId: number | null }) {
  const { viewTribe, showOnMap } = useGame();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<number | null>(null);

  const all = useMemo(() => {
    const base = [...real.players];
    if (real.me && !base.some((p) => p.playerId === real.me!.playerId)) base.push(real.me);
    return sample ? rerank([...base, ...sample]) : base;
  }, [real, sample]);

  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () => (q ? all.filter((p) => p.username.toLowerCase().includes(q) || (p.tribe?.tag.toLowerCase().includes(q) ?? false)) : all),
    [all, q],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const cur = Math.min(page, pages);
  const slice = rows.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);
  const myIndex = rows.findIndex((p) => p.playerId === meId);

  const top = all[0];
  const totalPoints = all.reduce((s, p) => s + p.points, 0);

  const pickedRow = picked === null ? null : (all.find((p) => p.playerId === picked) ?? null);

  // Real players: load the public profile for the sheet (sample players have none).
  const [profile, setProfile] = useState<PlayerProfileDto | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  useEffect(() => {
    setProfile(null);
    setProfileError(null);
    if (picked === null || picked < 0) return;
    let cancelled = false;
    api
      .playerProfile(picked)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((e: unknown) => {
        if (!cancelled) setProfileError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [picked]);
  const prof = profile && profile.playerId === picked ? profile : null;

  const sheet: SheetData | null = pickedRow && {
    title: pickedRow.username,
    subtitle: pickedRow.playerId === meId ? 'This is you' : pickedRow.tribe ? `Member of [${pickedRow.tribe.tag}]` : 'No tribe',
    facts: [
      ['Rank', `#${pickedRow.rank}`],
      ['Points', formatInt(pickedRow.points)],
      ['Villages', String(pickedRow.villages)],
      ['Tribe', prof?.tribe ? `${prof.tribe.name} [${prof.tribe.tag}] · ${prof.tribe.role}` : pickedRow.tribe ? `[${pickedRow.tribe.tag}]` : '—'],
      ...(prof
        ? ([
            ['Joined', new Date(prof.joinedAt).toLocaleDateString()],
            ['Protection', prof.protectedNow ? 'Beginner protection' : 'None'],
          ] as [string, string][])
        : []),
    ],
    actions: [
      { label: 'Show on map', disabled: pickedRow.playerId < 0, onClick: () => showOnMap(pickedRow.villageX, pickedRow.villageY) },
      ...(pickedRow.tribe && pickedRow.tribe.id > 0 ? [{ label: 'View tribe', onClick: () => viewTribe({ id: pickedRow.tribe!.id }) }] : []),
    ],
    note:
      pickedRow.playerId < 0
        ? 'Sample player: not a real account, so there is nothing to open.'
        : profileError
          ? profileError
          : prof
            ? prof.villages.slice(0, 5).map((v) => `${v.name} (${v.x}|${v.y})`).join(' · ') + (prof.villageCount > 5 ? ` · +${prof.villageCount - 5} more` : '')
            : 'Loading profile…',
  };

  return (
    <>
      {sheet && <Sheet data={sheet} onClose={() => setPicked(null)} />}
      {!q && (
        <Podium
          items={all.slice(0, 3).map((p) => ({ key: p.playerId, rank: p.rank, name: p.username, sub: `${formatInt(p.points)} pts` }))}
          onPick={setPicked}
        />
      )}
      <Tiles
        items={[
          { label: 'Players', value: formatInt(sample ? all.length : real.total) },
          { label: 'Top player', value: top ? top.username : '—', sub: top ? `${formatInt(top.points)} pts` : undefined },
          { label: 'Average', value: all.length ? formatInt(Math.round(totalPoints / all.length)) : '—', sub: 'points per player' },
        ]}
      />
      <div className="rk-toolbar">
        <input
          className="rk-search"
          type="search"
          value={query}
          placeholder="Find a player or tribe tag"
          aria-label="Find a player or tribe tag"
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        {myIndex >= 0 && (
          <button className="btn btn-small" onClick={() => setPage(Math.floor(myIndex / PAGE_SIZE) + 1)}>
            Jump to me
          </button>
        )}
      </div>
      {slice.length === 0 ? (
        <p className="muted rk-empty">{q ? 'Nobody matches that search.' : 'No players yet.'}</p>
      ) : (
        <div className="rk-scroll">
          <table className="rk-table">
            <thead>
              <tr>
                <th scope="col" className="rk-c-rank">Rank</th>
                <th scope="col">Player</th>
                <th scope="col" className="rk-c-tribe">Tribe</th>
                <th scope="col" className="rk-c-vill num">Villages</th>
                <th scope="col" className="num">Points</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((p) => {
                const mine = p.playerId === meId;
                const tribe = p.tribe;
                return (
                  <tr key={p.playerId} className={`rk-press${mine ? ' rk-me' : ''}`} aria-current={mine ? 'true' : undefined} onClick={() => setPicked(p.playerId)}>
                    <td className="rk-c-rank"><Medal rank={p.rank} /></td>
                    <td className="rk-name">
                      <button type="button" className="rk-who" onClick={(e) => { e.stopPropagation(); setPicked(p.playerId); }}>{p.username}</button>
                      {mine && <span className="rk-you">you</span>}
                      <span className="rk-sub muted small">
                        {tribe ? `[${tribe.tag}] · ` : ''}
                        {p.villages} {p.villages === 1 ? 'village' : 'villages'}
                      </span>
                    </td>
                    <td className="rk-c-tribe">
                      {tribe ? (
                        tribe.id > 0 ? (
                          <button className="link" onClick={(e) => { e.stopPropagation(); viewTribe({ id: tribe.id }); }}>[{tribe.tag}]</button>
                        ) : (
                          <span>[{tribe.tag}]</span>
                        )
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="rk-c-vill num">{p.villages}</td>
                    <td className="num rk-pts">{formatInt(p.points)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="rk-foot">
        <span className="muted small">
          {rows.length === 0 ? '0' : `${(cur - 1) * PAGE_SIZE + 1}–${(cur - 1) * PAGE_SIZE + slice.length}`} of {formatInt(rows.length)}
        </span>
        <Pager page={cur} pages={pages} onPage={setPage} />
      </div>
    </>
  );
}

function Tribes({ real, sample }: { real: TribeSummaryDto[]; sample: TribeSummaryDto[] | null }) {
  const { viewTribe, player } = useGame();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<number | null>(null);

  const all = useMemo(() => (sample ? rerank([...real, ...sample]) : real), [real, sample]);
  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () => (q ? all.filter((t) => t.name.toLowerCase().includes(q) || t.tag.toLowerCase().includes(q)) : all),
    [all, q],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const cur = Math.min(page, pages);
  const slice = rows.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);
  const myIndex = rows.findIndex((t) => t.id === player.tribe?.id);
  const top = all[0];
  const members = all.reduce((s, t) => s + t.members, 0);

  const pickedRow = picked === null ? null : (all.find((t) => t.id === picked) ?? null);
  const sheet: SheetData | null = pickedRow && {
    title: pickedRow.name,
    subtitle: `[${pickedRow.tag}]${pickedRow.id === player.tribe?.id ? ' · your tribe' : ''}`,
    facts: [
      ['Rank', `#${pickedRow.rank}`],
      ['Points', formatInt(pickedRow.points)],
      ['Members', `${pickedRow.members}/${TRIBE_MAX_MEMBERS}`],
      ['Villages', String(pickedRow.villages)],
      ['Avg. points', pickedRow.members ? formatInt(Math.round(pickedRow.points / pickedRow.members)) : '—'],
    ],
    actions: [{ label: 'Open tribe page', disabled: pickedRow.id < 0, onClick: () => viewTribe({ id: pickedRow.id }) }],
    note: pickedRow.id < 0 ? 'Sample tribe: not real, so there is no page to open.' : 'More options (apply, diplomacy) will appear here later.',
  };

  return (
    <>
      {sheet && <Sheet data={sheet} onClose={() => setPicked(null)} />}
      {!q && (
        <Podium
          items={all.slice(0, 3).map((t) => ({ key: t.id, rank: t.rank, name: t.name, sub: `[${t.tag}] · ${formatInt(t.points)} pts` }))}
          onPick={setPicked}
        />
      )}
      <Tiles
        items={[
          { label: 'Tribes', value: formatInt(all.length) },
          { label: 'Top tribe', value: top ? top.name : '—', sub: top ? `${formatInt(top.points)} pts` : undefined },
          { label: 'In tribes', value: formatInt(members), sub: 'players' },
        ]}
      />
      <div className="rk-toolbar">
        <input
          className="rk-search"
          type="search"
          value={query}
          placeholder="Find a tribe by name or tag"
          aria-label="Find a tribe by name or tag"
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        {myIndex >= 0 && (
          <button className="btn btn-small" onClick={() => setPage(Math.floor(myIndex / PAGE_SIZE) + 1)}>
            Jump to my tribe
          </button>
        )}
      </div>
      {slice.length === 0 ? (
        <p className="muted rk-empty">{q ? 'No tribe matches that search.' : 'No tribes yet.'}</p>
      ) : (
        <div className="rk-scroll">
          <table className="rk-table">
            <thead>
              <tr>
                <th scope="col" className="rk-c-rank">Rank</th>
                <th scope="col">Tribe</th>
                <th scope="col" className="num">Members</th>
                <th scope="col" className="num">Villages</th>
                <th scope="col" className="rk-c-vill num">Avg. points</th>
                <th scope="col" className="num">Points</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((t) => {
                const mine = t.id === player.tribe?.id;
                return (
                  <tr key={t.id} className={`rk-press${mine ? ' rk-me' : ''}`} aria-current={mine ? 'true' : undefined} onClick={() => setPicked(t.id)}>
                    <td className="rk-c-rank"><Medal rank={t.rank} /></td>
                    <td className="rk-name">
                      <button type="button" className="rk-who" onClick={(e) => { e.stopPropagation(); setPicked(t.id); }}>{t.name}</button>
                      <span className="rk-sub muted small">[{t.tag}]{mine ? ' · your tribe' : ''}</span>
                    </td>
                    <td className="num">{t.members}<span className="muted small">/{TRIBE_MAX_MEMBERS}</span></td>
                    <td className="num">{t.villages}</td>
                    <td className="rk-c-vill num">{t.members ? formatInt(Math.round(t.points / t.members)) : '—'}</td>
                    <td className="num rk-pts">{formatInt(t.points)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="rk-foot">
        <span className="muted small">
          {rows.length === 0 ? '0' : `${(cur - 1) * PAGE_SIZE + 1}–${(cur - 1) * PAGE_SIZE + slice.length}`} of {formatInt(rows.length)}
        </span>
        <Pager page={cur} pages={pages} onPage={setPage} />
      </div>
    </>
  );
}

export function RankingsView() {
  const [section, setSection] = useState<Section>(lastSection);
  const [players, setPlayers] = useState<PlayerRankingResponse | null>(null);
  const [tribes, setTribes] = useState<TribeSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sampleOn, setSampleOn] = useState<boolean | null>(lastSample);
  const sample = useMemo(makeSample, []);

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

  // Default: sample data on while the world is still small, so there is something to browse.
  const showSample = sampleOn ?? (players !== null && players.total < 15);
  const sections: Section[] = ['players', 'tribes'];

  return (
    <div className="rk-stage">
      <Backdrop />
      <div className="rk-head">
        <h1 className="page-title">Rankings</h1>
        <label className="rk-sample">
          <input
            type="checkbox"
            checked={showSample}
            onChange={(e) => {
              lastSample = e.target.checked;
              setSampleOn(e.target.checked);
            }}
          />
          <span>Sample data</span>
        </label>
      </div>
      <div className="subtabs subtabs-2" role="tablist" aria-label="Rankings">
        {sections.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={section === s}
            aria-controls="rank-panel"
            className={`subtab${section === s ? ' is-active' : ''}`}
            onClick={() => {
              lastSection = s;
              setSection(s);
            }}
          >
            {SECTION_LABEL[s]}
          </button>
        ))}
      </div>
      <section className="card rk-card" id="rank-panel" role="tabpanel">
        {showSample && <p className="rk-note muted small">Made-up players and tribes are mixed in so you can try the page out. Switch “Sample data” off to see only real ones.</p>}
        {error ? (
          <p className="form-error" role="alert">{error}</p>
        ) : !players || !tribes ? (
          <p className="muted">Loading…</p>
        ) : section === 'players' ? (
          <Players real={players} sample={showSample ? sample.players : null} meId={players.me?.playerId ?? null} />
        ) : (
          <Tribes real={tribes} sample={showSample ? sample.tribes : null} />
        )}
      </section>
    </div>
  );
}
