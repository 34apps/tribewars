// Panel for a tapped site (Great Fire, Fire Shrine, Waymark, Lookout), "A · number tiles": who holds it (one status line),
// three tiles (what it gives, what guards it, its Wall), my troops there, and the normal send form aimed at the site's tile.

import { useRef, useState } from 'react';
import { UNITS, UNIT_IDS, distance, keepersRegrowMs } from '@clanfire/engine';
import type { Coords, Mission, SiteDto, Units } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { formatCoords, formatDuration, formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import {
  isUtilitySite,
  siteDefendersTile,
  siteGivesTile,
  siteMissions,
  siteName,
  siteSendCopy,
  siteStatus,
  siteWallTile,
  stateText,
} from '../sites.ts';
import type { SiteTile } from '../sites.ts';
import { SiteGlyph } from './SiteGlyph.tsx';
import { SendForm, useFitPanel } from './TilePanel.tsx';
import { RecallSome } from '../components/RecallSome.tsx';
import { TERRAIN_NAME } from './terrain.ts';
import type { TerrainCache } from './terrain.ts';

interface Props {
  site: SiteDto;
  wakesAt: number;
  terrain: TerrainCache;
  /** Mission to pre-select (a jump from elsewhere); null otherwise. */
  preferred: { mission?: Mission; nonce: number } | null;
  /** Called after a recall so the site list refetches. */
  onChanged?: () => void;
  onClose: () => void;
}

const INK = '#2B211C';

/** Small art icons of the tiles and the status line (same flat toy style as the glyphs). */
function SiteIcon({ name }: { name: SiteTile['icon'] | 'flag' | 'flag-ok' | 'flag-danger' | 'swords' | 'shield' }) {
  const g = { stroke: INK, strokeWidth: 1.8, strokeLinejoin: 'round' as const };
  let art;
  switch (name) {
    case 'renown':
      art = (
        <g {...g}>
          <path d="M6 3v19" fill="none" />
          <path d="M6 4h12l-3 4 3 4H6z" fill="#F2B33D" />
          <circle cx="6" cy="3" r="1.6" fill="#F2B33D" />
        </g>
      );
      break;
    case 'keepers':
      art = (
        <g {...g}>
          <circle cx="12" cy="7" r="3.6" fill="#E8C49A" />
          <path d="M5 21c0-5 3-8 7-8s7 3 7 8z" fill="#8E8678" />
        </g>
      );
      break;
    case 'troops':
    case 'shield':
      art = <path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" fill="#2F9AA0" {...g} />;
      break;
    case 'wall':
      art = (
        <g {...g}>
          <path d="M3 21V9h3V6h3v3h2V6h2v3h2V6h3v3h3v12z" fill="#BDB5A6" />
          <path d="M3 15h18M8 9v6M16 9v6M12 15v6" fill="none" strokeWidth={1.3} />
        </g>
      );
      break;
    case 'road':
      art = (
        <g {...g}>
          <path d="M8 21l2-18h4l2 18z" fill="#D9A25B" />
          <path d="M12 6v3M12 12v3M12 18v2" stroke="#FFF8E8" strokeWidth={1.6} />
        </g>
      );
      break;
    case 'lookout':
      art = (
        <g {...g}>
          <path d="M2 12C5 6 9 4.5 12 4.5S19 6 22 12c-3 6-7 7.5-10 7.5S5 18 2 12z" fill="#FFF8E8" />
          <circle cx="12" cy="12" r="3.6" fill="#2F9AA0" />
        </g>
      );
      break;
    case 'flag-ok':
      art = (
        <g {...g}>
          <path d="M6 3v19" fill="none" />
          <path d="M6 4h12l-3 4 3 4H6z" fill="#5E8C3A" />
        </g>
      );
      break;
    case 'flag-danger':
      art = (
        <g {...g}>
          <path d="M6 3v19" fill="none" />
          <path d="M6 4h12l-3 4 3 4H6z" fill="#C4623A" />
        </g>
      );
      break;
    case 'swords':
      art = <path d="M4 4l14 14M20 4L6 18M15 20l5-5M4 15l5 5" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" />;
      break;
    default:
      art = (
        <g {...g}>
          <path d="M6 3v19" fill="none" />
          <path d="M6 4h12l-3 4 3 4H6z" fill="#FFF8E8" strokeDasharray="2.4 2" />
        </g>
      );
  }
  return (
    <svg className="wm-site-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {art}
    </svg>
  );
}

function Tile({ tile, kind, tone }: { tile: SiteTile; kind: 'gives' | 'defenders' | 'wall'; tone?: 'ours' | 'theirs' | 'free' }) {
  return (
    <div className={`wm-site-tile is-${kind}${tone ? ` is-${tone}` : ''}`}>
      <div className="wm-site-tile-top">
        <SiteIcon name={tile.icon} />
        <span className="wm-site-tile-label">{tile.label}</span>
      </div>
      <div className="wm-site-big">
        {tile.value}
        {tile.unit && <small>{tile.unit}</small>}
      </div>
      {tile.fill !== undefined && (
        <div className="wm-site-bar" aria-hidden="true">
          <i style={{ width: `${Math.round(tile.fill * 100)}%` }} />
        </div>
      )}
      <div className="wm-site-sub">{tile.sub}</div>
    </div>
  );
}

export function SitePanel({ site, wakesAt, terrain, preferred, onChanged, onClose }: Props) {
  const { village: mine, player, settings, now, viewTribe, navigate, refresh, toast, worldEnd } = useGame();
  const panelRef = useRef<HTMLElement>(null);
  useFitPanel(panelRef);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recallOpen, setRecallOpen] = useState<number | null>(null);
  const tile: Coords = { x: site.x, y: site.y };
  const myTribeId = player.tribe?.id ?? null;
  const { missions, note } = siteMissions(site, myTribeId, now);
  const status = siteStatus(site, myTribeId, now);
  const copy = siteSendCopy(status.tone);
  const utility = isUtilitySite(site.kind);
  const terrainName = TERRAIN_NAME[terrain.get(site.x, site.y)] ?? 'Land';
  const dist = distance(mine, tile);
  const contingents = site.myContingents ?? [];
  const mineHeld = status.tone === 'ours';
  const gives = siteGivesTile(site, settings.speed);
  const defenders = siteDefendersTile(site, keepersRegrowMs(settings));
  const wall = siteWallTile(site);

  /** Bring one village's troops home from this site (the server checks ownership and re-computes the way back). */
  async function callBack(villageId: number, units?: Partial<Units>) {
    if (busyId !== null) return;
    setBusyId(villageId);
    setError(null);
    try {
      const res = await api.siteRecall(site.id, villageId, units);
      toast(`Called back from ${siteName(site)} · ${formatDuration(res.movement.arriveAt - now)}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
      onChanged?.();
      void refresh();
    }
  }

  return (
    <aside ref={panelRef} className="wm-panel is-site" aria-label="Selected site">
      <div className="wm-panel-grip" aria-hidden="true" />
      <header className="wm-site-head">
        <span className="wm-site-plate" aria-hidden="true">
          <SiteGlyph kind={site.kind} awake={site.awake} size={50} />
        </span>
        <div className="wm-site-titles">
          <h2>{siteName(site)}</h2>
          <div className="wm-site-where">
            {!utility && (
              <span className={`wm-site-state${site.awake ? ' is-awake' : ''}`} title={stateText(site, wakesAt, now)}>
                {site.awake ? 'Awake' : 'Dormant'}
              </span>
            )}
            <span>{`${formatCoords(site.x, site.y)} · ${dist.toFixed(1)} fields · ${terrainName}`}</span>
          </div>
        </div>
        <button type="button" className="wm-btn wm-btn-icon wm-close" onClick={onClose} aria-label="Close panel">
          <svg className="wm-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      <div className={`wm-site-status is-${status.tone}`}>
        <SiteIcon name={status.tone === 'ours' ? 'flag-ok' : status.tone === 'theirs' ? 'flag-danger' : 'flag'} />
        <div className="wm-site-status-text">
          <strong>
            {status.title}
            {status.tribe && (
              <button
                type="button"
                className="wm-site-tag"
                onClick={() => viewTribe({ id: status.tribe!.tribeId })}
                aria-label={`Open tribe ${status.tribe.tag}`}
              >
                {status.tribe.tag}
              </button>
            )}
          </strong>
          <span>{status.sub}</span>
        </div>
      </div>

      <div className="wm-site-tiles">
        <Tile tile={gives} kind="gives" />
        <Tile tile={defenders} kind="defenders" tone={status.tone} />
        <Tile tile={wall} kind="wall" />
      </div>

      {contingents.length > 0 && (
        <div className="wm-site-mine">
          <strong>{`Your troops here: ${formatInt(site.mine)}`}</strong>
          <ul className="wm-contingents" aria-label="Your troops at this site">
            {contingents.map((c) => {
              const open = recallOpen === c.villageId;
              return (
                <li key={c.villageId} className="wm-contingent">
                  <div className="wm-site-mine-row">
                    <div className="wm-contingent-info">
                      <strong>{c.villageName}</strong>
                      <span className="wm-contingent-units">
                        {UNIT_IDS.filter((u) => (c.units[u] ?? 0) > 0)
                          .map((u) => `${formatInt(c.units[u] ?? 0)} ${UNITS[u].name}`)
                          .join(', ')}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="wm-btn wm-btn-small"
                      aria-expanded={open}
                      onClick={() => setRecallOpen(open ? null : c.villageId)}
                    >
                      Call back
                    </button>
                  </div>
                  {open && (
                    <RecallSome
                      s={{ id: `site-${site.id}-${c.villageId}`, units: c.units }}
                      busy={busyId !== null || worldEnd !== null}
                      label="Call back"
                      onRecall={(units) => void callBack(c.villageId, units)}
                      warning={
                        mineHeld && contingents.length === 1
                          ? 'This takes all your troops from here. If no other member of your tribe has troops here, the site turns neutral again and allied troops go home too.'
                          : undefined
                      }
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {site.mine > 0 && contingents.length === 0 && (
        <button type="button" className="wm-btn wm-btn-big" onClick={() => navigate('army')}>
          Manage in Army
        </button>
      )}
      {error && (
        <p className="wm-error" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="wm-note" role="note">
          {note}
        </p>
      )}
      <SendForm
        key={`${mine.id}|${site.x}|${site.y}|${preferred?.nonce ?? 0}|${missions.join(',')}`}
        tile={tile}
        target={null}
        missions={missions}
        preferred={preferred?.mission ?? null}
        hints={copy.hints}
        titles={copy.titles}
        targetLabel={siteName(site)}
      />
    </aside>
  );
}
