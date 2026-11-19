import { useEffect, useId, useRef, useState } from 'react';
import { MAP_STAGE_NAMES } from '@clanfire/engine';
import { ALLEGIANCE_STYLE, stageRange } from './allegiance.ts';
import { STRONG_COLOR } from './dots.ts';
import { ROUTE_DOT_COLOR } from './render.ts';
import { ALLEGIANCES, STAGE_FILES, artUrl } from './sprites.ts';
import { SiteGlyph } from './SiteGlyph.tsx';

/** "Map key": village growth stages by points, allegiance banners, ruins and protection. A round button; closed by default. */
/** A tiny far-zoom flag (same shapes as farLook.ts): pole with a foot, cloth in the relation colour; abandoned = short pole, small pale pennant. */
function FlagSample({ a }: { a: (typeof ALLEGIANCES)[number] | 'abandoned' }) {
  const ab = a === 'abandoned';
  const own = a === 'own';
  return (
    <svg className="wm-flag-sample" width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <ellipse cx="9" cy="23" rx={ab ? 3 : 4.5} ry="1.8" fill={ab ? '#B9AD98' : '#9C8F7A'} stroke="#2B211C" strokeWidth="0.9" />
      {own && <path d="M9 23V3" stroke="#FFF8E8" strokeWidth="6" strokeLinecap="round" opacity="0.9" />}
      <path d={ab ? 'M9 23V14' : own ? 'M9 23V3' : 'M9 23V5'} stroke="#2B211C" strokeWidth={ab ? 1.8 : 3} strokeLinecap="round" />
      <path d={ab ? 'M9 23V14' : own ? 'M9 23V3' : 'M9 23V5'} stroke={ab ? '#CFCAC0' : '#D9B27A'} strokeWidth={ab ? 0.9 : 1.5} strokeLinecap="round" />
      {ab ? (
        <path d="M9 14.4L15 16.8L9 19.2Z" fill="#CFCAC0" stroke="#8F897E" strokeWidth="0.8" strokeLinejoin="round" />
      ) : (
        <path
          d={own ? 'M9 3.5L15 4.5L21 3.5L19 9L21 14.5L15 13.5L9 14.5Z' : 'M9 5.5L14 6.3L19 5.5L17.2 9.7L19 14L14 13.2L9 14Z'}
          fill={STRONG_COLOR[a]}
          stroke="#2B211C"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

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
            Tribe tag written on the cloth when the owner is in a tribe
          </li>
          <li className="wm-legend-wide">
            <span className="wm-dome-sample" aria-hidden="true" />
            Beginner protection
          </li>
          <li className="wm-legend-wide">
            <span className="wm-cold-sample" aria-hidden="true" />
            Hearth out
          </li>
        </ul>
        <h3>Zoomed far out · flags</h3>
        <ul className="wm-legend-banners wm-legend-dots">
          {([...ALLEGIANCES, 'abandoned'] as const).map((a) => (
            <li key={a}>
              <FlagSample a={a} />
              {ALLEGIANCE_STYLE[a].label}
              {a === 'own' ? ' · biggest, gold' : a === 'abandoned' ? ' · small grey pennant' : ''}
            </li>
          ))}
          <li className="wm-legend-wide">
            <span className="wm-badge-sample" aria-hidden="true">
              48
            </span>
            Crowd count (whole world in view): player villages in a group
          </li>
          <li className="wm-legend-wide">
            <span className="wm-dot-site" aria-hidden="true" />
            Fire site (diamond)
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
