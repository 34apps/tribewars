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

/** The short second half of a recruit row's role line ("Defence · good vs riders"). Our own wording; the numbers are in the unit guide. */
export const UNIT_HINT: Record<UnitId, string> = {
  pikeman: 'good vs riders',
  guard: 'good vs foot',
  raider: 'hits hard',
  pathfinder: 'fastest',
  outrider: 'carries loot',
  knight: 'attack and defence',
  chieftain: 'takes villages',
  logram: 'breaks the Wall',
  boulder: 'hits a building',
};

/** One "good for" line per unit for the info cards. Our own wording; every number on the cards comes from the engine config. */
export const UNIT_GOOD_FOR: Record<UnitId, string> = {
  pikeman: 'holding the village against riders. A weak attacker.',
  guard: 'holding the village against foot soldiers. Slow to hit back.',
  raider: 'hitting hard and carrying loot home. Weak when attacked.',
  pathfinder: 'scouting a village before you send the army. The fastest unit.',
  outrider: 'fast raids that carry a lot of loot home.',
  knight: 'both attacking and defending. Costly, so keep them alive.',
  chieftain: 'taking an abandoned village for your own. Needs an escort.',
  logram: 'breaking the Wall before the main army arrives.',
  boulder: 'knocking down one chosen building. Slow and fragile.',
};
