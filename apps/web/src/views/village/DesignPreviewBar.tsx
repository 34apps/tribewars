// Control bar for the test-mode "Design preview": step every building through levels 0-20 in the real village scene.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BUILDINGS, BUILDING_IDS } from '@clanfire/engine';
import { wallLook } from '../../art/buildings.ts';
import { PREVIEW_MAX_LEVEL, setDesignPreview, setPreviewLevel, useDesignPreview } from './designPreviewState.ts';

const bar: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  background: 'rgba(24,18,12,0.88)',
  color: '#f3e7d0',
  border: '1px solid rgba(243,231,208,0.25)',
  borderRadius: 10,
  fontSize: 14,
  boxSizing: 'border-box',
  // The desktop board header ignores pointer events; the bar must not inherit that.
  pointerEvents: 'auto',
};
const btn: React.CSSProperties = { minWidth: 44, minHeight: 44 };

export function DesignPreviewBar({ floating = false }: { floating?: boolean }) {
  const { level } = useDesignPreview();
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (level >= PREVIEW_MAX_LEVEL) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setPreviewLevel(level + 1), 1000);
    return () => clearTimeout(t);
  }, [playing, level]);

  // Only the wall is drawn in this preview.
  const max = BUILDINGS.wall.maxLevel;
  const changed = BUILDING_IDS.filter(
    (id) => id === 'wall' && level > 0 && wallLook(Math.min(level, max)) !== wallLook(Math.max(0, Math.min(level - 1, max))),
  );

  // Drawn straight into <body>: inside the village board an ancestor's containment/overflow would clip or move a fixed bar.
  return createPortal(
    <div
      style={floating ? { ...bar, position: 'fixed', bottom: 70, left: 8, right: 8, zIndex: 30 } : { ...bar, position: 'fixed', bottom: 8, right: 8, width: 420, maxWidth: 'calc(100vw - 16px)', zIndex: 30 }}
      role="group"
      aria-label="Design preview"
    >
      <strong style={{ flex: '1 1 auto' }}>Wall preview · Level {level}</strong>
      <button type="button" className="btn btn-small" style={btn} aria-label="Previous level" onClick={() => { setPlaying(false); setPreviewLevel(level - 1); }}>−</button>
      <input
        id="dp-slider"
        type="range"
        min={0}
        max={PREVIEW_MAX_LEVEL}
        value={level}
        aria-label="Preview level"
        style={{ flex: '1 1 120px', minWidth: 100, minHeight: 44 }}
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
            if (level >= PREVIEW_MAX_LEVEL) setPreviewLevel(1);
            setPlaying(true);
          }
        }}
      >
        {playing ? 'Pause' : 'Play'}
      </button>
      <button type="button" className="btn btn-small" style={btn} onClick={() => setDesignPreview(false)}>Exit preview</button>
      <div style={{ flexBasis: '100%', fontSize: 12, opacity: 0.8 }} hidden={floating}>
        {level === 0
          ? 'Level 0: no wall.'
          : changed.length
            ? `New picture at level ${level}: ${changed.map((id) => BUILDINGS[id].name).join(', ')}`
            : `No picture change at level ${level}.`}
      </div>
    </div>,
    document.body,
  );
}
