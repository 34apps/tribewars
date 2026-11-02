import { RESOURCE_IDS } from '@clanfire/engine';
import type { Resources } from '@clanfire/engine';
import { formatCompact } from '../format.ts';
import { RESOURCE_ICON, RESOURCE_NAME } from '../icons.ts';

export function ProgressBar({ value, label, tone = 'brand' }: { value: number; label?: string; tone?: 'brand' | 'danger' | 'ok' }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <div
      className={`progress progress-${tone}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
    >
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Resource costs; items turn red when `have` is lower (or the cost can never fit in `cap`). */
export function Cost({ cost, have, cap }: { cost: Resources; have?: Resources; cap?: number }) {
  return (
    <span className="cost">
      {RESOURCE_IDS.filter((r) => cost[r] > 0).map((r) => {
        const short = have ? Math.floor(have[r] + 1e-9) < cost[r] || (cap !== undefined && cost[r] > cap) : false;
        return (
          <span key={r} className={`cost-item${short ? ' is-short' : ''}`} title={`${RESOURCE_NAME[r]}${short ? ' (not enough)' : ''}`}>
            <span aria-hidden="true">{RESOURCE_ICON[r]}</span>
            <span className="visually-hidden">{RESOURCE_NAME[r]} </span>
            {formatCompact(cost[r])}
            {short && <span className="visually-hidden"> (not enough)</span>}
          </span>
        );
      })}
    </span>
  );
}
