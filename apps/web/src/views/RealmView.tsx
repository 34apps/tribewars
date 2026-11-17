// The Realm page: all my villages at a glance, from one GET /api/realm. Read-only; every cell jumps to the matching page of that
// village. Desktop (the fixed 1440 x 900 frame): one table row per village, no scrolling, the rows that do not fit are paged.
// Phone: one compact card per village. Names and notes are user text: always React text nodes.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BUILDINGS, RESOURCE_IDS, UNITS, worldPrefixOf } from '@clanfire/engine';
import type { BuildingId, RealmVillageDto, UnitId } from '@clanfire/engine';
import { Icon } from '../art/Icon.tsx';
import { UnitFigure } from '../art/UnitFigure.tsx';
import { NoteButton, NoteChips } from '../components/Notes.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { formatCoords, formatCompact, formatDuration, formatInt, formatLeft, formatRate } from '../format.ts';
import { useGame } from '../game.ts';
import { useIsDesktop } from '../hooks/useLayout.ts';
import { useNotes } from '../hooks/useNotes.tsx';
import { useRealm } from '../hooks/useRealm.ts';
import { RESOURCE_ICON, RESOURCE_NAME } from '../icons.ts';
import { DEFAULT_SORT, SORT_HINT, SORT_KEYS, SORT_LABEL, buildSummary, fillOf, msLeft, nextSort, parseSort, popRatio, ratioOf, realmTotals, rowsFit, sortVillages, stockPerResource, troopEntries, trainingLines } from '../realm.ts';
import type { RealmTotals, SortChoice, SortKey } from '../realm.ts';
import { paging, pageSlice } from './reports/frame-reports-logic.ts';
import { Chev } from './village/FrameParts.tsx';
import '../realm.css';

/** Height of one table row in px (realm.css `--rl-row`): the page count follows from it. */
const ROW_H = 66;
const HEAD_H = 36;
const PAGER_H = 52;

const SORT_KEY = () => `clanfire.realm.sort${worldPrefixOf(window.location.pathname)}`;

function readSort(): SortChoice {
  try {
    return parseSort(window.localStorage.getItem(SORT_KEY()));
  } catch {
    return DEFAULT_SORT;
  }
}

// ---- Shared state of both layouts -------------------------------------------------------------------------------------------

type Go = 'village' | 'army' | { building: BuildingId | null };

function useRealmPage() {
  const { now, selectVillage, navigate, openBuilding } = useGame();
  const store = useRealm();
  const notes = useNotes();
  const [sort, setSortState] = useState<SortChoice>(readSort);
  const setSort = useCallback((key: SortKey) => {
    setSortState((cur) => {
      const next = nextSort(cur, key);
      try {
        window.localStorage.setItem(SORT_KEY(), JSON.stringify(next));
      } catch {
        // Private mode: the choice lasts until the page is closed.
      }
      return next;
    });
  }, []);
  const { data } = store;
  const serverTime = data?.serverTime ?? now;
  // A freshly polled list is sorted with the clock of that poll so the order does not twitch every second; the stock fullness
  // used by the sort changes slowly, and the next poll re-sorts.
  const sortClock = serverTime;
  const sorted = useMemo(() => (data ? sortVillages(data.villages, sort, data.serverTime, sortClock) : []), [data, sort, sortClock]);
  const totals = useMemo(() => (data ? realmTotals(data.villages, data.serverTime, now) : null), [data, now]);
  const go = useCallback(
    (id: number, to: Go) => {
      selectVillage(id);
      if (to === 'village') navigate('village');
      else if (to === 'army') navigate('army');
      else openBuilding(to.building);
    },
    [selectVillage, navigate, openBuilding],
  );
  /** The note of one of my villages: the notes store once it has loaded (it is the one that gets edited), else what the realm sent. */
  const noteOf = useCallback(
    (v: RealmVillageDto) => (notes.loaded ? (notes.get('village', v.id) ?? null) : v.note),
    [notes],
  );
  return { ...store, now, serverTime, sort, setSort, sorted, totals, go, noteOf };
}

// ---- Small pieces ------------------------------------------------------------------------------------------------------------

function Bar({ ratio, className = '' }: { ratio: number; className?: string }) {
  return (
    <span className={`rl-bar is-${fillOf(ratio)} ${className}`.trim()} aria-hidden="true">
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%` }} />
    </span>
  );
}

function Pt({ unit, size = 20 }: { unit: UnitId; size?: number }) {
  return (
    <span className="rl-pt" style={{ width: size, height: size }} aria-hidden="true">
      <UnitFigure unit={unit} pose="icon" size={size} />
    </span>
  );
}

function TroopChips({ troops, size = 20 }: { troops: RealmVillageDto['troops']; size?: number }) {
  const entries = troopEntries(troops);
  if (entries.length === 0) return <span className="rl-idle">None at home</span>;
  return (
    <span className="rl-troops">
      {entries.map(([u, n]) => (
        <span key={u} className="rl-tr" title={`${UNITS[u].name}: ${formatInt(n)}`}>
          <Pt unit={u} size={size} />
          <b>{formatCompact(n)}</b>
          <span className="visually-hidden">{UNITS[u].name}</span>
        </span>
      ))}
    </span>
  );
}

/** "Hearth out" chip with the claimant and the time left on the hold clock. */
function HoldChip({ v, now }: { v: RealmVillageDto; now: number }) {
  if (v.hearth !== 'out') return null;
  const left = v.holdEndsAt !== null ? formatLeft(msLeft(v.holdEndsAt, now)) : null;
  const text = v.claimBy ? `Claimed by ${v.claimBy}` : 'Hearth out';
  return (
    <span className="rl-chip is-hold" title={`${text}${left ? `, changes hands in ${left}` : ', the hold clock is paused'}`}>
      <Icon name="flame" size={14} />
      <span className="rl-chip-t">{text}</span>
      {left && <b>{left}</b>}
    </span>
  );
}

function FreeSlotChip({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="rl-chip is-free" title="A construction slot is free: start something">
      <Icon name="queue" size={14} />
      {n > 1 ? `${n} free slots` : 'Free slot'}
    </span>
  );
}

function IncomingBadge({ attacks, nextAt, now }: { attacks: number; nextAt: number | null; now: number }) {
  if (attacks <= 0) return null;
  const left = nextAt !== null ? formatDuration(msLeft(nextAt, now)) : '';
  return (
    <span className="rl-atk" title={`${attacks} incoming ${attacks === 1 ? 'attack' : 'attacks'}${left ? `, the first arrives in ${left}` : ''}`}>
      <Icon name="warning" size={16} />
      <b>{attacks}</b>
      {left && <span>{left}</span>}
    </span>
  );
}

function OutgoingBadge({ marches, nextAt, now }: { marches: number; nextAt: number | null; now: number }) {
  if (marches <= 0) return null;
  const left = nextAt !== null ? formatLeft(msLeft(nextAt, now)) : '';
  return (
    <span className="rl-out" title={`${marches} ${marches === 1 ? 'march' : 'marches'} on the road${left ? `, the first arrives in ${left}` : ''}`}>
      <Icon name="send" size={16} />
      <b>{marches}</b>
      {left && <span>{left}</span>}
    </span>
  );
}

function jobText(job: { building: keyof typeof BUILDINGS; targetLevel: number }): string {
  return `${BUILDINGS[job.building].name} → ${job.targetLevel}`;
}

function BuildCell({ v, now }: { v: RealmVillageDto; now: number }) {
  const s = buildSummary(v);
  return (
    <span className="rl-lines">
      {s.first ? (
        <span className="rl-ln">
          <span className="rl-ln-t">{jobText(s.first)}</span>
          <b className="rl-time">{formatDuration(msLeft(s.first.finishAt, now))}</b>
        </span>
      ) : (
        <span className="rl-ln">
          <span className="rl-idle">Nothing building</span>
        </span>
      )}
      {s.second && (
        <span className="rl-ln is-2nd">
          <span className="rl-ln-t">
            then {jobText(s.second)}
            {s.more > 0 ? ` (+${s.more})` : ''}
          </span>
          <span className="rl-time">{formatLeft(msLeft(s.second.finishAt, now))}</span>
        </span>
      )}
      {s.free > 0 && (
        <span className="rl-ln">
          <FreeSlotChip n={s.free} />
        </span>
      )}
    </span>
  );
}

function TrainCell({ v, now, max = 2 }: { v: RealmVillageDto; now: number; max?: number }) {
  if (v.training.length === 0) return <span className="rl-idle">Idle</span>;
  const { shown, more } = trainingLines(v.training, max);
  return (
    <span className="rl-lines">
      {shown.map((b, i) => (
        <span key={`${b.building}-${b.unit}-${i}`} className="rl-ln" title={`${UNITS[b.unit].name}: ${formatInt(b.left)} still to come`}>
          <Pt unit={b.unit} size={18} />
          <span className="rl-ln-t">
            {UNITS[b.unit].name} ×{formatCompact(b.left)}
          </span>
          <span className="rl-time">{formatLeft(msLeft(b.finishAt, now))}</span>
        </span>
      ))}
      {more > 0 && <span className="rl-ln rl-idle">+{more} more</span>}
    </span>
  );
}

function StockCells({ v, serverTime, now }: { v: RealmVillageDto; serverTime: number; now: number }) {
  const rows = stockPerResource(v, serverTime, now);
  return (
    <span className="rl-stock">
      {rows.map((r) => (
        <span key={r.id} className={`rl-st is-${r.fill}`} title={`${RESOURCE_NAME[r.id]}: ${formatInt(r.amount)} of ${formatInt(v.storageCap)}${r.fill === 'full' ? ' (full)' : r.fill === 'near' ? ' (nearly full)' : ''}`}>
          <span className="rl-st-top">
            <Icon name={RESOURCE_ICON[r.id]} size={16} />
            <b>{formatCompact(r.amount)}</b>
            <span className="visually-hidden">
              {RESOURCE_NAME[r.id]} of {formatInt(v.storageCap)}
              {r.fill === 'full' ? ' (full)' : r.fill === 'near' ? ' (nearly full)' : ''}
            </span>
          </span>
          <Bar ratio={r.ratio} />
          <small className={Math.round(r.income) <= 0 ? 'is-zero' : ''}>{formatRate(r.income)}</small>
        </span>
      ))}
    </span>
  );
}

function PopCell({ used, cap }: { used: number; cap: number }) {
  const ratio = ratioOf(used, cap);
  return (
    <span className={`rl-pop is-${fillOf(ratio)}`} title={`Population ${formatInt(used)} of ${formatInt(cap)}`}>
      <span className="rl-pop-n">
        <b>{formatCompact(used)}</b>
        <small>/ {formatCompact(cap)}</small>
      </span>
      <Bar ratio={ratio} />
    </span>
  );
}

// ---- Desktop table -----------------------------------------------------------------------------------------------------------

/** One clickable table cell: the whole cell is a button laid over its content (the note button sits above it). */
function Cell({ label, onGo, children, className = '' }: { label: string; onGo?: () => void; children: ReactNode; className?: string }) {
  return (
    <div role="cell" className={`rl-c ${className}`.trim()}>
      <div className="rl-c-in">{children}</div>
      {onGo && <button type="button" className="rl-go" aria-label={label} onClick={onGo} />}
    </div>
  );
}

function SortArrow({ reverse }: { reverse: boolean }) {
  return (
    <svg className={`rl-arrow${reverse ? ' is-up' : ''}`} width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 3.5l3 3 3-3" />
    </svg>
  );
}

function SortHead({ k, label, sort, onSort }: { k: SortKey; label: string; sort: SortChoice; onSort: (k: SortKey) => void }) {
  const on = sort.key === k;
  return (
    <button type="button" className={`rl-sort${on ? ' is-on' : ''}`} aria-pressed={on} title={`Sort: ${SORT_LABEL[k]}, ${SORT_HINT[k]}. Press again to reverse.`} onClick={() => onSort(k)}>
      {label}
      {on && <SortArrow reverse={sort.reverse} />}
      {on && <span className="visually-hidden">{sort.reverse ? ' (reversed)' : ''}</span>}
    </button>
  );
}

function RealmRow({ v, now, serverTime, go, noteOf }: { v: RealmVillageDto; now: number; serverTime: number; go: ReturnType<typeof useRealmPage>['go']; noteOf: (v: RealmVillageDto) => RealmVillageDto['note'] }) {
  const note = noteOf(v);
  const trainTo: Go = v.training[0] ? { building: v.training[0].building } : 'army';
  return (
    <div role="row" className={`rl-row${v.incoming.attacks > 0 ? ' is-attacked' : ''}`}>
      <Cell label={`Open ${v.name}`} onGo={() => go(v.id, 'village')} className="rl-c-v">
        <span className="rl-vn">
          <b className="rl-name" title={v.name}>
            {v.name}
          </b>
        </span>
        <span className="rl-sub">
          {formatCoords(v.x, v.y)} · {formatInt(v.points)} pts
        </span>
        <span className="rl-vchips">
          <HoldChip v={v} now={now} />
          {note && note.tags.length > 0 && <NoteChips tags={note.tags} compact />}
        </span>
        <span className="rl-note-btn">
          <NoteButton kind="village" targetId={v.id} title={v.name} subtitle={`${formatCoords(v.x, v.y)} · your village`} hasNote={note !== null} />
        </span>
      </Cell>
      <Cell label={`${v.name}: buildings and stock`} onGo={() => go(v.id, 'village')}>
        <StockCells v={v} serverTime={serverTime} now={now} />
      </Cell>
      <Cell label={`${v.name}: buildings and population`} onGo={() => go(v.id, 'village')}>
        <PopCell used={v.population.used} cap={v.population.cap} />
      </Cell>
      <Cell label={`${v.name}: construction`} onGo={() => go(v.id, 'village')}>
        <BuildCell v={v} now={now} />
      </Cell>
      <Cell label={`${v.name}: training`} onGo={() => go(v.id, trainTo)}>
        <TrainCell v={v} now={now} />
      </Cell>
      <Cell label={`${v.name}: troops at home`} onGo={() => go(v.id, 'army')}>
        <TroopChips troops={v.troops} size={20} />
      </Cell>
      <Cell label={`${v.name}: movements`} onGo={() => go(v.id, 'army')}>
        <span className="rl-moves">
          <IncomingBadge attacks={v.incoming.attacks} nextAt={v.incoming.nextAt} now={now} />
          <OutgoingBadge marches={v.outgoing.marches} nextAt={v.outgoing.nextAt} now={now} />
          {v.incoming.attacks === 0 && v.outgoing.marches === 0 && <span className="rl-idle">Quiet</span>}
        </span>
      </Cell>
    </div>
  );
}

function TotalsRow({ t, now }: { t: RealmTotals; now: number }) {
  const ratio = ratioOf(t.population.used, t.population.cap);
  return (
    <div role="row" className="rl-row rl-total" data-rl="tot">
      <div role="cell" className="rl-c rl-c-v">
        <div className="rl-c-in">
          <span className="rl-vn">
            <b className="rl-name">Realm total</b>
          </span>
          <span className="rl-sub">{t.villages} villages</span>
        </div>
      </div>
      <div role="cell" className="rl-c">
        <div className="rl-c-in">
          <span className="rl-stock">
            {RESOURCE_IDS.map((r) => (
              <span key={r} className="rl-st" title={`${RESOURCE_NAME[r]}: ${formatInt(t.resources[r])} in all villages`}>
                <span className="rl-st-top">
                  <Icon name={RESOURCE_ICON[r]} size={16} />
                  <b>{formatCompact(t.resources[r])}</b>
                  <span className="visually-hidden">{RESOURCE_NAME[r]}</span>
                </span>
                <Bar ratio={ratioOf(t.resources[r], t.cap)} />
                <small className={Math.round(t.income[r]) <= 0 ? 'is-zero' : ''}>{formatRate(t.income[r])}</small>
              </span>
            ))}
          </span>
        </div>
      </div>
      <div role="cell" className="rl-c">
        <div className="rl-c-in">
          <span className={`rl-pop is-${fillOf(ratio)}`}>
            <span className="rl-pop-n">
              <b>{formatCompact(t.population.used)}</b>
              <small>/ {formatCompact(t.population.cap)}</small>
            </span>
            <Bar ratio={ratio} />
          </span>
        </div>
      </div>
      <div role="cell" className="rl-c">
        <div className="rl-c-in">
          <span className="rl-lines">
            <span className="rl-ln">
              <FreeSlotChip n={t.freeSlots} />
              {t.freeSlots === 0 && <span className="rl-idle">No free slots</span>}
            </span>
          </span>
        </div>
      </div>
      <div role="cell" className="rl-c">
        <div className="rl-c-in">
          <span className="rl-idle">—</span>
        </div>
      </div>
      <div role="cell" className="rl-c">
        <div className="rl-c-in">
          <TroopChips troops={t.troops} size={20} />
        </div>
      </div>
      <div role="cell" className="rl-c">
        <div className="rl-c-in">
          <span className="rl-moves">
            <IncomingBadge attacks={t.incoming.attacks} nextAt={t.incoming.nextAt} now={now} />
            <OutgoingBadge marches={t.outgoing.marches} nextAt={t.outgoing.nextAt} now={now} />
            {t.incoming.attacks === 0 && t.outgoing.marches === 0 && <span className="rl-idle">Quiet</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

function RealmTable() {
  const page = useRealmPage();
  const { data, error, refresh, now, serverTime, sort, setSort, sorted, totals, go, noteOf } = page;
  const [pageNo, setPageNo] = useState(0);
  const fitRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<number | null>(null);

  // How many rows fit: the height of the table area minus the header, the totals row and the pager (the heights are fixed in
  // realm.css), so a bigger window shows more rows. Until measured, a safe 7.
  const hasData = data !== null;
  useLayoutEffect(() => {
    const el = fitRef.current;
    if (!el) return;
    const measure = () => setArea(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasData]);

  const total = sorted.length;
  const rowsArea = area === null ? null : area - HEAD_H - (total > 1 ? ROW_H : 0);
  const fitAll = rowsArea === null ? 7 : rowsFit(rowsArea, ROW_H);
  const perPage = total <= fitAll ? Math.max(1, total) : rowsArea === null ? 7 : rowsFit(rowsArea - PAGER_H, ROW_H);
  const pg = paging(total, pageNo, perPage);
  const rows = pageSlice(sorted, pg.page, perPage);
  useEffect(() => {
    if (pageNo !== pg.page) setPageNo(pg.page);
  }, [pageNo, pg.page]);

  const sortFor = (k: SortKey, label: string) => <SortHead k={k} label={label} sort={sort} onSort={setSort} />;

  return (
    <section className="fv-pn rl" aria-label="Realm">
      <div className="fv-ph">
        <Icon name="realm" size={26} />
        <h2>Realm</h2>
        {data && <span className="fv-cnt">{total === 1 ? '1 village' : `${total} villages`}</span>}
        <span className="fv-sp" />
        <span className="fv-mut">Press a cell to open that village. Sorted by {SORT_LABEL[sort.key].toLowerCase()}.</span>
      </div>
      {error && (
        <p className="form-error rl-pad" role="alert">
          {error}{' '}
          <button type="button" className="fv-lk" onClick={() => void refresh()}>
            Retry
          </button>
        </p>
      )}
      {!data && !error && <p className="fv-empty rl-pad">Loading…</p>}
      {data && (
        <div className="rl-fit" ref={fitRef}>
          <div role="table" aria-label="My villages" aria-rowcount={total + 1} className="rl-table">
            <div role="row" className="rl-row rl-head" data-rl="head">
              <div role="columnheader" className="rl-c rl-c-v">
                <span className="rl-sorts">
                  {sortFor('name', 'Village')}
                  {sortFor('points', 'Points')}
                </span>
              </div>
              <div role="columnheader" className="rl-c">
                {sortFor('stock', 'Stock')}
              </div>
              <div role="columnheader" className="rl-c">
                {sortFor('population', 'Population')}
              </div>
              <div role="columnheader" className="rl-c">
                {sortFor('build', 'Building')}
              </div>
              <div role="columnheader" className="rl-c">
                <span className="rl-sort is-plain">Training</span>
              </div>
              <div role="columnheader" className="rl-c">
                <span className="rl-sort is-plain">Troops at home</span>
              </div>
              <div role="columnheader" className="rl-c">
                {sortFor('incoming', 'Moves')}
              </div>
            </div>
            <div role="rowgroup" className="rl-rows">
              {rows.map((v) => (
                <RealmRow key={v.id} v={v} now={now} serverTime={serverTime} go={go} noteOf={noteOf} />
              ))}
            </div>
            {total > 1 && totals && <TotalsRow t={totals} now={now} />}
          </div>
          {total <= 1 && (
            <p className="rl-hint">
              This is your only village for now. When you found more, they all appear here: stock, building, training, troops and incoming attacks side by side.
            </p>
          )}
          {pg.pages > 1 && (
            <div className="rl-pager" data-rl="pager">
              <span className="fv-mut">
                Page {pg.page + 1} of {pg.pages} · villages {pg.from}–{pg.to} of {pg.total}
              </span>
              <span className="fv-sp" />
              <button type="button" className="fv-pg" aria-label="Previous page" disabled={pg.page <= 0} onClick={() => setPageNo(pg.page - 1)}>
                <Chev flip size={16} />
              </button>
              <button type="button" className="fv-pg" aria-label="Next page" disabled={pg.page >= pg.pages - 1} onClick={() => setPageNo(pg.page + 1)}>
                <Chev size={16} />
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---- Phone cards -----------------------------------------------------------------------------------------------------------

function CardSection({ label, onGo, children, className = '' }: { label: string; onGo: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" className={`rlc-sec ${className}`.trim()} aria-label={label} onClick={onGo}>
      {children}
    </button>
  );
}

function RealmCard({ v, now, serverTime, go, noteOf }: { v: RealmVillageDto; now: number; serverTime: number; go: ReturnType<typeof useRealmPage>['go']; noteOf: (v: RealmVillageDto) => RealmVillageDto['note'] }) {
  const note = noteOf(v);
  const stock = stockPerResource(v, serverTime, now);
  const s = buildSummary(v);
  return (
    <li className={`rlc${v.incoming.attacks > 0 ? ' is-attacked' : ''}`}>
      <div className="rlc-head">
        <button type="button" className="rlc-title" aria-label={`Open ${v.name}`} onClick={() => go(v.id, 'village')}>
          <b>{v.name}</b>
          <span className="rl-sub">
            {formatCoords(v.x, v.y)} · {formatInt(v.points)} pts
          </span>
        </button>
        <NoteButton kind="village" targetId={v.id} title={v.name} subtitle={`${formatCoords(v.x, v.y)} · your village`} hasNote={note !== null} />
      </div>
      {(v.hearth === 'out' || (note && note.tags.length > 0)) && (
        <div className="rlc-chips">
          <HoldChip v={v} now={now} />
          {note && note.tags.length > 0 && <NoteChips tags={note.tags} />}
        </div>
      )}
      <CardSection label={`${v.name}: stock`} onGo={() => go(v.id, 'village')} className="rlc-stock">
        {stock.map((r) => (
          <span key={r.id} className={`rl-st is-${r.fill}`}>
            <span className="rl-st-top">
              <Icon name={RESOURCE_ICON[r.id]} size={18} />
              <b>{formatCompact(r.amount)}</b>
              <small className={Math.round(r.income) <= 0 ? 'is-zero' : ''}>{formatRate(r.income)}</small>
              <span className="visually-hidden">
                {RESOURCE_NAME[r.id]} of {formatInt(v.storageCap)}
                {r.fill === 'full' ? ' (full)' : r.fill === 'near' ? ' (nearly full)' : ''}
              </span>
            </span>
            <Bar ratio={r.ratio} />
          </span>
        ))}
      </CardSection>
      <CardSection label={`${v.name}: population`} onGo={() => go(v.id, 'village')} className="rlc-line">
        <span className="rlc-k">Population</span>
        <PopCell used={v.population.used} cap={v.population.cap} />
      </CardSection>
      <CardSection label={`${v.name}: construction`} onGo={() => go(v.id, 'village')} className="rlc-line">
        <span className="rlc-k">Building</span>
        <span className="rlc-v">
          <span className="rl-ln">
            {s.first ? (
              <>
                <span className="rl-ln-t">{jobText(s.first)}</span>
                <b className="rl-time">{formatDuration(msLeft(s.first.finishAt, now))}</b>
              </>
            ) : (
              <span className="rl-idle">Nothing building</span>
            )}
          </span>
          {s.second && (
            <span className="rl-ln is-2nd">
              <span className="rl-ln-t">
                then {jobText(s.second)}
                {s.more > 0 ? ` (+${s.more})` : ''}
              </span>
            </span>
          )}
          {s.free > 0 && <FreeSlotChip n={s.free} />}
        </span>
      </CardSection>
      <CardSection label={`${v.name}: training`} onGo={() => go(v.id, 'army')} className="rlc-line">
        <span className="rlc-k">Training</span>
        <span className="rlc-v">
          <TrainCell v={v} now={now} max={3} />
        </span>
      </CardSection>
      <CardSection label={`${v.name}: troops at home`} onGo={() => go(v.id, 'army')} className="rlc-line">
        <span className="rlc-k">Troops</span>
        <span className="rlc-v">
          <TroopChips troops={v.troops} size={22} />
        </span>
      </CardSection>
      <CardSection label={`${v.name}: movements`} onGo={() => go(v.id, 'army')} className="rlc-line">
        <span className="rlc-k">Moves</span>
        <span className="rlc-v rl-moves">
          <IncomingBadge attacks={v.incoming.attacks} nextAt={v.incoming.nextAt} now={now} />
          <OutgoingBadge marches={v.outgoing.marches} nextAt={v.outgoing.nextAt} now={now} />
          {v.incoming.attacks === 0 && v.outgoing.marches === 0 && <span className="rl-idle">Quiet</span>}
        </span>
      </CardSection>
    </li>
  );
}

function TotalsCard({ t, now }: { t: RealmTotals; now: number }) {
  const ratio = ratioOf(t.population.used, t.population.cap);
  return (
    <section className="rlc rlc-total" aria-label="Realm total">
      <div className="rlc-head">
        <div className="rlc-title is-static">
          <b>Realm total</b>
          <span className="rl-sub">{t.villages === 1 ? '1 village' : `${t.villages} villages`}</span>
        </div>
      </div>
      <div className="rlc-sec rlc-stock is-static">
        {RESOURCE_IDS.map((r) => (
          <span key={r} className="rl-st">
            <span className="rl-st-top">
              <Icon name={RESOURCE_ICON[r]} size={18} />
              <b>{formatCompact(t.resources[r])}</b>
              <small className={Math.round(t.income[r]) <= 0 ? 'is-zero' : ''}>{formatRate(t.income[r])}</small>
              <span className="visually-hidden">{RESOURCE_NAME[r]}</span>
            </span>
            <Bar ratio={ratioOf(t.resources[r], t.cap)} />
          </span>
        ))}
      </div>
      <div className="rlc-sec rlc-line is-static">
        <span className="rlc-k">Population</span>
        <span className={`rl-pop is-${fillOf(ratio)}`}>
          <span className="rl-pop-n">
            <b>{formatCompact(t.population.used)}</b>
            <small>/ {formatCompact(t.population.cap)}</small>
          </span>
          <Bar ratio={ratio} />
        </span>
      </div>
      <div className="rlc-sec rlc-line is-static">
        <span className="rlc-k">Building</span>
        <span className="rlc-v">{t.freeSlots > 0 ? <FreeSlotChip n={t.freeSlots} /> : <span className="rl-idle">No free slots</span>}</span>
      </div>
      <div className="rlc-sec rlc-line is-static">
        <span className="rlc-k">Troops</span>
        <span className="rlc-v">
          <TroopChips troops={t.troops} size={22} />
        </span>
      </div>
      <div className="rlc-sec rlc-line is-static">
        <span className="rlc-k">Moves</span>
        <span className="rlc-v rl-moves">
          <IncomingBadge attacks={t.incoming.attacks} nextAt={t.incoming.nextAt} now={now} />
          <OutgoingBadge marches={t.outgoing.marches} nextAt={t.outgoing.nextAt} now={now} />
          {t.incoming.attacks === 0 && t.outgoing.marches === 0 && <span className="rl-idle">Quiet</span>}
        </span>
      </div>
    </section>
  );
}

function RealmCards() {
  const { data, error, refresh, now, serverTime, sort, setSort, sorted, totals, go, noteOf } = useRealmPage();
  return (
    <div className="page rl-page">
      <PageHeader icon="realm" title="Realm" count={data ? (sorted.length === 1 ? '1 village' : `${sorted.length} villages`) : undefined} />
      {error && (
        <p className="form-error" role="alert">
          {error}{' '}
          <button type="button" className="link" onClick={() => void refresh()}>
            Retry
          </button>
        </p>
      )}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <>
          {sorted.length > 1 && (
            <div className="rlc-sortbar">
              <label className="rlc-sortlab">
                <span>Sort by</span>
                <select className="input rlc-select" value={sort.key} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort villages by">
                  {SORT_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {SORT_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn btn-small" aria-pressed={sort.reverse} onClick={() => setSort(sort.key)}>
                {sort.reverse ? 'Reversed' : 'Reverse'}
              </button>
            </div>
          )}
          {totals && sorted.length > 1 && <TotalsCard t={totals} now={now} />}
          <ul className="rlc-list">
            {sorted.map((v) => (
              <RealmCard key={v.id} v={v} now={now} serverTime={serverTime} go={go} noteOf={noteOf} />
            ))}
          </ul>
          {sorted.length <= 1 && <p className="muted rl-hint-phone">This is your only village for now. When you found more, they all appear here side by side.</p>}
        </>
      )}
    </div>
  );
}

export function RealmView() {
  return useIsDesktop() ? <RealmTable /> : <RealmCards />;
}
