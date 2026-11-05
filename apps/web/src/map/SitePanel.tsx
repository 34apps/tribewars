// Panel for a tapped site (Great Fire / Fire Shrine): who holds it, its state, garrison, calm time, the Renown it gives,
// my troops there, and the normal send form aimed at the site's tile (attack to take it, support to hold it).

import { distance } from '@clanfire/engine';
import type { Coords, Mission, SiteDto } from '@clanfire/engine';
import { formatCoords, formatDuration } from '../format.ts';
import { useGame } from '../game.ts';
import {
  calmLeftMs,
  garrisonText,
  holderText,
  siteBonusText,
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
  preferred: { mission: Mission; nonce: number } | null;
  onClose: () => void;
}

const SITE_HINTS: Partial<Record<Mission, string>> = {
  attack: 'Beat the troops standing on the site to take it. If your army wins, the survivors stay as the new garrison and your tribe holds the site. Troops there still cost their home village food.',
  support: 'Your troops stay at the site as part of its garrison. A tribe holds a site while at least one of its members has troops there.',
};

export function SitePanel({ site, wakesAt, terrain, preferred, onClose }: Props) {
  const { village: mine, player, now, viewTribe, navigate } = useGame();
  const tile: Coords = { x: site.x, y: site.y };
  const { missions, note } = siteMissions(site, player.tribe?.id ?? null, now);
  const calm = calmLeftMs(site, now);
  const terrainName = TERRAIN_NAME[terrain.get(site.x, site.y)] ?? 'Land';
  const dist = distance(mine, tile);
  const holder = site.holder;

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
            <span className={`wm-allegiance wm-site-state${site.awake ? ' is-awake' : ''}`}>{site.awake ? 'Awake' : 'Dormant'}</span>
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
          <div className="wm-stagecard-kicker">{site.kind === 'great_fire' ? 'The centre of the world' : 'Fire site'}</div>
          <div className="wm-stagecard-name">{siteBonusText(site)}</div>
          <div className="wm-stagecard-al">{stateText(site, wakesAt, now)}</div>
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
        <div>
          <dt>Held by</dt>
          <dd>{holderText(site)}</dd>
        </div>
        <div>
          <dt>Garrison</dt>
          <dd>{garrisonText(site)}</dd>
        </div>
        <div>
          <dt>Calm</dt>
          <dd>{calm > 0 ? `${formatDuration(calm)} left (cannot be attacked)` : 'None'}</dd>
        </div>
        <div>
          <dt>Your troops there</dt>
          <dd>{site.mine > 0 ? site.mine.toLocaleString() : 'None'}</dd>
        </div>
      </dl>

      {site.mine > 0 && (
        <button type="button" className="wm-btn wm-btn-big" onClick={() => navigate('army')}>
          Recall or manage in the Army tab
        </button>
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
