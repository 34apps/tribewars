// A unit's toy figure as a plain <img> (art/units/<unit>-<pose>.svg, art/units/icon/<unit>.svg), loaded as asset URLs, not bundled.
// Units without a drawing yet (chieftain, logram, boulder) fall back to the line icon. Swapping art: drop a file with the same name
// into ./units/ and it is used everywhere.

import type { UnitId } from '@clanfire/engine';
import { UNIT_ICON } from '../icons.ts';
import { Icon } from './Icon.tsx';

export type UnitPose = 'idle' | 'march' | 'victory' | 'defeated' | 'icon';

const FILES = import.meta.glob(['./units/*.svg', './units/icon/*.svg'], { query: '?no-inline', import: 'default', eager: true }) as Record<string, string>;

function figureUrl(unit: UnitId, pose: UnitPose): string | undefined {
  return FILES[pose === 'icon' ? `./units/icon/${unit}.svg` : `./units/${unit}-${pose}.svg`];
}

/** True when the unit has its own drawing for this pose (default: the idle pose). */
export function hasUnitFigure(unit: UnitId, pose: UnitPose = 'idle'): boolean {
  return figureUrl(unit, pose) !== undefined;
}

/** Decorative (alt="") — always shown next to the unit's name. `size` is the box in px (square). */
export function UnitFigure({ unit, pose = 'idle', size, className }: { unit: UnitId; pose?: UnitPose; size: number; className?: string }) {
  const url = figureUrl(unit, pose);
  if (!url) return <Icon name={UNIT_ICON[unit]} size={size} className={className} />;
  return <img src={url} alt="" width={size} height={size} className={className ? `ufig ${className}` : 'ufig'} draggable={false} />;
}
