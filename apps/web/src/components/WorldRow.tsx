// Phone lobby pieces: the tent tile (a small coloured rounded square with a toy tent) and a world row.

import type { LobbyWorldDto } from '@clanfire/engine';
import { tentColour, worldButtonLabel } from '../lobby.ts';

/** The tent tile. The colour comes from a hash of the world id, so a world always looks the same. */
export function TentTile({ worldId }: { worldId: string }) {
  const colour = `var(${tentColour(worldId)})`;
  return (
    <span className="tent-tile" aria-hidden="true">
      <svg viewBox="0 0 48 48" width="100%" height="100%" focusable="false">
        <rect width="48" height="48" fill={colour} />
        <ellipse cx="14" cy="54" rx="34" ry="16" fill="#fff" fillOpacity=".22" />
        <ellipse cx="38" cy="56" rx="30" ry="14" fill="#2b211c" fillOpacity=".2" />
        <path d="M13 37l11-19 11 19z" fill="#fff8e8" stroke="#2b211c" strokeWidth="2.6" strokeLinejoin="round" />
        <path d="M21 37l3-8 3 8z" fill="#c4623a" />
      </svg>
    </span>
  );
}

/**
 * One world as a row: tent tile, name, a line of text and one action. `action`: a button (Join / Play / Results / View
 * results) or a filled "Full" tag.
 */
export function WorldRow({
  world,
  meta,
  action,
  busyId,
  disabled,
  error,
  onPlay,
}: {
  world: LobbyWorldDto;
  meta: string | null;
  action: 'join' | 'play' | 'results' | 'view' | 'full';
  busyId: string | null;
  disabled: boolean;
  error?: string;
  onPlay: (w: LobbyWorldDto) => void;
}) {
  const busy = busyId === world.id;
  const label = action === 'join' ? 'Join' : action === 'play' ? 'Play' : action === 'results' ? 'Results' : worldButtonLabel('finished');
  return (
    <li className="wrow">
      <TentTile worldId={world.id} />
      <span className="wrow-text">
        <span className="wrow-name">{world.name}</span>
        {meta && <span className="wrow-meta">{meta}</span>}
        {error && (
          <span className="form-error wrow-error" role="alert">
            {error}
          </span>
        )}
      </span>
      {action === 'full' ? (
        <span className="tag tag-warn wrow-tag">Full</span>
      ) : (
        <button
          type="button"
          className={`btn wrow-btn${action === 'join' || action === 'play' ? ' btn-primary' : ''}`}
          disabled={busyId !== null || disabled}
          aria-label={busy ? undefined : `${label} ${world.name}`}
          onClick={() => onPlay(world)}
        >
          {busy ? 'Opening…' : label}
        </button>
      )}
    </li>
  );
}
