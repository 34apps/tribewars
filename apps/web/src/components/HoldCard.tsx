// Hold clock of a cold village (hearth out): who holds it, running or paused, time left (live), occupiers vs the minimum.
// Used in the village view (owner), the map tile panel (everybody) and for my own claims. Grey with a smoke-coloured flame so it
// reads as "cold" without relying on colour: the words say it too.

import type { HearthInfoDto } from '@clanfire/engine';
import { Icon } from '../art/Icon.tsx';
import { formatDuration, formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { holdText, holdView, occupierGap } from '../villages.ts';
import '../villages.css';

export type HoldViewpoint = 'owner' | 'claimant' | 'other';

export function HoldCard({
  hearth,
  viewpoint,
  occupiers,
  className = 'hold',
  compact = false,
}: {
  hearth: HearthInfoDto;
  viewpoint: HoldViewpoint;
  /** Population of the occupiers standing there, when known (owner's own village; my own claim from my stationed troops). */
  occupiers?: number;
  className?: string;
  /** Phone: head, one sentence and the occupier count only. */
  compact?: boolean;
}) {
  const { now } = useGame();
  const view = holdView(hearth, now);
  const gap = occupierGap(hearth, occupiers ?? hearth.occupierPopulation);
  return (
    <div className={className} role="group" aria-label="Hearth is out">
      <div className="hold-head">
        <span className="hold-smoke" aria-hidden="true">
          <Icon name="flame" size={22} />
        </span>
        <span>Hearth out</span>
        <span className="hold-clock" aria-label={view.running ? `Changes hands in ${formatDuration(view.leftMs)}` : 'Clock paused'}>
          {view.running ? formatDuration(view.leftMs) : `paused ${formatDuration(view.leftMs)}`}
        </span>
      </div>
      <p>{holdText(hearth, now, viewpoint === 'claimant')}</p>
      {viewpoint === 'owner' && <p>{compact ? 'No training. Only the Wall can be built.' : 'No output, no training. Only the Wall can be built.'}</p>}
      {gap && (
        <p>
          Occupiers <strong>{formatInt(gap.have)}</strong>/{formatInt(gap.need)}
          {gap.enough ? '' : <span className="tag tag-bad">Too few</span>}
        </p>
      )}
    </div>
  );
}
