import { useState } from 'react';
import { UNITS, UNIT_IDS, checkSend, distance, emptyUnits, isAttackForbidden, totalUnits, travelTimeMs } from '@tribewars/engine';
import type { Coords, MapVillageDto, UnitId, Units } from '@tribewars/engine';
import { api, errorMessage } from '../api.ts';
import { formatClock, formatCoords, formatDuration, formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { UNIT_ICON } from '../icons.ts';
import { ATTACK_BLOCKED_TEXT, RELATION_STYLE } from '../relations.ts';
import { relationKey } from './render.ts';
import { TERRAIN_NAME } from './terrain.ts';
import type { TerrainCache } from './terrain.ts';

interface Props {
  tile: Coords;
  village: MapVillageDto | undefined;
  loaded: boolean;
  terrain: TerrainCache;
  onClose: () => void;
}

function SendForm({ tile, target }: { tile: Coords; target: MapVillageDto }) {
  const { live, now, settings, village, player, applySend, refresh, toast, viewMovement } = useGame();
  const [counts, setCounts] = useState<Partial<Record<UnitId, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = UNIT_IDS.filter((u) => live.troops[u] > 0);
  const chosen: Units = emptyUnits();
  for (const u of UNIT_IDS) {
    const n = Number(counts[u] ?? '');
    chosen[u] = Number.isInteger(n) ? Math.max(0, Math.min(live.troops[u], n)) : 0;
  }
  const total = totalUnits(chosen);
  const partial: Partial<Units> = {};
  for (const u of UNIT_IDS) if (chosen[u] > 0) partial[u] = chosen[u];
  const check = checkSend(live, partial);
  const travel = total > 0 ? travelTimeMs(village, tile, chosen, settings) : 0;
  const carry = UNIT_IDS.reduce((sum, u) => sum + chosen[u] * UNITS[u].carry, 0);
  const targetProtected = target.protected && target.kind === 'player';
  const breaksProtection = target.kind === 'player' && player.protectedUntil > now;

  let reason: string | null = null;
  if (targetProtected) reason = 'This player is under beginner protection';
  else if (total < 1) reason = available.length === 0 ? 'No troops at home' : 'Choose troops to send';
  else if (!check.ok) reason = check.message;

  function setCount(u: UnitId, value: string) {
    setError(null);
    setCounts((c) => ({ ...c, [u]: value }));
  }

  async function send() {
    if (busy || reason) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.send(village.id, { x: tile.x, y: tile.y, units: partial });
      applySend(res);
      setCounts({});
      toast(`Troops sent to ${target.name}. They arrive in ${formatDuration(res.movement.arriveAt - now)}.`, {
        action: { label: 'View', onClick: () => viewMovement(res.movement.id) },
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  return (
    <form
      className="send"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <h3 className="subtitle">Send troops</h3>
      {available.length === 0 ? (
        <p className="muted">No troops at home. Train some in the Army tab.</p>
      ) : (
        <ul className="send-units">
          {available.map((u) => (
            <li key={u}>
              <label htmlFor={`send-${u}`} className="send-label">
                <span aria-hidden="true">{UNIT_ICON[u]}</span> {UNITS[u].name}
                <span className="muted"> / {formatInt(live.troops[u])}</span>
              </label>
              <input
                id={`send-${u}`}
                className="input"
                type="number"
                inputMode="numeric"
                min={0}
                max={live.troops[u]}
                step={1}
                placeholder="0"
                value={counts[u] ?? ''}
                onChange={(e) => setCount(u, e.target.value)}
              />
              <button type="button" className="btn" onClick={() => setCount(u, String(live.troops[u]))}>
                all
              </button>
            </li>
          ))}
        </ul>
      )}

      {total > 0 && Number.isFinite(travel) && (
        <dl className="facts send-facts">
          <div>
            <dt>Travel time</dt>
            <dd>{formatDuration(travel)}</dd>
          </div>
          <div>
            <dt>Arrives</dt>
            <dd>{formatClock(now + travel, now)}</dd>
          </div>
          <div>
            <dt>Can carry</dt>
            <dd>{formatInt(carry)}</dd>
          </div>
        </dl>
      )}
      {breaksProtection && !targetProtected && (
        <p className="notice">Attacking another player ends your beginner protection.</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary btn-block" type="submit" disabled={!!reason || busy}>
        {busy ? 'Sending…' : 'Send troops'}
      </button>
      {reason && <div className="why">{reason}</div>}
    </form>
  );
}

export function TilePanel({ tile, village, loaded, terrain, onClose }: Props) {
  const { village: mine, navigate, viewTribe } = useGame();
  const isOwn = village?.kind === 'own' || (tile.x === mine.x && tile.y === mine.y);
  const terrainName = TERRAIN_NAME[terrain.get(tile.x, tile.y)] ?? 'Land';
  const dist = distance(mine, tile);
  const icon = isOwn ? '🏠' : village ? (village.kind === 'abandoned' ? '🏚️' : '🏘️') : '🌿';
  const owner = isOwn ? 'You' : village ? (village.ownerName ?? 'Abandoned') : null;
  const relation = village && !isOwn && village.kind === 'player' ? village.relation : null;
  const tribeId = village && !isOwn ? village.tribeId : null;
  const blocked = relation !== null && isAttackForbidden(relation);

  return (
    <aside className="map-panel" aria-label="Selected tile">
      <div className="map-panel-grip" aria-hidden="true" />
      <header className="map-panel-head">
        <span className="building-icon" aria-hidden="true">{icon}</span>
        <div className="building-title">
          <h2>{village ? village.name : isOwn ? mine.name : terrainName}</h2>
          <div className="level">
            {formatCoords(tile.x, tile.y)}
            {!village && !isOwn && <span> · {loaded ? 'No village here' : 'Loading…'}</span>}
          </div>
        </div>
        <button className="btn btn-icon" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </header>

      <dl className="facts">
        {owner && (
          <div>
            <dt>Owner</dt>
            <dd>{owner}</dd>
          </div>
        )}
        {village && village.tribeTag && tribeId !== null && (
          <div>
            <dt>Tribe</dt>
            <dd>
              <button className="link" onClick={() => viewTribe({ id: tribeId })} aria-label={`Open tribe ${village.tribeTag}`}>
                [{village.tribeTag}]
              </button>
            </dd>
          </div>
        )}
        {village && !isOwn && (
          <div>
            <dt>Relation</dt>
            <dd>
              <span className="relation-chip">
                <span className="swatch" style={{ background: RELATION_STYLE[relationKey(village)].body, borderColor: RELATION_STYLE[relationKey(village)].roof }} aria-hidden="true" />
                {RELATION_STYLE[relationKey(village)].label}
              </span>
            </dd>
          </div>
        )}
        {village && (
          <div>
            <dt>Points</dt>
            <dd>{formatInt(village.points)}</dd>
          </div>
        )}
        <div>
          <dt>Distance</dt>
          <dd>{isOwn ? '–' : `${dist.toFixed(1)} tiles`}</dd>
        </div>
        <div>
          <dt>Terrain</dt>
          <dd>{terrainName}</dd>
        </div>
        {village?.protected && village.kind !== 'abandoned' && (
          <div>
            <dt>Status</dt>
            <dd>
              <span className="tag tag-info">🛡️ Beginner protection</span>
            </dd>
          </div>
        )}
      </dl>

      {isOwn && (
        <button className="btn btn-block" onClick={() => navigate('village')}>
          Open my village
        </button>
      )}
      {village && !isOwn && blocked && relation && (
        <p className="notice notice-block" role="note">
          <span aria-hidden="true">🛡️</span> {ATTACK_BLOCKED_TEXT[relation] ?? 'Attacks on this village are blocked.'}
        </p>
      )}
      {village && !isOwn && !blocked && <SendForm key={`${tile.x}|${tile.y}`} tile={tile} target={village} />}
    </aside>
  );
}
