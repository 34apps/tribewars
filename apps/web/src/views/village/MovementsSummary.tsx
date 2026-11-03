// Short summary of armies on the road, shown in the village view: outgoing, returning (with loot) and incoming.

import type { MovementDto } from '@clanfire/engine';
import { formatCoords, formatDuration } from '../../format.ts';
import { useGame } from '../../game.ts';

function label(mv: MovementDto): string {
  const where = formatCoords(mv.target.x, mv.target.y);
  const incoming = mv.direction === 'incoming';
  if (mv.kind === 'shipment') return incoming ? `Resources coming from ${formatCoords(mv.origin.x, mv.origin.y)}` : `Shipment to ${where}`;
  if (incoming) return mv.kind === 'support' ? `Support arriving from ${formatCoords(mv.origin.x, mv.origin.y)}` : `Attack coming from ${formatCoords(mv.origin.x, mv.origin.y)}`;
  if (mv.kind === 'return') return 'Returning home';
  if (mv.kind === 'scout') return `Scouting ${where}`;
  if (mv.kind === 'support') return `Support to ${where}`;
  return `${mv.target.ownerName ? 'Attack on' : 'Raid on'} ${where}`;
}

function cargo(mv: MovementDto): string {
  let troops = 0;
  for (const n of Object.values(mv.units ?? {})) troops += n ?? 0;
  let loot = 0;
  for (const n of Object.values(mv.loot ?? {})) loot += n ?? 0;
  return [troops > 0 ? `${troops} troops` : '', loot > 0 ? `loot ${Math.round(loot)}` : ''].filter(Boolean).join(' · ');
}

export function MovementsSummary({ compact = false }: { compact?: boolean }) {
  const { movements, now } = useGame();
  const list = movements.filter((m) => m.arriveAt > now).sort((a, b) => a.arriveAt - b.arriveAt);
  if (list.length === 0) return null;
  const shown = list.slice(0, compact ? 3 : 6);
  return (
    <section className="vv-moves" aria-label="Armies on the road">
      <div className="eyebrow">On the road</div>
      <ul className="vv-moves-list">
        {shown.map((mv) => (
          <li key={mv.id} className={`vv-moves-row${mv.direction === 'incoming' ? ' is-incoming' : ''}`}>
            <span className="vv-moves-what">
              {label(mv)}
              {cargo(mv) ? <span className="vv-moves-sub"> · {cargo(mv)}</span> : null}
            </span>
            <strong className="vv-moves-time">{formatDuration(mv.arriveAt - now)}</strong>
          </li>
        ))}
      </ul>
      {list.length > shown.length && <div className="vv-moves-sub">+{list.length - shown.length} more in the Army tab</div>}
    </section>
  );
}
