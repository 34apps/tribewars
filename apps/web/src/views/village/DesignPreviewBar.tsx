// Control bar for the test-mode "Design preview": pick one building (or "All buildings" = the wall) and step it through its
// levels in the real village scene.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BUILDINGS, BUILDING_IDS } from '@clanfire/engine';
import type { BuildingId } from '@clanfire/engine';
import { buildingStage, wallLook } from '../../art/buildings.ts';
import {
  LANDSCAPE_CHOICES,
  previewRange,
  setDesignPreview,
  setPreviewBuilding,
  setPreviewLandscape,
  setPreviewLevel,
  setPreviewLook,
  setPreviewWork,
  useDesignPreview,
  type LandscapeChoice,
  type PreviewBuilding,
} from './designPreviewState.ts';

const bar: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '8px 10px',
  background: 'rgba(24,18,12,0.92)',
  color: '#f3e7d0',
  border: '1px solid rgba(243,231,208,0.25)',
  borderRadius: 10,
  fontSize: 14,
  boxSizing: 'border-box',
  // The desktop board header ignores pointer events; the bar must not inherit that.
  pointerEvents: 'auto',
};
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 };
const btn: React.CSSProperties = { minWidth: 44, minHeight: 44 };
const select: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  minHeight: 44,
  padding: '0 8px',
  font: 'inherit',
  color: '#2a1f14',
  background: '#f3e7d0',
  border: '1px solid rgba(243,231,208,0.6)',
  borderRadius: 8,
};

/** Named first (the ones the owner checks most), then the rest in game order. */
const PICKER_ORDER: readonly BuildingId[] = [
  ...(['hall', 'lumber', 'farm', 'mine', 'goldmine', 'wall'] as const),
  ...BUILDING_IDS.filter((id) => !['hall', 'lumber', 'farm', 'mine', 'goldmine', 'wall'].includes(id)),
];

/** The picture a building shows at a level (the wall's fourth, grand look is drawn in code). 0 = not built. */
const look = (id: BuildingId, level: number): number => (id === 'wall' ? wallLook(level) : buildingStage(id, level));

/** Levels (1..max) whose picture differs from the level before. */
function changeLevels(id: BuildingId): number[] {
  const out: number[] = [];
  for (let l = 1; l <= BUILDINGS[id].maxLevel; l++) if (look(id, l) !== look(id, l - 1)) out.push(l);
  return out;
}

export function DesignPreviewBar({ inline = false }: { inline?: boolean }) {
  const { level, building, landscape, look: allLook, work } = useDesignPreview();
  const [playing, setPlaying] = useState(false);
  const { max } = previewRange(building);
  const subject: BuildingId = building ?? 'wall';

  useEffect(() => {
    if (!playing) return;
    if (level >= max) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setPreviewLevel(level + 1), 1000);
    return () => clearTimeout(t);
  }, [playing, level, max]);

  const lvl = Math.min(level, BUILDINGS[subject].maxLevel);
  const changed = lvl > 0 && look(subject, lvl) !== look(subject, lvl - 1);
  const name = BUILDINGS[subject].name;
  const info =
    lvl === 0
      ? 'Level 0: no wall.'
      : changed
        ? `New picture at level ${lvl}.`
        : `Same picture as level ${lvl - 1}.`;
  const changes = building ? changeLevels(building) : null;

  const content = (
    <>
      <div style={row}>
        <select
          style={select}
          aria-label="Building to preview"
          value={building ?? ''}
          onChange={(e) => {
            setPlaying(false);
            setPreviewBuilding((e.target.value || null) as PreviewBuilding);
          }}
        >
          <option value="">All buildings</option>
          {PICKER_ORDER.map((id) => (
            <option key={id} value={id}>
              {BUILDINGS[id].name}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-small" style={btn} onClick={() => setDesignPreview(false)}>Exit preview</button>
      </div>
      <div style={row}>
        <label htmlFor="dp-landscape" style={{ flex: '0 0 auto' }}>Landscape</label>
        <select
          id="dp-landscape"
          style={select}
          value={landscape}
          onChange={(e) => setPreviewLandscape(e.target.value as LandscapeChoice)}
        >
          {LANDSCAPE_CHOICES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div style={row}>
        <button type="button" className="btn btn-small" style={btn} aria-label="Previous level" onClick={() => { setPlaying(false); setPreviewLevel(level - 1); }}>−</button>
        <input
          id="dp-slider"
          type="range"
          min={previewRange(building).min}
          max={max}
          value={level}
          aria-label="Preview level"
          style={{ flex: '1 1 auto', minWidth: 0, minHeight: 44 }}
          onChange={(e) => { setPlaying(false); setPreviewLevel(Number(e.target.value)); }}
        />
        <button type="button" className="btn btn-small" style={btn} aria-label="Next level" onClick={() => { setPlaying(false); setPreviewLevel(level + 1); }}>+</button>
        <button
          type="button"
          className="btn btn-small"
          style={btn}
          onClick={() => {
            if (playing) setPlaying(false);
            else {
              if (level >= max) setPreviewLevel(1);
              setPlaying(true);
            }
          }}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
      </div>
      <div style={{ ...row, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`btn btn-small${work ? ' btn-primary' : ''}`}
          style={btn}
          aria-pressed={work}
          onClick={() => setPreviewWork(!work)}
        >
          Building work: {work ? 'on' : 'off'}
        </button>
      </div>
      {(!building || (building !== 'wall' && changes && changes.length > 0)) && (
        <div style={{ ...row, flexWrap: 'wrap' }} role="group" aria-label="Jump to a look">
          {([1, 2, 3, 4] as const).map((n) => {
            const first = building ? changes![n - 1] : n;
            if (first === undefined) return null;
            const active = building ? look(building, lvl) === n : allLook === n;
            return (
              <button
                key={n}
                type="button"
                className={`btn btn-small${active ? ' btn-primary' : ''}`}
                style={btn}
                aria-pressed={active}
                onClick={() => {
                  setPlaying(false);
                  if (building) setPreviewLevel(first);
                  else setPreviewLook(n);
                }}
              >
                Look {n}
              </button>
            );
          })}
          <button
            type="button"
            className="btn btn-small"
            style={btn}
            aria-label="Replay the look change animation"
            onClick={() => {
              // Step to another look and straight back: the scene plays the build moment again.
              setPlaying(false);
              if (building) {
                const i = look(building, lvl) - 1;
                const other = changes![i > 0 ? i - 1 : 1];
                if (other === undefined) return;
                const back = lvl;
                setPreviewLevel(other);
                window.setTimeout(() => setPreviewLevel(back), 60);
              } else {
                const back = allLook;
                setPreviewLook(back === 1 ? 2 : 1);
                window.setTimeout(() => (back ? setPreviewLook(back) : setPreviewLevel(level)), 60);
              }
            }}
          >
            Replay
          </button>
        </div>
      )}
      <div style={{ fontSize: 12, lineHeight: 1.35 }} aria-live="polite">
        <strong style={{ fontSize: 14 }}>
          {building ? `${name} · Level ${lvl} of ${BUILDINGS[subject].maxLevel}` : allLook ? `All buildings · Look ${allLook}` : `All buildings · Level ${lvl}`}
        </strong>
        <span style={{ opacity: 0.85 }}>
          {' '}
          — {building ? info : allLook ? 'Every building at the first level of this look.' : 'Every building at this level (or its max).'}
          {changes && changes.length > 0 ? ` Picture changes at level ${changes.join(', ')}.` : ''}
        </span>
      </div>
    </>
  );

  // Phone: an ordinary strip under the village, so it takes its own space and never covers the scene.
  if (inline) {
    return (
      <div style={{ ...bar, flexShrink: 0, borderRadius: 0, borderWidth: '1px 0 0' }} role="group" aria-label="Design preview">
        {content}
      </div>
    );
  }
  // Desktop: drawn straight into <body>: inside the village board an ancestor's containment/overflow would clip or move a fixed bar.
  return createPortal(
    <div
      style={{ ...bar, position: 'fixed', bottom: 8, right: 8, width: 420, maxWidth: 'calc(100vw - 16px)', zIndex: 30 }}
      role="group"
      aria-label="Design preview"
    >
      {content}
    </div>,
    document.body,
  );
}
