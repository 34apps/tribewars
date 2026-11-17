// Raid lists (a paid extra): save abandoned villages with the troops for each and send them all with one press. Convenience only:
// every row is an ordinary attack the server checks like any other send (troops at home, protection, march limit, rate limit).
// One responsive page: the desktop frame (fixed 1440 x 900, 8 rows a page, nothing scrolls) and the phone sheet (5 rows a page).
// Without the extra the same page shows a short note and every control is disabled (no requests are made).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { RAID_LIST_MAX_LISTS, RAID_LIST_MAX_ROWS, RAID_LIST_NAME_MAX, RAID_LIST_SEND_CAP, UNITS } from '@clanfire/engine';
import type { RaidListDto, RaidListRowDto, RaidListsResponse, UnitId, Units } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { Icon } from '../art/Icon.tsx';
import { UnitFigure } from '../art/UnitFigure.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { groupSummary } from '../components/TroopGroups.tsx';
import { formatCompact, formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { useExtraRows } from '../hooks/useExtraRows.ts';
import { useIsDesktop } from '../hooks/useLayout.ts';
import { useLock } from '../hooks/useLock.ts';
import { useTroopGroups } from '../hooks/useTroopGroups.ts';
import { Chev } from './village/FrameParts.tsx';
import {
  ROW_UNITS,
  SKIPPED_SHOWN_DESKTOP,
  capNote,
  checkListName,
  checkNewRow,
  countsFromUnits,
  isTicked,
  lastText,
  pageRows,
  rowsPerPage,
  sendLabel,
  summarizeSend,
  tickAll,
  tickedIds,
  toggleTick,
  travelText,
  unitEntries,
} from '../raidLists.ts';
import type { SendSummary } from '../raidLists.ts';
import '../raid.css';

type Counts = Partial<Record<UnitId, string>>;

/** The paid-extra note (plain words; nothing to buy yet). */
export const PAID_EXTRA_NOTE = 'Raid lists are a paid extra. They save clicks: you keep the villages you raid in a list and send them all with one press. They never sell resources, troops or speed, and every raid still follows the normal rules. There is nothing to buy yet.';

// ---- Small pieces -------------------------------------------------------------------------------------------------------------

function TroopChips({ units }: { units: Partial<Units> }) {
  const entries = unitEntries(units);
  if (entries.length === 0) return <span className="rdl-mut">No troops</span>;
  return (
    <span className="rdl-chips">
      {entries.map(({ unit, count }) => (
        <span key={unit} className="rdl-tc" title={`${formatInt(count)} ${UNITS[unit].name}${count === 1 ? '' : 's'}`}>
          <UnitFigure unit={unit} pose="icon" size={22} />
          <b>{formatCompact(count)}</b>
          <span className="visually-hidden">
            {' '}
            {UNITS[unit].name}
          </span>
        </span>
      ))}
    </span>
  );
}

function RowView({
  row,
  fromName,
  now,
  ticked,
  locked,
  busy,
  editing,
  btn,
  onTick,
  onEdit,
  onRemove,
}: {
  row: RaidListRowDto;
  fromName: string;
  now: number;
  ticked: boolean;
  locked: boolean;
  busy: boolean;
  editing: boolean;
  btn: string;
  onTick: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <li className={`rdl-row${row.abandoned ? '' : ' is-gone'}${editing ? ' is-edit' : ''}`}>
      <label className="rdl-tick">
        <input type="checkbox" checked={ticked} disabled={locked || !row.abandoned} onChange={onTick} />
        <span className="visually-hidden">Send to {row.name}</span>
      </label>
      <div className="rdl-tg">
        <b className="rdl-nm">{row.name}</b>
        <small className="rdl-co">({row.x}|{row.y})</small>
        {!row.abandoned && <span className="rdl-warn">Now owned by a player. Remove it.</span>}
      </div>
      <div className="rdl-fr">
        <span className="rdl-lab">From</span>
        {fromName}
      </div>
      <div className="rdl-tr">
        <TroopChips units={row.units} />
      </div>
      <div className="rdl-ds">
        <b>{Math.round(row.distance * 10) / 10} fields</b>
        <small>{travelText(row.travelSeconds)} one way</small>
      </div>
      <div className="rdl-ls">{lastText(row.last, now)}</div>
      <div className="rdl-ac">
        <button type="button" className={btn} disabled={locked || busy} aria-label={`Edit troops of ${row.name}`} onClick={onEdit}>
          Edit troops
        </button>
        <button type="button" className={`${btn} rdl-rm`} disabled={locked || busy} aria-label={`Remove ${row.name} from the list`} onClick={onRemove}>
          <Icon name="close" size={16} />
          <span>Remove</span>
        </button>
      </div>
    </li>
  );
}

function ResultBox({ summary, desktop, onClose, btn }: { summary: SendSummary; desktop: boolean; onClose: () => void; btn: string }) {
  const shown = desktop ? summary.skippedRows.slice(0, SKIPPED_SHOWN_DESKTOP) : summary.skippedRows;
  const more = summary.skippedRows.length - shown.length;
  return (
    <section className="rdl-res" aria-label="Result of the send" role="status">
      <div className="rdl-res-h">
        <b>{summary.headline}</b>
        <button type="button" className={btn} onClick={onClose}>
          OK
        </button>
      </div>
      {summary.skippedRows.length > 0 && (
        <ul className="rdl-skips">
          {shown.map((s) => (
            <li key={s.rowId}>
              <b>{s.name}</b>
              {s.coords && <small> ({s.coords})</small>}
              <span>{s.text}</span>
            </li>
          ))}
          {more > 0 && <li className="rdl-mut">+{more} more skipped</li>}
        </ul>
      )}
      {summary.capNote && <p className="rdl-mut">{summary.capNote}</p>}
    </section>
  );
}

// ---- The panel (everything after the data has loaded) -------------------------------------------------------------------------

export function RaidListsPanel({ data, desktop: desktopProp }: { data: RaidListsResponse; desktop?: boolean }) {
  const game = useGame();
  const { villages, village, now, refresh } = game;
  const layoutDesktop = useIsDesktop();
  const desktop = desktopProp ?? layoutDesktop;
  const extra = useExtraRows(50);
  const perPage = rowsPerPage(desktop, extra);
  const locked = !data.entitled;
  const lock = useLock();
  const groups = useTroopGroups(data.entitled);

  const [lists, setLists] = useState<RaidListDto[]>(data.lists);
  const [selectedId, setSelectedId] = useState<number | null>(data.lists[0]?.id ?? null);
  const [page, setPage] = useState(0);
  const [unticked, setUnticked] = useState<ReadonlySet<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Problems with the add / edit form itself: shown under the form only (everything else is `error`, shown once: in the form column on the
  // desktop, under the send bar on the phone, so the same words never appear twice).
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<SendSummary | null>(null);
  // The add / edit form.
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [fromId, setFromId] = useState<number | null>(village?.id ?? villages[0]?.id ?? null);
  const [counts, setCounts] = useState<Counts>({});
  const [editRow, setEditRow] = useState<number | null>(null);
  const formRef = useRef<HTMLElement>(null);

  const list = lists.find((l) => l.id === selectedId) ?? lists[0] ?? null;
  const rows = list?.rows ?? [];
  const pg = pageRows(rows, page, perPage);
  const ids = tickedIds(rows, unticked);
  const villageName = useCallback((id: number): string => villages.find((v) => v.id === id)?.name ?? 'Village', [villages]);
  const btn = desktop ? 'fv-btn sm' : 'btn btn-small';
  const btnGo = desktop ? 'fv-btn fv-btn-g' : 'btn btn-primary';
  const editing = editRow === null ? null : rows.find((r) => r.id === editRow) ?? null;

  // A deleted or vanished list leaves the selection on the first one; the page never points past the last.
  useEffect(() => {
    if (selectedId !== null && !lists.some((l) => l.id === selectedId)) setSelectedId(lists[0]?.id ?? null);
  }, [lists, selectedId]);
  useEffect(() => {
    if (page !== pg.page) setPage(pg.page);
  }, [page, pg.page]);

  /** One request per press: the shared lock refuses a second press in the same tick; every button greys while one runs. */
  async function act<T>(job: () => Promise<T>, done: (r: T) => void, scope: 'list' | 'form' = 'list') {
    if (locked || !lock.begin()) return;
    setError(null);
    setFormError(null);
    try {
      done(await job());
    } catch (e) {
      (scope === 'form' ? setFormError : setError)(errorMessage(e));
    } finally {
      lock.end();
    }
  }
  const putList = (l: RaidListDto) => setLists((cur) => (cur.some((c) => c.id === l.id) ? cur.map((c) => (c.id === l.id ? l : c)) : [...cur, l]));

  function selectList(id: number) {
    setSelectedId(id);
    setPage(0);
    setResult(null);
    setError(null);
    setRenaming(false);
    setConfirmDelete(false);
    resetForm();
  }
  function resetForm() {
    setFormError(null);
    setEditRow(null);
    setCounts({});
    setX('');
    setY('');
  }

  function createList() {
    const c = checkListName(name);
    if (!c.ok) return setError(c.message);
    void act(
      () => api.createRaidList(c.name),
      (r) => {
        putList(r.list);
        setCreating(false);
        setName('');
        selectList(r.list.id);
      },
    );
  }
  function renameList() {
    if (!list) return;
    const c = checkListName(name);
    if (!c.ok) return setError(c.message);
    void act(
      () => api.renameRaidList(list.id, c.name),
      (r) => {
        putList(r.list);
        setRenaming(false);
        setName('');
      },
    );
  }
  function deleteList() {
    if (!list) return;
    const id = list.id;
    void act(
      () => api.deleteRaidList(id),
      () => {
        setLists((cur) => cur.filter((l) => l.id !== id));
        setConfirmDelete(false);
        setResult(null);
        resetForm();
      },
    );
  }
  function saveRow() {
    if (!list) return;
    const check = checkNewRow({ x: editing ? String(editing.x) : x, y: editing ? String(editing.y) : y, fromVillageId: fromId, counts });
    if (!check.ok) return setFormError(check.message);
    if (editing) {
      void act(
        () => api.updateRaidRow(list.id, editing.id, { fromVillageId: check.body.fromVillageId, units: check.body.units }),
        (r) => {
          putList(r.list);
          resetForm();
        },
        'form',
      );
      return;
    }
    void act(
      () => api.addRaidRow(list.id, check.body),
      (r) => {
        putList(r.list);
        setPage(Math.max(0, Math.ceil(r.list.rows.length / perPage) - 1));
        setCounts({});
        setX('');
        setY('');
      },
      'form',
    );
  }
  function removeRow(row: RaidListRowDto) {
    if (!list) return;
    void act(
      () => api.deleteRaidRow(list.id, row.id),
      (r) => {
        putList(r.list);
        if (editRow === row.id) resetForm();
      },
    );
  }
  function startEdit(row: RaidListRowDto) {
    setEditRow(row.id);
    setFromId(villages.some((v) => v.id === row.fromVillageId) ? row.fromVillageId : fromId);
    setCounts(countsFromUnits(row.units));
    setError(null);
    setFormError(null);
    formRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }
  function send() {
    if (!list || ids.length === 0) return;
    const sent = list;
    void act(
      () => api.sendRaidList(sent.id, { rowIds: ids }),
      (res) => {
        setResult(summarizeSend(res, sent));
        // Troops left home and new marches exist: the one state fetch the send needs (no village comes back in the response).
        void refresh();
      },
    );
  }
  function applyGroup(units: Partial<Units>) {
    const next: Counts = {};
    for (const u of ROW_UNITS) if ((units[u] ?? 0) > 0) next[u] = String(units[u]);
    setCounts(next);
  }

  const atListLimit = lists.length >= RAID_LIST_MAX_LISTS;
  const atRowLimit = rows.length >= RAID_LIST_MAX_ROWS;
  const off = locked || lock.busy;

  // ---- Tabs ----
  const tabs = (
    <div className="rdl-tabs" role="group" aria-label="Your raid lists">
      {lists.map((l) => (
        <button key={l.id} type="button" className={`rdl-chip${list?.id === l.id ? ' on' : ''}`} aria-pressed={list?.id === l.id} disabled={locked} onClick={() => selectList(l.id)}>
          {l.name}
          <i>{l.rows.length}</i>
        </button>
      ))}
      {!creating && (
        <button
          type="button"
          className="rdl-chip rdl-chip-new"
          disabled={off || atListLimit}
          title={atListLimit ? `You can keep ${RAID_LIST_MAX_LISTS} lists` : undefined}
          onClick={() => {
            setCreating(true);
            setRenaming(false);
            setName('');
            setError(null);
          }}
        >
          + New list
        </button>
      )}
    </div>
  );

  const nameForm = (creating || renaming) && (
    <form
      className="rdl-nameform"
      onSubmit={(e) => {
        e.preventDefault();
        if (creating) createList();
        else renameList();
      }}
    >
      <label className="rdl-lab" htmlFor="rdl-name">
        {creating ? 'New list name' : 'List name'}
      </label>
      <input id="rdl-name" className="rdl-in" type="text" value={name} maxLength={RAID_LIST_NAME_MAX} autoComplete="off" autoFocus onChange={(e) => setName(e.target.value)} />
      <button type="submit" className={btnGo} disabled={off || name.trim() === ''}>
        {creating ? 'Create' : 'Save'}
      </button>
      <button
        type="button"
        className={btn}
        onClick={() => {
          setCreating(false);
          setRenaming(false);
          setError(null);
        }}
      >
        Cancel
      </button>
    </form>
  );

  const listHead = list && !creating && !renaming && (
    <div className="rdl-lh">
      <h3 className="rdl-ln">{list.name}</h3>
      <span className="rdl-mut">
        {list.rows.length} of {RAID_LIST_MAX_ROWS} villages
      </span>
      <span className="fv-sp" />
      {confirmDelete ? (
        <>
          <span className="rdl-ask">Delete this list and its villages?</span>
          <button type="button" className={`${btn} rdl-danger`} disabled={off} onClick={deleteList}>
            Delete list
          </button>
          <button type="button" className={btn} onClick={() => setConfirmDelete(false)}>
            Keep it
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className={btn}
            disabled={off}
            onClick={() => {
              setRenaming(true);
              setName(list.name);
              setError(null);
            }}
          >
            Rename
          </button>
          <button type="button" className={btn} disabled={off} onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        </>
      )}
    </div>
  );

  const rowsView = (
    <>
      {list ? (
        rows.length === 0 ? (
          <p className="rdl-empty">No villages in this list yet. Add one with the form{desktop ? ' on the right' : ' below'}.</p>
        ) : (
          <ul className="rdl-rows">
            {desktop && (
              <li className="rdl-hd" aria-hidden="true">
                <span />
                <span className="rdl-lab">Village</span>
                <span className="rdl-lab">From</span>
                <span className="rdl-lab">Troops</span>
                <span className="rdl-lab">Distance</span>
                <span className="rdl-lab">Last raid</span>
                <span />
              </li>
            )}
            {pg.rows.map((row) => (
              <RowView
                key={row.id}
                row={row}
                fromName={villageName(row.fromVillageId)}
                now={now}
                ticked={isTicked(row, unticked)}
                locked={locked}
                busy={lock.busy}
                editing={editRow === row.id}
                btn={btn}
                onTick={() => setUnticked((u) => toggleTick(u, row.id))}
                onEdit={() => startEdit(row)}
                onRemove={() => removeRow(row)}
              />
            ))}
          </ul>
        )
      ) : (
        <p className="rdl-empty">{locked ? 'Your lists will show here.' : 'You have no raid list yet. Press "+ New list" to make one.'}</p>
      )}
    </>
  );

  const pager = list && rows.length > 0 && (
    <div className="rdl-pgr">
      <span className="rdl-mut">{`${pg.from}\u2013${pg.to} of ${pg.total}`}</span>
      <button type="button" className={desktop ? 'fv-pg' : 'btn btn-small rdl-pg'} aria-label="Earlier villages" disabled={pg.page <= 0} onClick={() => setPage(pg.page - 1)}>
        <Chev flip size={16} />
      </button>
      <span className="rdl-mut">
        {pg.page + 1} / {pg.pages}
      </span>
      <button type="button" className={desktop ? 'fv-pg' : 'btn btn-small rdl-pg'} aria-label="Later villages" disabled={pg.page >= pg.pages - 1} onClick={() => setPage(pg.page + 1)}>
        <Chev size={16} />
      </button>
    </div>
  );

  const eligible = rows.filter((r) => r.abandoned).length;
  const allTicked = ids.length >= eligible;
  const sendBar = (
    <div className="rdl-send">
      <button type="button" className={btn} disabled={locked || rows.length === 0} onClick={() => setUnticked(tickAll(rows, !allTicked))}>
        {allTicked ? 'Tick none' : 'Tick all'}
      </button>
      {pager}
      <span className="fv-sp" />
      <button type="button" className={`${btnGo} rdl-go`} disabled={off || !list || ids.length === 0} onClick={send}>
        {lock.busy ? 'Sending\u2026' : sendLabel(ids.length)}
      </button>
      <p className="rdl-mut rdl-cap">{capNote(ids.length) ?? `Up to ${RAID_LIST_SEND_CAP} rows go with one press. Each one is a normal raid with the usual checks.`}</p>
    </div>
  );

  const form = (
    <section className={desktop ? 'fv-pn rdl-form' : 'rdl-form rdl-card'} aria-label={editing ? 'Edit troops' : 'Add village'} ref={formRef}>
      {desktop ? (
        <div className="fv-ph">
          <h2>{editing ? 'Edit troops' : 'Add village'}</h2>
        </div>
      ) : (
        <h3 className="rdl-fh">{editing ? 'Edit troops' : 'Add village'}</h3>
      )}
      <form
        className="rdl-fb"
        onSubmit={(e) => {
          e.preventDefault();
          saveRow();
        }}
      >
        {editing ? (
          <p className="rdl-target">
            <b>{editing.name}</b> <small>({editing.x}|{editing.y})</small>
          </p>
        ) : (
          <div className="rdl-xy">
            <label className="rdl-fld">
              <span className="rdl-lab">x</span>
              <input className="rdl-in" inputMode="numeric" autoComplete="off" value={x} disabled={off || !list || atRowLimit} onChange={(e) => setX(e.target.value)} />
            </label>
            <label className="rdl-fld">
              <span className="rdl-lab">y</span>
              <input className="rdl-in" inputMode="numeric" autoComplete="off" value={y} disabled={off || !list || atRowLimit} onChange={(e) => setY(e.target.value)} />
            </label>
          </div>
        )}
        <label className="rdl-fld">
          <span className="rdl-lab">Troops leave from</span>
          <select className="rdl-in" value={fromId ?? ''} disabled={off || !list} onChange={(e) => setFromId(Number(e.target.value))}>
            {villages.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.x}|{v.y})
              </option>
            ))}
          </select>
        </label>
        {groups.groups.length > 0 && (
          <div className="rdl-grps" role="group" aria-label="Saved troop groups">
            <span className="rdl-lab">Saved groups</span>
            {groups.groups.map((g) => (
              <button key={g.id} type="button" className="rdl-chip" disabled={off || !list} title={groupSummary(g.units)} aria-label={`${g.name}: ${groupSummary(g.units)}`} onClick={() => applyGroup(g.units)}>
                {g.name}
              </button>
            ))}
          </div>
        )}
        <div className="rdl-units" role="group" aria-label="Troops">
          {ROW_UNITS.map((u) => (
            <label key={u} className="rdl-un">
              <UnitFigure unit={u} pose="icon" size={24} />
              <span className="visually-hidden">{UNITS[u].name}</span>
              <input
                className="rdl-in rdl-n"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                aria-label={UNITS[u].name}
                value={counts[u] ?? ''}
                disabled={off || !list}
                onChange={(e) => setCounts((c) => ({ ...c, [u]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        {(formError ?? (desktop ? error : null)) && (
          <p className="form-error rdl-err" role="alert">
            {formError ?? error}
          </p>
        )}
        <div className="rdl-fact">
          <button type="submit" className={btnGo} disabled={off || !list || (!editing && atRowLimit)}>
            {editing ? 'Save troops' : 'Add to list'}
          </button>
          {editing && (
            <button type="button" className={btn} onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
        {atRowLimit && !editing && <p className="rdl-mut">This list is full ({RAID_LIST_MAX_ROWS} villages).</p>}
      </form>
    </section>
  );

  const note = locked && (
    <p className="rdl-paid" role="note">
      <Icon name="lock" size={20} />
      <span>{PAID_EXTRA_NOTE}</span>
    </p>
  );

  const main = (
    <section className={desktop ? 'fv-pn rdl-main' : 'rdl-main'} aria-label="Raid lists">
      {desktop && (
        <div className="fv-ph">
          <h2>Raid lists</h2>
          <span className="fv-sp" />
          <span className="fv-mut">
            {lists.length} of {RAID_LIST_MAX_LISTS} lists
          </span>
        </div>
      )}
      <div className="rdl-body">
        {note}
        {tabs}
        {nameForm}
        {listHead}
        {rowsView}
        {(list || locked) && sendBar}
        {error && !desktop && (
          <p className="form-error rdl-err" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );

  return (
    <div className={`rdl ${desktop ? 'rdl-desktop' : 'rdl-phone'}${locked ? ' is-locked' : ''}`}>
      {!desktop && <PageHeader icon="raider" title="Raid lists" count={`${lists.length} of ${RAID_LIST_MAX_LISTS}`} />}
      {main}
      <div className="rdl-side">
        {result && <ResultBox summary={result} desktop={desktop} btn={btn} onClose={() => setResult(null)} />}
        {form}
      </div>
    </div>
  );
}

// ---- The page: loads the lists once -------------------------------------------------------------------------------------------

/** The page behind the Raid lists tab. GET /api/raid-lists is open to everyone and says whether the world has the feature and whether
 *  this player has the extra; nothing else is requested without the extra. */
export function RaidListsView() {
  const desktop = useIsDesktop();
  const [data, setData] = useState<RaidListsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api.raidLists());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const frame = (body: ReactNode) =>
    desktop ? (
      <section className="fv-pn rdl-solo" aria-label="Raid lists">
        <div className="fv-ph">
          <h2>Raid lists</h2>
        </div>
        <div className="rdl-body">{body}</div>
      </section>
    ) : (
      <div className="page rdl-page">
        <PageHeader icon="raider" title="Raid lists" />
        {body}
      </div>
    );
  if (error) {
    return frame(
      <p className="form-error" role="alert">
        {error}{' '}
        <button type="button" className="fv-lk" onClick={() => void load()}>
          Retry
        </button>
      </p>,
    );
  }
  if (!data) return frame(<p className="rdl-mut">Loading…</p>);
  if (!data.enabled) return frame(<p className="rdl-mut">Raid lists are not switched on in this world.</p>);
  return <RaidListsPanel data={data} />;
}
