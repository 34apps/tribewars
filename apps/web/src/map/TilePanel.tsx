import { useState } from 'react';
import { MAP_STAGE_NAMES, UNITS, UNIT_IDS, buildSiteProblem, checkFoundTarget, checkMission, checkSend, distance, emptyUnits, mapStage, ruinStage, totalUnits, travelPreview } from '@clanfire/engine';
import type { Coords, MapVillageDto, Mission, UnitId, Units } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { Icon } from '../art/Icon.tsx';
import { UnitFigure } from '../art/UnitFigure.tsx';
import { HoldCard } from '../components/HoldCard.tsx';
import { SiegePicker } from '../components/Siege.tsx';
import { TroopGroupBar } from '../components/TroopGroups.tsx';
import { useTroopGroups } from '../hooks/useTroopGroups.ts';
import { builtinGroups, fillFromGroup, shortNote } from '../troopGroups.ts';
import { formatClock, formatCoords, formatDuration, formatInt } from '../format.ts';
import { useGame, useRules } from '../game.ts';
import { MISSION_NAME, UNIT_ICON } from '../icons.ts';
import { ATTACK_BLOCKED_TEXT, MISSION_HINT } from '../relations.ts';
import { Segmented } from '../tribe/bits.tsx';
import {
  RELIEF_LABEL,
  SEND_MODE_BUTTON,
  SEND_MODE_HINT,
  SEND_MODE_SENT,
  canStrike,
  foundProblem,
  isReliefTarget,
  missionsFor,
  myOccupierPopulation,
  nextChieftainPrice,
  occupyWarning,
  selectableUnits,
  sendMode,
  showsSiegePicker,
  siegeTargetFor,
  strikeHint,
  strikeNeed,
  strikeWarning,
  UNIT_COLUMN_NAME,
  unitColumns,
} from '../villages.ts';
import { ALLEGIANCE_STYLE, allegianceOf, stageName, villageSprite } from './allegiance.ts';
import { ShipmentForm } from './ShipmentForm.tsx';
import { draftFromSend } from '../simulator.ts';
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
  /** Is a village standing on this tile (as far as the loaded map chunks know)? Previews the free-site rule for Found. */
  occupied: (x: number, y: number) => boolean;
  onClose: () => void;
}

/**
 * `target` is null for a free tile (Found a village). One form for every mission: the army list follows the mission, and the
 * mode (Strike, Found, Occupy...) picks the wording, the hint and the warnings. The server re-checks everything.
 */
export function SendForm({
  tile,
  target,
  missions,
  preferred,
  hints,
  targetLabel,
  layout = 'panel',
}: {
  tile: Coords;
  target: MapVillageDto | null;
  missions: Mission[];
  preferred: Mission | null;
  /** Site panel: wording per mission that replaces the generic hint (a site is a tile, not a village). */
  hints?: Partial<Record<Mission, string>>;
  /** Name for the toast after sending (a site's name); defaults to the village name or the coordinates. */
  targetLabel?: string;
  /** 'wide' (Command post): the troop picker in columns Foot / Riders / Siege / Special. The map panel keeps 'panel'. */
  layout?: 'panel' | 'wide';
}) {
  const { live, now, settings, renown, village, player, stationed, applySend, refresh, toast, viewMovement, navigate, worldEnd, openSimulator } = useGame();
  const rules = useRules();
  const fallback: Mission = missions[0] ?? 'attack';
  const [chosenMission, setChosenMission] = useState<Mission>(preferred && missions.includes(preferred) ? preferred : fallback);
  // A Found send starts with the Chieftain already chosen.
  const [counts, setCounts] = useState<Partial<Record<UnitId, string>>>(() =>
    (preferred ?? fallback) === 'found' && live.troops.chieftain > 0 ? { chieftain: '1' } : {},
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Test mode only: own seconds for the way out / home (blank = normal travel time).
  const [outSecs, setOutSecs] = useState('');
  const [backSecs, setBackSecs] = useState('');
  // Boulder Slings only: the building they hit ('' = random).
  const [siegePick, setSiegePick] = useState('');
  // Troop groups: "Only 40 of 60 Raiders at home" after a tap that came up short.
  const [groupNote, setGroupNote] = useState<string | null>(null);
  const savedGroups = useTroopGroups();

  // The relation can change while the panel is open (a pact formed): fall back to an allowed mission.
  const mission: Mission = missions.includes(chosenMission) ? chosenMission : fallback;
  const scouting = mission === 'scout';
  const fights = mission === 'attack' || mission === 'scout';
  const targetName = target?.name ?? 'the new village';

  // Attack on a cold own / tribe-mate / ally village = relief attack (occupiers only; no Chieftains, no siege, no loot).
  const relief = mission === 'attack' && isReliefTarget(target, { playerId: player.id, currentVillageId: village.id });
  const visible = selectableUnits(relief ? 'relieve' : mission, live.troops, rules.features.siege);
  const chosen: Units = emptyUnits();
  for (const u of visible) {
    const n = Number(counts[u] ?? '');
    chosen[u] = Number.isInteger(n) ? Math.max(0, Math.min(live.troops[u], n)) : 0;
  }
  const total = totalUnits(chosen);
  const partial: Partial<Units> = {};
  for (const u of UNIT_IDS) if (chosen[u] > 0) partial[u] = chosen[u];
  const mode = sendMode(mission, partial, target?.kind ?? null, relief);
  const check = checkSend(live, partial);
  const missionCheck = checkMission(mission, chosen);
  // The server computes the real time from the same rule and its own seed; this only shows it in advance.
  const preview = total > 0 ? travelPreview(village, tile, chosen, settings) : null;
  const travel = preview ? preview.ms : 0;
  const slowdown = preview ? slowdownText(preview.flatMs, preview.ms) : null;
  const carry = UNIT_IDS.reduce((sum, u) => sum + chosen[u] * UNITS[u].carry, 0);
  const targetProtected = fights && !relief && !!target && target.protected && target.kind === 'player';
  const breaksProtection = fights && !relief && target?.kind === 'player' && player.protectedUntil > now;
  const chieftainHome = live.troops.chieftain > 0;
  const offerStrike = mission === 'attack' && !relief && canStrike(target?.kind ?? null) && chieftainHome && chosen.chieftain === 0 && !targetProtected;
  const strikeNeeds = strikeNeed(target?.kind ?? null, target?.points ?? 0);

  let reason: string | null = null;
  if (worldEnd) reason = 'This world has ended';
  else if (targetProtected) reason = 'This player is under beginner protection';
  else if (total < 1) {
    if (mission === 'found') reason = chieftainHome ? 'Choose your Chieftain' : 'No Chieftain at home. Train one in the Army tab (Banner Hall)';
    else if (visible.length > 0) reason = scouting ? 'Choose how many Pathfinders to send' : 'Choose troops to send';
    else reason = scouting ? 'No Pathfinders at home' : 'No troops at home';
  } else if (!check.ok) reason = check.message;
  else if (!missionCheck.ok) reason = missionCheck.message;
  else if (mission === 'found') reason = foundProblem(chosen);

  // Not blocking (the server decides), but worth saying before the army leaves.
  let warning: string | null = null;
  if (mode === 'strike') warning = strikeWarning(chosen, target?.kind !== 'player', target?.points ?? 0);
  else if (mode === 'occupy' && target) {
    const there = target.hearth ? myOccupierPopulation(stationed.abroad, target.id) : 0;
    warning = target.hearth ? occupyWarning(chosen, there, target.hearth.minPopulation) : null;
  }

  function setCount(u: UnitId, value: string) {
    setError(null);
    setGroupNote(null);
    setCounts((c) => ({ ...c, [u]: value }));
    // The chosen building only means something while Boulder Slings are in the army: drop it when they are deselected.
    if (u === 'boulder') {
      const n = Number(value);
      if (!(Number.isInteger(n) && n > 0)) setSiegePick('');
    }
  }

  /** A troop group tapped: min(group, at home) for the units this mission takes; everything else is cleared. */
  function applyGroup(units: Partial<Units>) {
    const fill = fillFromGroup(units, visible, live.troops);
    setError(null);
    setCounts(fill.counts);
    if (!fill.counts.boulder) setSiegePick('');
    setGroupNote(Object.keys(fill.counts).length === 0 ? 'None of that group is at home for this mission.' : shortNote(fill.short));
  }

  /** Everything at home (a Found send takes just the one Chieftain). */
  function fillAll(u: UnitId) {
    setCount(u, String(mission === 'found' && u === 'chieftain' ? Math.min(1, live.troops[u]) : live.troops[u]));
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
      const targetBuilding = rules.features.siege ? siegeTargetFor(mission, partial, siegePick) : undefined;
      const res = await api.send(village.id, { x: tile.x, y: tile.y, units: partial, mission, ...(targetBuilding ? { targetBuilding } : {}), ...timing });
      applySend(res);
      setCounts({});
      setSiegePick('');
      setGroupNote(null);
      toast(`${SEND_MODE_SENT[mode]} ${targetLabel ?? target?.name ?? formatCoords(tile.x, tile.y)}. Arrives in ${formatDuration(res.movement.arriveAt - now)}.`, {
        action: { label: 'View', onClick: () => viewMovement(res.movement.id) },
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  const title = mode === 'found' ? 'Found a village here' : mode === 'strike' ? 'Strike' : mode === 'relieve' ? RELIEF_LABEL : missions.length > 1 ? 'Send troops' : `Send ${MISSION_NAME[mission].toLowerCase()}`;
  const reliefTarget = isReliefTarget(target, { playerId: player.id, currentVillageId: village.id });

  return (
    <form
      className="wm-send"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <h3 className="wm-send-title">{title}</h3>
      {missions.length > 1 && (
        <Segmented
          label="Mission"
          value={mission}
          options={missions.map((m) => ({ value: m, label: m === 'attack' && reliefTarget ? RELIEF_LABEL : MISSION_NAME[m] }))}
          onChange={(m) => {
            setError(null);
            setGroupNote(null);
            setSiegePick('');
            setChosenMission(m);
          }}
        />
      )}
      <p className="wm-muted">
        {mode === 'strike' ? strikeHint(target?.kind ?? null, settings) : (hints?.[mission] ?? SEND_MODE_HINT[mode] ?? MISSION_HINT[mission])}
        {mode === 'found' && chieftainHome ? ' The Renown for him is already paid (reserved when he was trained).' : ''}
      </p>
      {offerStrike && (
        <p className="wm-muted">
          Add {strikeNeeds === 1 ? 'a Chieftain' : `${strikeNeeds} Chieftains`} and an escort to try a Strike: it tries to put the hearth of {targetName} out.
        </p>
      )}
      {visible.length === 0 ? (
        <p className="wm-muted">
          {scouting ? 'No Pathfinders at home. ' : mission === 'found' ? 'No Chieftain at home. ' : 'No troops at home. '}
          <button type="button" className="wm-link" onClick={() => navigate('army')}>
            {mission === 'found' ? 'Train one in the Army tab (Banner Hall)' : 'Train some in the Army tab'}
          </button>
          .
        </p>
      ) : (
        <>
        {mission !== 'found' && (
          <TroopGroupBar
            builtins={builtinGroups({ visible, home: live.troops, mission, relief, target, minPopulation: target?.hearth?.minPopulation })}
            store={savedGroups}
            chosen={partial}
            total={total}
            onApply={applyGroup}
          />
        )}
        {groupNote && (
          <p className="wm-muted wm-groups-note" role="status">
            {groupNote}
          </p>
        )}
        {layout === 'wide' ? (
          <div className="wm-units-wide">
            {unitColumns(visible).map((col) => (
              <section key={col.column} className="wm-ucol" aria-label={UNIT_COLUMN_NAME[col.column]}>
                <h4 className="wm-ucol-title">{UNIT_COLUMN_NAME[col.column]}</h4>
                <ul className="wm-units wm-units-col">
                  {col.units.map((u) => (
                    <li key={u}>
                      <label htmlFor={`send-${u}`}>
                        <UnitFigure unit={u} pose="icon" size={32} className="inline-icon" /> {UNITS[u].name}
                      </label>
                      <button type="button" className="wm-link wm-have" onClick={() => fillAll(u)} aria-label={`Fill all ${formatInt(live.troops[u])} ${UNITS[u].name}`}>
                        {formatInt(live.troops[u])}
                      </button>
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
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
        <ul className="wm-units">
          {visible.map((u) => (
            <li key={u}>
              <label htmlFor={`send-${u}`}>
                <Icon name={UNIT_ICON[u]} size={18} className="inline-icon" /> {UNITS[u].name}
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
              <button type="button" className="wm-btn wm-btn-small" onClick={() => setCount(u, String(mission === 'found' && u === 'chieftain' ? Math.min(1, live.troops[u]) : live.troops[u]))}>
                {mission === 'found' && u === 'chieftain' ? '1' : 'All'}
              </button>
            </li>
          ))}
        </ul>
        )}
        </>
      )}
      {showsSiegePicker(mission, chosen, rules.features.siege) &&<SiegePicker value={siegePick} onChange={setSiegePick} />}
      {mission === 'attack' && total > 0 && (
        <p className="wm-muted">
          <button type="button" className="wm-link" onClick={() => openSimulator(draftFromSend(partial))}>
            Try in simulator
          </button>
        </p>
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
          {mission === 'attack' && mode !== 'strike' && mode !== 'relieve' && (
            <div>
              <dt>Can carry</dt>
              <dd>{formatInt(carry)}</dd>
            </div>
          )}
          {mode === 'found' && (
            <div>
              <dt>Price</dt>
              <dd>
                {chosen.chieftain > 0 ? 'Renown already paid' : `${formatInt(nextChieftainPrice(renown, settings))} Renown`}
              </dd>
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
      {warning && <p className="wm-note">{warning}</p>}
      {error && (
        <p className="wm-error" role="alert">
          {error}
        </p>
      )}
      <button className="wm-btn wm-btn-sun wm-btn-big" type="submit" disabled={!!reason || busy}>
        <svg className="wm-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4l11 11M20 4 9 15M6 18l-2 2M18 18l2 2M13 17l4 4M11 17l-4 4" />
        </svg>
        {busy ? 'Sending…' : SEND_MODE_BUTTON[mode]}
      </button>
      {reason && <div className="wm-why">{reason}</div>}
    </form>
  );
}

export function TilePanel({ tile, village, loaded, terrain, preferred, occupied, onClose }: Props) {
  const { village: mine, villages, selectVillage, player, navigate, viewTribe, settings, stationed } = useGame();
  // One of my villages stands here (the map may still be loading, then my own list answers).
  const ownHere = villages.find((v) => v.id === village?.id || (v.x === tile.x && v.y === tile.y));
  const isOwn = village?.kind === 'own' || !!ownHere;
  const isCurrent = ownHere?.id === mine.id;
  const free = !village && !isOwn && loaded;
  const terrainName = TERRAIN_NAME[terrain.get(tile.x, tile.y)] ?? 'Land';
  const dist = distance(mine, tile);
  const al = village ? allegianceOf(village) : isOwn ? 'own' : null;
  const style = al ? ALLEGIANCE_STYLE[al] : null;
  const owner = isOwn ? player.username : village ? (village.ownerName ?? null) : null;
  // Resources can also go to another village of mine (the server allows it).
  const canShip = village?.kind === 'own' && !isCurrent;
  const relation = village && !isOwn && village.kind === 'player' ? village.relation : null;
  const tribeId = village && !isOwn ? village.tribeId : null;
  const missions: Mission[] = village ? missionsFor(village, { playerId: player.id, currentVillageId: mine.id }) : free ? ['found'] : [];
  // Attack and scout go together, so a missing attack means the relation blocks both.
  const attackBlocked = relation !== null && !missions.includes('attack');
  // Found: the same rule as the server on free, buildable land away from other villages (the server re-checks on send and arrival).
  const foundSite = free ? checkFoundTarget(tile, settings, occupied) : null;
  // ownerChieftain may be missing from an older server; badgeUrl treats undefined as "no portrait".
  const badge = badgeUrl(isOwn ? player.chieftain : village?.ownerChieftain);
  const stageNo = village ? (village.kind === 'abandoned' ? ruinStage(village.points) : mapStage(village.points)) : 0;
  const stageCount = village?.kind === 'abandoned' ? RUIN_NAMES.length : MAP_STAGE_NAMES.length;
  // Hold clock of a cold village: my own village shows the owner's numbers (occupiers), my claim shows my stationed troops.
  const hearth = ownHere?.hearth ?? village?.hearth;
  const claimant = !!hearth && hearth.claimById === player.id;
  const viewpoint = isOwn ? 'owner' : claimant ? 'claimant' : 'other';
  const occupiers = hearth && claimant && village ? myOccupierPopulation(stationed.abroad, village.id) : undefined;

  return (
    <aside className="wm-panel" aria-label="Selected tile">
      <div className="wm-panel-grip" aria-hidden="true" />
      <header className="wm-panel-head">
        <div className="wm-panel-titles">
          <h2>
            {al && al !== 'abandoned' && <img className="wm-head-banner" src={artUrl(`banner-${al}`)} alt="" width={24} height={28} />}
            {village ? village.name : ownHere ? ownHere.name : terrainName}
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
                {hearth && ' · hearth out'}
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
          <dd>{isCurrent ? '–' : `${dist.toFixed(1)} fields`}</dd>
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
        {free && (
          <div>
            <dt>Land</dt>
            <dd>{foundSite?.ok ? 'Free to settle' : buildSiteProblem(tile.x, tile.y, settings, occupied) === 'near' ? 'Too close to a village' : 'Not buildable'}</dd>
          </div>
        )}
      </dl>

      {hearth && <HoldCard hearth={hearth} viewpoint={viewpoint} occupiers={occupiers} className="wm-hold" compact />}

      {isOwn && (
        <button
          type="button"
          className="wm-btn wm-btn-sun wm-btn-big"
          onClick={() => {
            if (ownHere && !isCurrent) selectVillage(ownHere.id);
            navigate('village');
          }}
        >
          {isCurrent ? 'Open my village' : 'Switch to this village'}
        </button>
      )}
      {village && (canShip || (!isOwn && (village.kind === 'player' || village.kind === 'abandoned'))) && (
        <ShipmentForm key={`ship-${mine.id}-${tile.x}|${tile.y}`} tile={tile} target={village} />
      )}
      {village && !isOwn && attackBlocked && relation && (
        <p className="wm-note" role="note">
          {ATTACK_BLOCKED_TEXT[relation] ?? 'Attacks on this village are blocked.'}
        </p>
      )}
      {free && foundSite && !foundSite.ok && (
        <p className="wm-note" role="note">
          {foundSite.message}
        </p>
      )}
      {missions.length > 0 && !(free && foundSite && !foundSite.ok) && (
        <SendForm
          key={`${mine.id}|${tile.x}|${tile.y}|${preferred?.nonce ?? 0}`}
          tile={tile}
          target={village ?? null}
          missions={missions}
          preferred={preferred?.mission ?? null}
        />
      )}
    </aside>
  );
}
