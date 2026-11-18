// Game balance data. Formulas that use these numbers are described in docs/GAME_DESIGN.md.
// Change numbers here (not in logic files) when tuning the game.

import type { FirstStepId } from './api.ts';
import type { BuildingDef, BuildingId, DominationSettings, ResourceId, Resources, Terrain, TribeAction, TribeRole, UnitDef, UnitId, WorldSettings } from './types.ts';

const res = (wood: number, food: number, iron: number, gold = 0): Resources => ({ wood, food, iron, gold });

export const DEFAULT_WORLD: WorldSettings = {
  seed: 20261102,
  speed: 1,
  radius: 100,
  npcDensity: 0.01,
  protectionHours: 72,
};

/**
 * Domination win condition (owner, 2026-11-05: normal worlds are long, no seasons; a tribe wins by holding most of the
 * world). Values are days at speed 1; every duration is divided by the world speed. Stored per world at creation
 * (WorldSettings.domination) and changeable by the operator (admin `domination-set`).
 */
export const DOMINATION_DEFAULTS: DominationSettings = {
  minAgeDays: 180,
  minActivePlayers: 50,
  minPeakShare: 0.3,
  winShare: 0.75,
  streakDays: 14,
  activeDays: 7,
};
/** Allowed range per setting (inclusive), checked by the operator tool and when reading stored settings. */
export const DOMINATION_LIMITS: Record<keyof DominationSettings, { min: number; max: number; integer: boolean }> = {
  minAgeDays: { min: 0, max: 3650, integer: false },
  minActivePlayers: { min: 1, max: 100_000, integer: true },
  minPeakShare: { min: 0, max: 1, integer: false },
  winShare: { min: 0.5, max: 1, integer: false },
  streakDays: { min: 0, max: 3650, integer: false },
  activeDays: { min: 0, max: 3650, integer: false },
};
/** The world is evaluated lazily at most this often (minutes at speed 1, divided by the speed). */
export const DOMINATION_EVAL_INTERVAL_MINUTES = 15;
/** Ranking rows kept in the stored final result, and rows sent in the API (the rest stays in the database). */
export const WORLD_END_STORED_ROWS = 200;
export const WORLD_END_DTO_ROWS = 50;

// ---- Badges + Hall of Fame (docs/GAME_DESIGN.md 18.1 "Badges") ----
/** A player needs this many days in the world (and, for tribe badges, in that tribe) before the end. Divided by the world speed. */
export const BADGE_MIN_DAYS = 14;
/** ... and must have played within this many days before the end. Divided by the world speed. */
export const BADGE_ACTIVE_DAYS = 7;
/** Final player ranks 1..this earn 'top10'. Ties share a rank, so a tie at 10 gives more than ten. */
export const BADGE_TOP_PLAYERS = 10;
/** Hall of Fame: how many tribes / players each finished world shows, and how many worlds the list returns. */
export const HALL_OF_FAME_TOP_TRIBES = 3;
export const HALL_OF_FAME_TOP_PLAYERS = 3;
export const HALL_OF_FAME_MAX_WORLDS = 50;
/** Upper bound of a badge count in an entry pass summary. */
export const BADGE_COUNT_MAX = 999;
/** Tribes listed in the domination status. */
export const DOMINATION_TOP_TRIBES = 5;

export const START_RESOURCES: Resources = res(600, 600, 600, 100);

/**
 * Build queue: one job building + one waiting. The premium (longer queue) option was removed on 2026-11-04 (owner):
 * `buildQueueLimit()` / `researchQueueLimit()` and the *_PREMIUM constants are gone; use these constants directly.
 */
export const MAX_BUILD_QUEUE = 2;
/** Research queue: two researches (one running, one waiting). */
export const MAX_RESEARCH_QUEUE = 2;
/** Batches waiting per training building. */
export const MAX_TRAIN_QUEUE = 5;
/** Share (percent) of the paid cost that comes back when a queued build or training batch is cancelled. The rest is lost. */
export const CANCEL_REFUND_PERCENT = 80;
/**
 * Input sanity bound for one training order, far above anything reachable (owner, 2026-11-18: no fixed limit on an order).
 * The real limits are resources, population room and MAX_TRAIN_QUEUE.
 */
export const MAX_TRAIN_BATCH = 100_000;

/** Production per hour at level 1 (speed 1). Level L gives base * PRODUCTION_GROWTH^(L-1). */
export const PRODUCTION_BASE: Record<'lumber' | 'farm' | 'mine' | 'goldmine', number> = {
  lumber: 54,
  farm: 72,
  mine: 54,
  goldmine: 3, // 1/10 of a Lumber Camp (owner, 2026-11-10): gold counts 10x in loot; GAME_DESIGN §2 has the sizing
};
/** 25 levels (owner 2026-11-11): level 25 makes about 900 wood / 1,200 food / 900 iron an hour; Gold Mine 18 makes 27 gold, as the old level 15 did. */
export const PRODUCTION_GROWTH: Record<'lumber' | 'farm' | 'mine' | 'goldmine', number> = {
  lumber: 1.1245,
  farm: 1.1245,
  mine: 1.1245,
  goldmine: 1.138,
};
/** Wood/food/iron trickle per hour when the producing building is level 0. Gold has none. */
export const PRODUCTION_LEVEL0 = 9;

/** Storehouse cap per resource: level 0 -> STORAGE_LEVEL0, level L -> base * growth^(L-1). */
export const STORAGE_LEVEL0 = 1350;
export const STORAGE_BASE = 1800;
export const STORAGE_GROWTH = 1.177; // level 25 holds about 90,000

/** Vault: resources per type raiders can't take. Level 0 -> 0, level L -> base * growth^(L-1). */
export const VAULT_BASE = 120;
export const VAULT_GROWTH = 1.28; // 12 levels: level 12 hides about 1,800, what the old level 10 hid

/**
 * Population: a second limit next to food. Every building level and every troop (home, away or in training)
 * takes population; the Longhouse sets the cap (the Farm's job until the 2026-11-11 originality pass). Queued building levels are reserved when queued. Abandoned villages
 * are exempt. Building at level L takes ceil(first * POP_BUILDING_GROWTH^(L-1)); the Longhouse itself takes none, so a
 * full village can always still upgrade its Longhouse.
 */
export const POP_BUILDING_FIRST: Record<BuildingId, number> = {
  hall: 4,
  lumber: 3,
  farm: 3,
  longhouse: 0,
  mine: 3,
  goldmine: 3,
  market: 4,
  storehouse: 3,
  barracks: 5,
  stables: 6,
  wrightyard: 6,
  drillyard: 5,
  bannerhall: 6,
  wall: 2,
  vault: 2,
};
export const POP_BUILDING_GROWTH = 1.08; // 25 levels: a maxed building takes about what a 20-level one did
/** Population per troop type. Troops eat no food (owner, 2026-11-05); population is the only limit on army size besides cost and time. */
export const POP_PER_UNIT: Record<UnitId, number> = { pikeman: 1, guard: 1, raider: 1, outrider: 2, hearthwarden: 2, knight: 3, pathfinder: 1, chieftain: 8, logram: 3, firecart: 3 };
/** Cap: Longhouse level 0 -> POP_CAP_LEVEL0, level L -> round(POP_CAP_BASE * POP_CAP_GROWTH^(L-1)). */
export const POP_CAP_LEVEL0 = 120;
export const POP_CAP_BASE = 720;
// Level 25 = about 12,000 (owner 2026-11-11). Room grows as fast as production (x1.1244 per level, same as PRODUCTION_GROWTH), so a village needs about 12-13
// days of its own income to fill its room at EVERY stage of the ladder (2026-11-17, docs/proposals/economy-vs-genre.md; the old x1.2 left the middle levels with a tenth of the room).
export const POP_CAP_GROWTH = 1.1244;

/** Town Hall speeds construction: time * HALL_TIME_FACTOR^(hallLevel-1). */
export const HALL_TIME_FACTOR = 0.9566; // 25 levels: the max level builds in x0.35 of the time; a whole village then takes 25.0 builder-days (27.2 at x0.96)
/** Barracks/Stables/Wrightyard speed training: time * TRAIN_TIME_FACTOR^(buildingLevel-1). */
export const TRAIN_TIME_FACTOR = 0.94;

/** Wall: defense * (1 + WALL_BONUS_PER_LEVEL * level), plus militia WALL_BASE_DEFENSE + WALL_DEFENSE_PER_LEVEL * level. */
export const WALL_BONUS_PER_LEVEL = 0.045; // 22 levels: level 22 = +99%, as the old level 20 (+100%)
export const WALL_BASE_DEFENSE = 20;
export const WALL_DEFENSE_PER_LEVEL = 14;

/** Battle: loser-side loss ratio = (weaker / stronger) ^ BATTLE_LOSS_EXPONENT. Luck is +-BATTLE_LUCK. */
export const BATTLE_LOSS_EXPONENT = 1.5;
export const BATTLE_LUCK = 0.1;

/**
 * Morale (GAME_DESIGN battle section, owner 2026-11-08): a player attacking a village of a player with LESS than this share of the
 * attacker's points (exactly the share = no morale) fights at MORALE_ATTACK_FACTOR of its attack strength.
 */
export const MORALE_SMALL_SHARE = 1 / 3;
export const MORALE_ATTACK_FACTOR = 0.75;
/**
 * A wiped-out attacker normally sees nothing of the defence. When its attack power was at least this share of the defence power
 * (a close fight), its report still shows the defender's units had and lost (home troops and support). The Wall level and buildings stay hidden.
 */
export const LOST_ATTACK_SEEN_SHARE = 0.5;

/**
 * Abandoned villages produce this share of what the same levels would (their stock is the loot raiders live on; the 25-level economy with
 * cheap troops made loot supply the lever that holds raiders in line, BALANCE 13; 0.5 -> 0.45 with the Longhouse split, which slows builders and so raised the raider / builder score ratio to 2.05; back to 0.5 on 2026-11-17 when abandoned villages lost every defender and the Wall militia, BALANCE 16). Players are never affected.
 */
export const NPC_PRODUCTION_FACTOR = 0.5;

/** Abandoned villages. */
export const NPC_MAX_LEVEL = 7;
/** Share of abandoned villages per tier 1..5 (sums to 1). */
export const NPC_TIER_WEIGHTS = [0.4, 0.25, 0.18, 0.11, 0.06] as const;
/**
 * The simple build order of an abandoned village (owner 2026-11-05): it spends its OWN stock on the next level of the next building in
 * this order (a seeded shuffle of it in the expanding layout), skipping maxed ones and ones it can never pay for. It ignores the
 * building prerequisites (it has no Barracks and never trains).
 */
export const NPC_GROWTH_ORDER: readonly BuildingId[] = ['lumber', 'farm', 'mine', 'storehouse', 'lumber', 'farm', 'mine', 'hall', 'storehouse', 'wall', 'vault'];
/** Safety bound: builds an abandoned village can start in one settle (a village is maxed after far fewer). */
export const NPC_MAX_BUILDS_PER_SETTLE = 1000;

/** Villages may not be closer than this (Chebyshev distance) to another village. */
export const NPC_MIN_SPACING = 2;
export const SPAWN_MIN_SPACING = 3;

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  hall: {
    id: 'hall',
    name: 'Town Hall',
    description: 'Heart of the village. Each level makes construction faster and unlocks new buildings.',
    maxLevel: 25,
    startLevel: 1,
    requires: {},
    baseCost: res(135, 120, 105),
    costGrowth: 1.23,
    baseTimeSec: 600,
    timeGrowth: 1.285,
  },
  lumber: {
    id: 'lumber',
    name: 'Lumber Camp',
    description: 'Woodcutters bring in wood every hour.',
    maxLevel: 25,
    startLevel: 1,
    requires: {},
    baseCost: res(75, 60, 45),
    costGrowth: 1.207,
    baseTimeSec: 360,
    timeGrowth: 1.262,
  },
  farm: {
    id: 'farm',
    name: 'Farm',
    description: 'Grows the food that troops and buildings are paid with. It takes population room like any other building: the Longhouse sets how much room there is.',
    maxLevel: 25,
    startLevel: 1,
    requires: {},
    baseCost: res(90, 45, 45),
    costGrowth: 1.207,
    baseTimeSec: 360,
    timeGrowth: 1.262,
  },
  longhouse: {
    id: 'longhouse',
    name: 'Longhouse',
    description: 'The great hall where the clan lives. Sets how many people the village can hold, so a bigger Longhouse means room for a bigger army. It takes no room itself.',
    maxLevel: 25,
    startLevel: 1,
    requires: {},
    baseCost: res(90, 45, 45),
    costGrowth: 1.207,
    baseTimeSec: 360,
    timeGrowth: 1.262,
  },
  mine: {
    id: 'mine',
    name: 'Iron Mine',
    description: 'Miners dig iron for weapons and stronger buildings.',
    maxLevel: 25,
    startLevel: 1,
    requires: {},
    baseCost: res(100, 70, 30),
    costGrowth: 1.207,
    baseTimeSec: 420,
    timeGrowth: 1.262,
  },
  goldmine: {
    id: 'goldmine',
    name: 'Gold Mine',
    description: 'Slowly produces gold, used for elite troops (Ember Guards), siege, research, upgrades, the Banner Hall and the War Chest that pays for Chieftains.',
    maxLevel: 18,
    startLevel: 0,
    requires: { hall: 3 },
    baseCost: res(225, 180, 270),
    costGrowth: 1.22,
    baseTimeSec: 1500,
    timeGrowth: 1.275,
  },
  market: {
    id: 'market',
    name: 'Market',
    description: 'Traders carry resources to your other villages and to friends. Higher levels carry more per shipment.',
    maxLevel: 12,
    startLevel: 0,
    requires: { hall: 3 },
    baseCost: res(150, 105, 90),
    costGrowth: 1.205,
    baseTimeSec: 1200,
    timeGrowth: 1.26,
  },
  storehouse: {
    id: 'storehouse',
    name: 'Storehouse',
    description: 'Raises how much of each resource the village can hold.',
    maxLevel: 25,
    startLevel: 1,
    requires: {},
    baseCost: res(105, 75, 60),
    costGrowth: 1.207,
    baseTimeSec: 480,
    timeGrowth: 1.262,
  },
  barracks: {
    id: 'barracks',
    name: 'Barracks',
    description: 'Trains troops on foot, up to the Ember Guard elite. Higher levels train faster and unlock new units.',
    maxLevel: 20,
    startLevel: 0,
    requires: { hall: 2 },
    baseCost: res(300, 225, 180),
    costGrowth: 1.23,
    baseTimeSec: 900,
    timeGrowth: 1.285,
  },
  stables: {
    id: 'stables',
    name: 'Stables',
    description: 'Keeps tame elks and trains the Elk Rider, a fast rider that carries a lot of loot.',
    maxLevel: 18,
    startLevel: 0,
    requires: { hall: 5, barracks: 3 },
    baseCost: res(390, 300, 450, 20),
    costGrowth: 1.22,
    baseTimeSec: 1800,
    timeGrowth: 1.275,
  },
  wrightyard: {
    id: 'wrightyard',
    name: 'Wrightyard',
    description: 'Wrights build and train the siege units: the Log Ram (breaks the Wall) and the Firecart (burns buildings, from level 4). Higher levels train faster. It has its own training queue.',
    maxLevel: 12,
    startLevel: 0,
    requires: { barracks: 5 },
    baseCost: res(390, 300, 450),
    costGrowth: 1.22,
    baseTimeSec: 1800,
    timeGrowth: 1.275,
  },
  drillyard: {
    id: 'drillyard',
    name: 'Drillyard',
    description: 'Veterans research stronger troops and drill them. Each level gives Training Points; a village cannot max everything.',
    maxLevel: 10,
    startLevel: 0,
    requires: { barracks: 3, hall: 5 },
    baseCost: res(360, 270, 390, 15),
    costGrowth: 1.245,
    baseTimeSec: 1500,
    timeGrowth: 1.3,
  },
  bannerhall: {
    id: 'bannerhall',
    name: 'Banner Hall',
    description: 'Feast turns resources into Renown; trains Chieftains who take abandoned villages and found new ones.',
    maxLevel: 4,
    startLevel: 0,
    requires: { hall: 7, drillyard: 2, market: 2, storehouse: 6 },
    // Tuned with the sim (2026-11-04): the first design numbers (Hall 10, Drillyard 3, Market 3, Storehouse 8, 8000 each) put
    // the raider's Banner Hall after day 28. 2500 per resource fits the Storehouse level 6 that is required (cap 2930).
    baseCost: res(2100, 3450, 2100, 100),
    costGrowth: 1.35,
    baseTimeSec: 72000,
    timeGrowth: 1.32,
  },
  wall: {
    id: 'wall',
    name: 'Wall',
    description: 'Makes defenders stronger and adds village militia.',
    maxLevel: 22,
    startLevel: 0,
    requires: { barracks: 1 },
    baseCost: res(150, 60, 90),
    costGrowth: 1.21,
    baseTimeSec: 720,
    timeGrowth: 1.265,
  },
  vault: {
    id: 'vault',
    name: 'Vault',
    description: 'Hides some of each resource so raiders cannot take it.',
    maxLevel: 12,
    startLevel: 0,
    requires: { hall: 2 },
    baseCost: res(60, 75, 45),
    costGrowth: 1.225,
    baseTimeSec: 540,
    timeGrowth: 1.28,
  },
};

export const UNITS: Record<UnitId, UnitDef> = {
  pikeman: {
    id: 'pikeman',
    name: 'Pikeman',
    description: 'Cheap defender with long pikes. Very good against riders.',
    unitClass: 'infantry',
    attack: 8,
    defenseInfantry: 14,
    defenseCavalry: 40,
    speed: 6,
    carry: 12,
    cost: res(19, 23, 14), // 35 / 45 / 25 x 0.55 (food x 0.5), the branch troop cost cut
    trainTimeSec: 260,
    building: 'barracks',
    requires: { barracks: 1 },
  },
  guard: {
    id: 'guard',
    name: 'Shieldbearer',
    description: 'Heavy shield wall. Very good against infantry.',
    unitClass: 'infantry',
    attack: 12,
    defenseInfantry: 42,
    defenseCavalry: 22,
    speed: 5,
    carry: 10,
    cost: res(17, 30, 28), // 30 / 60 / 50 x 0.55 (food x 0.5)
    trainTimeSec: 320,
    building: 'barracks',
    requires: { barracks: 3 },
    research: { drillyard: 1, cost: res(150, 120, 200), timeSec: 3600 },
  },
  raider: {
    id: 'raider',
    name: 'Raider',
    description: 'Fierce attacker on foot. Weak in defense.',
    unitClass: 'infantry',
    attack: 36,
    defenseInfantry: 8,
    defenseCavalry: 6,
    speed: 6,
    carry: 28,
    cost: res(25, 35, 25), // 45 / 70 / 45 x 0.55 (food x 0.5)
    trainTimeSec: 290,
    building: 'barracks',
    requires: { barracks: 2 },
  },
  outrider: {
    id: 'outrider',
    name: 'Elk Rider',
    description: 'Fast rider on a tame elk. Carries the most loot.',
    unitClass: 'cavalry',
    attack: 65,
    defenseInfantry: 18,
    defenseCavalry: 16,
    speed: 13,
    carry: 75,
    cost: res(39, 80, 66), // 70 / 160 / 120 x 0.55 (food x 0.5)
    trainTimeSec: 620,
    building: 'stables',
    requires: { stables: 1 },
    research: { drillyard: 3, cost: res(300, 220, 350, 20), timeSec: 7200 },
  },
  hearthwarden: {
    id: 'hearthwarden',
    name: 'Hearthwarden',
    description: "A heavy rider who rides to stand before a friend's fire. Strong in defence against foot and riders, weak in attack, carries little: send it as support.",
    unitClass: 'cavalry',
    attack: 18,
    defenseInfantry: 48,
    defenseCavalry: 52,
    speed: 11, // between foot (5-6) and the Elk Rider (13): support that arrives in time
    carry: 20,
    cost: res(60, 90, 110),
    trainTimeSec: 700,
    building: 'stables',
    requires: { stables: 4 },
    research: { drillyard: 4, cost: res(320, 240, 380, 20), timeSec: 7800 },
  },
  knight: {
    id: 'knight',
    name: 'Ember Guard',
    description: 'Elite warrior on foot who carries a live ember, strong in attack and defense. Costs gold.',
    unitClass: 'infantry',
    attack: 140, // 70 / 60 / 60 -> 140 / 90 / 90 (BALANCE 14): the best attack per population (46.7 vs the Raider's 36), the dearest per coin
    defenseInfantry: 90,
    defenseCavalry: 90,
    speed: 5,
    carry: 20,
    cost: res(50, 90, 110, 14), // 90 / 180 / 200 / 25 x 0.55 (food x 0.5)
    trainTimeSec: 1100,
    building: 'barracks',
    requires: { barracks: 8, hall: 8 },
    research: { drillyard: 6, cost: res(600, 450, 700, 80), timeSec: 14400 },
  },
  pathfinder: {
    id: 'pathfinder',
    name: 'Pathfinder',
    description: 'Quick, quiet scout. In an attack it scouts the village first and reports what it holds. Catches enemy scouts at home.',
    unitClass: 'infantry',
    attack: 0,
    defenseInfantry: 3,
    defenseCavalry: 2,
    speed: 18,
    carry: 0,
    cost: res(11, 20, 14), // 20 / 40 / 25 x 0.55 (food x 0.5)
    trainTimeSec: 170,
    building: 'barracks',
    requires: { barracks: 2 },
  },
  chieftain: {
    id: 'chieftain',
    name: 'Chieftain',
    description: 'Carries a village\'s ember. Puts out the hearth of an abandoned village, or founds a new village on free land. Weak fighter: needs an escort.',
    unitClass: 'infantry',
    attack: 0,
    defenseInfantry: 10,
    defenseCavalry: 10,
    speed: 5,
    carry: 0,
    cost: res(6000, 4500, 7500), // x1.5 with the economy (2026-11-11); no gold: his gold price is paid from the War Chest (WAR_CHEST_BASE)
    trainTimeSec: 6 * 3600,
    building: 'bannerhall',
    requires: { bannerhall: 1 },
  },
  // Siege units (docs/GAME_DESIGN.md 18.9), trained at the Wrightyard and researched at the Drillyard first. Slow, weak fighters.
  // The Log Ram only breaks the Wall (during the battle and again after a win); the Firecart only burns other buildings after a win.
  logram: {
    id: 'logram',
    name: 'Log Ram',
    description: 'A heavy ram on wheels. It breaks only the Wall: in the battle it batters the Wall down, and after a won attack the surviving rams batter it again. Slow, and a poor fighter.',
    unitClass: 'infantry',
    attack: 3,
    defenseInfantry: 5,
    defenseCavalry: 4,
    speed: 3,
    carry: 0,
    cost: res(70, 50, 90),
    trainTimeSec: 1100,
    building: 'wrightyard',
    requires: { wrightyard: 1 },
    research: { drillyard: 2, cost: res(260, 200, 340), timeSec: 7200 },
    siege: { power: 6, maxLevels: 3, hits: 'wall' }, // about 3x the Firecart's old Wall power per unit, and cheaper (owner 2026-11-18)
  },
  firecart: {
    id: 'firecart',
    name: 'Firecart',
    description: 'A cart of burning pitch. After a won attack the surviving carts burn the building you pick when sending (a random building other than the Wall if you pick none). They never touch the Wall: that is the Log Ram\'s job. Slow, and a poor fighter.',
    unitClass: 'infantry',
    attack: 5,
    defenseInfantry: 7,
    defenseCavalry: 5,
    speed: 3,
    carry: 0,
    cost: res(99, 88, 121, 6), // 180 / 160 / 220 / 10 x 0.55, like the other troops on this branch
    trainTimeSec: 1400,
    building: 'wrightyard',
    requires: { wrightyard: 4 },
    research: { drillyard: 3, cost: res(400, 300, 500, 10), timeSec: 10800 },
    siege: { power: 4, maxLevels: 2, hits: 'buildings' }, // power 1 -> 2 (BALANCE 14) -> 4 (BALANCE 18, with 7 points per level)
  },
};

// ---- Siege (docs/GAME_DESIGN.md 18.9). Building levels only ever drop through siege. ----

/**
 * Siege units have `count * power` siege points; lowering a building from level L to L-1 costs SIEGE_BASE_POINTS + SIEGE_POINTS_PER_LEVEL * L
 * points, so high levels are harder to knock down. Each step lowers at most `maxLevels` levels (UnitDef.siege). Two kinds (owner 2026-11-18):
 * Log Rams (`hits: 'wall'`) lower only the Wall: step 1, DURING the battle, all Log Rams that were sent fire at the Wall with SIEGE_DURING_SHARE of
 * their points (the lowered Wall counts in that battle); step 2, after it, the survivors spend their full points on the Wall again.
 * Firecarts (`hits: 'buildings'`) have only step 2: the survivors spend their full points on the building the sender picked (a random building
 * other than the Wall if none). On a LOST attack floor(count * (A/D)^BATTLE_LOSS_EXPONENT * SIEGE_LOST_SHARE) of each kind count as survivors for step 2.
 */
export const SIEGE_BASE_POINTS = 6;
export const SIEGE_POINTS_PER_LEVEL = 7;
export const SIEGE_DURING_SHARE = 0.5;
export const SIEGE_LOST_SHARE = 0.5;
/** Some buildings are sturdier: extra siege points added to the cost of lowering one level of that building (cost = base + per level x L + extra). Absent = 0. The Banner Hall is paid in gold, so it costs far more to rebuild than its level suggests (BALANCE 18). */
export const SIEGE_EXTRA_POINTS: Partial<Record<BuildingId, number>> = { bannerhall: 40 };

// ---- Notifications (docs/GAME_DESIGN.md 18.10) ----
export const NOTIFICATIONS_KEEP = 100; // per player
export const NOTIFICATION_MAX_AGE_DAYS = 7; // real days, not scaled by world speed
export const NOTIFICATION_READ_MAX_IDS = 200; // ids per POST /api/notifications/read
/** Lowest level siege can bring a building to (default 0 = flattened). The Town Hall, Farm, Longhouse and Storehouse never drop below 1 (owner 2026-11-05). */
export const SIEGE_MIN_LEVEL: Partial<Record<BuildingId, number>> = { hall: 1, farm: 1, longhouse: 1, storehouse: 1 };

// ---- Renown (docs/GAME_DESIGN.md section 18.2, "Owning several villages"). Starting values; the sim step tunes the pace. ----

/** What one unit of each resource is worth when valuing loot and troops for Renown (same convention as scripts/sim: gold = 10). */
export const RENOWN_VALUE_WEIGHT: Resources = { wood: 1, food: 1, iron: 1, gold: 10 };
/** Building Renown for finishing level L: round(RENOWN_BUILD_SCALE * L ^ RENOWN_BUILD_EXP), once per village and level. */
export const RENOWN_BUILD_SCALE = 0.25;
export const RENOWN_BUILD_EXP = 1.25;
/**
 * Renown per point of loot value taken in a raid. Retuned 2026-11-05 from 1/16 to 1/4000: with full loot and no garrison refill the
 * same abandoned village pays its whole stock to every raid, so the loot value taken per month is ~35x what it was (BALANCE 9).
 */
export const RENOWN_PER_LOOT_VALUE = 1 / 4000;
/** Renown per point of enemy troop value destroyed (attacking and defending). */
export const RENOWN_PER_KILL_VALUE = 1 / 16;
/** A battle worth less than this (loot + kills, in value) earns nothing and does not count in the pair window. */
export const RENOWN_MIN_BATTLE_VALUE = 300;
/**
 * Daily cap of combat Renown per (earner, opponent) pair. The pair window counts raw Renown R (loot value * RENOWN_PER_LOOT_VALUE
 * + kill value * RENOWN_PER_KILL_VALUE) and pays F(R) = CAP * (1 - exp(-R / CAP)): slope 1 for small R, never more than CAP.
 */
export const RENOWN_PAIR_CAP = 60;
/** Length of the pair window in hours (divided by world speed); it starts at the first paying battle. */
export const RENOWN_PAIR_WINDOW_HOURS = 24;
/** Hitting a smaller player: factor = clamp((opponentPoints / ownPoints / RENOWN_SMALL_RATIO)^2, RENOWN_SMALL_FLOOR, 1). */
export const RENOWN_SMALL_RATIO = 0.5;
export const RENOWN_SMALL_FLOOR = 0.05;
/** Renown price of the 2nd village; each further village costs RENOWN_VILLAGE_GROWTH times more. */
export const RENOWN_VILLAGE_BASE = 1300; // was 1,000 before the 2026-11-11 economy (x1.5 production, cheaper troops)
export const RENOWN_VILLAGE_GROWTH = 1.6;
/** War Chest gold the 2nd village's Chieftain reserves (BALANCE 12.3); each further one costs RENOWN_VILLAGE_GROWTH times more. */
export const WAR_CHEST_BASE = 2000;
/** Share of a Chieftain's reserved Renown that comes back when he dies on the way (step 2). */
export const CHIEFTAIN_RENOWN_REFUND_SHARE = 0.5;
/** Chieftains per village in the Banner Hall queue: one batch of at most this many (each living or queued one is a future village). */
export const CHIEFTAIN_MAX_QUEUED_BATCHES = 1;
export const CHIEFTAIN_MAX_BATCH = 3;
/** Most villages one player may own (sanity cap for performance; the Renown price makes it unreachable). */
export const MAX_VILLAGES_PER_PLAYER = 20;

// ---- Hearth: Strike and Hold, founding, restart (docs/GAME_DESIGN.md 18.2). Times in hours at speed 1, divided by world speed. ----

/** Hold clock after a Strike: players' villages / abandoned villages. */
export const HOLD_HOURS = 8;
export const HOLD_HOURS_ABANDONED = 2;
/** Occupier population that keeps the hold clock running. */
export const HOLD_MIN_POPULATION = 150;
/** Occupiers may stay under HOLD_MIN_POPULATION this long before the claim fails. */
export const HOLD_FAIL_HOURS = 2;
/** No new Strike on a village for this long after it changed owner (raids stay possible). */
export const STRIKE_LOCK_HOURS = 24;
/** Chieftains needed to Strike a player village: 1 + floor(points / this), at most HEARTH_MAX_CHIEFTAINS (abandoned: always 1). */
// was 4000: with 25 levels villages are about 3x bigger (2026-11-11), so 4000 asked for the maximum 3 Chieftains almost everywhere (BALANCE 13.3)
export const HEARTH_POINTS_PER_CHIEFTAIN = 12000;
export const HEARTH_MAX_CHIEFTAINS = 3;
/** Striking player villages (switched on in step 4, 2026-11-05). */
export const HEARTH_PLAYERS_ENABLED = true;
/**
 * Chieftain chain (2026-11-05): Chieftains that survive a won attack but are too few for the village add up with earlier ones of
 * the same attacker on the same village that arrived at most this long ago and are still on their way home (divided by world speed).
 */
export const STRIKE_CHAIN_WINDOW_HOURS = 2;
/** Share of each resource a village keeps when it changes owner. */
export const TAKE_KEEP_RESOURCE_SHARE = 0.5;
/** A founded village starts with this stock (levels are the new-player start levels) and is safe from attacks for this long. */
export const FOUND_START_RESOURCES: Resources = res(300, 300, 150, 0);
export const FOUND_PROTECTION_HOURS = 24;
/** A player who lost their last village restarts at the world edge with this much protection. */
export const RESTART_PROTECTION_HOURS = 48;
/** The restart spot lies within this many tiles inside the edge of the populated disc. */
export const RESTART_EDGE_BAND = 2;
/** One Feast (Banner Hall level 1+) costs this at Banner Hall level 1 (full price) and gives FEAST_RENOWN. */
export const FEAST_COST: Resources = res(810, 2025, 810, 0); // was 600/1500/600 while a daily limit capped Feasts; x1.35 without it (BALANCE 17, 2026-11-18)
export const FEAST_RENOWN = 10;
/**
 * No daily Feast limit any more (owner, 2026-11-18: the price is the brake). Every Banner Hall level after the first makes a
 * Feast this much cheaper: price factor = 1 - FEAST_LEVEL_DISCOUNT * (level - 1), so levels 1-4 pay 100 / 90 / 80 / 70%.
 */
export const FEAST_LEVEL_DISCOUNT = 0.1;
/** Most Feasts one request may hold (sanity bound, not a game limit). */
export const FEAST_MAX_COUNT = 1000;
/**
 * Defender Renown (GAME_DESIGN 18.2 source 4): a small daily trickle for keeping a real defence at home. Strength is the
 * defence of the village's own troops at home (support and troops away do not count). Renown per 24 h (divided by world
 * speed) = min(DEFENDER_RENOWN_DAILY_CAP, strength x DEFENDER_RENOWN_PER_DEFENCE), nothing during beginner protection.
 */
export const DEFENDER_RENOWN_PER_DEFENCE = 0.006;
export const DEFENDER_RENOWN_DAILY_CAP = 36;

// ---- Drillyard: research and ranks (docs/GAME_DESIGN.md sections 4 and 15) -----------------------------

/** Training Points a village gets per Drillyard level. */
export const DRILLYARD_POINTS_PER_LEVEL = 3;
/** Highest rank per track. */
export const RANK_MAX = 5;
/** Might: +attack, Bulwark: +both defences, per rank (max RANK_MAX * 5% = +25%). */
export const RANK_BONUS = 0.05;
/** Units that can be ranked (the Chieftain has no attack and the siege units are tools: ranks would do nothing, 2026-11-18). */
export const RANKABLE_UNITS: readonly UnitId[] = ['pikeman', 'guard', 'raider', 'outrider', 'hearthwarden', 'knight', 'pathfinder'];
/** Keen (pathfinder only): +scout strength per rank. */
export const KEEN_BONUS = 0.1;
/** Resources paid for buying rank r (index r - 1) of one track. Points cost r. */
export const RANK_COST: readonly Resources[] = [
  res(60, 40, 60),
  res(120, 80, 120),
  res(220, 150, 220, 5),
  res(380, 260, 380, 15),
  res(650, 450, 650, 40),
];

// ---- Additions used by the engine logic (kept here so tuning never touches logic files) ----------

/** Which building produces which resource. Level 0 produces PRODUCTION_LEVEL0 (gold: nothing). */
export const RESOURCE_PRODUCER: Record<ResourceId, 'lumber' | 'farm' | 'mine' | 'goldmine'> = {
  wood: 'lumber',
  food: 'farm',
  iron: 'mine',
  gold: 'goldmine',
};

/** Largest count of one unit type accepted in a send order (input sanity bound). */
export const MAX_UNIT_COUNT = 1_000_000;

/** Most marches (outbound and returning together) one player may have on the road at once. Refuses new sends only; recalls and returns are never refused. */
export const MAX_MARCHES_IN_FLIGHT = 200;

/** Site upkeep (troops of leavers go home, empty sites turn neutral) runs at least this often in game-clock ms even when nothing it watches changed. */
export const SITE_UPKEEP_INTERVAL_MS = 5000;

/** Saved troop groups (a convenience for the send form): at most this many per player, names up to this long. */
export const TROOP_GROUP_MAX = 12;
export const TROOP_GROUP_NAME_MAX = 24;

/** Abandoned-village start level of building b at tier T: perTier * T + offset (min 0, max NPC_MAX_LEVEL). */
export const NPC_START_LEVELS: Partial<Record<BuildingId, { perTier: number; offset: number }>> = {
  hall: { perTier: 1, offset: 0 },
  lumber: { perTier: 2, offset: 0 },
  farm: { perTier: 2, offset: 0 },
  longhouse: { perTier: 2, offset: 0 }, // = the Farm level
  mine: { perTier: 2, offset: 0 },
  storehouse: { perTier: 2, offset: 0 },
  wall: { perTier: 1, offset: -1 },
  vault: { perTier: 1, offset: -1 },
  goldmine: { perTier: 1, offset: -1 },
};
/** Abandoned villages start with this share of their storage cap in wood, food and iron. */
/**
 * An abandoned village only builds when the build leaves at least this share of its storage cap of each resource it spends (a reserve it keeps
 * for hard times). Gives raiders something to find even in a village that builds all the time, and means a village raided empty first
 * has to refill the reserve before it builds again.
 */
export const NPC_BUILD_KEEP_SHARE = 0.25;
export const NPC_START_RESOURCE_SHARE = 0.8;
/** ...and with this much gold per tier (gold is rare; their Gold Mine adds more over time). */
export const NPC_START_GOLD_PER_TIER = 40;
/** Random placement tries per abandoned village before giving up (only matters for very dense worlds). */
export const NPC_PLACEMENT_ATTEMPTS_PER_VILLAGE = 100;
/** Random spawn tries before scanning outward. */
export const SPAWN_RANDOM_TRIES = 2000;

/**
 * 'expanding' world layout. Players land in a disc around the centre that grows with the player count
 * (EXPAND_TILES_PER_PLAYER tiles of disc per player village, plus EXPAND_CORE_RADIUS). Every newcomer brings
 * NPC_RING_BASE abandoned villages at evenly spaced angles around them (NPC_RING_MIN..MAX_RADIUS tiles away),
 * and each extra roll (chance NPC_RING_EXTRA_CHANCE, at most NPC_RING_EXTRA_MAX) adds one more nearby.
 */
export const EXPAND_CORE_RADIUS = 8;
export const EXPAND_TILES_PER_PLAYER = 150;
export const NPC_RING_BASE = 3; // LEGACY number: worlds created before 2026-11-06 (WorldConfig npc.perNewcomer; see NPC_PER_NEWCOMER)
export const NPC_RING_MIN_RADIUS = 3.5;
export const NPC_RING_MAX_RADIUS = 7;
export const NPC_RING_EXTRA_CHANCE = 0.4; // LEGACY (npc.extraChance; see NPC_EXTRA_CHANCE)
export const NPC_RING_EXTRA_MAX = 3;
/**
 * Owner 2026-11-06: fewer abandoned villages, about 2 per new player (BALANCE 11). These are the defaults of a NEW world (WorldConfig
 * npc.perNewcomer / extraChance / startRingScale); worlds that already exist keep the legacy numbers above and EXPAND_START_RINGS x 1.
 */
export const NPC_PER_NEWCOMER = 2;
export const NPC_EXTRA_CHANCE = 0;
/** Share of the start-ring counts a new world gets (8 and 14 become 5 and 8). */
export const NPC_START_RING_SCALE = 0.6;
/** Terrain amount of a world (WorldConfig terrain.amount): 0 = flat grass only, 1 = the map the generator always made, 1.5 = wilder. */
export const TERRAIN_AMOUNT_DEFAULT = 1;
/**
 * Fair start (owner 2026-11-06; WorldConfig start.*): a new player's spot, and a restart spot, needs enough open ground around it.
 * Within `radius` tiles (Chebyshev square) at least `minOpenShare` of the tiles are buildable (not mountain or lake) and at most
 * `maxSlowShare` are slow (forest, hills, mountain, lake). After `tries` candidate spots without a pass, the best one found is taken.
 */
export const FAIR_START = { radius: 4, minOpenShare: 0.7, maxSlowShare: 0.4, tries: 40 } as const;
/** Abandoned villages around the empty centre at world creation: [count, minRadius, maxRadius] per ring. */
export const EXPAND_START_RINGS: ReadonlyArray<readonly [number, number, number]> = [
  [8, 4, 11],
  [14, 12, 24],
];

/** Seed salts so terrain noise fields and placement streams are independent. */
export const SEED_SALT = { elevation: 11, wetness: 23, npcPlacement: 37 } as const;

/**
 * Terrain: two smooth value-noise fields (elevation, wetness), each made of a coarse octave and a finer
 * one. Elevation >= mountain -> mountain; >= hills -> hills; else wetness >= lake -> lake;
 * >= forest -> forest; else grass. Scales are in tiles.
 */
export const TERRAIN = {
  elevationScale: 18,
  wetnessScale: 12,
  /** Second octave: scale divisor and weight relative to the first octave (weight 1). */
  detailScaleDivisor: 2.6,
  detailWeight: 0.45,
  mountain: 0.8,
  hills: 0.7,
  lake: 0.78,
  forest: 0.64,
};

/**
 * Terrain and travel (docs/GAME_DESIGN.md 18.4a). A trip is the sum of the time spent on each tile along the straight
 * line (sampled every TERRAIN_SAMPLE_STEP tiles); on a tile a walker moves at speed x the factor below. Grass is 1, so a
 * trip over grass takes exactly what it always took. Our own numbers, tuned so an average trip is about 12% slower.
 */
export type TerrainFamily = 'foot' | 'mounted' | 'pathfinder' | 'carrier';
export const TERRAIN_SPEED: Record<TerrainFamily, Record<Terrain, number>> = {
  foot: { grass: 1, forest: 0.85, hills: 0.8, mountain: 0.55, lake: 0.45 },
  mounted: { grass: 1, forest: 0.7, hills: 0.6, mountain: 0.4, lake: 0.35 },
  pathfinder: { grass: 1, forest: 0.95, hills: 0.9, mountain: 0.75, lake: 0.7 },
  carrier: { grass: 1, forest: 0.8, hills: 0.65, mountain: 0.4, lake: 0.3 },
};
/** Which row of TERRAIN_SPEED each unit walks by. Ranks never change it (owner rule). */
export const UNIT_TERRAIN_FAMILY: Record<UnitId, TerrainFamily> = {
  pikeman: 'foot',
  guard: 'foot',
  raider: 'foot',
  outrider: 'mounted',
  hearthwarden: 'mounted',
  knight: 'foot',
  pathfinder: 'pathfinder',
  chieftain: 'foot',
  logram: 'carrier',
  firecart: 'carrier',
};
/** Length of one sample along the route, in tiles. */
export const TERRAIN_SAMPLE_STEP = 1;
/** A trip never takes longer than this many times its flat-ground time, so one lake cannot cut two villages off. */
export const TERRAIN_MAX_SLOWDOWN = 2.2;

// ---- Resource shipments (GAME_DESIGN section 13) ----

/** Most one shipment can carry (all four resources together): base + per Market level of the sending village. */
export const SHIPMENT_BASE_CAPACITY = 300;
export const SHIPMENT_CAPACITY_PER_MARKET_LEVEL = 200;
/** Market level the sending village needs to send a shipment. */
export const SHIPMENT_MIN_MARKET_LEVEL = 1;

// ---- Sandbox / test mode (allow-listed accounts only; see SECURITY_ROADMAP.md) ----
/** Troops of every type a village gets from "Max out" (at least this many at home). */
export const SANDBOX_ARMY_PER_UNIT = 500;
/** Test mode "Max": population room kept free for this many Chieftains (so conquest can be tested). */
export const SANDBOX_CHIEFTAIN_ROOM = 3;
/** Carriers walk at this many tiles per hour (speed 1; scaled by world speed like units). */
export const SHIPMENT_SPEED = 8;
/** Shipments a single village may have on the road at once. */
export const SHIPMENT_MAX_IN_TRANSIT = 5;

/** Window after departure in which the sender may cancel an attack, scout, support or shipment (not scaled by world speed). */
export const CANCEL_WINDOW_MS = 2 * 60 * 1000;

// ---- Tribes ----

/** Town Hall level needed to found a tribe (joining has no requirement). */
export const TRIBE_FOUND_HALL_LEVEL = 3;
export const TRIBE_MAX_MEMBERS = 30;
/** Active + pending alliances per tribe. Non-aggression pacts and enemies are unlimited... */
export const TRIBE_MAX_ALLIES = 3;
/** ...except NAPs, capped here (active + pending). */
export const TRIBE_MAX_NAPS = 10;
/** Cancelling an alliance or NAP takes effect after this notice (divided by world speed): no surprise backstabs. */
export const PACT_NOTICE_HOURS = 24;
/** Invitations a tribe may have open at once; each expires after TRIBE_INVITE_TTL_HOURS (real hours, not world speed). */
export const TRIBE_MAX_OPEN_INVITES = 20;
export const TRIBE_INVITE_TTL_HOURS = 7 * 24;
/** Open applications a player may have at once. */
export const PLAYER_MAX_APPLICATIONS = 3;

export const TRIBE_NAME_MIN = 3;
export const TRIBE_NAME_MAX = 30;
/** Letters (any language), digits, spaces, and - ' . — no leading/trailing/double spaces. */
export const TRIBE_NAME_PATTERN = "^[\\p{L}\\p{N}](?:[\\p{L}\\p{N}'.-]| (?! ))*[\\p{L}\\p{N}.]$";
export const TRIBE_TAG_MIN = 2;
export const TRIBE_TAG_MAX = 6;
/** Tags are stored upper-case: A-Z and 0-9 only. */
export const TRIBE_TAG_PATTERN = '^[A-Z0-9]{2,6}$';
export const TRIBE_DESCRIPTION_MAX = 1000;
export const TRIBE_APPLICATION_MESSAGE_MAX = 300;
export const TRIBE_CHAT_MESSAGE_MAX = 500;
/** Chat history kept per tribe (older messages are deleted). */
export const TRIBE_CHAT_KEEP = 500;
/** Tribe event log entries kept per tribe. */
export const TRIBE_EVENTS_KEEP = 200;

// ---- Mail (player-to-player messages; docs/GAME_DESIGN.md section "Mail") ----------------------------------
/** Subject length in characters (may be empty). */
export const MAIL_SUBJECT_MAX = 60;
/** Body length in characters (1 or more). */
export const MAIL_BODY_MAX = 2000;
/** Mails kept per recipient. When full, the oldest READ mail is dropped; if none is read the new mail is refused. */
export const MAIL_INBOX_KEEP = 200;
/** Spam guard per sender: at most this many mails per minute, this long between two, and this many per hour. */
export const MAIL_PER_MINUTE = 6;
export const MAIL_MIN_GAP_MS = 2000;
export const MAIL_PER_HOUR = 60;
/** Mails per list page and characters of body shown in the list preview. */
export const MAIL_PAGE_SIZE = 30;
export const MAIL_PREVIEW_CHARS = 120;
/** Conversations per page, and letters per thread page (default and cap). */
export const MAIL_CONV_PAGE_SIZE = 20;
export const MAIL_THREAD_DEFAULT = 30;
export const MAIL_THREAD_MAX = 50;

// ---- Support and moderation (tickets, reports, mutes, templates) ---------------------------------------------
export const TICKET_SUBJECT_MAX = 120;
/** Ticket message and rendered template length in characters. */
export const TICKET_BODY_MAX = 4000;
/** Tickets a player may have open (open or waiting for them) at once; staff notices do not count. */
export const TICKETS_OPEN_MAX = 5;
export const TICKETS_PER_DAY = 10;
/** Ticket reply spam guard per player: gap between two, per minute and per hour. */
export const TICKET_MSG_MIN_GAP_MS = 2000;
export const TICKET_MSG_PER_MINUTE = 4;
export const TICKET_MSG_PER_HOUR = 30;
/** Rows per page in the player ticket list and the staff lists. */
export const TICKET_LIST_MAX = 50;
export const STAFF_PAGE_SIZE = 30;
export const AUDIT_PAGE_MAX = 100;
export const AUDIT_DETAIL_MAX = 500;

/** Player reports of messages: note and evidence copy lengths, and how many one player may file. */
export const REPORT_NOTE_MAX = 500;
export const REPORT_SNAPSHOT_MAX = 4000;
export const REPORTS_PER_HOUR = 5;
export const REPORTS_PER_DAY = 20;
export const REPORT_RESOLUTION_MAX = 500;

/** Mutes: longest allowed (minutes) and the reason length every moderation action needs. */
export const MUTE_MAX_MINUTES = 30 * 24 * 60;
export const MOD_REASON_MAX = 300;
export const PLAYER_SEARCH_MAX = 20;

// ---- Multi-account tooling for staff (docs/SECURITY_ROADMAP.md "Multi-account tooling"). Staff SEE and JUDGE; nothing here bans anyone.
/** IPs, device hashes, activity slots and pair events are kept this long, then deleted (privacy: personal data). */
export const MULTI_RETENTION_MS = 30 * 24 * 3_600_000;
/** An IP or device seen on more accounts than this (a mobile gateway, a school, a cafe) links nobody: it would join strangers into one group. */
export const MULTI_LINK_MAX_ACCOUNTS = 12;
/** Activity is remembered in slots this long (one row per account and slot). */
export const MULTI_ACTIVITY_SLOT_MS = 10 * 60_000;
/** Feeding: one account attacks the other (no defence) at least this often, carries off at least this much, and at least this share of all loot between the two goes one way. */
export const MULTI_FEED_MIN_ATTACKS = 3;
export const MULTI_FEED_MIN_LOOT = 1000;
export const MULTI_FEED_SHARE = 0.8;
/** "No defence": at most this many defending troops stood in the village when the attack arrived. */
export const MULTI_FEED_MAX_DEFENDERS = 2;
/** One-way flow: A shipped to B at least this many times, on this many different days, at least this much in total, B got at least this share of everything A shipped, and B sent back at most MULTI_FLOW_RETURN_MAX of it. */
export const MULTI_FLOW_MIN_SHIPMENTS = 3;
export const MULTI_FLOW_MIN_DAYS = 3;
export const MULTI_FLOW_MIN_RESOURCES = 1000;
export const MULTI_FLOW_SHARE = 0.7;
export const MULTI_FLOW_RETURN_MAX = 0.1;
/** Relay: A ships to C and C ships on to B within this time (A and B linked, C anyone). */
export const MULTI_RELAY_WINDOW_MS = 48 * 3_600_000;
/** Alternating play: both accounts were active in at least this many slots, shared at most this share of the smaller one's slots, and one followed the other within MULTI_ALT_GAP_SLOTS slots at least MULTI_ALT_MIN_HANDOFFS times. */
export const MULTI_ALT_MIN_SLOTS = 12;
export const MULTI_ALT_MAX_OVERLAP = 0.05;
export const MULTI_ALT_GAP_SLOTS = 2;
export const MULTI_ALT_MIN_HANDOFFS = 8;
/** Refused same-connection attempts (ship, support, attack, scout) between two accounts from which they count as a finding. */
export const MULTI_BLOCKED_MIN = 2;
/** Risk score (one point per finding, device-on-different-connections counts double) at which a group turns medium / high. */
export const MULTI_RISK_MEDIUM = 1;
export const MULTI_RISK_HIGH = 3;
/** Most groups one page lists. */
export const MULTI_GROUPS_MAX = 100;

export const TEMPLATE_TITLE_MAX = 80;
export const TEMPLATE_BODY_MAX = 3000;
export const TEMPLATE_KEY_PATTERN = '^[a-z0-9][a-z0-9_-]{1,39}$';

/** Who may do what. The leader can always do everything. */
export const TRIBE_PERMISSIONS: Record<TribeAction, readonly TribeRole[]> = {
  edit_settings: ['leader', 'officer'],
  invite: ['leader', 'officer'],
  handle_applications: ['leader', 'officer'],
  kick: ['leader', 'officer'],
  diplomacy: ['leader', 'officer'],
  set_roles: ['leader'],
  transfer_leadership: ['leader'],
  disband: ['leader'],
  chat: ['leader', 'officer', 'member'],
  // Forum: managing boards and moderating threads. Officers have both by default; the leader can grant either
  // (or any other right in TRIBE_GRANTABLE) to a single member (docs/GAME_DESIGN.md section 11).
  forum_manage: ['leader', 'officer'],
  forum_moderate: ['leader', 'officer'],
  // See each member's online status and last-online time (members' own tribe view only).
  view_activity: ['leader', 'officer'],
  // Tribe projects (GAME_DESIGN 18.5): store village, start/cancel projects. Leader only by role; the leader can grant it.
  projects: ['leader'],
};

/** Rights the leader may grant to an individual member (stored on the membership). Everything else stays role-bound. */
export const TRIBE_GRANTABLE = ['invite', 'handle_applications', 'kick', 'diplomacy', 'edit_settings', 'forum_manage', 'forum_moderate', 'view_activity', 'projects'] as const satisfies readonly TribeAction[];

// ---- Tribe projects (docs/GAME_DESIGN.md 18.5; owner approved the simple version 2026-11-07) ----
/** Most of EACH resource the Tribe Store holds. Cargo arriving above it turns back home with the carriers. */
export const TRIBE_STORE_CAP = 1_500_000;
/** Highest level of every project. */
export const TRIBE_PROJECT_MAX_LEVEL = 3;
/** Level L costs PROJECT_BASE_COST_PER_RESOURCE * PROJECT_COST_GROWTH^(L-1) of EACH resource (rounded); level 1 = 75,000 each. */
export const PROJECT_BASE_COST_PER_RESOURCE = 75_000;
export const PROJECT_COST_GROWTH = 1.8;
/** Build time of level L: L * this many hours, divided by the world speed. */
export const PROJECT_BUILD_HOURS_PER_LEVEL = 24;
/** A member may send at most this much (sum of the 4 resources) to the store per rolling 24 h, cargo on the road included. */
export const PROJECT_DAILY_CAP_PER_MEMBER = 60_000;
/** Accounts younger than this many days cannot send to the store (stops fresh alt accounts funding projects). */
export const PROJECT_MIN_ACCOUNT_DAYS = 3;
/** The store village can be changed once per this many days (always when the store has no home). */
export const STORE_VILLAGE_CHANGE_COOLDOWN_DAYS = 7;
/** A won attack on the store village may carry away at most this share of each store resource (owner 2026-11-07: "a fifth"). */
export const TRIBE_STORE_LOOT_SHARE = 0.2;
/** Roads: support and shipments between two villages of the same tribe's members are this much faster, by level (index = level - 1). */
export const ROADS_SPEED_BONUS = [0.1, 0.2, 0.3] as const;
/** Wards: defence bonus for the holding tribe's side at map sites it holds (not villages), by level. */
export const WARD_DEFENCE_BONUS = [0.04, 0.08, 0.12] as const;
/**
 * Watchtower alert bands, by the population of the incoming non-Chieftain units: below the first number = small, below the
 * second = medium, below the third = large, else huge. Level 2 adds the slowest unit type; level 3 the population rounded to WATCHTOWER_ROUND_TO.
 */
export const WATCHTOWER_SIZE_BANDS = [200, 1_000, 4_000] as const;
export const WATCHTOWER_ROUND_TO = 100;
/** Ledger rows returned by GET /api/tribe/projects (newest first). */
export const TRIBE_LEDGER_LIST_LIMIT = 50;

// ---- Tribe forum (docs/GAME_DESIGN.md section 11) ----
export const FORUM_BOARD_NAME_MAX = 40;
export const FORUM_THREAD_TITLE_MAX = 80;
export const FORUM_POST_MAX = 3000;
/** Boards per tribe. */
export const FORUM_BOARDS_MAX = 8;
/** Threads kept per board; when full the oldest unpinned thread is dropped. */
export const FORUM_THREADS_KEEP = 200;
/** Posts per thread (the first post included); a full thread refuses replies. */
export const FORUM_POSTS_PER_THREAD = 500;
/** The author may edit a post this long after writing it (moderators editing their own posts: always). */
export const FORUM_EDIT_WINDOW_MS = 15 * 60_000;
export const FORUM_PAGE_SIZE = 30;
/** Spam guard per member for new threads and replies together. */
export const FORUM_MIN_GAP_MS = 3000;
export const FORUM_PER_MINUTE = 6;
export const FORUM_PER_HOUR = 60;

// ---- Tribe warfare (section 12) ----

/** The scouting unit: in an attack it scouts first and sits out the battle. */
export const SCOUT_UNIT: UnitId = 'pathfinder';
/** Scouting succeeds when sent scouts > defending scouts * this. */
export const SCOUT_DEFENSE_FACTOR = 1;
/** Loss ratio exponent for scouting fights (as battles). */
export const SCOUT_LOSS_EXPONENT = 1.5;
/** Keen rank of the sending village needed for each layer of a successful scout's intel (docs/GAME_DESIGN.md section 15). Resources always show. */
export const SCOUT_INTEL_KEEN = { approxTroops: 1, exactTroops: 2, wall: 3, buildings: 4, ranks: 5 } as const;
/** Rough troop counts (Keen 1) are rounded to a multiple of this, and never shown as 0 when some are there. */
export const SCOUT_APPROX_STEP = 10;

// ---- Art-facing rules (docs/ART_DIRECTION.md) ----

/** Map picture stage by village points: stage n starts at MAP_STAGE_MIN_POINTS[n-1]. */
export const MAP_STAGE_MIN_POINTS = [0, 300, 1000, 3750, 6500, 11250] as const; // spread over the 25-level ladder (owner, 2026-11-17): 1,000 / 3,750 / 11,250 = ~25 / 50 / 75% built (full village ~31,265); was 0/100/300/800/1,800/3,500

/** Village points: level L of a building adds round(base * POINTS_GROWTH^(L-1)) points, so high levels are worth far more. */
export const POINTS_GROWTH = 1.2;
export const BUILDING_POINTS_BASE: Record<BuildingId, number> = {
  hall: 10,
  lumber: 8,
  farm: 8,
  longhouse: 8,
  mine: 8,
  goldmine: 12,
  storehouse: 6,
  barracks: 10,
  stables: 12,
  wrightyard: 12,
  wall: 8,
  vault: 6,
  market: 10,
  drillyard: 12,
  bannerhall: 14,
};
export const MAP_STAGE_NAMES = ['Hamlet', 'Palisade village', 'Stockade town', 'Stone-walled town', 'Fortified town', 'Castle'] as const;
/** Abandoned villages show a ruin: hamlet below the first, town below the second, fort above. */
export const RUIN_STAGE_MIN_POINTS = MAP_STAGE_MIN_POINTS; // 6 abandoned pictures, same steps as player villages (owner, 2026-11-04)

/** Selectable chieftain portraits (art in design/sprites/chieftains/<id>.svg). */
export const CHIEFTAINS = [
  { id: 'old-orm', name: 'Old Orm', title: 'The Elder' },
  { id: 'ysra', name: 'Ysra', title: 'The Firebrand' },
  { id: 'brannoc', name: 'Brannoc One-Eye', title: 'The Old Raider' },
  { id: 'hild', name: 'Hild Ironveil', title: 'The Shieldmaiden' },
  { id: 'barley-tam', name: 'Barley Tam', title: 'The Farmer-Chief' },
  { id: 'maelis', name: 'Seer Maelis', title: 'The Grove Elder' },
  { id: 'corwen', name: 'Corwen', title: 'The Hot-headed Heir' },
  { id: 'khorza', name: 'Khorza Longmane', title: 'The Horse-Lord' },
  { id: 'saffi', name: 'Saffi Goldhand', title: 'The Merchant-Queen' },
  { id: 'wren', name: 'Wren', title: 'The Quiet Huntress' },
] as const;
export type ChieftainId = (typeof CHIEFTAINS)[number]['id'];
export const DEFAULT_CHIEFTAIN: ChieftainId = 'old-orm';

// ---- Achievements (docs/GAME_DESIGN.md section 16): bronze / silver / gold thresholds per achievement ----

export const ACHIEVEMENT_TIERS = {
  timberBaron: [2_000, 25_000, 250_000],
  grainGrabber: [2_000, 25_000, 250_000],
  ironPilferer: [2_000, 25_000, 250_000],
  goldMagpie: [200, 2_500, 25_000],
  hoardOfHoards: [10_000, 100_000, 1_000_000],
  boneCollector: [25, 500, 5_000],
  hardKnocks: [25, 500, 5_000],
  fireStarter: [3, 40, 300],
  plucky: [3, 25, 150],
  hedgehog: [2, 20, 150],
  openDoor: [3, 25, 100],
  battleHardened: [10, 100, 600],
  nosyNeighbour: [3, 30, 250],
  keenEyes: [2, 20, 150],
  brickByBrick: [10, 100, 600],
  drillSergeant: [50, 1_000, 10_000],
  generousCart: [1_000, 20_000, 200_000],
  caravanMaster: [3, 30, 200],
  ruinRaider: [3, 30, 250],
  shieldFriend: [2, 20, 150],
} as const satisfies Record<string, readonly [number, number, number]>;

// ---- Caretaker bot for idle owners (docs/GAME_DESIGN.md section 17) ----

/** An owner who has not made an authenticated request for this many days (divided by world speed) is idle. */
export const BOT_IDLE_DAYS = 3;
/** An owner away this many days (divided by world speed) loses the villages to the map: they become abandoned villages: buildings and the troops standing at home stay (nothing is added, trained or refilled; they defend until beaten), queues go. */
export const ABANDON_IDLE_DAYS = 30;
/** The caretaker acts on an idle village at most once per this many hours (divided by world speed). */
export const BOT_STEP_HOURS = 2;
/** Most builds the caretaker queues for one village in one run. */
export const BOT_MAX_STEPS_PER_RUN = 2;
/** Most villages the caretaker handles in one pass of the periodic job. */
export const BOT_BATCH_VILLAGES = 25;
/** An abandoned village's stored state (and so its map points) is settled and saved by the caretaker once per this many hours (divided by world speed). */
export const NPC_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
/** Most abandoned villages one caretaker pass refreshes (15,000 of them are all done within the hour at one pass a minute). */
export const NPC_REFRESH_BATCH = 400;
/** ... and the real time one pass may spend on it, whichever limit comes first. */
export const NPC_REFRESH_BUDGET_MS = 20;
/** How often the server runs the caretaker pass (real ms, not scaled). */
export const BOT_PASS_INTERVAL_MS = 60_000;
/** The ranking lists (players, Renown) are rebuilt at most this often (server clock, ms); every request in between reuses the list. */
export const RANKINGS_CACHE_MS = 15_000;
/** A player's last_active is written at most this often (real ms), so reads never cause write storms. */
export const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60_000;
/** A player counts as online when last_active is at most this old (real ms; two write intervals, so a steady player never flickers). */
export const ONLINE_WINDOW_MS = 2 * ACTIVITY_WRITE_INTERVAL_MS;
/** Relative chance that the caretaker picks a building; 0 = never. Troop buildings and the Drillyard are left alone. */
export const BOT_BUILD_WEIGHTS: Record<BuildingId, number> = {
  hall: 2,
  lumber: 5,
  farm: 4,
  longhouse: 4,
  mine: 5,
  goldmine: 3,
  storehouse: 4,
  barracks: 0,
  stables: 0,
  wrightyard: 0,
  wall: 3,
  vault: 3,
  market: 1,
  drillyard: 0,
  bannerhall: 0,
};

// ---- Map sites: Great Fire and Fire Shrines (docs/GAME_DESIGN.md 18.4b "Step 5") ------------------
/** Kinds of neutral map sites a tribe can hold: the Great Fire, Fire Shrines, Waymarks (faster roads) and Lookouts (sight of passing marches). */
export const SITE_KINDS = ['great_fire', 'fire_shrine', 'waymark', 'lookout'] as const;
export type SiteKind = (typeof SITE_KINDS)[number];
/** Ring radii (tiles from the world centre) of the Fire Shrines: inner ring, then outer ring. The Great Fire stands near (0,0). */
export const SHRINE_RING_RADII = [35, 85] as const;
/** Fire Shrines per ring, spaced evenly (90 degrees for 4) with a seeded rotation per ring. */
export const SHRINE_COUNT_PER_RING = 4;
/** Every site is at least this far (Euclidean tiles) from every other site. */
export const SITE_MIN_SPACING = 15;
/** No village is placed within this distance (Chebyshev, tiles: a square) of a site; abandoned-village generation and landing check it. */
export const SITE_NO_VILLAGE_RADIUS = 4;
/** Militia of an unheld site, in population (mixed pikemen and shieldbearers). */
export const SITE_MILITIA: Record<SiteKind, number> = { fire_shrine: 600, great_fire: 1500, waymark: 300, lookout: 300 };
/** An awake site's militia is this many times larger (the Great Fire wakes on the same clock as the shrines). Waymarks and Lookouts never wake. */
export const SHRINE_AWAKE_MILITIA_FACTOR = 2;
/** Most population that can be stationed at a site. */
export const SITE_MAX_POPULATION: Record<SiteKind, number> = { fire_shrine: 3000, great_fire: 5000, waymark: 3000, lookout: 3000 };
/** After a capture the site cannot be attacked for this many hours (divided by world speed). */
export const SITE_CALM_HOURS = 2;
/** Fire Shrines sleep for this many days from world creation (divided by world speed), then wake with a stronger bonus. */
export const SHRINE_WAKE_DAYS = 120;
/** Extra Renown share for every member of the holding tribe, per held site (0.01 = +1%). The Great Fire wakes on the same clock as the shrines. */
export const SITE_RENOWN_BONUS: { dormant: Record<SiteKind, number>; awake: Record<SiteKind, number> } = {
  dormant: { fire_shrine: 0.01, great_fire: 0.03, waymark: 0, lookout: 0 },
  awake: { fire_shrine: 0.04, great_fire: 0.1, waymark: 0, lookout: 0 },
};
/** The sum of the Renown bonuses of all held sites never exceeds this (+30%). */
export const SITE_RENOWN_BONUS_CAP = 0.3;

// ---- Waymarks and Lookouts (docs/GAME_DESIGN.md 18.4b "Neutral sites tribes can hold") ----------------
/** Ground within this distance (Euclidean tiles) of a Waymark held by the mover's tribe has its terrain penalty reduced. */
export const WAYMARK_RADIUS = 12;
/** The terrain penalty (extra time over grass) near a held Waymark is multiplied by this (0.5 = halved). Grass is unchanged. */
export const WAYMARK_PENALTY_FACTOR = 0.5;
/** A Lookout shows enemy marches whose straight line passes within this many tiles of it. */
export const LOOKOUT_RADIUS = 20;
/** Radius (tiles from the world centre) of the one ring that carries the Waymarks and Lookouts, alternating around it. */
export const SIDE_SITE_RING_RADIUS = 60;
/** Waymarks and Lookouts on the ring, 30 degrees apart (6 of each, alternating). */
export const SIDE_SITE_COUNT = 12;
/** A sighted march is shown as a size band, never unit counts: population below `smallBelow` is small, below `mediumBelow` medium, else large. */
export const LOOKOUT_SIZE_BANDS = { smallBelow: 100, mediumBelow: 1000 } as const;
/** At most this many sightings are listed (soonest arrival first). */
export const LOOKOUT_LIST_LIMIT = 100;

/**
 * First steps (docs/GAME_DESIGN.md "First steps"): nine starter tasks with a small reward each. Done is detected by the
 * server (any order, sticky); the reward is claimed once into a village the player names. Order here = order shown.
 */
export const FIRST_STEPS: readonly { id: FirstStepId; reward: Resources }[] = [
  { id: 'lumber2', reward: { wood: 150, food: 80, iron: 80, gold: 0 } },
  { id: 'farm2', reward: { wood: 80, food: 150, iron: 80, gold: 0 } },
  { id: 'longhouse2', reward: { wood: 80, food: 150, iron: 80, gold: 0 } },
  { id: 'hall2', reward: { wood: 120, food: 120, iron: 120, gold: 0 } },
  { id: 'barracks2', reward: { wood: 250, food: 200, iron: 200, gold: 0 } },
  { id: 'raiders5', reward: { wood: 200, food: 200, iron: 200, gold: 20 } },
  { id: 'raid', reward: { wood: 150, food: 150, iron: 150, gold: 0 } },
  { id: 'report', reward: { wood: 100, food: 100, iron: 100, gold: 30 } },
  { id: 'tribe', reward: { wood: 250, food: 250, iron: 250, gold: 50 } },
];

/** Building level (counting a queued or started upgrade) that completes each building step. */
export const FIRST_STEP_BUILDING_LEVEL = 2;
/** Raiders (home + training + away) that complete the `raiders5` step. */
export const FIRST_STEP_RAIDERS = 5;
