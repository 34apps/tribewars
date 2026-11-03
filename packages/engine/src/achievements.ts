// Player statistics and achievements (docs/GAME_DESIGN.md section 16). Pure: the server counts, this file names and scores.

import { ACHIEVEMENT_TIERS } from './config.ts';

/** Lifetime counters per player. Counted on the server only, in the same transaction as the event. */
export const STAT_KEYS = [
  'lootWood',
  'lootFood',
  'lootIron',
  'lootGold',
  'troopsKilled',
  'troopsLost',
  'attacksWon',
  'attacksLost',
  'defencesWon',
  'defencesLost',
  'scoutsSent',
  'scoutsSucceeded',
  'buildingLevelsBuilt',
  'troopsTrained',
  'resourcesShipped',
  'shipmentsSent',
  'abandonedRaided',
  'supportSent',
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type PlayerStatsDto = Record<StatKey, number>;

export const emptyStats = (): PlayerStatsDto => Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as PlayerStatsDto;

/** Readable names for the statistics list. */
export const STAT_LABELS: Record<StatKey, string> = {
  lootWood: 'Wood raided',
  lootFood: 'Food raided',
  lootIron: 'Iron raided',
  lootGold: 'Gold raided',
  troopsKilled: 'Enemy troops defeated',
  troopsLost: 'Troops lost',
  attacksWon: 'Attacks won',
  attacksLost: 'Attacks lost',
  defencesWon: 'Defences held',
  defencesLost: 'Defences lost',
  scoutsSent: 'Scouting missions',
  scoutsSucceeded: 'Scouting missions that got through',
  buildingLevelsBuilt: 'Building levels ordered',
  troopsTrained: 'Troops trained',
  resourcesShipped: 'Resources shipped',
  shipmentsSent: 'Shipments sent',
  abandonedRaided: 'Abandoned villages raided',
  supportSent: 'Support arrivals',
};

export const TIER_NAMES = ['bronze', 'silver', 'gold'] as const;
export type TierName = (typeof TIER_NAMES)[number];

export type AchievementId = keyof typeof ACHIEVEMENT_TIERS;

export interface AchievementDef {
  id: AchievementId;
  name: string;
  description: string;
  /** Counter the achievement reads; derived ones (sums) have null. */
  stat: StatKey | null;
  value: (s: PlayerStatsDto) => number;
  tiers: readonly [number, number, number];
}

const of = (id: AchievementId, name: string, description: string, stat: StatKey): AchievementDef => ({
  id,
  name,
  description,
  stat,
  value: (s) => s[stat],
  tiers: ACHIEVEMENT_TIERS[id],
});

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  of('timberBaron', 'Timber Baron', 'Carry off wood from raids.', 'lootWood'),
  of('grainGrabber', 'Grain Grabber', 'Haul home food from raids.', 'lootFood'),
  of('ironPilferer', 'Iron Pilferer', 'Walk away with iron from raids.', 'lootIron'),
  of('goldMagpie', 'Gold Magpie', 'Snatch gold from raids. Shiny.', 'lootGold'),
  {
    id: 'hoardOfHoards',
    name: 'Hoard of Hoards',
    description: 'Loot of every kind, all added up.',
    stat: null,
    value: (s) => s.lootWood + s.lootFood + s.lootIron + s.lootGold,
    tiers: ACHIEVEMENT_TIERS.hoardOfHoards,
  },
  of('boneCollector', 'Bone Collector', 'Defeat enemy troops, attacking or defending.', 'troopsKilled'),
  of('hardKnocks', 'School of Hard Knocks', 'Lose troops. Every veteran pays tuition.', 'troopsLost'),
  of('fireStarter', 'Fire Starter', 'Win attacks.', 'attacksWon'),
  of('plucky', 'Plucky Loser', 'Lose attacks and march out again anyway.', 'attacksLost'),
  of('hedgehog', 'Immovable Hedgehog', 'Hold your village when attacked.', 'defencesWon'),
  of('openDoor', 'Open Door Policy', 'Get beaten at home. It happens to the best.', 'defencesLost'),
  {
    id: 'battleHardened',
    name: 'Battle Hardened',
    description: 'Win battles, attacking or defending.',
    stat: null,
    value: (s) => s.attacksWon + s.defencesWon,
    tiers: ACHIEVEMENT_TIERS.battleHardened,
  },
  of('nosyNeighbour', 'Nosy Neighbour', 'Send scouting missions.', 'scoutsSent'),
  of('keenEyes', 'Keen Eyes', 'Get your scouts through to bring back a report.', 'scoutsSucceeded'),
  of('brickByBrick', 'Brick by Brick', 'Order building upgrades.', 'buildingLevelsBuilt'),
  of('drillSergeant', 'Drill Sergeant', 'Train troops.', 'troopsTrained'),
  of('generousCart', 'Generous Cart', 'Send resources by market shipment.', 'resourcesShipped'),
  of('caravanMaster', 'Caravan Master', 'Send shipments.', 'shipmentsSent'),
  of('ruinRaider', 'Ruin Raider', 'Win raids on abandoned villages.', 'abandonedRaided'),
  of('shieldFriend', 'Shield Friend', 'Station support troops in a friend’s village.', 'supportSent'),
];

export interface AchievementProgress {
  id: AchievementId;
  /** Current counter value. */
  value: number;
  /** 0 = locked, 1 bronze, 2 silver, 3 gold. */
  tier: 0 | 1 | 2 | 3;
  /** Threshold of the next tier, or null at gold. */
  next: number | null;
}

/** Tier reached and next threshold for every achievement, in ACHIEVEMENTS order. */
export function achievementProgress(stats: PlayerStatsDto): AchievementProgress[] {
  return ACHIEVEMENTS.map((a) => {
    const value = Math.max(0, Math.floor(a.value(stats)));
    let tier = 0;
    for (const need of a.tiers) if (value >= need) tier++;
    return { id: a.id, value, tier: tier as 0 | 1 | 2 | 3, next: a.tiers[tier] ?? null };
  });
}
