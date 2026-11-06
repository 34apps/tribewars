import { useEffect, useState } from 'react';
import type { ScoutedResponse, SiegeHit } from '@clanfire/engine';
import { api } from '../api.ts';
import { Icon } from '../art/Icon.tsx';
import { UNIT_ICON } from '../icons.ts';
import { formatAgo } from '../format.ts';
import { siegeHitText, siegeOptionLabel, siegeTargetOptions } from '../villages.ts';

/**
 * Send form, attack with Boulder Slings: which building they lower after a won battle. Names are public; levels come only from the
 * player's OWN latest scout report on this village (GET /api/scouted/:id, shown with its age), never from the village itself.
 * '' = random (the request then carries no `targetBuilding`).
 */
export function SiegePicker({ value, onChange, targetId, now }: { value: string; onChange: (id: string) => void; targetId?: number; now?: number }) {
  const [scouted, setScouted] = useState<ScoutedResponse | null>(null);
  useEffect(() => {
    setScouted(null);
    if (targetId === undefined) return undefined;
    let live = true;
    api
      .scouted(targetId)
      .then((r) => {
        if (live) setScouted(r);
      })
      .catch(() => {}); // no intel is fine: the names alone still work
    return () => {
      live = false;
    };
  }, [targetId]);
  const ageText = scouted?.buildings && scouted.scoutedAt !== null ? formatAgo(scouted.scoutedAt, now ?? Date.now()) : null;
  return (
    <div className="wm-siege">
      <label htmlFor="send-siege-target">Boulder Slings hit:</label>
      <select id="send-siege-target" className="wm-select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Random building</option>
        {siegeTargetOptions().map((b) => (
          <option key={b.id} value={b.id}>
            {siegeOptionLabel(b.name, scouted?.buildings?.[b.id], ageText)}
          </option>
        ))}
      </select>
      <p className="wm-muted">{ageText ? `Levels from your scouting report, ${ageText}. They may have changed since.` : 'Scout first to see building levels.'}</p>
    </div>
  );
}

/** Report: what the surviving siege units did to the defender's buildings (one line per hit). */
export function SiegeResult({ hits }: { hits: SiegeHit[] | undefined }) {
  if (!hits || hits.length === 0) return null;
  return (
    <section className="subsection" aria-label="Siege">
      <h3 className="subtitle">Siege</h3>
      <ul className="siege-list">
        {hits.map((h, i) => (
          <li key={`${h.unit}-${h.building}-${i}`} className={h.from === h.to ? 'muted' : undefined}>
            <Icon name={UNIT_ICON[h.unit]} size={18} className="inline-icon" /> {siegeHitText(h)}
          </li>
        ))}
      </ul>
    </section>
  );
}
