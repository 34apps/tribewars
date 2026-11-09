import { useEffect, useId, useRef, useState } from 'react';
import { MAP_STAGE_NAMES } from '@clanfire/engine';
import { ALLEGIANCE_STYLE, stageRange } from './allegiance.ts';
import { ROUTE_DOT_COLOR } from './render.ts';
import { ALLEGIANCES, STAGE_FILES, artUrl } from './sprites.ts';
import { SiteGlyph } from './SiteGlyph.tsx';

/** "Map key": village growth stages by points, allegiance banners, ruins and protection. A round button; closed by default. */
export function Legend({ sites = true }: { sites?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className={`wm-legend${open ? ' wm-legend-open' : ''}`} ref={wrap}>
      <button type="button" className="wm-btn wm-btn-icon" aria-label="Map key" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <svg className="wm-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6.5 9 4l6 2.5L20 4v13.5L15 20l-6-2.5L4 20z" />
          <path d="M9 4v13.5M15 6.5V20" />
        </svg>
      </button>
      <div className="wm-legend-card" id={id} hidden={!open}>
      <div className="wm-legend-body">
        <h3>Size · points</h3>
        <ul className="wm-legend-stages">
          {STAGE_FILES.map((f, i) => (
            <li key={f}>
              <span className="wm-thumb" aria-hidden="true">
                <img src={artUrl(f)} alt="" width={52} height={64} decoding="async" />
              </span>
              <span>
                <b>
                  {i + 1} · {MAP_STAGE_NAMES[i]}
                </b>
                <small>{stageRange(i)}</small>
              </span>
            </li>
          ))}
          <li>
            <span className="wm-thumb" aria-hidden="true">
              <img src={artUrl('abandoned-stage-3-stockade-town')} alt="" width={52} height={64} decoding="async" />
            </span>
            <span>
              <b>Ruins</b>
              <small>Abandoned</small>
            </span>
          </li>
        </ul>
        <h3>Banners</h3>
        <ul className="wm-legend-banners">
          {ALLEGIANCES.map((a) => (
            <li key={a}>
              <img src={artUrl(`banner-${a}`)} alt="" width={26} height={30} decoding="async" />
              {ALLEGIANCE_STYLE[a].label}
            </li>
          ))}
          <li className="wm-legend-wide">
            <span className="wm-dome-sample" aria-hidden="true" />
            Beginner protection
          </li>
          <li className="wm-legend-wide">
            <span className="wm-cold-sample" aria-hidden="true" />
            Hearth out
          </li>
        </ul>
        {sites && (
          <>
            <h3>Fire sites · Renown</h3>
            <ul className="wm-legend-banners wm-legend-sites">
              <li>
                <SiteGlyph kind="fire_shrine" awake size={38} />
                Shrine, awake
              </li>
              <li>
                <SiteGlyph kind="fire_shrine" awake={false} size={38} />
                Shrine, dormant
              </li>
              <li className="wm-legend-wide">
                <SiteGlyph kind="great_fire" awake size={38} />
                Great Fire · ring: green mine, red other, grey none
              </li>
            </ul>
            <h3>Tribe sites</h3>
            <ul className="wm-legend-banners wm-legend-sites">
              <li className="wm-legend-wide">
                <SiteGlyph kind="waymark" awake={false} size={38} />
                Waymark · faster travel
              </li>
              <li className="wm-legend-wide">
                <SiteGlyph kind="lookout" awake={false} size={38} />
                Lookout · sees armies
              </li>
            </ul>
          </>
        )}
        <h3>Route</h3>
        <ul className="wm-legend-banners">
          <li>
            <span className="wm-route-dot" style={{ background: ROUTE_DOT_COLOR.grass }} aria-hidden="true" />
            Open
          </li>
          <li>
            <span className="wm-route-dot" style={{ background: ROUTE_DOT_COLOR.hills }} aria-hidden="true" />
            Forest, hills · slow
          </li>
          <li className="wm-legend-wide">
            <span className="wm-route-dot" style={{ background: ROUTE_DOT_COLOR.mountain }} aria-hidden="true" />
            Mountains, water · slower
          </li>
        </ul>
      </div>
      </div>
    </div>
  );
}
