import { useState } from 'react';
import { SCOUT_UNIT, UNITS, UNIT_IDS, checkMission, checkSend, distance, emptyUnits, totalUnits, travelTimeMs } from '@clanfire/engine';
import type { Coords, MapVillageDto, Mission, UnitId, Units } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { formatClock, formatCoords, formatDuration, formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { MISSION_NAME, UNIT_ICON } from '../icons.ts';
import { ATTACK_BLOCKED_TEXT, MISSION_HINT, RELATION_STYLE } from '../relations.ts';
import { allowedMissions } from '../rules.ts';
import { Segmented } from '../tribe/bits.tsx';
import { relationKey } from './render.ts';
import { TERRAIN_NAME } from './terrain.ts';
import type { TerrainCache } from './terrain.ts';

interface Props {
  tile: Coords;
  village: MapVillageDto | undefined;
  loaded: boolean;
  terrain: TerrainCache;
  /** Mission to pre-select for this tile (a jump from a tribe alert); null otherwise. */
  preferred: { mission: Mission; nonce: number } | null;
  onClose: () => void;
}

const SEND_LABEL: Record<Mission, string> = { attack: 'Send attack', scout: 'Send scouts', support: 'Send support' };
const SENT_TOAST: Record<Mission, string> = { attack: 'Attack sent to', scout: 'Scouts sent to', support: 'Support sent to' };

function SendForm({
  tile,
  target,
  missions,
  preferred,
}: {
  tile: Coords;
  target: MapVillageDto;
  missions: Mission[];
  preferred: Mission | null;
}) {
  const { live, now, settings, village, player, applySend, refresh, toast, viewMovement, navigate } = useGame();
  const fallback: Mission = missions[0] ?? 'attack';
  const [chosenMission, setChosenMission] = useState<Mission>(preferred && missions.includes(preferred) ? preferred : fallback);
  const [counts, setCounts] = useState<Partial<Record<UnitId, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The relation can change while the panel is open (a pact formed): fall back to an allowed mission.
  const mission: Mission = missions.includes(chosenMission) ? chosenMission : fallback;
  const scouting = mission === 'scout';
  const fights = mission !== 'support';

  const atHome = UNIT_IDS.filter((u) => live.troops[u] > 0);
  // Scout missions carry Pathfinders only; the other units are neither shown nor sent.
  const visible = scouting ? atHome.filter((u) => u === SCOUT_UNIT) : atHome;
  const chosen: Units = emptyUnits();
  for (const u of visible) {
    const n = Number(counts[u] ?? '');
    chosen[u] = Number.isInteger(n) ? Math.max(0, Math.min(live.troops[u], n)) : 0;
  }
  const total = totalUnits(chosen);
  const partial: Partial<Units> = {};
  for (const u of UNIT_IDS) if (chosen[u] > 0) partial[u] = chosen[u];
  const check = checkSend(live, partial);
  const missionCheck = checkMission(mission, chosen);
  const travel = total > 0 ? travelTimeMs(village, tile, chosen, settings) : 0;
  const carry = UNIT_IDS.reduce((sum, u) => sum + chosen[u] * UNITS[u].carry, 0);
  const targetProtected = fights && target.protected && target.kind === 'player';
  const breaksProtection = fights && target.kind === 'player' && player.protectedUntil > now;

  let reason: string | null = null;
  if (targetProtected) reason = 'This player is under beginner protection';
  else if (total < 1) {
    if (visible.length > 0) reason = scouting ? 'Choose how many Pathfinders to send' : 'Choose troops to send';
    else reason = scouting ? 'No Pathfinders at home' : 'No troops at home';
  } else if (!check.ok) reason = check.message;
  else if (!missionCheck.ok) reason = missionCheck.message;

  function setCount(u: UnitId, value: string) {
    setError(null);
    setCounts((c) => ({ ...c, [u]: value }));
  }

  async function send() {
    if (busy || reason) return;
    // Same rules as the server (which re-checks everything); catches a bad army before the round trip.
    const mc = checkMission(mission, chosen);
    if (!mc.ok) {
      setError(mc.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.send(village.id, { x: tile.x, y: tile.y, units: partial, mission });
      applySend(res);
      setCounts({});
      toast(`${SENT_TOAST[mission]} ${target.name}. Arrives in ${formatDuration(res.movement.arriveAt - now)}.`, {
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
      <h3 className="subtitle">{missions.length > 1 ? 'Send troops' : `Send ${MISSION_NAME[mission].toLowerCase()}`}</h3>
      {missions.length > 1 && (
        <Segmented
          label="Mission"
          value={mission}
          options={missions.map((m) => ({ value: m, label: MISSION_NAME[m] }))}
          onChange={(m) => {
            setError(null);
            setChosenMission(m);
          }}
        />
      )}
      <p className="muted small send-hint">{MISSION_HINT[mission]}</p>
      {visible.length === 0 ? (
        <p className="muted">
          {scouting ? 'No Pathfinders at home. ' : 'No troops at home. '}
          <button type="button" className="link" onClick={() => navigate('army')}>
            Train some in the Army tab
          </button>
          .
        </p>
      ) : (
        <ul className="send-units">
          {visible.map((u) => (
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
          {mission === 'attack' && (
            <div>
              <dt>Can carry</dt>
              <dd>{formatInt(carry)}</dd>
            </div>
          )}
        </dl>
      )}
      {breaksProtection && !targetProtected && (
        <p className="notice">{scouting ? 'Scouting' : 'Attacking'} another player ends your beginner protection.</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary btn-block btn-tall" type="submit" disabled={!!reason || busy}>
        {busy ? 'Sending…' : SEND_LABEL[mission]}
      </button>
      {reason && <div className="why">{reason}</div>}
    </form>
  );
}

export function TilePanel({ tile, village, loaded, terrain, preferred, onClose }: Props) {
  const { village: mine, navigate, viewTribe } = useGame();
  const isOwn = village?.kind === 'own' || (tile.x === mine.x && tile.y === mine.y);
  const terrainName = TERRAIN_NAME[terrain.get(tile.x, tile.y)] ?? 'Land';
  const dist = distance(mine, tile);
  const icon = isOwn ? '🏠' : village ? (village.kind === 'abandoned' ? '🏚️' : '🏘️') : '🌿';
  const owner = isOwn ? 'You' : village ? (village.ownerName ?? 'Abandoned') : null;
  const relation = village && !isOwn && village.kind === 'player' ? village.relation : null;
  const tribeId = village && !isOwn ? village.tribeId : null;
  const missions = village && !isOwn ? allowedMissions(village.kind, village.relation) : [];
  // Attack and scout go together, so a missing attack means the relation blocks both.
  const attackBlocked = relation !== null && !missions.includes('attack');

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
      {village && !isOwn && attackBlocked && relation && (
        <p className="notice notice-block" role="note">
          <span aria-hidden="true">🛡️</span> {ATTACK_BLOCKED_TEXT[relation] ?? 'Attacks on this village are blocked.'}
        </p>
      )}
      {village && !isOwn && missions.length > 0 && (
        <SendForm
          key={`${tile.x}|${tile.y}|${preferred?.nonce ?? 0}`}
          tile={tile}
          target={village}
          missions={missions}
          preferred={preferred?.mission ?? null}
        />
      )}
    </aside>
  );
}
