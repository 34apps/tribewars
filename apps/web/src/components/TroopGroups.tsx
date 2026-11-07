import { useState } from 'react';
import { TROOP_GROUP_MAX, TROOP_GROUP_NAME_MAX, UNITS, UNIT_IDS, checkTroopGroup } from '@clanfire/engine';
import type { TroopGroupDto, Units } from '@clanfire/engine';
import { errorMessage } from '../api.ts';
import type { TroopGroupsStore } from '../hooks/useTroopGroups.ts';
import type { BuiltinGroup } from '../troopGroups.ts';

/** "40 Raiders, 5 Pikemen" for a chip's tooltip and the manage list. */
export function groupSummary(units: Partial<Units>): string {
  return UNIT_IDS.filter((u) => (units[u] ?? 0) > 0)
    .map((u) => `${units[u]} ${UNITS[u].name}${units[u] === 1 ? '' : 's'}`)
    .join(', ');
}

/**
 * Chips above the troop picker: the built-in groups, then the player's saved groups. A tap fills the form (the parent decides how).
 * "Save as group" keeps the current choice under a name; "Manage" lists the saved groups with Rename and Delete.
 */
export function TroopGroupBar({
  builtins,
  store,
  chosen,
  total,
  onApply,
  onClear,
}: {
  builtins: BuiltinGroup[];
  store: TroopGroupsStore;
  /** What is typed into the form now (clamped to what is at home): this is what "Save as group" keeps. */
  chosen: Partial<Units>;
  total: number;
  onApply: (units: Partial<Units>) => void;
  /** Adds a "Clear" chip that zeroes the form (the send form passes it; other users of the bar may not). */
  onClear?: () => void;
}) {
  const { groups } = store;
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = groups.length >= TROOP_GROUP_MAX;

  async function run(job: () => Promise<void>, done: () => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await job();
      done();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const c = checkTroopGroup(name, chosen);
    if (!c.ok) return setError(c.message);
    void run(
      () => store.create(c.name, c.units),
      () => {
        setSaving(false);
        setName('');
      },
    );
  }

  function rename(g: TroopGroupDto) {
    const c = checkTroopGroup(editName, g.units);
    if (!c.ok) return setError(c.message);
    void run(
      () => store.update(g.id, c.name, g.units),
      () => setEditing(null),
    );
  }

  return (
    <div className="wm-groups">
      <div className="wm-groups-row" role="group" aria-label="Troop groups">
        {builtins.map((g) => (
          <button key={g.id} type="button" className="wm-chip" title={g.hint} onClick={() => onApply(g.units)}>
            {g.label}
          </button>
        ))}
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            className="wm-chip wm-chip-saved"
            title={groupSummary(g.units)}
            aria-label={`${g.name}: ${groupSummary(g.units)}`}
            onClick={() => onApply(g.units)}
          >
            {g.name}
          </button>
        ))}
        {!saving && (
          <button
            type="button"
            className="wm-chip wm-chip-tool"
            disabled={total < 1 || full}
            title={full ? `Limit ${TROOP_GROUP_MAX} groups` : undefined}
            onClick={() => {
              setError(null);
              setSaving(true);
            }}
          >
            Save as group
          </button>
        )}
        {groups.length > 0 && (
          <button type="button" className="wm-chip wm-chip-tool" aria-expanded={managing} onClick={() => setManaging((m) => !m)}>
            {managing ? 'Done' : 'Manage'}
          </button>
        )}
        {onClear && (
          <button type="button" className="wm-chip wm-chip-tool" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      {full && !saving && <span className="wm-muted">{TROOP_GROUP_MAX}/{TROOP_GROUP_MAX} saved</span>}
      {saving && (
        <div className="wm-groups-edit">
          <label className="wm-groups-label" htmlFor="troop-group-name">
            Group name
          </label>
          <input
            id="troop-group-name"
            className="wm-input wm-groups-name"
            type="text"
            maxLength={TROOP_GROUP_NAME_MAX}
            autoComplete="off"
            value={name}
            placeholder="e.g. Raid party"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                save();
              }
            }}
          />
          <button type="button" className="wm-btn wm-btn-small wm-btn-sun" disabled={busy || name.trim() === ''} onClick={save}>
            Save
          </button>
          <button type="button" className="wm-btn wm-btn-small" onClick={() => setSaving(false)}>
            Cancel
          </button>
        </div>
      )}
      {managing && groups.length > 0 && (
        <ul className="wm-groups-list">
          {groups.map((g) => (
            <li key={g.id}>
              {editing === g.id ? (
                <div className="wm-groups-edit">
                  <input
                    className="wm-input wm-groups-name"
                    type="text"
                    aria-label={`New name for ${g.name}`}
                    maxLength={TROOP_GROUP_NAME_MAX}
                    autoComplete="off"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        rename(g);
                      }
                    }}
                  />
                  <button type="button" className="wm-btn wm-btn-small wm-btn-sun" disabled={busy || editName.trim() === ''} onClick={() => rename(g)}>
                    Save
                  </button>
                  <button type="button" className="wm-btn wm-btn-small" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <span className="wm-groups-item">
                    <strong>{g.name}</strong>
                    <small className="wm-muted">{groupSummary(g.units)}</small>
                  </span>
                  <button
                    type="button"
                    className="wm-btn wm-btn-small"
                    aria-label={`Rename ${g.name}`}
                    onClick={() => {
                      setError(null);
                      setEditing(g.id);
                      setEditName(g.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="wm-btn wm-btn-small"
                    aria-label={`Delete ${g.name}`}
                    disabled={busy}
                    onClick={() => void run(() => store.remove(g.id), () => undefined)}
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="wm-muted wm-groups-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
