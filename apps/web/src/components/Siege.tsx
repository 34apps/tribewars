import type { SiegeHit } from '@clanfire/engine';
import { Icon } from '../art/Icon.tsx';
import { UNIT_ICON } from '../icons.ts';
import { siegeHitText, siegeTargetOptions } from '../villages.ts';

/**
 * Send form, attack with Boulder Slings: which building they lower after a won battle. Names only: building levels are known
 * from a scouting report, never from here. '' = random (the request then carries no `targetBuilding`).
 */
export function SiegePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="wm-siege">
      <label htmlFor="send-siege-target">Boulder Slings hit:</label>
      <select id="send-siege-target" className="wm-select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Random building</option>
        {siegeTargetOptions().map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <p className="wm-muted">Scout first to see building levels.</p>
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
