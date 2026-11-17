// "Add to raid list" in the map's village panel: abandoned villages only, and only when the world has raid lists and the player has the
// extra. A small chooser: which list, which village the troops leave from, a saved troop group or counts. The server checks everything.

import { useEffect, useState } from 'react';
import { UNITS } from '@clanfire/engine';
import type { RaidListsResponse, UnitId } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { UnitFigure } from '../art/UnitFigure.tsx';
import { groupSummary } from '../components/TroopGroups.tsx';
import { useGame } from '../game.ts';
import { useLock } from '../hooks/useLock.ts';
import { useRaidListsOn } from '../hooks/useRaidListsOn.ts';
import { useTroopGroups } from '../hooks/useTroopGroups.ts';
import { loadRaidListsCached, resetRaidListsCache } from '../raidListsCache.ts';
import { ROW_UNITS, checkNewRow, countsFromUnits } from '../raidLists.ts';
import '../raid.css';

export function AddToRaidList({ x, y, name }: { x: number; y: number; name: string }) {
  const on = useRaidListsOn();
  const { village, villages, navigate } = useGame();
  const [data, setData] = useState<RaidListsResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [listId, setListId] = useState<number | null>(null);
  const [fromId, setFromId] = useState<number>(village.id);
  const [counts, setCounts] = useState<Partial<Record<UnitId, string>>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const lock = useLock();
  const entitled = on && data?.entitled === true;
  const groups = useTroopGroups(open && entitled);

  useEffect(() => {
    if (!on) return;
    let dead = false;
    loadRaidListsCached().then(
      (r) => {
        if (!dead) setData(r);
      },
      () => undefined,
    );
    return () => {
      dead = true;
    };
  }, [on]);
  // A different tile closes the chooser (the panel keeps this component mounted).
  useEffect(() => {
    setOpen(false);
    setMsg(null);
  }, [x, y]);

  if (!on || !data || !data.entitled) return null;
  const lists = data.lists;

  async function add() {
    const check = checkNewRow({ x: String(x), y: String(y), fromVillageId: fromId, counts });
    if (!check.ok) return setMsg({ ok: false, text: check.message });
    const id = listId ?? lists[0]?.id;
    if (id === undefined) return;
    if (!lock.begin()) return;
    setMsg(null);
    try {
      const r = await api.addRaidRow(id, check.body);
      resetRaidListsCache();
      setData((cur) => (cur ? { ...cur, lists: cur.lists.map((l) => (l.id === r.list.id ? r.list : l)) } : cur));
      setMsg({ ok: true, text: `Added ${name} to ${r.list.name}.` });
      setCounts({});
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      lock.end();
    }
  }

  if (!open) {
    return (
      <button type="button" className="wm-btn" onClick={() => setOpen(true)}>
        Add to raid list
      </button>
    );
  }
  return (
    <form
      className="rdl-chooser"
      aria-label="Add to raid list"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      {lists.length === 0 ? (
        <>
          <p className="wm-muted">You have no raid list yet.</p>
          <button type="button" className="wm-btn" onClick={() => navigate('raids')}>
            Open Raid lists
          </button>
        </>
      ) : (
        <>
          <label className="rdl-fld">
            <span className="rdl-lab">List</span>
            <select className="wm-input" value={listId ?? lists[0]?.id} onChange={(e) => setListId(Number(e.target.value))}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.rows.length})
                </option>
              ))}
            </select>
          </label>
          <label className="rdl-fld">
            <span className="rdl-lab">Troops leave from</span>
            <select className="wm-input" value={fromId} onChange={(e) => setFromId(Number(e.target.value))}>
              {villages.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.x}|{v.y})
                </option>
              ))}
            </select>
          </label>
          {groups.groups.length > 0 && (
            <label className="rdl-fld">
              <span className="rdl-lab">Saved troop group</span>
              <select
                className="wm-input"
                value=""
                onChange={(e) => {
                  const g = groups.groups.find((x2) => x2.id === Number(e.target.value));
                  if (g) setCounts(countsFromUnits(g.units));
                }}
              >
                <option value="">Pick a group (or type counts)</option>
                {groups.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}: {groupSummary(g.units)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="rdl-units" role="group" aria-label="Troops">
            {ROW_UNITS.map((u) => (
              <label key={u} className="rdl-un">
                <UnitFigure unit={u} pose="icon" size={24} />
                <input
                  className="wm-input rdl-n"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="0"
                  aria-label={UNITS[u].name}
                  value={counts[u] ?? ''}
                  onChange={(e) => setCounts((c) => ({ ...c, [u]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <div className="rdl-fact">
            <button type="submit" className="wm-btn wm-btn-sun" disabled={lock.busy}>
              Add
            </button>
            <button type="button" className="wm-btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </>
      )}
      {msg && (
        <p className={msg.ok ? 'wm-note' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}
    </form>
  );
}
