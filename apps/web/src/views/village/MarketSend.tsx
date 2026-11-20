// "Send resources" on the Market's own page (desktop frame and phone sheet). The form itself is the map's ShipmentForm; this adds
// the target picker the map gets from its selection: my other villages and typed coordinates (x|y) for a friend's village.

import { useEffect, useId, useState } from 'react';
import type { MapVillageDto } from '@clanfire/engine';
import { api } from '../../api.ts';
import { Icon } from '../../art/Icon.tsx';
import { useGame } from '../../game.ts';
import { ShipmentForm } from '../../map/ShipmentForm.tsx';
import type { ShipTarget } from '../../map/ShipmentForm.tsx';
import { ownPicks, parseCoords, typedHint, typedTarget } from './marketTarget.ts';
import '../../map/map.css';
import './market.css';

type Pick = { source: 'own'; id: number } | { source: 'typed' } | null;

export function MarketSendPanel({ phone = false }: { phone?: boolean }) {
  const { village, villages, player, live } = useGame();
  const inputId = useId();
  const others = ownPicks(villages, village.id);
  const [pick, setPick] = useState<Pick>(others.length > 0 ? { source: 'own', id: others[0]!.id } : null);
  const [text, setText] = useState('');
  // undefined = asking the map, null = nothing there.
  const [found, setFound] = useState<MapVillageDto | null | undefined>(undefined);
  const parsedKey = text.trim();

  useEffect(() => {
    if (pick?.source !== 'typed') return;
    const at = parseCoords(parsedKey);
    if (!at) return;
    let current = true;
    setFound(undefined);
    const timer = window.setTimeout(() => {
      api
        .map(at.x, at.y, 1, 1)
        .then((r) => current && setFound(r.villages.find((v) => v.x === at.x && v.y === at.y) ?? null))
        .catch(() => current && setFound(null));
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [pick?.source, parsedKey]);

  const typed = typedTarget(pick?.source === 'typed' ? text : '', village, found, village.id);
  let tile: { x: number; y: number } | null = null;
  let target: ShipTarget | null = null;
  if (pick?.source === 'own') {
    const v = others.find((o) => o.id === pick.id);
    if (v) {
      tile = { x: v.x, y: v.y };
      target = { name: v.name, tribeId: player.tribe?.id ?? null };
    }
  } else if (typed.kind === 'ok') {
    tile = typed.at;
    target = { name: typed.village.name, tribeId: typed.village.tribeId, ...(typed.village.tribeStore ? { tribeStore: true as const } : {}) };
  }
  const hint = pick?.source === 'typed' ? typedHint(typed) : null;
  const hasMarket = live.buildings.market >= 1;

  const body = (
    <div className="mk-body">
      <div className="mk-pick" role="group" aria-label="Where to send">
        {others.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`mk-chip${pick?.source === 'own' && pick.id === v.id ? ' is-on' : ''}`}
            aria-pressed={pick?.source === 'own' && pick.id === v.id}
            onClick={() => setPick({ source: 'own', id: v.id })}
          >
            <b>{v.name}</b>
            <small>
              {v.x}|{v.y}
            </small>
          </button>
        ))}
        <label className={`mk-coords${pick?.source === 'typed' ? ' is-on' : ''}`} htmlFor={inputId}>
          <span>Another village</span>
          <input
            id={inputId}
            className="wm-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="x|y"
            aria-label="Target coordinates, x|y"
            value={text}
            onFocus={() => setPick({ source: 'typed' })}
            onChange={(e) => {
              setText(e.target.value);
              setPick({ source: 'typed' });
            }}
          />
        </label>
      </div>
      {hint && <p className="mk-hint" role="status">{hint}</p>}
      {tile && target && (
        <p className="mk-to">
          To <b>{target.name}</b> · {tile.x}|{tile.y}
        </p>
      )}
      {tile && target ? (
        <ShipmentForm key={`${tile.x}|${tile.y}`} tile={tile} target={target} className="wm-send mk-form" />
      ) : (
        !hint && <p className="mk-hint">{others.length > 0 ? 'Pick a village above.' : 'Type the coordinates of the village, like 12|-5.'}</p>
      )}
    </div>
  );
  if (!hasMarket) return null;
  return phone ? (
    <section className="vv-card mk-send is-phone" aria-label="Send resources">
      <h3 className="mk-title">
        <Icon name="support" size={18} /> Send resources
      </h3>
      {body}
    </section>
  ) : (
    <section className="fv-pn mk-send" aria-label="Send resources">
      <div className="fv-ph">
        <h2>Send resources</h2>
      </div>
      {body}
    </section>
  );
}
