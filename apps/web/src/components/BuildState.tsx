// ONE state control for a building (owner, 2026-11-09): same size, shape, ink outline and bottom shadow in every state, so the
// Village list and the building page's upgrade box read as one design. The pure choice is in ../buildState.ts; styles in frame.css (.bs).
//   gold Up/Build, cream hourglass + time, cream "Queue full", teal timer, tan "Next", dark star "Max", grey lock, "Blocked".

import { Icon } from '../art/Icon.tsx';
import { formatDuration, formatLeft } from '../format.ts';
import type { BuildingInfo } from '../views/village/buildingInfo.ts';

export function BuildState({
  info,
  busy = false,
  onBuild,
  size = 'sm',
  action = false,
}: {
  info: BuildingInfo;
  busy?: boolean;
  onBuild: () => void;
  /** sm: list rows (88 x 36); lg: the building page's upgrade box (full word, 44 high). */
  size?: 'sm' | 'lg';
  /** Building page: show the action state (gold Upgrade even while a job of this building runs) instead of the job state. */
  action?: boolean;
}) {
  const { kind, actionable } = action ? info.actionPick : info.pick;
  const cls = `bs bs-${kind} bs-${size}`;
  if (actionable) {
    const fresh = info.level === 0 && info.jobs.length === 0;
    const word = size === 'lg' ? (fresh ? 'Build' : 'Upgrade') : fresh ? 'Build' : 'Up';
    return (
      <button type="button" className={cls} disabled={busy} onClick={onBuild} aria-label={`${fresh ? 'Build' : 'Upgrade'} to level ${info.target}`}>
        <Icon name="upgrade" size={size === 'lg' ? 20 : 16} />
        {word}
      </button>
    );
  }
  switch (kind) {
    case 'afford':
      return (
        <span className={cls}>
          <Icon name="time" size={size === 'lg' ? 18 : 16} />
          <span className="visually-hidden">Ready in </span>
          {info.affordInMs === null ? 'Too low' : formatLeft(info.affordInMs)}
        </span>
      );
    case 'queuefull':
      return <span className={cls}>Queue full</span>;
    case 'upgrading':
      return (
        <span className={cls}>
          <span className="visually-hidden">Upgrading, </span>
          {formatDuration(info.upgradingLeftMs ?? 0)}
        </span>
      );
    case 'queued':
      return <span className={cls}>Next</span>;
    case 'max':
      return (
        <span className={cls}>
          <Star size={size === 'lg' ? 18 : 15} />
          Max
        </span>
      );
    case 'locked':
      return (
        <span className={cls}>
          <Icon name="lock" size={size === 'lg' ? 18 : 16} />
          Locked
        </span>
      );
    default:
      return <span className={cls}>Blocked</span>;
  }
}

/** A small gold star for the Max state (the drawn icons have no star). */
function Star({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"
        fill="var(--c-sun)"
        stroke="var(--c-sun-hi)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
