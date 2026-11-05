import { useState } from 'react';
import { MAP_STAGE_NAMES } from '@clanfire/engine';
import { ALLEGIANCE_STYLE, stageRange } from './allegiance.ts';
import { ROUTE_DOT_COLOR } from './render.ts';
import { ALLEGIANCES, STAGE_FILES, artUrl } from './sprites.ts';
import { SiteGlyph } from './SiteGlyph.tsx';

/** "Map key": village growth stages by points, allegiance banners, ruins and protection. Open by default on wide screens. */
export function Legend() {
  const [startOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1100px) and (min-height: 760px)').matches);
  return (
    <details className="wm-legend" open={startOpen}>
      <summary>
        <svg className="wm-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6.5 9 4l6 2.5L20 4v13.5L15 20l-6-2.5L4 20z" />
          <path d="M9 4v13.5M15 6.5V20" />
        </svg>
        Map key
      </summary>
      <div className="wm-legend-body">
        <h3>Village size · points</h3>
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
              <small>Abandoned · raid them</small>
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
            Hearth out: grey ring and smoke. Someone is holding it
          </li>
        </ul>
        <h3>Fire sites · bonus Renown</h3>
        <ul className="wm-legend-banners wm-legend-sites">
          <li>
            <SiteGlyph kind="fire_shrine" awake size={38} />
            Fire Shrine, awake
          </li>
          <li>
            <SiteGlyph kind="fire_shrine" awake={false} size={38} />
            Fire Shrine, dormant (ash)
          </li>
          <li className="wm-legend-wide">
            <SiteGlyph kind="great_fire" awake size={38} />
            Great Fire: bigger bonus. Ring colour: green = your tribe, red = another tribe, grey = nobody
          </li>
        </ul>
        <h3>Route to the selected tile</h3>
        <ul className="wm-legend-banners">
          <li>
            <span className="wm-route-dot" style={{ background: ROUTE_DOT_COLOR.grass }} aria-hidden="true" />
            Open ground
          </li>
          <li>
            <span className="wm-route-dot" style={{ background: ROUTE_DOT_COLOR.hills }} aria-hidden="true" />
            Forest, hills: slower
          </li>
          <li className="wm-legend-wide">
            <span className="wm-route-dot" style={{ background: ROUTE_DOT_COLOR.mountain }} aria-hidden="true" />
            Mountains, water: much slower (never more than 2.2 times the flat time)
          </li>
        </ul>
      </div>
    </details>
  );
}
