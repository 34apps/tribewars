// Tribe tab, "Lookout": enemy armies (attacks and supports) that pass within a Lookout's reach, soonest first.
// Who, from where, to where, when, and a rough size (never unit counts). Data: GET /api/tribe/sightings.

import type { LookoutSightingDto, SightingSize } from '@clanfire/engine';
import { formatClock, formatCoords, formatDuration } from '../format.ts';
import { useGame, useRules } from '../game.ts';
import { useSightings } from '../hooks/useSightings.ts';

export const SIZE_LABEL: Record<SightingSize, string> = { small: 'Small army', medium: 'Medium army', large: 'Large army' };
export const LOOKOUT_NONE_HELD = 'Hold a Lookout to see enemy armies passing by.';
export const LOOKOUT_NONE_SEEN = 'No enemy armies seen right now.';

/** "[TAG] Player, Village" (the tag, name and village are whatever the server knows). */
export function sightingWho(s: Pick<LookoutSightingDto, 'from' | 'fromTribeTag'>): string {
  const owner = s.from.ownerName ?? 'Unknown';
  return `${s.fromTribeTag ? `[${s.fromTribeTag}] ` : ''}${owner}, ${s.from.name}`;
}

interface ListProps {
  sightings: readonly LookoutSightingDto[];
  /** How many Lookouts the tribe holds. */
  lookouts: number;
  /** Server-corrected time (ms). */
  now: number;
  onShow: (x: number, y: number) => void;
}

/** Pure list (no hooks): heading with the Lookouts held, the rows, or the right empty state. */
export function LookoutList({ sightings, lookouts, now, onShow }: ListProps) {
  const live = sightings.filter((s) => s.arriveAt > now - 1500);
  return (
    <section className="card" aria-labelledby="lookout-title">
      <h2 id="lookout-title" className="card-title">
        Lookout{' '}
        <span className="muted small lookout-held">
          {lookouts === 1 ? 'You hold 1 Lookout' : `You hold ${lookouts} Lookouts`}
        </span>
      </h2>
      {lookouts <= 0 && <p className="muted">{LOOKOUT_NONE_HELD}</p>}
      {lookouts > 0 && live.length === 0 && <p className="muted">{LOOKOUT_NONE_SEEN}</p>}
      {live.length > 0 && (
        <ul className="movement-list" aria-label="Enemy armies seen by your Lookouts">
          {live.map((s) => {
            const left = s.arriveAt - now;
            return (
              <li key={s.movementId} className="movement is-incoming alert-row sighting-row">
                <div className="movement-head">
                  <span className="movement-title">
                    <span className={`tag ${s.mission === 'attack' ? 'tag-bad' : 'tag-info'}`}>{s.mission === 'attack' ? 'Attack' : 'Support'}</span>{' '}
                    <span className="sighting-who">{sightingWho(s)}</span>
                  </span>
                  <span className="movement-time">
                    <strong>{left > 0 ? formatDuration(left) : 'landing…'}</strong>
                  </span>
                </div>
                <div className="movement-foot">
                  <span>
                    {'→ '}
                    <button type="button" className="link link-touch" onClick={() => onShow(s.to.x, s.to.y)} title="Show on map">
                      {s.to.name} ({formatCoords(s.to.x, s.to.y)})
                    </button>
                  </span>
                  <span className="muted">
                    arrives {formatClock(s.arriveAt, now)} · seen by {s.lookoutName}
                  </span>
                </div>
                <div className="sighting-size">
                  <span className={`size-chip size-${s.size}`}>{SIZE_LABEL[s.size]}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The live section for the Tribe tab. */
export function LookoutSection() {
  const { now, showOnMap } = useGame();
  const sitesOn = useRules().features.sites;
  const { sightings, lookouts } = useSightings(sitesOn);
  if (!sitesOn) return null;
  return <LookoutList sightings={sightings} lookouts={lookouts} now={now} onShow={(x, y) => showOnMap(x, y)} />;
}
