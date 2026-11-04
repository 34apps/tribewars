import { useState } from 'react';
import { MAP_STAGE_NAMES, SCOUT_UNIT, UNITS, UNIT_IDS, checkMission, checkSend, distance, emptyUnits, mapStage, ruinStage, totalUnits, travelPreview } from '@clanfire/engine';
import type { Coords, MapVillageDto, Mission, UnitId, Units } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { formatClock, formatCoords, formatDuration, formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { MISSION_NAME, UNIT_ICON } from '../icons.ts';
import { ATTACK_BLOCKED_TEXT, MISSION_HINT } from '../relations.ts';
import { allowedMissions } from '../rules.ts';
import { Segmented } from '../tribe/bits.tsx';
import { ALLEGIANCE_STYLE, allegianceOf, stageName, villageSprite } from './allegiance.ts';
import { ShipmentForm } from './ShipmentForm.tsx';
import { RUIN_NAMES, artUrl, badgeUrl } from './sprites.ts';
import { TERRAIN_NAME } from './terrain.ts';
import { slowdownText, slowGroundText } from './travel.ts';
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
  // Test mode only: own seconds for the way out / home (blank = normal travel time).
  const [outSecs, setOutSecs] = useState('');
  const [backSecs, setBackSecs] = useState('');

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
  // The server computes the real time from the same rule and its own seed; this only shows it in advance.
  const preview = total > 0 ? travelPreview(village, tile, chosen, settings) : null;
  const travel = preview ? preview.ms : 0;
  const slowdown = preview ? slowdownText(preview.flatMs, preview.ms) : null;
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
      const timing: { travelSeconds?: number; returnSeconds?: number } = {};
      if (player.sandbox) {
        const o = outSecs.trim() === '' ? NaN : Number(outSecs);
        const b = backSecs.trim() === '' ? NaN : Number(backSecs);
        if (Number.isInteger(o) && o >= 0 && o <= 86400) timing.travelSeconds = o;
        if (fights && Number.isInteger(b) && b >= 0 && b <= 86400) timing.returnSeconds = b;
      }
      const res = await api.send(village.id, { x: tile.x, y: tile.y, units: partial, mission, ...timing });
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
      className="wm-send"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <h3 className="wm-send-title">{missions.length > 1 ? 'Send troops' : `Send ${MISSION_NAME[mission].toLowerCase()}`}</h3>
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
      <p className="wm-muted">{MISSION_HINT[mission]}</p>
      {visible.length === 0 ? (
        <p className="wm-muted">
          {scouting ? 'No Pathfinders at home. ' : 'No troops at home. '}
          <button type="button" className="wm-link" onClick={() => navigate('army')}>
            Train some in the Army tab
          </button>
          .
        </p>
      ) : (
        <ul className="wm-units">
          {visible.map((u) => (
            <li key={u}>
              <label htmlFor={`send-${u}`}>
                <span aria-hidden="true">{UNIT_ICON[u]}</span> {UNITS[u].name}
                <span className="wm-muted"> / {formatInt(live.troops[u])}</span>
              </label>
              <input
                id={`send-${u}`}
                className="wm-input"
                type="number"
                inputMode="numeric"
                min={0}
                max={live.troops[u]}
                step={1}
                placeholder="0"
                value={counts[u] ?? ''}
                onChange={(e) => setCount(u, e.target.value)}
              />
              <button type="button" className="wm-btn wm-btn-small" onClick={() => setCount(u, String(live.troops[u]))}>
                All
              </button>
            </li>
          ))}
        </ul>
      )}

      {total > 0 && Number.isFinite(travel) && (
        <dl className="wm-facts wm-facts-send">
          <div>
            <dt>Travel time</dt>
            <dd>{formatDuration(travel)}</dd>
          </div>
          {preview && slowdown && (
            <div className="wm-terrain-time">
              <dt>Without terrain</dt>
              <dd>
                {formatDuration(preview.flatMs)} <span className="wm-slow">{slowdown}</span>
                <small className="wm-muted"> {slowGroundText(preview.route)}</small>
              </dd>
            </div>
          )}
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
      {player.sandbox && (
        <div className="wm-muted">
          <strong>Test mode:</strong> own travel time in seconds (blank = normal)
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <input
              className="wm-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={86400}
              step={1}
              placeholder="Way out (s)"
              aria-label="Test mode: seconds on the way out"
              value={outSecs}
              onChange={(e) => setOutSecs(e.target.value)}
            />
            {fights && (
              <input
                className="wm-input"
                type="number"
                inputMode="numeric"
                min={0}
                max={86400}
                step={1}
                placeholder="Way home (s)"
                aria-label="Test mode: seconds on the way home"
                value={backSecs}
                onChange={(e) => setBackSecs(e.target.value)}
              />
            )}
          </div>
        </div>
      )}
      {breaksProtection && !targetProtected && (
        <p className="wm-note">{scouting ? 'Scouting' : 'Attacking'} another player ends your beginner protection.</p>
      )}
      {error && (
        <p className="wm-error" role="alert">
          {error}
        </p>
      )}
      <button className="wm-btn wm-btn-sun wm-btn-big" type="submit" disabled={!!reason || busy}>
        <svg className="wm-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4l11 11M20 4 9 15M6 18l-2 2M18 18l2 2M13 17l4 4M11 17l-4 4" />
        </svg>
        {busy ? 'Sending…' : SEND_LABEL[mission]}
      </button>
      {reason && <div className="wm-why">{reason}</div>}
    </form>
  );
}

export function TilePanel({ tile, village, loaded, terrain, preferred, onClose }: Props) {
  const { village: mine, player, navigate, viewTribe } = useGame();
  const isOwn = village?.kind === 'own' || (tile.x === mine.x && tile.y === mine.y);
  const terrainName = TERRAIN_NAME[terrain.get(tile.x, tile.y)] ?? 'Land';
  const dist = distance(mine, tile);
  const al = village ? allegianceOf(village) : isOwn ? 'own' : null;
  const style = al ? ALLEGIANCE_STYLE[al] : null;
  const owner = isOwn ? player.username : village ? (village.ownerName ?? null) : null;
  // Resources can also go to another village of mine (the server allows it).
  const canShip = village?.kind === 'own' && (tile.x !== mine.x || tile.y !== mine.y);
  const relation = village && !isOwn && village.kind === 'player' ? village.relation : null;
  const tribeId = village && !isOwn ? village.tribeId : null;
  const missions = village && !isOwn ? allowedMissions(village.kind, village.relation) : [];
  // Attack and scout go together, so a missing attack means the relation blocks both.
  const attackBlocked = relation !== null && !missions.includes('attack');
  // ownerChieftain may be missing from an older server; badgeUrl treats undefined as "no portrait".
  const badge = badgeUrl(isOwn ? player.chieftain : village?.ownerChieftain);
  const stageNo = village ? (village.kind === 'abandoned' ? ruinStage(village.points) : mapStage(village.points)) : 0;
  const stageCount = village?.kind === 'abandoned' ? RUIN_NAMES.length : MAP_STAGE_NAMES.length;

  return (
    <aside className="wm-panel" aria-label="Selected tile">
      <div className="wm-panel-grip" aria-hidden="true" />
      <header className="wm-panel-head">
        <div className="wm-panel-titles">
          <h2>
            {al && al !== 'abandoned' && <img className="wm-head-banner" src={artUrl(`banner-${al}`)} alt="" width={24} height={28} />}
            {village ? village.name : isOwn ? mine.name : terrainName}
          </h2>
          <div className="wm-owner">
            {badge && <img className="wm-badge" src={badge} alt="" width={28} height={28} />}
            {owner && <span className="wm-owner-name">{owner}</span>}
            {village && village.tribeTag && tribeId !== null && (
              <button type="button" className="wm-tag" onClick={() => viewTribe({ id: tribeId })} aria-label={`Open tribe ${village.tribeTag}`}>
                [{village.tribeTag}]
              </button>
            )}
            {!village && !isOwn && <span className="wm-owner-name wm-dim">{loaded ? 'No village here' : 'Loading…'}</span>}
            {style && (
              <span className="wm-allegiance" style={{ color: style.ring }}>
                {style.words}
              </span>
            )}
          </div>
        </div>
        <button type="button" className="wm-btn wm-btn-icon wm-close" onClick={onClose} aria-label="Close panel">
          <svg className="wm-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>

      {village && (
        <div className="wm-stagecard">
          <span className="wm-thumb" aria-hidden="true">
            <img src={artUrl(villageSprite(village))} alt="" width={72} height={88} />
          </span>
          <div>
            <div className="wm-stagecard-kicker">
              {village.kind === 'abandoned' ? 'Ruin' : 'Stage'} {stageNo} of {stageCount}
            </div>
            <div className="wm-stagecard-name">
              {stageName(village)} · {formatInt(village.points)} points
            </div>
            {style && (
              <div className="wm-stagecard-al">
                <span className="wm-ring-sample" data-al={al ?? undefined} aria-hidden="true" />
                {style.words}
                {al !== 'abandoned' && ` · ${style.banner.toLowerCase()}`}
              </div>
            )}
          </div>
        </div>
      )}

      <dl className="wm-facts">
        <div>
          <dt>Location</dt>
          <dd>{formatCoords(tile.x, tile.y)}</dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>{isOwn ? '–' : `${dist.toFixed(1)} fields`}</dd>
        </div>
        <div>
          <dt>Terrain</dt>
          <dd>{terrainName}</dd>
        </div>
        {village?.protected && village.kind !== 'abandoned' && (
          <div>
            <dt>Status</dt>
            <dd className="wm-protected">Beginner protection</dd>
          </div>
        )}
      </dl>

      {isOwn && (
        <button type="button" className="wm-btn wm-btn-sun wm-btn-big" onClick={() => navigate('village')}>
          Open my village
        </button>
      )}
      {village && (canShip || (!isOwn && (village.kind === 'player' || village.kind === 'abandoned'))) && (
        <ShipmentForm key={`ship-${tile.x}|${tile.y}`} tile={tile} target={village} />
      )}
      {village && !isOwn && attackBlocked && relation && (
        <p className="wm-note" role="note">
          {ATTACK_BLOCKED_TEXT[relation] ?? 'Attacks on this village are blocked.'}
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
