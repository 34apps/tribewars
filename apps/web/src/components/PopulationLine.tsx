import { Icon } from '../art/Icon.tsx';
import { formatInt } from '../format.ts';

/** Population line under the troops table. Troops cost population only; there is no food upkeep (GAME_DESIGN 18.9). */
export function PopulationLine({ used, cap }: { used: number; cap: number }) {
  return (
    <p className="muted upkeep">
      <Icon name="pop" size={20} className="inline-icon" /> Population {formatInt(used)} / {formatInt(cap)} (buildings and troops; the Farm raises the cap).
    </p>
  );
}
