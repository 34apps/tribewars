// Village switcher (docs/GAME_DESIGN.md 18.2, step 2): the village pill in the HUD names the current village; tapping it opens
// the list of all my villages (name, coordinates, points, hearth, incoming attack, protection, stock). Choosing one makes it the
// current village everywhere. With only one village the pill is a plain label (Rename lives in the account menu).

import { useEffect, useRef, useState } from 'react';
import { RESOURCE_IDS } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { Icon } from '../art/Icon.tsx';
import { formatCompact, formatCoords, formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { RESOURCE_ICON, RESOURCE_NAME } from '../icons.ts';
import { orderVillages, renameProblem, villageBadges, villageLabel } from '../villages.ts';
import '../villages.css';

const BADGE_TAG = { attack: 'tag-bad', cold: 'tag-muted', protected: 'tag-info' } as const;

/** Rename the current village: one text field, the same name rules as the server. */
export function RenameVillage({ onDone }: { onDone?: () => void }) {
  const { village, applyVillage, refresh, toast } = useGame();
  const [name, setName] = useState(village.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = renameProblem(name);
  const unchanged = name.trim() === village.name;

  async function save() {
    if (busy || problem || unchanged) return;
    setBusy(true);
    setError(null);
    try {
      applyVillage(await api.renameVillage(village.id, name.trim()));
      toast(`Renamed to ${name.trim()}`);
      onDone?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  return (
    <form
      className="vsw-rename"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label htmlFor="vsw-name" className="vsw-rename-label">
        Village name
      </label>
      <div className="vsw-rename-row">
        <input id="vsw-name" className="input" type="text" maxLength={30} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={busy || !!problem || unchanged}>
          Save
        </button>
      </div>
      {error ? (
        <p className="vsw-error" role="alert">
          {error}
        </p>
      ) : (
        problem &&
        name.length > 0 && <p className="vsw-error">{problem}</p>
      )}
    </form>
  );
}

export function VillageBar() {
  const { village, villages, villageList, selectVillage, now, navigate, tab } = useGame();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // One village: a plain name pill (no list to open). Several: the same pill opens the switcher.
  if (villages.length < 2) {
    return (
      <div className="hud-pill hud-village is-static">
        <Icon name="flame" size={28} />
        <span className="hud-village-name">{village.name}</span>
        <span className="hud-village-xy">{formatCoords(village.x, village.y)}</span>
      </div>
    );
  }

  // Rows come from GET /api/villages; until it arrives the state response gives names and coordinates.
  const rows = orderVillages(
    villageList ??
      villages.map((v) => ({
        id: v.id,
        name: v.name,
        x: v.x,
        y: v.y,
        points: 0,
        hearth: v.hearth ? ('out' as const) : ('lit' as const),
        holdEndsAt: v.hearth?.endsAt ?? null,
        resources: v.state.resources,
        incomingAttack: false,
        nextAttackAt: null,
        protectedUntil: null,
      })),
  );
  const current = rows.find((r) => r.id === village.id);
  const attacked = rows.filter((r) => r.incomingAttack && r.id !== village.id).length;
  const currentBadges = current ? villageBadges(current, now) : [];

  return (
    <div className="hud-village-wrap" ref={ref}>
      <button
        type="button"
        className={`hud-pill hud-village${village.hearth ? ' is-cold' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`${villageLabel(village)}, ${villages.length} villages. Switch village`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="flame" size={28} />
        <span className="hud-village-name">{village.name}</span>
        <span className="hud-village-xy">{formatCoords(village.x, village.y)}</span>
        {currentBadges.map((b) => (
          <span key={b.kind} className={`tag ${BADGE_TAG[b.kind]} hud-village-tag`}>
            {b.text}
          </span>
        ))}
        {attacked > 0 && <span className="tag tag-bad hud-village-tag">{attacked === 1 ? '1 other attacked' : `${attacked} others attacked`}</span>}
        <span className="hud-village-chev" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="vsw-pop" role="group" aria-label="My villages">
          <ul className="vsw-list">
            {rows.map((r) => {
              const badges = villageBadges(r, now);
              const isCurrent = r.id === village.id;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    className={`vsw-row${isCurrent ? ' is-current' : ''}${r.hearth === 'out' ? ' is-cold' : ''}`}
                    aria-current={isCurrent ? 'true' : undefined}
                    onClick={() => {
                      selectVillage(r.id);
                      setOpen(false);
                      setRenaming(false);
                    }}
                  >
                    <span className="vsw-row-head">
                      <span className={`vsw-hearth${r.hearth === 'out' ? ' is-out' : ''}`} aria-hidden="true">
                        <Icon name="flame" size={20} />
                      </span>
                      <span className="vsw-row-name">{r.name}</span>
                      <span className="vsw-row-coords">({r.x}|{r.y})</span>
                      {isCurrent && <span className="vsw-here">Current</span>}
                    </span>
                    <span className="vsw-row-meta">
                      {r.points > 0 && <span>{formatInt(r.points)} pts</span>}
                      {RESOURCE_IDS.map((res) => (
                        <span key={res} className="vsw-res" title={RESOURCE_NAME[res]}>
                          <Icon name={RESOURCE_ICON[res]} size={14} className="inline-icon" />
                          <span className="visually-hidden">{RESOURCE_NAME[res]} </span>
                          {formatCompact(r.resources[res])}
                        </span>
                      ))}
                    </span>
                    {badges.length > 0 && (
                      <span className="vsw-row-badges">
                        {badges.map((b) => (
                          <span key={b.kind} className={`tag ${BADGE_TAG[b.kind]}`}>
                            {b.text}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="vsw-foot">
            {renaming ? (
              <RenameVillage onDone={() => setRenaming(false)} />
            ) : (
              <button type="button" className="btn btn-small" onClick={() => setRenaming(true)}>
                Rename
              </button>
            )}
            {tab !== 'village' && (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  setOpen(false);
                  navigate('village');
                }}
              >
                Open village
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
