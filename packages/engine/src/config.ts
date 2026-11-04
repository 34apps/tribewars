// Game balance data. Formulas that use these numbers are described in docs/GAME_DESIGN.md.
// Change numbers here (not in logic files) when tuning the game.

import type { BuildingDef, BuildingId, ResourceId, Resources, Terrain, TribeAction, TribeRole, UnitDef, UnitId, WorldSettings } from './types.ts';

const res = (wood: number, food: number, iron: number, gold = 0): Resources => ({ wood, food, iron, gold });

export const DEFAULT_WORLD: WorldSettings = {
  seed: 20261102,
  speed: 1,
  radius: 100,
  npcDensity: 0.02,
  protectionHours: 72,
  npcGrowthHours: 6,
};

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
/** Largest single training batch. */
export const MAX_TRAIN_BATCH = 1000;

/** Production per hour at level 1 (speed 1). Level L gives base * PRODUCTION_GROWTH^(L-1). */
export const PRODUCTION_BASE: Record<'lumber' | 'farm' | 'mine' | 'goldmine', number> = {
  lumber: 30,
  farm: 40,
  mine: 30,
  goldmine: 10,
};
export const PRODUCTION_GROWTH = 1.17;
/** Wood/food/iron trickle per hour when the producing building is level 0. Gold has none. */
export const PRODUCTION_LEVEL0 = 5;

/** Storehouse cap per resource: level 0 -> STORAGE_LEVEL0, level L -> base * growth^(L-1). */
export const STORAGE_LEVEL0 = 800;
export const STORAGE_BASE = 1000;
export const STORAGE_GROWTH = 1.24;

/** Vault: resources per type raiders can't take. Level 0 -> 0, level L -> base * growth^(L-1). */
export const VAULT_BASE = 120;
export const VAULT_GROWTH = 1.35;

/**
 * Population: a second limit next to food. Every building level and every troop (home, away or in training)
 * takes population; the Farm sets the cap. Queued building levels are reserved when queued. Abandoned villages
 * are exempt. Building at level L takes ceil(first * POP_BUILDING_GROWTH^(L-1)); the Farm itself takes none, so a
 * full village can always still upgrade its Farm.
 */
export const POP_BUILDING_FIRST: Record<BuildingId, number> = {
  hall: 4,
  lumber: 3,
  farm: 0,
  mine: 3,
  goldmine: 3,
  market: 4,
  storehouse: 3,
  barracks: 5,
  stables: 6,
  drillyard: 5,
  bannerhall: 6,
  wall: 2,
  vault: 2,
};
export const POP_BUILDING_GROWTH = 1.1;
/** Population per troop type (separate from food upkeep). */
export const POP_PER_UNIT: Record<UnitId, number> = { pikeman: 1, guard: 1, raider: 1, outrider: 2, knight: 4, pathfinder: 1, chieftain: 8 };
/** Food a troop eats per hour for each population point it takes (owner decision 2026-11-04: 0.25; was 1 per unit). Unit upkeep = POP_PER_UNIT * this. */
export const FOOD_UPKEEP_PER_POP = 0.25;
/** Cap: Farm level 0 -> POP_CAP_LEVEL0, level L -> round(POP_CAP_BASE * POP_CAP_GROWTH^(L-1)). */
export const POP_CAP_LEVEL0 = 120;
export const POP_CAP_BASE = 150;
export const POP_CAP_GROWTH = 1.2;

/** Town Hall speeds construction: time * HALL_TIME_FACTOR^(hallLevel-1). */
export const HALL_TIME_FACTOR = 0.95;
/** Barracks/Stables speed training: time * TRAIN_TIME_FACTOR^(buildingLevel-1). */
export const TRAIN_TIME_FACTOR = 0.94;

/** Wall: defense * (1 + WALL_BONUS_PER_LEVEL * level), plus militia WALL_BASE_DEFENSE + WALL_DEFENSE_PER_LEVEL * level. */
export const WALL_BONUS_PER_LEVEL = 0.05;
export const WALL_BASE_DEFENSE = 20;
export const WALL_DEFENSE_PER_LEVEL = 15;

/** Battle: loser-side loss ratio = (weaker / stronger) ^ BATTLE_LOSS_EXPONENT. Luck is +-BATTLE_LUCK. */
export const BATTLE_LOSS_EXPONENT = 1.5;
export const BATTLE_LUCK = 0.1;

/** Abandoned villages. */
export const NPC_MAX_LEVEL = 10;
/** Share of abandoned villages per tier 1..5 (sums to 1). */
export const NPC_TIER_WEIGHTS = [0.4, 0.25, 0.18, 0.11, 0.06] as const;
/** Building that grows on growth step n is NPC_GROWTH_ORDER[n % length] (skipping maxed ones). */
export const NPC_GROWTH_ORDER: readonly BuildingId[] = ['lumber', 'farm', 'mine', 'storehouse', 'hall', 'wall', 'vault', 'goldmine'];
/** Full garrison = per-unit count * Town Hall level. */
export const NPC_GARRISON_PER_HALL: Partial<Record<UnitId, number>> = { pikeman: 4, guard: 2 };
/**
 * Abandoned villages slowly recruit again: every growth step (npcGrowthHours) brings back this share of the full
 * garrison (rounded up, at least one unit of each missing type) until it is full.
 */
export const NPC_GARRISON_REFILL_SHARE = 0.2;
/**
 * Repeat raids on one abandoned village by the same player: within NPC_REPEAT_WINDOW_HOURS (divided by world speed)
 * each earlier won raid multiplies what the next army can carry off by NPC_REPEAT_LOOT_FACTOR, never below NPC_REPEAT_LOOT_FLOOR.
 */
export const NPC_REPEAT_WINDOW_HOURS = 24;
export const NPC_REPEAT_LOOT_FACTOR = 0.5;
export const NPC_REPEAT_LOOT_FLOOR = 0.1;
/** Growth steps applied per settle call at most; older steps are skipped (village is maxed by then anyway). */
export const NPC_MAX_STEPS_PER_SETTLE = 500;

/** Villages may not be closer than this (Chebyshev distance) to another village. */
export const NPC_MIN_SPACING = 2;
export const SPAWN_MIN_SPACING = 3;

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  hall: {
    id: 'hall',
    name: 'Town Hall',
    description: 'Heart of the village. Each level makes construction faster and unlocks new buildings.',
    maxLevel: 20,
    startLevel: 1,
    requires: {},
    baseCost: res(90, 80, 70),
    costGrowth: 1.26,
    baseTimeSec: 600,
    timeGrowth: 1.32,
  },
  lumber: {
    id: 'lumber',
    name: 'Lumber Camp',
    description: 'Woodcutters bring in wood every hour.',
    maxLevel: 20,
    startLevel: 1,
    requires: {},
    baseCost: res(50, 40, 30),
    costGrowth: 1.25,
    baseTimeSec: 360,
    timeGrowth: 1.3,
  },
  farm: {
    id: 'farm',
    name: 'Farm',
    description: 'Grows food. Your troops eat food every hour, so more farms mean a bigger army.',
    maxLevel: 20,
    startLevel: 1,
    requires: {},
    baseCost: res(60, 30, 30),
    costGrowth: 1.25,
    baseTimeSec: 360,
    timeGrowth: 1.3,
  },
  mine: {
    id: 'mine',
    name: 'Iron Mine',
    description: 'Miners dig iron for weapons and stronger buildings.',
    maxLevel: 20,
    startLevel: 1,
    requires: {},
    baseCost: res(65, 45, 20),
    costGrowth: 1.25,
    baseTimeSec: 420,
    timeGrowth: 1.3,
  },
  goldmine: {
    id: 'goldmine',
    name: 'Gold Mine',
    description: 'Slowly produces gold, needed for cavalry and elite troops.',
    maxLevel: 15,
    startLevel: 0,
    requires: { hall: 3 },
    baseCost: res(150, 120, 180),
    costGrowth: 1.3,
    baseTimeSec: 1500,
    timeGrowth: 1.32,
  },
  market: {
    id: 'market',
    name: 'Market',
    description: 'Traders carry resources to your other villages and to friends. Higher levels carry more per shipment.',
    maxLevel: 10,
    startLevel: 0,
    requires: { hall: 3 },
    baseCost: res(100, 70, 60),
    costGrowth: 1.27,
    baseTimeSec: 1200,
    timeGrowth: 1.3,
  },
  storehouse: {
    id: 'storehouse',
    name: 'Storehouse',
    description: 'Raises how much of each resource the village can hold.',
    maxLevel: 20,
    startLevel: 1,
    requires: {},
    baseCost: res(70, 50, 40),
    costGrowth: 1.24,
    baseTimeSec: 480,
    timeGrowth: 1.3,
  },
  barracks: {
    id: 'barracks',
    name: 'Barracks',
    description: 'Trains infantry. Higher levels train faster and unlock new units.',
    maxLevel: 20,
    startLevel: 0,
    requires: { hall: 2 },
    baseCost: res(200, 150, 120),
    costGrowth: 1.26,
    baseTimeSec: 900,
    timeGrowth: 1.32,
  },
  stables: {
    id: 'stables',
    name: 'Stables',
    description: 'Trains fast cavalry that can carry more loot.',
    maxLevel: 15,
    startLevel: 0,
    requires: { hall: 5, barracks: 3 },
    baseCost: res(260, 200, 300, 20),
    costGrowth: 1.27,
    baseTimeSec: 1800,
    timeGrowth: 1.32,
  },
  drillyard: {
    id: 'drillyard',
    name: 'Drillyard',
    description: 'Veterans research stronger troops and drill them. Each level gives Training Points; a village cannot max everything.',
    maxLevel: 10,
    startLevel: 0,
    requires: { barracks: 3, hall: 5 },
    baseCost: res(240, 180, 260, 15),
    costGrowth: 1.28,
    baseTimeSec: 1500,
    timeGrowth: 1.32,
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
    baseCost: res(2500, 2500, 2500, 100),
    costGrowth: 1.35,
    baseTimeSec: 72000,
    timeGrowth: 1.32,
  },
  wall: {
    id: 'wall',
    name: 'Wall',
    description: 'Makes defenders stronger and adds village militia.',
    maxLevel: 20,
    startLevel: 0,
    requires: { barracks: 1 },
    baseCost: res(100, 40, 60),
    costGrowth: 1.26,
    baseTimeSec: 720,
    timeGrowth: 1.32,
  },
  vault: {
    id: 'vault',
    name: 'Hidden Vault',
    description: 'Hides some of each resource so raiders cannot take it.',
    maxLevel: 10,
    startLevel: 0,
    requires: { hall: 2 },
    baseCost: res(40, 50, 30),
    costGrowth: 1.28,
    baseTimeSec: 540,
    timeGrowth: 1.32,
  },
};

export const UNITS: Record<UnitId, UnitDef> = {
  pikeman: {
    id: 'pikeman',
    name: 'Pikeman',
    description: 'Cheap defender with long pikes. Very good against cavalry.',
    unitClass: 'infantry',
    attack: 10,
    defenseInfantry: 15,
    defenseCavalry: 45,
    speed: 6,
    carry: 15,
    upkeep: POP_PER_UNIT.pikeman * FOOD_UPKEEP_PER_POP,
    cost: res(35, 30, 40),
    trainTimeSec: 270,
    building: 'barracks',
    requires: { barracks: 1 },
  },
  guard: {
    id: 'guard',
    name: 'Shieldbearer',
    description: 'Heavy shield wall. Very good against infantry.',
    unitClass: 'infantry',
    attack: 15,
    defenseInfantry: 45,
    defenseCavalry: 25,
    speed: 5,
    carry: 10,
    upkeep: POP_PER_UNIT.guard * FOOD_UPKEEP_PER_POP,
    cost: res(30, 40, 75),
    trainTimeSec: 330,
    building: 'barracks',
    requires: { barracks: 3 },
    research: { drillyard: 1, cost: res(150, 120, 200), timeSec: 3600 },
  },
  raider: {
    id: 'raider',
    name: 'Raider',
    description: 'Fierce attacker on foot. Weak in defense.',
    unitClass: 'infantry',
    attack: 40,
    defenseInfantry: 10,
    defenseCavalry: 5,
    speed: 6,
    carry: 30,
    upkeep: POP_PER_UNIT.raider * FOOD_UPKEEP_PER_POP,
    cost: res(50, 40, 70),
    trainTimeSec: 300,
    building: 'barracks',
    requires: { barracks: 2 },
  },
  outrider: {
    id: 'outrider',
    name: 'Outrider',
    description: 'Fast light cavalry. Carries the most loot.',
    unitClass: 'cavalry',
    attack: 60,
    defenseInfantry: 20,
    defenseCavalry: 15,
    speed: 14,
    carry: 70,
    upkeep: POP_PER_UNIT.outrider * FOOD_UPKEEP_PER_POP,
    cost: res(80, 100, 180),
    trainTimeSec: 600,
    building: 'stables',
    requires: { stables: 1 },
    research: { drillyard: 3, cost: res(300, 220, 350, 20), timeSec: 7200 },
  },
  knight: {
    id: 'knight',
    name: 'Knight',
    description: 'Armoured elite rider, strong in attack and defense. Costs gold.',
    unitClass: 'cavalry',
    attack: 110,
    defenseInfantry: 70,
    defenseCavalry: 50,
    speed: 10,
    carry: 40,
    upkeep: POP_PER_UNIT.knight * FOOD_UPKEEP_PER_POP,
    cost: res(130, 150, 320, 30),
    trainTimeSec: 1320,
    building: 'stables',
    requires: { stables: 5, hall: 10 },
    research: { drillyard: 6, cost: res(600, 450, 700, 80), timeSec: 14400 },
  },
  pathfinder: {
    id: 'pathfinder',
    name: 'Pathfinder',
    description: 'Quick, quiet scout. Sent alone on a scouting mission, reports what a village holds. Catches enemy scouts at home.',
    unitClass: 'infantry',
    attack: 0,
    defenseInfantry: 2,
    defenseCavalry: 1,
    speed: 18,
    carry: 0,
    upkeep: POP_PER_UNIT.pathfinder * FOOD_UPKEEP_PER_POP,
    cost: res(20, 30, 40),
    trainTimeSec: 180,
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
    upkeep: POP_PER_UNIT.chieftain * FOOD_UPKEEP_PER_POP,
    cost: res(4000, 3000, 5000, 150),
    trainTimeSec: 6 * 3600,
    building: 'bannerhall',
    requires: { bannerhall: 1 },
  },
};

// ---- Renown (docs/GAME_DESIGN.md section 18.2, "Owning several villages"). Starting values; the sim step tunes the pace. ----

/** What one unit of each resource is worth when valuing loot and troops for Renown (same convention as scripts/sim: gold = 10). */
export const RENOWN_VALUE_WEIGHT: Resources = { wood: 1, food: 1, iron: 1, gold: 10 };
/** Building Renown for finishing level L: round(RENOWN_BUILD_SCALE * L ^ RENOWN_BUILD_EXP), once per village and level. */
export const RENOWN_BUILD_SCALE = 0.25;
export const RENOWN_BUILD_EXP = 1.25;
/** Renown per point of loot value taken in a raid. */
export const RENOWN_PER_LOOT_VALUE = 1 / 16;
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
export const RENOWN_VILLAGE_BASE = 500;
export const RENOWN_VILLAGE_GROWTH = 1.6;
/** Share of a Chieftain's reserved Renown that comes back when he dies on the way (step 2). */
export const CHIEFTAIN_RENOWN_REFUND_SHARE = 0.5;
/** Chieftains per village in the Banner Hall queue: one batch of at most this many (each living or queued one is a future village). */
export const CHIEFTAIN_MAX_QUEUED_BATCHES = 1;
export const CHIEFTAIN_MAX_BATCH = 3;
/** Most villages one player may own (sanity cap for performance; the Renown price makes it unreachable). */
export const MAX_VILLAGES_PER_PLAYER = 20;

// ---- Hearth: Strike and Hold, founding, restart (docs/GAME_DESIGN.md 18.2). Times in hours at speed 1, divided by world speed. ----

/** Hold clock after a Strike: players' villages / abandoned villages. */
export const HOLD_HOURS = 12;
export const HOLD_HOURS_ABANDONED = 6;
/** Occupier population that keeps the hold clock running. */
export const HOLD_MIN_POPULATION = 150;
/** Occupiers may stay under HOLD_MIN_POPULATION this long before the claim fails. */
export const HOLD_FAIL_HOURS = 2;
/** No new Strike on a village for this long after it changed owner (raids stay possible). */
export const STRIKE_LOCK_HOURS = 24;
/** Chieftains needed to Strike a player village: 1 + floor(points / this), at most HEARTH_MAX_CHIEFTAINS (abandoned: always 1). */
export const HEARTH_POINTS_PER_CHIEFTAIN = 4000;
export const HEARTH_MAX_CHIEFTAINS = 3;
/** Striking player villages is built (and tested) but switched on only in step 4. */
export const HEARTH_PLAYERS_ENABLED = false;
/** Share of each resource a village keeps when it changes owner. */
export const TAKE_KEEP_RESOURCE_SHARE = 0.5;
/** A founded village starts with this stock (levels are the new-player start levels) and is safe from attacks for this long. */
export const FOUND_START_RESOURCES: Resources = res(300, 300, 150, 0);
export const FOUND_PROTECTION_HOURS = 24;
/** A player who lost their last village restarts at the world edge with this much protection. */
export const RESTART_PROTECTION_HOURS = 48;
/** The restart spot lies within this many tiles inside the edge of the populated disc. */
export const RESTART_EDGE_BAND = 2;
/** One Feast (Banner Hall level 1+) costs this and gives FEAST_RENOWN. */
export const FEAST_COST: Resources = res(600, 600, 600, 0);
export const FEAST_RENOWN = 10;
/** Feasts per village per window, per Banner Hall level. */
export const FEAST_DAILY_PER_LEVEL = 3;
/** Feast window in hours (divided by world speed); it starts at the first Feast. */
export const FEAST_WINDOW_HOURS = 24;
/**
 * Defender Renown (GAME_DESIGN 18.2 source 4): a small daily trickle for keeping a real defence at home. Strength is the
 * defence of the village's own troops at home (support and troops away do not count). Renown per 24 h (divided by world
 * speed) = min(DEFENDER_RENOWN_DAILY_CAP, strength x DEFENDER_RENOWN_PER_DEFENCE), nothing during beginner protection.
 */
export const DEFENDER_RENOWN_PER_DEFENCE = 0.006;
export const DEFENDER_RENOWN_DAILY_CAP = 22;

// ---- Drillyard: research and ranks (docs/GAME_DESIGN.md sections 4 and 15) -----------------------------

/** Training Points a village gets per Drillyard level. */
export const DRILLYARD_POINTS_PER_LEVEL = 3;
/** Highest rank per track. */
export const RANK_MAX = 5;
/** Might: +attack, Bulwark: +both defences, per rank (max RANK_MAX * 5% = +25%). */
export const RANK_BONUS = 0.05;
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

/** Abandoned-village start level of building b at tier T: perTier * T + offset (min 0, max NPC_MAX_LEVEL). */
export const NPC_START_LEVELS: Partial<Record<BuildingId, { perTier: number; offset: number }>> = {
  hall: { perTier: 1, offset: 0 },
  lumber: { perTier: 2, offset: 0 },
  farm: { perTier: 2, offset: 0 },
  mine: { perTier: 2, offset: 0 },
  storehouse: { perTier: 2, offset: 0 },
  wall: { perTier: 1, offset: -1 },
  vault: { perTier: 1, offset: -1 },
  goldmine: { perTier: 1, offset: -1 },
};
/** Abandoned villages start with this share of their storage cap in wood, food and iron. */
export const NPC_START_RESOURCE_SHARE = 0.5;
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
export const NPC_RING_BASE = 3;
export const NPC_RING_MIN_RADIUS = 3.5;
export const NPC_RING_MAX_RADIUS = 7;
export const NPC_RING_EXTRA_CHANCE = 0.4;
export const NPC_RING_EXTRA_MAX = 3;
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
  knight: 'mounted',
  pathfinder: 'pathfinder',
  chieftain: 'foot',
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
};

/** Rights the leader may grant to an individual member (stored on the membership). Everything else stays role-bound. */
export const TRIBE_GRANTABLE = ['invite', 'handle_applications', 'kick', 'diplomacy', 'edit_settings', 'forum_manage', 'forum_moderate', 'view_activity'] as const satisfies readonly TribeAction[];

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

/** The scouting unit: the only unit a scout mission may carry. */
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
export const MAP_STAGE_MIN_POINTS = [0, 100, 300, 800, 1800, 3500] as const;

/** Village points: level L of a building adds round(base * POINTS_GROWTH^(L-1)) points, so high levels are worth far more. */
export const POINTS_GROWTH = 1.2;
export const BUILDING_POINTS_BASE: Record<BuildingId, number> = {
  hall: 10,
  lumber: 8,
  farm: 8,
  mine: 8,
  goldmine: 12,
  storehouse: 6,
  barracks: 10,
  stables: 12,
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
/** An owner away this many days (divided by world speed) loses the villages to the map: they become abandoned villages, troops and queues kept. */
export const ABANDON_IDLE_DAYS = 30;
/** The caretaker acts on an idle village at most once per this many hours (divided by world speed). */
export const BOT_STEP_HOURS = 2;
/** Most builds the caretaker queues for one village in one run. */
export const BOT_MAX_STEPS_PER_RUN = 2;
/** Most villages the caretaker handles in one pass of the periodic job. */
export const BOT_BATCH_VILLAGES = 25;
/** How often the server runs the caretaker pass (real ms, not scaled). */
export const BOT_PASS_INTERVAL_MS = 60_000;
/** A player's last_active is written at most this often (real ms), so reads never cause write storms. */
export const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60_000;
/** A player counts as online when last_active is at most this old (real ms; two write intervals, so a steady player never flickers). */
export const ONLINE_WINDOW_MS = 2 * ACTIVITY_WRITE_INTERVAL_MS;
/** Relative chance that the caretaker picks a building; 0 = never. Troop buildings and the Drillyard are left alone. */
export const BOT_BUILD_WEIGHTS: Record<BuildingId, number> = {
  hall: 2,
  lumber: 5,
  farm: 4,
  mine: 5,
  goldmine: 3,
  storehouse: 4,
  barracks: 0,
  stables: 0,
  wall: 3,
  vault: 3,
  market: 1,
  drillyard: 0,
  bannerhall: 0,
};
