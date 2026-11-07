// Panel for a tapped site (Great Fire / Fire Shrine): who holds it, its state, garrison, calm time, the Renown it gives,
// my troops there, and the normal send form aimed at the site's tile (attack to take it, support to hold it).

import { useState } from 'react';
import { UNITS, UNIT_IDS, distance } from '@clanfire/engine';
import type { Coords, Mission, SiteDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { formatCoords, formatDuration, formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import {
  calmLeftMs,
  garrisonText,
  holderText,
  isUtilitySite,
  siteBonusText,
  siteKindLine,
  SITE_KIND_NAME,
  siteMissions,
  siteName,
  stateText,
} from '../sites.ts';
import { SiteGlyph } from './SiteGlyph.tsx';
import { SendForm } from './TilePanel.tsx';
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

const SITE_HINTS: Partial<Record<Mission, string>> = {
  attack: 'Win to take it. Survivors become the garrison.',
  support: 'Troops join the garrison. A tribe holds it while a member has troops there.',
};

export function SitePanel({ site, wakesAt, terrain, preferred, onChanged, onClose }: Props) {
  const { village: mine, player, now, viewTribe, navigate, refresh, toast, worldEnd } = useGame();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tile: Coords = { x: site.x, y: site.y };
  const { missions, note } = siteMissions(site, player.tribe?.id ?? null, now);
  const utility = isUtilitySite(site.kind);
  const kindLine = siteKindLine(site.kind);
  const calm = calmLeftMs(site, now);
  const terrainName = TERRAIN_NAME[terrain.get(site.x, site.y)] ?? 'Land';
  const dist = distance(mine, tile);
  const holder = site.holder;
  const contingents = site.myContingents ?? [];

  /** Bring one village's troops home from this site (the server checks ownership and re-computes the way back). */
  async function callBack(villageId: number) {
    if (busyId !== null) return;
    setBusyId(villageId);
    setError(null);
    try {
      const res = await api.siteRecall(site.id, villageId);
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
    <aside className="wm-panel" aria-label="Selected site">
      <div className="wm-panel-grip" aria-hidden="true" />
      <header className="wm-panel-head">
        <div className="wm-panel-titles">
          <h2>{siteName(site)}</h2>
          <div className="wm-owner">
            {holder ? (
              <>
                <span className="wm-owner-name">{holder.name}</span>
                <button type="button" className="wm-tag" onClick={() => viewTribe({ id: holder.tribeId })} aria-label={`Open tribe ${holder.tag}`}>
                  [{holder.tag}]
                </button>
              </>
            ) : (
              <span className="wm-owner-name wm-dim">Nobody holds it</span>
            )}
            {!utility && <span className={`wm-allegiance wm-site-state${site.awake ? ' is-awake' : ''}`}>{site.awake ? 'Awake' : 'Dormant'}</span>}
          </div>
        </div>
        <button type="button" className="wm-btn wm-btn-icon wm-close" onClick={onClose} aria-label="Close panel">
          <svg className="wm-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>

      <div className="wm-stagecard">
        <span className="wm-thumb" aria-hidden="true">
          <SiteGlyph kind={site.kind} awake={site.awake} size={72} />
        </span>
        <div>
          <div className="wm-stagecard-kicker">{utility ? SITE_KIND_NAME[site.kind] : site.kind === 'great_fire' ? 'Centre' : 'Fire site'}</div>
          <div className="wm-stagecard-name">{utility ? kindLine : siteBonusText(site)}</div>
          {!utility && <div className="wm-stagecard-al">{stateText(site, wakesAt, now)}</div>}
        </div>
      </div>

      <dl className="wm-facts">
        <div>
          <dt>Location</dt>
          <dd>{formatCoords(site.x, site.y)}</dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>{`${dist.toFixed(1)} fields`}</dd>
        </div>
        <div>
          <dt>Terrain</dt>
          <dd>{terrainName}</dd>
        </div>
        <div className="wm-fact-wide">
          <dt>Held by</dt>
          <dd>{holderText(site)}</dd>
        </div>
        <div>
          <dt>Garrison</dt>
          <dd>{garrisonText(site)}</dd>
        </div>
        <div className="wm-fact-wide">
          <dt>Calm</dt>
          <dd>{calm > 0 ? formatDuration(calm) : 'None'}</dd>
        </div>
        <div>
          <dt>Yours</dt>
          <dd>{site.mine > 0 ? site.mine.toLocaleString() : 'None'}</dd>
        </div>
      </dl>

      {contingents.length > 0 && (
        <ul className="wm-contingents" aria-label="Your troops at this site">
          {contingents.map((c) => (
            <li key={c.villageId} className="wm-contingent">
              <div className="wm-contingent-info">
                <strong>{c.villageName}</strong>
                <span className="wm-contingent-units">
                  {UNIT_IDS.filter((u) => (c.units[u] ?? 0) > 0)
                    .map((u) => `${formatInt(c.units[u] ?? 0)} ${UNITS[u].name}`)
                    .join(', ')}
                </span>
              </div>
              <button type="button" className="wm-btn" disabled={busyId !== null || worldEnd !== null} onClick={() => void callBack(c.villageId)}>
                {busyId === c.villageId ? '…' : 'Call back'}
              </button>
            </li>
          ))}
        </ul>
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
        hints={SITE_HINTS}
        targetLabel={siteName(site)}
      />
    </aside>
  );
}
