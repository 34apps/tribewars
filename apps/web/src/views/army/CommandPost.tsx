import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { checkFoundTarget, distance } from '@clanfire/engine';
import type { Coords, MapVillageDto, Mission } from '@clanfire/engine';
import { api, errorMessage } from '../../api.ts';
import { formatCoords } from '../../format.ts';
import { useGame } from '../../game.ts';
import { ALLEGIANCE_STYLE, allegianceOf } from '../../map/allegiance.ts';
import { ShipmentForm } from '../../map/ShipmentForm.tsx';
import { SendForm } from '../../map/TilePanel.tsx';
import '../../map/map.css';
import { Segmented } from '../../tribe/bits.tsx';
import { missionsFor } from '../../villages.ts';
import {
  SEARCH_MAX,
  lookupWindow,
  occupiedIn,
  parseCoords,
  resultRows,
  searchHint,
  searchText,
  targetOfOwn,
  targetOfVillage,
  villageAt,
} from './command-post-logic.ts';
import type { PickedTarget, TargetMode } from './command-post-logic.ts';
import './command-post.css';

const MODES = [
  { value: 'coords', label: 'Coordinates' },
  { value: 'village', label: 'Village' },
  { value: 'player', label: 'Player' },
] as const;

const PLACEHOLDER: Record<TargetMode, string> = { coords: '12|-40', village: 'Village name', player: 'Player name' };
const DEBOUNCE_MS = 300;

/**
 * Army tab: send troops without going through the map. Pick a target by coordinates, village name or player name; the same
 * send form as the map's tile panel opens below. The server decides everything (search and send are re-checked there).
 */
export function CommandPost() {
  const { village, villages } = useGame();
  const [mode, setMode] = useState<TargetMode>('coords');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<PickedTarget | null>(null);
  // Villages around a coordinate target (for the free-site rule of Found); empty for a picked search result.
  const [nearby, setNearby] = useState<MapVillageDto[]>([]);
  const [results, setResults] = useState<MapVillageDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const here: Coords = village;
  const coordsParse = mode === 'coords' ? parseCoords(text) : null;
  const hint = mode === 'coords' ? (coordsParse && !coordsParse.ok ? coordsParse.message : '') : searchHint(text);

  function reset(next: TargetMode) {
    seq.current += 1;
    setMode(next);
    setText('');
    setPicked(null);
    setNearby([]);
    setResults(null);
    setError(null);
    setBusy(false);
  }

  async function lookupCoords(tile: Coords, id: number) {
    setBusy(true);
    setError(null);
    try {
      const w = lookupWindow(tile);
      const res = await api.map(w.x, w.y, w.w, w.h);
      if (id !== seq.current) return;
      setNearby(res.villages);
      setPicked({ tile, village: villageAt(res.villages, tile) });
    } catch (e) {
      if (id !== seq.current) return;
      setError(errorMessage(e));
    } finally {
      if (id === seq.current) setBusy(false);
    }
  }

  async function lookupNames(q: string, id: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.searchVillages(q, mode === 'player' ? 'player' : 'village', village.id);
      if (id !== seq.current) return;
      setResults(res.villages);
    } catch (e) {
      if (id !== seq.current) return;
      setResults(null);
      setError(errorMessage(e));
    } finally {
      if (id === seq.current) setBusy(false);
    }
  }

  // Debounced lookup while typing. Every change cancels the answer of the one before it.
  useEffect(() => {
    seq.current += 1;
    const id = seq.current;
    if (mode === 'coords') {
      const parsed = parseCoords(text);
      if (!parsed.ok) {
        setPicked(null);
        setNearby([]);
        setError(null);
        setBusy(false);
        return undefined;
      }
      const timer = window.setTimeout(() => void lookupCoords(parsed.coords, id), DEBOUNCE_MS);
      return () => window.clearTimeout(timer);
    }
    const q = searchText(text);
    if (q === null) {
      setResults(null);
      setError(null);
      setBusy(false);
      return undefined;
    }
    const timer = window.setTimeout(() => void lookupNames(q, id), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // The lookups only read the mode, the text and the current village (for the distance order).
  }, [mode, text, village.id]);

  function submit(e: FormEvent) {
    e.preventDefault();
    // Enter on a coordinate / name just waits for the debounced lookup; for names with exactly one hit it picks it.
    if (mode !== 'coords' && results?.length === 1 && results[0]) pick(results[0]);
  }

  function pick(v: MapVillageDto) {
    setPicked(targetOfVillage(v));
    setNearby([]);
  }

  const rows = resultRows(results ?? [], here);
  const others = villages.filter((v) => v.id !== village.id);

  return (
    <section className="card command-post" aria-label="Command post">
      <div className="title-row">
        <h2 className="card-title">Command post</h2>
        <details className="help-pop">
          <summary aria-label="How the command post works">?</summary>
          <p className="small">Find any village by coordinates, village name or player name and send troops without the map.</p>
        </details>
      </div>

      <form className="cp-target" onSubmit={submit} role="search">
        <Segmented label="Find the target by" value={mode} options={MODES} onChange={reset} />
        <div className="cp-find">
          <label className="field cp-field">
            <span>{mode === 'coords' ? 'Coordinates (x|y)' : mode === 'village' ? 'Village name' : 'Player name'}</span>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={PLACEHOLDER[mode]}
              inputMode={mode === 'coords' ? 'text' : 'search'}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={mode === 'coords' ? 24 : SEARCH_MAX + 8}
              aria-describedby="cp-hint"
              aria-invalid={hint !== ''}
            />
          </label>
          <span className="cp-status" aria-live="polite">
            {busy ? 'Looking…' : ''}
          </span>
        </div>
        <p id="cp-hint" className="cp-hint" role={hint ? 'status' : undefined}>
          {hint}
        </p>
        {error && (
          <p className="cp-error" role="alert">
            {error}
          </p>
        )}
      </form>

      {mode !== 'coords' && results !== null && (
        rows.length === 0 ? (
          <p className="cp-empty">{busy ? '' : 'No match'}</p>
        ) : (
          <ul className="cp-results" aria-label="Search results">
            {rows.map(({ village: v, distance: d }) => {
              const al = allegianceOf(v);
              const style = ALLEGIANCE_STYLE[al];
              const isPicked = picked?.village?.id === v.id;
              return (
                <li key={v.id}>
                  <button type="button" className={`cp-result${isPicked ? ' is-picked' : ''}`} onClick={() => pick(v)} aria-pressed={isPicked}>
                    <span className="cp-dot" style={{ background: style.ring }} aria-hidden="true" />
                    <span className="cp-result-main">
                      <span className="cp-result-name">{v.name}</span>
                      <span className="cp-result-owner">
                        {v.ownerName ?? 'Abandoned'}
                        {v.tribeTag ? ` [${v.tribeTag}]` : ''}
                      </span>
                    </span>
                    <span className="cp-result-al">{style.label}</span>
                    <span className="cp-result-where">
                      {formatCoords(v.x, v.y)}
                      {d !== null && <small>{d.toFixed(1)} fields</small>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      )}

      {others.length > 0 && (
        <div className="cp-own">
          <h3 className="cp-own-title">My other villages</h3>
          <ul className="cp-own-list">
            {others.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className={`cp-chip${picked?.village?.id === v.id ? ' is-picked' : ''}`}
                  onClick={() => {
                    setPicked(targetOfOwn(v, null));
                    setNearby([]);
                  }}
                >
                  {v.name} <small>{formatCoords(v.x, v.y)}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {picked && (
        <Picked
          // A new village, target or current village starts a fresh form (counts, mission, errors).
          key={`${village.id}|${picked.tile.x}|${picked.tile.y}|${picked.village?.id ?? 'free'}`}
          picked={picked}
          nearby={nearby}
          from={here}
        />
      )}
      <p className="cp-from">
        From <strong>{village.name}</strong> ({formatCoords(village.x, village.y)})
      </p>
    </section>
  );
}

/** The chosen target: who or what it is, then the shipment form and the send form of the map, with the wide troop picker. */
function Picked({ picked, nearby, from }: { picked: PickedTarget; nearby: MapVillageDto[]; from: Coords }) {
  const { village: current, player, settings } = useGame();
  const target = picked.village;
  const tile = picked.tile;
  const isCurrent = target?.kind === 'own' && target.id === current.id;
  const missions: Mission[] = target ? missionsFor(target, { playerId: player.id, currentVillageId: current.id }) : ['found'];
  const free = target === null;
  const occupied = occupiedIn(nearby);
  const foundSite = free ? checkFoundTarget(tile, settings, occupied) : null;
  const al = target ? allegianceOf(target) : null;
  const style = al ? ALLEGIANCE_STYLE[al] : null;
  const attackBlocked = !!target && target.kind === 'player' && !missions.includes('attack');
  const canShip = !!target && ((target.kind === 'own' && !isCurrent) || target.kind === 'player' || target.kind === 'abandoned');

  return (
    <div className="cp-sheet">
      <header className="cp-picked">
        <div className="cp-picked-main">
          <h3 className="cp-picked-name">{target ? target.name : 'Free land'}</h3>
          <div className="cp-picked-sub">
            {target ? (target.ownerName ?? 'Abandoned') : 'No village here'}
            {target?.tribeTag ? ` [${target.tribeTag}]` : ''}
            {style && (
              <span className="cp-al" style={{ color: style.ring }}>
                {' · '}
                {style.words}
              </span>
            )}
          </div>
        </div>
        <dl className="cp-picked-facts">
          <div>
            <dt>Location</dt>
            <dd>{formatCoords(tile.x, tile.y)}</dd>
          </div>
          <div>
            <dt>Distance</dt>
            <dd>{isCurrent ? '-' : `${distance(from, tile).toFixed(1)} fields`}</dd>
          </div>
          {target && target.kind !== 'abandoned' && target.protected && (
            <div>
              <dt>Status</dt>
              <dd>Beginner protection</dd>
            </div>
          )}
        </dl>
      </header>

      {isCurrent && <p className="wm-note">Your troops leave from here.</p>}
      {attackBlocked && target?.relation && <p className="wm-note">Attacks blocked by tribe relation.</p>}
      {free && foundSite && !foundSite.ok && <p className="wm-note">{foundSite.message}</p>}

      {canShip && target && <ShipmentForm key={`ship-${current.id}-${tile.x}|${tile.y}`} tile={tile} target={target} />}
      {missions.length > 0 && !(free && foundSite && !foundSite.ok) && (
        <SendForm tile={tile} target={target} missions={missions} preferred={null} layout="wide" />
      )}
    </div>
  );
}
