import type { UnitId } from '@clanfire/engine';

/** Short role label shown as a tag on unit cards (our own labelling; not engine data). */
export const UNIT_ROLE: Record<UnitId, { label: string; tone: 'def' | 'atk' | 'scout' | 'cav' | 'elite' | 'siege' }> = {
  pikeman: { label: 'Defence', tone: 'def' },
  guard: { label: 'Defence', tone: 'def' },
  raider: { label: 'Attack', tone: 'atk' },
  pathfinder: { label: 'Scout', tone: 'scout' },
  outrider: { label: 'Cavalry', tone: 'cav' },
  knight: { label: 'Elite', tone: 'elite' },
  chieftain: { label: 'Leader', tone: 'elite' },
  logram: { label: 'Siege', tone: 'siege' },
  boulder: { label: 'Siege', tone: 'siege' },
};
