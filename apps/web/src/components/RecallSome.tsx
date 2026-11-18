// "Call back" / "Recall" form: per-unit amount fields with an "all" button. Used by the Army page and the map site panel.

import { useState } from 'react';
import { UNITS, UNIT_IDS, normalizeUnits } from '@clanfire/engine';
import type { UnitId, Units } from '@clanfire/engine';
import { recallChoice } from '../recallChoice.ts';
import { UnitFigure } from '../art/UnitFigure.tsx';
import { formatInt } from '../format.ts';

/**
 * Per-unit amount fields with an "all" button and a Recall button: bring part of a contingent home. Used for support standing in another
 * player's village (Army) and for troops standing at a map site. `warning`, when given, is shown (before the button is pressed) once the
 * chosen amounts take the whole contingent.
 */
export function RecallSome({
  s,
  busy,
  onRecall,
  warning,
  label = 'Recall',
}: {
  s: { id: number | string; units: Partial<Units> };
  busy: boolean;
  onRecall: (units: Partial<Units>) => void;
  warning?: string;
  label?: string;
}) {
  const have = normalizeUnits(s.units);
  const [counts, setCounts] = useState<Partial<Record<UnitId, string>>>({});
  const present = UNIT_IDS.filter((u) => have[u] > 0);
  const { chosen, total } = recallChoice(have, counts);
  return (
    <form
      className="recall-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (total > 0 && !busy) onRecall(chosen);
      }}
    >
      <ul className="send-units">
        {present.map((u) => (
          <li key={u}>
            <label htmlFor={`recall-${s.id}-${u}`} className="send-label">
              <UnitFigure unit={u} pose="icon" size={20} className="inline-icon" /> {UNITS[u].name}
              <span className="muted"> / {formatInt(have[u])}</span>
            </label>
            <input
              id={`recall-${s.id}-${u}`}
              className="input"
              type="number"
              inputMode="numeric"
              min={0}
              max={have[u]}
              step={1}
              placeholder="0"
              value={counts[u] ?? ''}
              onChange={(e) => setCounts((c) => ({ ...c, [u]: e.target.value }))}
            />
            <button type="button" className="btn" onClick={() => setCounts((c) => ({ ...c, [u]: String(have[u]) }))}>
              all
            </button>
          </li>
        ))}
      </ul>
      {warning && total > 0 && total === present.reduce((n, u) => n + have[u], 0) && (
        <p className="muted" role="note">
          {warning}
        </p>
      )}
      <button className="btn btn-primary btn-block" type="submit" disabled={total < 1 || busy}>
        {total > 0 ? `${label} ${formatInt(total)}` : label}
      </button>
    </form>
  );
}
