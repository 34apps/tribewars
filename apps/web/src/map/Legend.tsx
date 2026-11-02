import { useState } from 'react';
import { MAP_STAGE_NAMES } from '@clanfire/engine';
import { ALLEGIANCE_STYLE, stageRange } from './allegiance.ts';
import { ALLEGIANCES, STAGE_FILES, artUrl } from './sprites.ts';

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
              <img src={artUrl('ruined-town')} alt="" width={52} height={64} decoding="async" />
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
        </ul>
      </div>
    </details>
  );
}
