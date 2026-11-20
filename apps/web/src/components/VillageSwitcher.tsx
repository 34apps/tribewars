// Village switcher (docs/GAME_DESIGN.md 18.2, step 2): the village name in the HUD names the current village; tapping it opens
// the list of all my villages (name, coordinates, points, hearth, incoming attack, protection, stock). Choosing one makes it the
// current village everywhere. Phone: the name hangs under the top band as a cream "tab" (name, coordinate tag, protection tag, pencil); with
// one village the name is a plain label. The desktop frame pill opens a rename popover.

import { useEffect, useRef, useState } from 'react';
import { RESOURCE_IDS, villagePoints } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { Icon } from '../art/Icon.tsx';
import { formatCompact, formatCoords, formatCoordsTag, formatInt, formatLeft } from '../format.ts';
import { useGame } from '../game.ts';
import { RESOURCE_ICON, RESOURCE_NAME } from '../icons.ts';
import { orderVillages, villageBadges, villageLabel } from '../villages.ts';
import { RenameButton, RenameVillage } from './RenameVillage.tsx';

export { RenameVillage };

const BADGE_TAG = { attack: 'tag-bad', cold: 'tag-muted', protected: 'tag-info' } as const;

/** Phone: the village tab under the top band. Name (the switcher button with several villages), coordinate tag, protection tag while protected, pencil. */
export function VillageTab() {
  const { village, player, now } = useGame();
  const protectedLeft = player.protectedUntil - now;
  return (
    <div className="vtab-row">
      <div className="vtab">
        <VillageSwitch />
        <span className="vtag vtag-xy">{formatCoordsTag(village.x, village.y)}</span>
        {protectedLeft > 0 && (
          <span
            className="vtag vtag-prot"
            role="img"
            title={`Protected from attacks for ${formatLeft(protectedLeft)}`}
            aria-label={`Protected from attacks, ${formatLeft(protectedLeft)} left`}
          >
            <Icon name="shield" size={15} />
            <span aria-hidden="true">{formatLeft(protectedLeft)}</span>
          </span>
        )}
        <RenameButton />
      </div>
    </div>
  );
}

/** The village name with its list (several villages) plus the pencil "Rename village" right next to it, whatever the village count. */
export function VillageBar({ frame = false }: { frame?: boolean }) {
  if (!frame) return <VillageTab />;
  return (
    <div className="vb-row fr-vrow">
      <VillageSwitch frame />
      <RenameButton frame />
    </div>
  );
}

/** `frame`: the desktop top bar's look (name over coordinates and points, a chevron button); same list, same actions. */
function VillageSwitch({ frame = false }: { frame?: boolean } = {}) {
  const { village, villages, villageList, selectVillage, now, navigate, tab, live } = useGame();
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
  const nameBlock = (
    <span className="fr-vname">
      <b>{village.name}</b>
      <small>
        {formatCoords(village.x, village.y)} · {formatInt(villagePoints(live))} points
      </small>
    </span>
  );
  if (villages.length < 2) {
    if (frame) {
      // Frame (desktop): the name is a button that opens a small popover with just the rename form.
      return (
        <div className="hud-village-wrap fr-vwrap" ref={ref}>
          <button
            type="button"
            className={`fr-vbtn${village.hearth ? ' is-cold' : ''}`}
            aria-expanded={open}
            aria-haspopup="true"
            aria-label={`${village.name}. Rename village`}
            onClick={() => setOpen((o) => !o)}
          >
            {nameBlock}
          </button>
          {open && (
            <div className="vsw-pop fr-rename-pop" role="group" aria-label="Rename village">
              <div className="vsw-foot">
                <RenameVillage onDone={() => setOpen(false)} />
              </div>
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="hud-village-wrap vtab-switch">
        <span className="vtab-name is-static">{village.name}</span>
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
  const attackedText = attacked === 1 ? '1 other village is under attack' : `${attacked} other villages are under attack`;
  const currentBadges = current ? villageBadges(current, now) : [];

  return (
    <div className={`hud-village-wrap${frame ? ' fr-vwrap' : ' vtab-switch'}`} ref={ref}>
      {frame ? (
        <button
          type="button"
          className={`fr-vbtn${village.hearth ? ' is-cold' : ''}`}
          aria-expanded={open}
          aria-haspopup="true"
          aria-label={`${villageLabel(village)}, ${villages.length} villages${attacked > 0 ? `, ${attackedText}` : ''}. Switch village`}
          onClick={() => setOpen((o) => !o)}
        >
          {nameBlock}
          {currentBadges.map((b) => (
            <span key={b.kind} className={`tag ${BADGE_TAG[b.kind]} hud-village-tag fr-vtag`} title={b.text}>
              {b.text}
            </span>
          ))}
          {/* A round count (the full words are the title and the button's label): the bar must never push the bell and the account out. */}
          {attacked > 0 && (
            <span className="tag tag-bad hud-village-tag fr-vbadge" title={attackedText}>
              {attacked}
            </span>
          )}
          <span className="fr-sw" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d={open ? 'M3 10l5-5 5 5' : 'M3 6l5 5 5-5'} />
            </svg>
          </span>
        </button>
      ) : (
        <button
          type="button"
          className={`vtab-name${village.hearth ? ' is-cold' : ''}`}
          aria-expanded={open}
          aria-haspopup="true"
          aria-label={`${villageLabel(village)}, ${villages.length} villages${attacked > 0 ? `, ${attackedText}` : ''}. Switch village`}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="vtab-name-text">{village.name}</span>
          <svg className="vtab-chev" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={open ? 'M3 10l5-5 5 5' : 'M3 6l5 5 5-5'} />
          </svg>
        </button>
      )}
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
