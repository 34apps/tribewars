// A building's picture as a plain <img> (whole sprite with its ground tile): panels, queue rows, lists.

import type { BuildingId } from '@clanfire/engine';
import { BUILDINGS } from '@clanfire/engine';
import { UNDER_CONSTRUCTION_URL, buildingStage, spriteUrl } from './buildings.ts';

/**
 * `level` picks the stage; level 0 shows what level 1 will look like (or the scaffold when `building`).
 * `crop` trims the empty sky above low buildings so small icons stay readable.
 */
export function BuildingArt({
  id,
  level,
  size = 44,
  building = false,
  label,
  className,
}: {
  id: BuildingId;
  level: number;
  size?: number;
  building?: boolean;
  label?: string;
  className?: string;
}) {
  const stage = buildingStage(id, level);
  const url = stage === 0 && building ? UNDER_CONSTRUCTION_URL : spriteUrl(id, stage === 0 ? 1 : stage);
  return (
    <span className={className ? `bart ${className}` : 'bart'} style={{ width: size, height: size }}>
      <img src={url} alt={label ?? ''} title={label ? undefined : BUILDINGS[id].name} draggable={false} />
    </span>
  );
}
