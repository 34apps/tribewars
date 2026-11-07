import { Icon } from '../art/Icon.tsx';
import { formatInt } from '../format.ts';

/** Population line under the troops table. Troops cost population only; there is no food upkeep (GAME_DESIGN 18.9). */
export function PopulationLine({ used, cap }: { used: number; cap: number }) {
  return (
    <p className="muted upkeep" title="Buildings and troops count. The Farm raises the cap.">
      <Icon name="pop" size={20} className="inline-icon" /> Population {formatInt(used)} / {formatInt(cap)}
    </p>
  );
}
