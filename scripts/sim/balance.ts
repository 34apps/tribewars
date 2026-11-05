// Balance simulator: plays computer players through the REAL engine (settleVillage, applyBuild, applyTrain,
// applySend, resolveBattle, applyStrike, applyOwnerChange, createFoundedVillage, ...). No server, no database, no wall
// clock: all time is simulated, all luck comes from fixed seeds, so every run gives the same numbers.
//
//   npm run sim                      30 days, world speed 1, report to stdout (markdown)
//   npm run sim -- --days 5 --seed 7 --json
//   npm run sim -- --out docs/sim/<file>.txt       write the report to a file
//   npm run sim -- --home -10,-10                  other start tile (terrain on the raid routes)
//   npm run sim -- --siege                         siege units (GAME_DESIGN 18.9): focused experiments (scripts/sim/siege.ts) + the
//                                                  computer players with and without siege. Without --siege nothing about siege runs.
//
// Since step 2 a style plays SEVERAL villages: once Renown pays for it and a Banner Hall exists it trains a Chieftain, then
// either TAKES an abandoned village (Strike + 6 h hold, raider / balanced) or FOUNDS a new one on free land (builder / turtle).
// Assumptions are listed at the end of the report ("Model") and in docs/BALANCE.md.

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  BUILDINGS,
  BUILDING_IDS,
  DEFAULT_WORLD,
  HOLD_MIN_POPULATION,
  POP_PER_UNIT,
  RESOURCE_IDS,
  UNITS,
  UNIT_IDS,
  applyAttackerLosses,
  applyBattleToDefender,
  applyBuild,
  applyFeast,
  applyOwnerChange,
  applyResearch,
  applyReturn,
  applySend,
  applyStrike,
  applyTrain,
  buildingCost,
  FEAST_COST,
  battleRenown,
  canAfford,
  checkBuild,
  checkFeast,
  checkFoundTarget,
  checkResearch,
  checkStrike,
  checkTrain,
  chieftainRefund,
  collectBuildRenown,
  collectDefenderRenown,
  createFoundedVillage,
  createNpcVillage,
  createPlayerVillage,
  emptyResources,
  emptyUnits,
  feastAllowance,
  hashSeed,
  holdDueAt,
  isAttackBlocked,
  isStrikeBlocked,
  occupierPopulation,
  protectionEndsAt,
  renownPairWindowMs,
  resolveBattle,
  settleVillage,
  storageCap,
  totalUnits,
  travelPreview,
  travelTimeMs,
  updateHold,
  villagePoints,
  villageRenownCost,
  villageRenownPrice,
} from '../../packages/engine/src/index.ts';
import type { BuildingId, Resources, UnitId, Units, VillageState, WorldSettings } from '../../packages/engine/src/index.ts';
import { formatSiegeExperiments, runSiegeExperiments } from './siege.ts';

const HOUR = 3_600_000;
const STEP_MS = 10 * 60_000; // a player "looks at the game" every 10 minutes
const QUEUE_LIMIT = 2; // free-player build queue (MAX_BUILD_QUEUE)
/** Gold is rare, so it counts 10x when raid profit and losses are valued. */
const VALUE_WEIGHT: Resources = { wood: 1, food: 1, iron: 1, gold: 10 };
const value = (r: Resources): number => RESOURCE_IDS.reduce((a, id) => a + r[id] * VALUE_WEIGHT[id], 0);
const num = (n: number): number => Math.round(n);
/** A strike army wants this many population of survivors (incl. the Chieftain) so the hold clock (HOLD_MIN_POPULATION) runs. */
const OCCUPIER_NEED = Math.ceil(HOLD_MIN_POPULATION * 1.05);
/** A take-style player gives up waiting for a beatable abandoned village after this many hours with a Chieftain at home and founds instead. */
const TAKE_PATIENCE_HOURS = 72;
/** A founded village escorts the Chieftain with at most this many defenders (they become its garrison). */
const FOUND_ESCORT = 30;
/** Late game for the idle metric: gaps that START on or after this day are reported separately. */
const LATE_DAY = 20;

export type StyleName = 'builder' | 'raider' | 'turtle' | 'balanced';
export const STYLES: StyleName[] = ['builder', 'raider', 'turtle', 'balanced'];

// ---- Styles -------------------------------------------------------------------------------------

type Step = [BuildingId, number];
interface Style {
  /** Strict priority list: the first entry below its target level is built next (waits for resources). */
  order: Step[];
  /** After the list: always raise the lowest of these. */
  tail: BuildingId[];
  /** Units to train, in a cycle; weights say how many of each per 100 trained. */
  army: Array<{ unit: UnitId; weight: number }>;
  /** Share of the next building's cost kept back from training (0 = army first, 1 = building first). */
  reserve: number;
  /** Do not train before this day. */
  trainFromDay: number;
  /** Units sent on raids (empty = never raids). */
  raiders: UnitId[];
  research: UnitId[];
  /** Units kept at home when raiding is allowed (never sent). */
  keepHome: number;
  /** Does the assumed enemy hit this village on days 7, 14, 21, 28? (turtle: never, to see what a pure defender earns.) */
  enemyRaids: boolean;
  /** How the style gets its next village: 'take' = Strike and Hold on the best abandoned village it can beat (falls back to
   *  founding after TAKE_PATIENCE_HOURS), 'found' = the slow safe path on free land. */
  expand: 'take' | 'found';
}

const eco: Step[] = [['lumber', 4], ['farm', 4], ['mine', 4], ['storehouse', 3]];

export const STYLE_DEFS: Record<StyleName, Style> = {
  builder: {
    order: [
      ...eco, ['hall', 3], ['lumber', 8], ['farm', 8], ['mine', 8], ['storehouse', 7], ['barracks', 1], ['vault', 2], ['hall', 5],
      ['goldmine', 3], ['lumber', 12], ['farm', 12], ['mine', 12], ['storehouse', 11], ['hall', 8], ['wall', 3], ['market', 3],
      ['barracks', 3], ['hall', 10], ['drillyard', 3], ['bannerhall', 1], ['stables', 1], ['goldmine', 8], ['lumber', 16],
      ['farm', 16], ['mine', 16], ['storehouse', 15], ['hall', 12], ['drillyard', 6], ['stables', 5], ['bannerhall', 2],
      ['wall', 10], ['vault', 8], ['market', 8], ['barracks', 8], ['drillyard', 9], ['stables', 8], ['bannerhall', 4],
    ],
    tail: ['lumber', 'farm', 'mine', 'storehouse', 'hall', 'goldmine', 'bannerhall'],
    army: [{ unit: 'pikeman', weight: 85 }, { unit: 'guard', weight: 10 }, { unit: 'knight', weight: 5 }],
    reserve: 1,
    trainFromDay: 4,
    raiders: [],
    research: ['guard', 'knight'],
    keepHome: 0,
    enemyRaids: true,
    expand: 'found',
  },
  raider: {
    order: [
      ['lumber', 2], ['farm', 3], ['hall', 2], ['barracks', 2], ['mine', 3], ['storehouse', 3], ['farm', 5], ['lumber', 4],
      ['mine', 5], ['barracks', 4], ['farm', 7], ['storehouse', 5], ['hall', 5], ['lumber', 6], ['mine', 7], ['farm', 9],
      ['stables', 1], ['market', 2], ['hall', 7], ['drillyard', 2], ['storehouse', 6], ['bannerhall', 1], ['barracks', 6], ['storehouse', 8], ['lumber', 8], ['mine', 9], ['farm', 11], ['hall', 8],
      ['market', 3], ['barracks', 8], ['lumber', 10], ['mine', 11], ['farm', 13], ['storehouse', 11], ['hall', 10], ['bannerhall', 1],
    ],
    tail: ['farm', 'lumber', 'mine', 'storehouse', 'barracks', 'hall'],
    army: [{ unit: 'raider', weight: 72 }, { unit: 'outrider', weight: 15 }, { unit: 'pikeman', weight: 10 }, { unit: 'pathfinder', weight: 3 }],
    reserve: 0.8,
    trainFromDay: 2,
    raiders: ['raider', 'outrider'],
    research: ['outrider'],
    keepHome: 0,
    enemyRaids: true,
    expand: 'take',
  },
  turtle: {
    order: [
      ['lumber', 3], ['farm', 4], ['hall', 2], ['barracks', 1], ['wall', 2], ['mine', 3], ['storehouse', 3], ['vault', 3],
      ['hall', 3], ['barracks', 3], ['wall', 5], ['farm', 6], ['lumber', 5], ['mine', 5], ['storehouse', 5], ['hall', 5],
      ['drillyard', 1], ['goldmine', 3], ['market', 2], ['hall', 7], ['storehouse', 6], ['drillyard', 2], ['bannerhall', 1], ['wall', 8], ['vault', 5], ['farm', 9], ['lumber', 8], ['mine', 8], ['storehouse', 8], ['hall', 8],
      ['market', 3], ['drillyard', 3], ['lumber', 11], ['farm', 12], ['mine', 11], ['storehouse', 11], ['hall', 10], ['bannerhall', 1],
      ['wall', 12], ['wall', 15], ['vault', 8],
    ],
    tail: ['wall', 'farm', 'lumber', 'mine', 'storehouse', 'hall'],
    army: [{ unit: 'pikeman', weight: 55 }, { unit: 'guard', weight: 40 }, { unit: 'pathfinder', weight: 5 }],
    reserve: 0.9,
    trainFromDay: 2,
    raiders: [],
    research: ['guard'],
    keepHome: 0,
    enemyRaids: false,
    expand: 'found',
  },
  balanced: {
    order: [
      ['lumber', 3], ['farm', 4], ['mine', 3], ['hall', 2], ['barracks', 2], ['storehouse', 3], ['lumber', 5], ['farm', 6],
      ['mine', 5], ['wall', 2], ['hall', 3], ['barracks', 3], ['vault', 2], ['storehouse', 5], ['farm', 8], ['lumber', 7],
      ['mine', 7], ['hall', 5], ['stables', 1], ['drillyard', 1], ['wall', 5], ['goldmine', 2], ['farm', 10], ['lumber', 9],
      ['mine', 9], ['storehouse', 8], ['market', 3], ['hall', 8], ['drillyard', 3], ['barracks', 5], ['stables', 3], ['farm', 12],
      ['lumber', 11], ['mine', 11], ['storehouse', 11], ['hall', 10], ['bannerhall', 1], ['goldmine', 5],
    ],
    tail: ['farm', 'lumber', 'mine', 'storehouse', 'wall', 'hall'],
    army: [{ unit: 'raider', weight: 40 }, { unit: 'pikeman', weight: 40 }, { unit: 'outrider', weight: 10 }, { unit: 'guard', weight: 10 }],
    reserve: 0.8,
    trainFromDay: 1.5,
    raiders: ['raider', 'outrider'],
    research: ['guard', 'outrider'],
    keepHome: 0,
    enemyRaids: true,
    expand: 'take',
  },
};

// ---- Report types -------------------------------------------------------------------------------

export interface DayRow {
  day: number;
  /** All villages together (resources, levels, points, army). */
  resources: Resources;
  /** Levels of the first (home) village. */
  buildings: Partial<Record<BuildingId, number>>;
  /** Building levels of all villages. */
  levelSum: number;
  points: number;
  villages: number;
  army: Units; // home + away + queued
  armySize: number;
  attack: number;
  defense: number; // vs an even mix of infantry and cavalry, wall excluded
  raidLoot: number; // cumulative, valued
  raidLosses: number; // cumulative, valued
  raids: number;
  raidWins: number;
  renownTotal: number;
  /** total - spent (Renown reserved for Chieftains leaves the balance). */
  renownBalance: number;
}

export interface RenownSources {
  buildings: number;
  raids: number;
  /** Renown for troops killed while defending (the assumed enemy raids). */
  defence: number;
  /** Daily trickle for keeping a defence at home (GAME_DESIGN 18.2 source 4). */
  trickle: number;
  feast: number;
}

export interface RaidStat {
  tier: number;
  sent: number;
  wins: number;
  loot: number;
  losses: number;
}

/** A village the player gained after the first one. */
export interface VillageGain {
  /** Hours since start when the village became the player's (hold clock ended / Chieftain arrived). */
  hour: number;
  route: 'take' | 'found';
  /** Points of the village at that moment. */
  points: number;
  /** Tier of the abandoned village that was taken. */
  tier?: number;
}

export interface ExpansionStats {
  chieftainsTrained: number;
  strikes: number;
  /** Strikes that put the hearth out. */
  strikeWins: number;
  /** Chieftains lost in a strike (Renown half refunded). */
  chieftainsLost: number;
  holdFails: number;
  founds: number;
  /** Chieftains that waited TAKE_PATIENCE_HOURS for a beatable village and went founding instead. */
  fallbacks: number;
}

export interface StyleResult {
  style: StyleName;
  rows: DayRow[];
  firstBuilding: Partial<Record<BuildingId, number>>; // hours when level 1 (next level for start buildings: level 2) first affordable with requirements met
  firstUnit: Partial<Record<UnitId, number>>; // hours when 1 unit was first affordable with requirements met
  trained: Units;
  raidByTier: RaidStat[];
  /**
   * IDLE STRETCH (a "dead period"): the longest time between two decision steps (10 min apart) at which, AFTER the player did
   * everything the style wants, something useful was still possible in ANY of the player's villages (a building, a batch of
   * 10 units, a research, a Feast, a Chieftain). A player who has built everything affordable and has nothing to spend on
   * waits: the gap grows until something becomes affordable again. Target: under 8 hours.
   */
  longestIdleHours: number;
  idleStartHour: number;
  /** Longest idle stretch that STARTS on or after day LATE_DAY (the late game). */
  lateIdleHours: number;
  lateIdleStartHour: number;
  hoursNearCap: Resources; // hours a resource sat at >= 90% of storage (first village)
  finalPoints: number;
  threats: Array<{ day: number; raiders: number; defended: boolean; lootLost: number; troopsLost: number }>;
  errors: string[];
  renownTotal: number;
  renownSpent: number;
  renownSources: RenownSources;
  feasts: number;
  /** Hour the balance first reached villageRenownCost(1) (the 2nd village's price; before any spending). */
  renownAffordableHour?: number;
  /** Hour Banner Hall level 1 was first finished (step 2 needs it to train a Chieftain). */
  bannerHallHour?: number;
  /** The later of the two (when a Chieftain could first be reserved). */
  secondVillageHour?: number;
  /** Hour the first Chieftain was queued (Renown reserved, resources paid). */
  chieftainQueuedHour?: number;
  /** Villages gained after the first, in order. */
  gains: VillageGain[];
  expansion: ExpansionStats;
  /** Villages owned at the end and the points of each. */
  villages: number;
  villagePointsEach: number[];
  /** Siege use (only when the run had siege units switched on). */
  siege?: SiegeStats;
}

export interface SimOptions {
  days: number;
  speed: number;
  seed: number;
  /** Map position of the simulated village (`--home x,y`); the terrain around it sets the raid travel times. */
  home: { x: number; y: number };
  /**
   * Siege units in play (`--siege`, default OFF so every older result stays valid): the attacking styles (raider, balanced) build
   * what Log Rams / Boulder Slings need, research and train a few, and send them with the raiders against fortified targets.
   */
  siege?: boolean;
}

/** What siege did to one style's run (only present when `SimOptions.siege`). */
export interface SiegeStats {
  /** Siege units trained (queued). */
  trained: { logram: number; boulder: number };
  /** Raids that carried siege units. */
  raids: number;
  /** ... of which won. */
  wins: number;
  /** Building levels lowered on abandoned villages. */
  levelsLowered: number;
  /** Value of the siege units that died (wood+food+iron+10xgold). */
  lossValue: number;
  /** Value of rebuilding the lowered levels (buildingCost): what the abandoned village's "owner" would have paid. */
  loweredValue: number;
  /** Day the first siege unit was trained (undefined = never). */
  firstTrainedDay?: number;
}

/** Siege caps for a computer player: units owned at once (home + away + queued) and units per training batch. */
const SIEGE_OWN_CAP: { logram: number; boulder: number } = { logram: 20, boulder: 12 };
const SIEGE_BATCH = 6;
/** A target with at least this Wall level can get a siege run (abandoned villages have Wall 0-4 by tier, so this is almost "any"). */
const SIEGE_MIN_WALL = 1;

/** The styles that attack (raider, balanced) add the siege prerequisites, research and a few units; the others stay as they are. */
function withSiege(style: StyleName, def: Style): Style {
  if (style !== 'raider' && style !== 'balanced') return def;
  // Raider: right after its Barracks 8 (it already has Drillyard 2); balanced: at the end of its list (Barracks 8, Drillyard 5).
  const order: Step[] = [...def.order];
  if (style === 'raider') order.splice(order.findIndex(([b, l]) => b === 'barracks' && l === 8) + 1, 0, ['drillyard', 3], ['drillyard', 5]);
  else order.push(['barracks', 8], ['drillyard', 5]);
  return {
    ...def,
    order,
    army: [...def.army, { unit: 'logram', weight: 6 }, { unit: 'boulder', weight: 4 }],
    research: [...def.research, 'logram', 'boulder'],
  };
}

// ---- Simulation of one style --------------------------------------------------------------------

interface Target {
  state: VillageState;
  tier: number;
  distance: number;
  /** Map position (the player's village is at HOME): terrain on the way decides the travel time. */
  pos: { x: number; y: number };
  /** False once the village was taken (it is then one of the player's villages). */
  alive: boolean;
}

/** One village of the simulated player. */
interface Vil {
  id: number;
  state: VillageState;
  pos: { x: number; y: number };
  trainCursor: number;
  how: 'home' | 'taken' | 'founded';
}

type Event =
  | { at: number; kind: 'battle'; from: number; target: number; units: Units; seed: number; travel: number }
  | { at: number; kind: 'return'; to: number; survivors: Units; loot: Resources }
  | { at: number; kind: 'strike'; from: number; target: number; units: Units; seed: number; travel: number }
  | { at: number; kind: 'hold'; from: number; target: number; occupiers: Units; travel: number }
  | { at: number; kind: 'found'; from: number; pos: { x: number; y: number }; units: Units; travel: number };

const TARGET_LAYOUT: Array<[number, number]> = [[1, 3], [1, 5], [2, 5], [2, 7], [3, 8], [3, 10], [4, 12], [5, 14]]; // [tier, tiles]
/**
 * The simulated village stands on a buildable tile of the default world whose surroundings are typical: the eight raid routes
 * below slow a foot army down by about 9% (the world-wide average for foot units is 9%, GAME_DESIGN 18.4a).
 */
export const DEFAULT_HOME = { x: -30, y: -10 };
/** Target i lies at its layout distance in its own direction (eight directions around home), so the terrain on the way varies. */
function targetPos(home: { x: number; y: number }, i: number, distance: number): { x: number; y: number } {
  const angle = 0.4 + (i * 2 * Math.PI) / TARGET_LAYOUT.length;
  return { x: home.x + Math.round(distance * Math.cos(angle)), y: home.y + Math.round(distance * Math.sin(angle)) };
}

function armyAttack(u: Units): number {
  return UNIT_IDS.reduce((a, id) => a + u[id] * UNITS[id].attack, 0);
}
function armyDefense(u: Units): number {
  return UNIT_IDS.reduce((a, id) => a + u[id] * (UNITS[id].defenseInfantry + UNITS[id].defenseCavalry) * 0.5, 0);
}
function addUnits(a: Units, b: Units): Units {
  const out = emptyUnits();
  for (const id of UNIT_IDS) out[id] = a[id] + b[id];
  return out;
}
function subUnits(a: Units, b: Units): Units {
  const out = emptyUnits();
  for (const id of UNIT_IDS) out[id] = Math.max(0, a[id] - b[id]);
  return out;
}
function queuedUnits(v: VillageState): Units {
  const out = emptyUnits();
  for (const q of [v.trainQueues.barracks, v.trainQueues.stables]) for (const j of q) out[j.unit] += j.count - j.done;
  return out;
}
const CHIEF_COST = UNITS.chieftain.cost;

function simulateStyle(style: StyleName, opt: SimOptions): StyleResult {
  const def = opt.siege ? withSiege(style, STYLE_DEFS[style]) : STYLE_DEFS[style];
  const siegeStats: SiegeStats = { trained: { logram: 0, boulder: 0 }, raids: 0, wins: 0, levelsLowered: 0, lossValue: 0, loweredValue: 0 };
  const s: WorldSettings = { ...DEFAULT_WORLD, speed: opt.speed };
  const styleSeed = hashSeed(opt.seed, STYLES.indexOf(style));
  const vils: Vil[] = [{ id: 0, state: createPlayerVillage(0), pos: opt.home, trainCursor: 0, how: 'home' }];
  const targets: Target[] = TARGET_LAYOUT.map(([tier, distance], i) => ({ state: createNpcVillage(tier, 0), tier, distance, pos: targetPos(opt.home, i, distance), alive: true }));
  const events: Event[] = [];
  const errors: string[] = [];
  const firstBuilding: StyleResult['firstBuilding'] = {};
  const firstUnit: StyleResult['firstUnit'] = {};
  const trained = emptyUnits();
  const raidByTier: RaidStat[] = [1, 2, 3, 4, 5].map((tier) => ({ tier, sent: 0, wins: 0, loot: 0, losses: 0 }));
  const hoursNearCap = emptyResources();
  const threats: StyleResult['threats'] = [];
  const rows: DayRow[] = [];
  const gains: VillageGain[] = [];
  const expansion: ExpansionStats = { chieftainsTrained: 0, strikes: 0, strikeWins: 0, chieftainsLost: 0, holdFails: 0, founds: 0, fallbacks: 0 };
  let raidLoot = 0;
  let raidLosses = 0;
  let raids = 0;
  let raidWins = 0;
  let raidSeq = 0;
  let strikeSeq = 0;
  let idleStart = 0;
  let longestIdle = 0;
  let idleStartHour = 0;
  let lateIdle = 0;
  let lateIdleStartHour = 0;
  let nextDay = 1;
  // Renown (GAME_DESIGN 18.2): total earned, spent = reserved for Chieftains (a Chieftain who dies on the way gives half back).
  let renownTotal = 0;
  let renownSpent = 0;
  /** Renown reserved for the Chieftain now outstanding (at most one at a time in the sim). */
  let chiefReserved = 0;
  /** Since when a Chieftain has been waiting at home for a target (ms), or -1. */
  let chiefWaitSince = -1;
  const renownSources: RenownSources = { buildings: 0, raids: 0, defence: 0, trickle: 0, feast: 0 };
  let feasts = 0;
  let renownAffordableHour: number | undefined;
  let bannerHallHour: number | undefined;
  let chieftainQueuedHour: number | undefined;
  /** Open pair windows of raw Renown: one per abandoned village ('t<i>') and one for the assumed enemy ('enemy'). */
  const pairs = new Map<string, { start: number; raw: number }>();
  const pairRaw = (key: string, now: number): number => {
    const w = pairs.get(key);
    return w && now < w.start + renownPairWindowMs(s) ? w.raw : 0;
  };
  const pairAdd = (key: string, now: number, counted: number): void => {
    if (!(counted > 0)) return;
    const w = pairs.get(key);
    if (w && now < w.start + renownPairWindowMs(s)) w.raw += counted;
    else pairs.set(key, { start: now, raw: counted });
  };
  const end = opt.days * 24 * HOUR;
  const threatTimes = [7, 14, 21, 28].filter((d) => d <= opt.days).map((d) => (d * 24 + 12) * HOUR);
  const eligibleFrom = protectionEndsAt(0, s);

  const sortEvents = (): void => {
    events.sort((a, b) => a.at - b.at);
  };
  const renownBalance = (): number => renownTotal - renownSpent;
  const levelWithQueue = (vil: Vil, b: BuildingId): number => vil.state.buildings[b] + vil.state.buildQueue.filter((j) => j.building === b).length;

  /** Chieftains alive, away or in training anywhere (each is a future village). */
  const outstanding = (): number => {
    let n = 0;
    for (const vil of vils) {
      n += vil.state.troops.chieftain + vil.state.away.chieftain;
      for (const j of vil.state.trainQueues.bannerhall) if (j.unit === 'chieftain') n += j.count - j.done;
    }
    return n;
  };
  const trainer = (): Vil | undefined => vils.find((x) => x.state.buildings.bannerhall >= 1 && !x.state.hearth);
  const chiefHolder = (): Vil | undefined => vils.find((x) => x.state.troops.chieftain >= 1);
  /** The village is the one that must now save up for the next Chieftain (Renown is there, nothing outstanding). */
  const chiefWanted = (vil: Vil): boolean => trainer() === vil && outstanding() === 0 && renownBalance() >= villageRenownPrice(vils.length, 0);
  const armyPop = (vil: Vil): number => {
    const all = addUnits(addUnits(vil.state.troops, vil.state.away), queuedUnits(vil.state));
    let pop = 0;
    // Siege units never go with a Chieftain (a taken village keeps its buildings), so they do not count as escort.
    for (const u of UNIT_IDS) if (UNITS[u].attack > 0 && !UNITS[u].siege) pop += all[u] * POP_PER_UNIT[u];
    return pop;
  };
  /**
   * A take style whose Renown is there first builds an escort big enough to hold the village (OCCUPIER_NEED population of
   * fighters): it stops raiding (raids burn the army) and trains as usual, then saves for the Chieftain.
   */
  const takePrep = (vil: Vil): boolean =>
    def.expand === 'take' &&
    vil === trainer() &&
    outstanding() === 0 &&
    renownBalance() >= villageRenownPrice(vils.length, 0) &&
    armyPop(vil) < OCCUPIER_NEED;
  const chiefSaving = (vil: Vil): boolean => chiefWanted(vil) && !takePrep(vil);

  /** Target village settled to `t`. */
  const targetAt = (i: number, t: number): VillageState => {
    const tg = targets[i] as Target;
    tg.state = settleVillage(tg.state, t, s);
    return tg.state;
  };

  /** Units walk back from tile `from` to village `to` and arrive after the real travel time. */
  const homeTrip = (to: Vil, from: { x: number; y: number }, at: number, units: Units, loot: Resources = emptyResources()): void => {
    if (totalUnits(units) <= 0 && value(loot) <= 0) return;
    events.push({ at: at + travelTimeMs(from, to.pos, units, s), kind: 'return', to: to.id, survivors: units, loot });
    sortEvents();
  };
  const refundLostChieftain = (): void => {
    renownSpent -= chieftainRefund(chiefReserved);
    chiefReserved = 0;
    expansion.chieftainsLost += 1;
  };

  /** Combat Renown for the attacker (abandoned villages have no owner: never eligible, they earn nothing). */
  const raidRenown = (r: ReturnType<typeof resolveBattle>, origin: VillageState, key: string, at: number): void => {
    for (const a of battleRenown({
      result: r,
      attacker: { eligible: true, points: villagePoints(origin) },
      // Abandoned villages are exempt from the size factor (docs/GAME_DESIGN.md 18.2): same points as the attacker.
      defender: { eligible: false, points: villagePoints(origin) },
      pairValue: () => pairRaw(key, at),
    })) {
      if (a.side !== 'attacker') continue;
      renownTotal += a.renown;
      renownSources.raids += a.renown;
      pairAdd(key, at, a.counted);
    }
  };

  const addVillage = (state: VillageState, pos: { x: number; y: number }, how: 'taken' | 'founded', at: number, tier?: number): void => {
    vils.push({ id: vils.length, state, pos, trainCursor: 0, how });
    gains.push({ hour: at / HOUR, route: how === 'taken' ? 'take' : 'found', points: villagePoints(state), ...(tier !== undefined ? { tier } : {}) });
  };

  const resolveEvent = (e: Event): void => {
    const origin = (id: number): Vil => vils[id] as Vil;
    if (e.kind === 'return') {
      const o = origin(e.to);
      o.state = applyReturn(o.state, e.survivors, e.loot, e.at, s);
      return;
    }
    if (e.kind === 'battle') {
      const o = origin(e.from);
      const tg = targets[e.target] as Target;
      if (!tg.alive || tg.state.hearth) {
        // Somebody else (the player's own strike) holds it now: the raiders turn back with nothing.
        homeTrip(o, tg.pos, e.at, e.units);
        return;
      }
      const def0 = targetAt(e.target, e.at);
      const withSiege = e.units.logram + e.units.boulder > 0;
      const r = resolveBattle({ attackerUnits: e.units, defender: def0, seed: e.seed, ...(withSiege ? { siegeTarget: 'wall' as BuildingId } : {}) });
      tg.state = applyBattleToDefender(def0, r);
      o.state = applyAttackerLosses(settleVillage(o.state, e.at, s), r.attackerLosses);
      raidRenown(r, o.state, `t${e.target}`, e.at);
      const stat = raidByTier[tg.tier - 1] as RaidStat;
      const lootVal = value(r.loot);
      let lossVal = 0;
      for (const id of UNIT_IDS) lossVal += r.attackerLosses[id] * value(UNITS[id].cost);
      if (withSiege) {
        siegeStats.raids += 1;
        if (r.attackerWon) siegeStats.wins += 1;
        for (const id of ['logram', 'boulder'] as const) siegeStats.lossValue += r.attackerLosses[id] * value(UNITS[id].cost);
        for (const h of r.siege ?? []) for (let lvl = h.from; lvl > h.to; lvl--) {
          siegeStats.levelsLowered += 1;
          siegeStats.loweredValue += value(buildingCost(h.building, lvl));
        }
      }
      stat.loot += lootVal;
      stat.losses += lossVal;
      raidLoot += lootVal;
      raidLosses += lossVal;
      if (r.attackerWon) {
        stat.wins += 1;
        raidWins += 1;
        homeTrip(o, tg.pos, e.at, r.attackerSurvivors, r.loot);
      }
      return;
    }
    if (e.kind === 'strike') {
      // Strike on an abandoned village: a won battle with a surviving Chieftain puts the hearth out; the survivors stay as occupiers.
      const o = origin(e.from);
      const tg = targets[e.target] as Target;
      if (!tg.alive || tg.state.hearth) {
        homeTrip(o, tg.pos, e.at, e.units);
        return;
      }
      const def0 = targetAt(e.target, e.at);
      const r = resolveBattle({ attackerUnits: e.units, defender: def0, seed: e.seed, noLoot: true });
      o.state = applyAttackerLosses(settleVillage(o.state, e.at, s), r.attackerLosses);
      tg.state = applyBattleToDefender(def0, r);
      raidRenown(r, o.state, `t${e.target}`, e.at);
      let lossVal = 0;
      for (const id of UNIT_IDS) lossVal += r.attackerLosses[id] * value(UNITS[id].cost);
      raidLosses += lossVal;
      (raidByTier[tg.tier - 1] as RaidStat).losses += lossVal;
      expansion.strikes += 1;
      const chk = checkStrike(r, r.attackerSurvivors, {
        abandoned: true,
        points: villagePoints(tg.state),
        now: e.at,
        ...(tg.state.lockUntil !== undefined ? { lockUntil: tg.state.lockUntil } : {}),
        ...(tg.state.protectedUntil !== undefined ? { protectedUntil: tg.state.protectedUntil } : {}),
      });
      if (!chk.ok) {
        if (r.attackerSurvivors.chieftain < 1) refundLostChieftain();
        homeTrip(o, tg.pos, e.at, r.attackerSurvivors);
        return;
      }
      expansion.strikeWins += 1;
      tg.state = applyStrike(tg.state, { claimBy: 0, now: e.at, settings: s, occupiers: r.attackerSurvivors });
      const due = holdDueAt(tg.state.hearth as NonNullable<VillageState['hearth']>, s);
      events.push({ at: due, kind: 'hold', from: e.from, target: e.target, occupiers: r.attackerSurvivors, travel: e.travel });
      sortEvents();
      return;
    }
    if (e.kind === 'hold') {
      const o = origin(e.from);
      const tg = targets[e.target] as Target;
      const hearth = tg.state.hearth;
      if (!hearth) return;
      const up = updateHold(hearth, occupierPopulation(e.occupiers), e.at, s);
      if (up.outcome === 'taken') {
        const oc = applyOwnerChange(tg.state, { newOwnerOccupiers: e.occupiers, now: up.at, settings: s });
        tg.alive = false;
        // The occupiers that moved in (and the used-up Chieftain) are no longer "away"; the rest walks home.
        o.state = applyAttackerLosses(settleVillage(o.state, e.at, s), subUnits(e.occupiers, oc.overflow));
        chiefReserved = 0; // the reserved Renown paid for this village
        addVillage(oc.state, tg.pos, 'taken', e.at, tg.tier);
        homeTrip(o, tg.pos, e.at, oc.overflow);
      } else {
        // The claim failed (occupiers under the minimum for too long): the hearth relights and everybody goes home.
        expansion.holdFails += 1;
        delete tg.state.hearth;
        homeTrip(o, tg.pos, e.at, e.occupiers);
      }
      return;
    }
    // found: the Chieftain reaches the tile and lights the new village's hearth.
    const o = origin(e.from);
    const occupied = new Set([...vils.map((x) => `${x.pos.x},${x.pos.y}`), ...targets.map((x) => `${x.pos.x},${x.pos.y}`)]);
    const ok = checkFoundTarget(e.pos, s, (x, y) => occupied.has(`${x},${y}`)).ok;
    if (!ok) {
      homeTrip(o, e.pos, e.at, e.units);
      return;
    }
    const made = createFoundedVillage(e.at, s, e.units);
    o.state = applyAttackerLosses(settleVillage(o.state, e.at, s), subUnits(e.units, made.overflow));
    chiefReserved = 0;
    expansion.founds += 1;
    addVillage(made.state, e.pos, 'founded', e.at);
    homeTrip(o, e.pos, e.at, made.overflow);
  };

  /** The building a village wants next: the first list entry below its target, then the lowest of the tail. */
  const wanted = (vil: Vil): { building: BuildingId; level: number } | undefined => {
    for (const [b, lvl] of def.order) if (levelWithQueue(vil, b) < lvl) return { building: b, level: levelWithQueue(vil, b) + 1 };
    const b = [...def.tail].sort((x, y) => levelWithQueue(vil, x) - levelWithQueue(vil, y))[0];
    return b ? { building: b, level: levelWithQueue(vil, b) + 1 } : undefined;
  };

  /** What blocks the next Chieftain besides money: a storehouse too small for his cost, or no population / food room. */
  const chiefBlock = (vil: Vil, t: number): BuildingId | undefined => {
    const cap = storageCap(vil.state);
    if (RESOURCE_IDS.some((id) => CHIEF_COST[id] > cap)) return 'storehouse';
    const c = checkTrain(vil.state, 'chieftain', 1, t, s);
    if (!c.ok && c.reason === 'population_full') return 'farm';
    return undefined;
  };

  const tryBuild = (vil: Vil, t: number): void => {
    // Strict list first; fix storage / population blocks on the way. A village that must save for a Chieftain only builds
    // what leaves his cost untouched (or the storehouse / farm he needs).
    const saving = chiefSaving(vil);
    let forced = false;
    let cur: BuildingId | undefined;
    if (saving) {
      cur = chiefBlock(vil, t);
      forced = cur !== undefined;
    }
    cur ??= wanted(vil)?.building;
    if (!cur) return;
    for (let guard = 0; guard < 4; guard++) {
      const c = checkBuild(vil.state, cur, t, s, QUEUE_LIMIT);
      if (c.ok) {
        if (saving && !forced) {
          const cost = buildingCost(cur, levelWithQueue(vil, cur) + 1);
          const need = emptyResources();
          for (const id of RESOURCE_IDS) need[id] = cost[id] + CHIEF_COST[id];
          if (!canAfford(vil.state.resources, need)) return;
        }
        vil.state = applyBuild(vil.state, cur, t, s, QUEUE_LIMIT);
        return;
      }
      if (c.reason === 'exceeds_storage' && cur !== 'storehouse') {
        cur = 'storehouse';
        forced = true;
      } else if (c.reason === 'population_full' && cur !== 'farm') {
        cur = 'farm';
        forced = true;
      } else if (c.reason === 'requirements_not_met') {
        const reqs: Partial<Record<BuildingId, number>> = BUILDINGS[cur].requires;
        const need: BuildingId | undefined = (Object.keys(reqs) as BuildingId[]).find((r) => vil.state.buildings[r] < (reqs[r] ?? 0));
        if (!need || need === cur) return;
        cur = need;
      } else return;
    }
  };

  /** Resources the next building would need (reserved from training). */
  const nextBuildCost = (vil: Vil): Resources => {
    const w = wanted(vil);
    return w && w.level <= BUILDINGS[w.building].maxLevel ? buildingCost(w.building, w.level) : emptyResources();
  };

  const tryTrain = (vil: Vil, t: number, day: number): void => {
    if (day < def.trainFromDay || def.army.length === 0) return;
    // Saving for a Chieftain: nothing is trained (the escort was built before, takePrep).
    const saving = chiefSaving(vil);
    if (saving) return;
    // Siege units only join the wheel once researched, so the wheel (and the early game) is the old one until then.
    const wheel = def.army.filter((a) => !UNITS[a.unit].siege || (vil.state.researched ?? []).includes(a.unit));
    const total = wheel.reduce((a, x) => a + x.weight, 0);
    // Pick a unit by cycling a weighted wheel, skipping units that are not trainable yet.
    for (let k = 0; k < wheel.length * 4; k++) {
      // The wheel only moves on when a batch was queued or the unit cannot be trained at all yet: otherwise the
      // cheapest unit always wins the race for scarce resources and a wanted unit (raider) starves (baseline bug).
      const pick = (vil.trainCursor * 37) % total;
      let acc = 0;
      let unit: UnitId = (wheel[0] as { unit: UnitId }).unit;
      for (const a of wheel) {
        acc += a.weight;
        if (pick < acc) {
          unit = a.unit;
          break;
        }
      }
      const building = UNITS[unit].building;
      const c1 = checkTrain(vil.state, unit, 1, t, s);
      if (!c1.ok && c1.reason === 'requirements_not_met') {
        vil.trainCursor++;
        continue;
      }
      if (UNITS[unit].siege) {
        // A player keeps only a few siege units: skip the wheel slot while enough are owned (home, away or queued).
        const owned = addUnits(addUnits(vil.state.troops, vil.state.away), queuedUnits(vil.state))[unit];
        if (owned >= SIEGE_OWN_CAP[unit as 'logram' | 'boulder']) {
          vil.trainCursor++;
          continue;
        }
      }
      if (vil.state.trainQueues[building].length >= 2) return;
      const reserve = nextBuildCost(vil);
      const spare = emptyResources();
      for (const id of RESOURCE_IDS) spare[id] = Math.max(0, vil.state.resources[id] - Math.max(reserve[id] * def.reserve, saving ? CHIEF_COST[id] : 0));
      // A sensible player never lets troops eat the food stock down to nothing: keep a quarter of the storehouse.
      spare.food = Math.max(0, spare.food - storageCap(vil.state) * 0.25);
      let n = UNITS[unit].siege ? SIEGE_BATCH : 40;
      for (const id of RESOURCE_IDS) if (UNITS[unit].cost[id] > 0) n = Math.min(n, Math.floor(spare[id] / UNITS[unit].cost[id]));
      while (n >= 1) {
        const c = checkTrain(vil.state, unit, n, t, s);
        if (c.ok) {
          vil.state = applyTrain(vil.state, unit, n, t, s);
          trained[unit] += n;
          if (unit === 'logram' || unit === 'boulder') {
            siegeStats.trained[unit] += n;
            siegeStats.firstTrainedDay ??= t / (24 * HOUR);
          }
          vil.trainCursor++;
          return;
        }
        if (c.reason !== 'population_full') break;
        n = Math.floor(n / 2);
      }
      return; // saving up for the picked unit
    }
  };

  const tryResearch = (vil: Vil, t: number): void => {
    for (const u of def.research) {
      if ((vil.state.researched ?? []).includes(u) || (vil.state.researchQueue ?? []).some((j) => j.unit === u)) continue;
      if (checkResearch(vil.state, u, t, s).ok) vil.state = applyResearch(vil.state, u, t, s);
      return;
    }
  };

  const tryRaid = (vil: Vil, t: number): void => {
    if (def.raiders.length === 0) return;
    // A Chieftain is waiting to strike from this village: keep the army at home as his escort.
    if (def.expand === 'take' && ((outstanding() > 0 && (chiefHolder() === vil || trainer() === vil)) || takePrep(vil))) return;
    const send = emptyUnits();
    for (const u of def.raiders) send[u] = Math.max(0, vil.state.troops[u] - def.keepHome);
    if (totalUnits(send) < 5) return;
    // Siege units at home go along on fortified targets (wall >= SIEGE_MIN_WALL) as a second candidate army; the slow siege
    // units set the pace of the whole army (travelTimeMs takes the slowest unit).
    const siegeHome = { logram: vil.state.troops.logram, boulder: vil.state.troops.boulder };
    const haveSiege = opt.siege === true && siegeHome.logram + siegeHome.boulder > 0;
    let best = -1;
    let bestScore = 0;
    let bestSend = send;
    let siegeBest = -1;
    let siegeScore = 0;
    let siegeSend = send;    for (let i = 0; i < targets.length; i++) {
      const tg = targets[i] as Target;
      if (!tg.alive || tg.state.hearth) continue;
      const st = targetAt(i, t);
      const candidates: Units[] = [send];
      if (haveSiege && st.buildings.wall >= SIEGE_MIN_WALL) candidates.push({ ...send, ...siegeHome });
      for (const army of candidates) {
        const travel = travelTimeMs(vil.pos, tg.pos, army, s);
        // Preview with a different seed: a player judges by scouting, not by knowing the luck.
        const arrival = settleVillage(st, t + travel, s);
        const siegeArmy = army.logram + army.boulder > 0;
        const pre = resolveBattle({
          attackerUnits: army,
          defender: arrival,
          seed: hashSeed(styleSeed, 999, raidSeq),
          ...(siegeArmy ? { siegeTarget: 'wall' as BuildingId } : {}),
        });
        // A won battle costs the winner (defence / attack)^1.5 of the army, so a thin win loses most of it. A sensible
        // player judges by NET profit (loot minus the value of the units that die) and keeps a luck margin.
        if (!(pre.attackPower > pre.defensePower * 1.25)) continue;
        let lossVal = 0;
        for (const u of UNIT_IDS) lossVal += pre.attackerLosses[u] * value(UNITS[u].cost);
        const net = value(pre.loot) - lossVal;
        if (siegeArmy) {
          // A siege run is worth the Wall levels it takes down at what they cost to build (the next raid there is easier), but only
          // when the preview really lowers one: a thin win leaves too few survivors. It beats the loot raids when it qualifies.
          let lowered = 0;
          for (const h of pre.siege ?? []) for (let lvl = h.from; lvl > h.to; lvl--) lowered += value(buildingCost(h.building, lvl));
          if (lowered > 0 && lowered / travel > siegeScore) {
            siegeBest = i;
            siegeScore = lowered / travel;
            siegeSend = army;
          }
          continue;
        }
        const score = net / (2 * travel);
        if (net > 0 && score > bestScore) {
          best = i;
          bestScore = score;
          bestSend = army;
        }
      }
    }
    if (siegeBest >= 0) {
      best = siegeBest;
      bestSend = siegeSend;
    }
    if (best < 0) return;
    const tg = targets[best] as Target;
    const travel = travelTimeMs(vil.pos, tg.pos, bestSend, s);
    vil.state = applySend(vil.state, bestSend, t, s);
    raids += 1;
    (raidByTier[tg.tier - 1] as RaidStat).sent += 1;
    events.push({ at: t + travel, kind: 'battle', from: vil.id, target: best, units: bestSend, seed: hashSeed(styleSeed, raidSeq++), travel });
    sortEvents();
  };

  /**
   * Feast (Banner Hall level 1+): turn resources into Renown when storage is nearly full or nothing else is worth doing,
   * never touching what the next building needs (scaled by the style's reserve) or, while saving, the Chieftain's cost.
   */
  const tryFeast = (vil: Vil, t: number): void => {
    if (vil.state.buildings.bannerhall < 1) return;
    const left = feastAllowance(vil.state, t, s).left;
    if (left < 1) return;
    const cap = storageCap(vil.state);
    const nearCap = RESOURCE_IDS.some((id) => FEAST_COST[id] > 0 && vil.state.resources[id] >= cap * 0.5);
    if (!nearCap && hasAction(vil, t, true)) return;
    const reserve = nextBuildCost(vil);
    const saving = chiefSaving(vil);
    let n = left;
    for (const id of RESOURCE_IDS) {
      if (FEAST_COST[id] > 0) n = Math.min(n, Math.floor((vil.state.resources[id] - Math.max(reserve[id] * def.reserve, saving ? CHIEF_COST[id] : 0)) / FEAST_COST[id]));
    }
    if (n < 1 || !checkFeast(vil.state, n, t, s).ok) return;
    const r = applyFeast(vil.state, n, t, s);
    vil.state = r.state;
    renownTotal += r.renown;
    renownSources.feast += r.renown;
    feasts += n;
  };

  /** Train the next Chieftain: Renown reserved (leaves the balance), resources paid, 6 h in the Banner Hall. One at a time. */
  const tryChieftain = (vil: Vil, t: number): void => {
    if (trainer() !== vil || outstanding() > 0) return;
    const price = villageRenownPrice(vils.length, 0);
    if (renownBalance() < price) return;
    if (!checkTrain(vil.state, 'chieftain', 1, t, s).ok) return;
    vil.state = applyTrain(vil.state, 'chieftain', 1, t, s);
    renownSpent += price;
    chiefReserved = price;
    expansion.chieftainsTrained += 1;
    chieftainQueuedHour ??= t / HOUR;
  };

  /** A free, buildable tile as near as possible to the Chieftain's village (checkFoundTarget, the server's rule). */
  const findFoundTile = (from: Vil): { x: number; y: number } | undefined => {
    const occupied = new Set([...vils.map((x) => `${x.pos.x},${x.pos.y}`), ...targets.map((x) => `${x.pos.x},${x.pos.y}`)]);
    const seen = new Set<string>();
    for (let d = 4; d <= 24; d++) {
      for (let k = 0; k < 24; k++) {
        const angle = 0.3 + (k * 2 * Math.PI) / 24;
        const p = { x: from.pos.x + Math.round(d * Math.cos(angle)), y: from.pos.y + Math.round(d * Math.sin(angle)) };
        const key = `${p.x},${p.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (checkFoundTarget(p, s, (x, y) => occupied.has(`${x},${y}`)).ok) return p;
      }
    }
    return undefined;
  };

  /** The Chieftain is home: take the best abandoned village he can win (take styles) or found a new one. */
  const tryExpand = (t: number): void => {
    const holder = chiefHolder();
    if (!holder) {
      chiefWaitSince = -1;
      return;
    }
    if (chiefWaitSince < 0) chiefWaitSince = t;
    if (def.expand === 'take') {
      // Siege units stay home on a strike: a taken village keeps all its buildings, so lowering them would only hurt the new owner.
      const send = { ...holder.state.troops, chieftain: 1, pathfinder: 0, logram: 0, boulder: 0 };
      let best = -1;
      let bestPoints = -1;
      let bestTravel = 0;
      for (let i = 0; i < targets.length; i++) {
        const tg = targets[i] as Target;
        if (!tg.alive || tg.state.hearth || isStrikeBlocked(tg.state, t)) continue;
        const travel = travelTimeMs(holder.pos, tg.pos, send, s);
        const arrival = settleVillage(targetAt(i, t), t + travel, s);
        const pre = resolveBattle({ attackerUnits: send, defender: arrival, seed: hashSeed(styleSeed, 555, strikeSeq), noLoot: true });
        // Needs the usual margin, a surviving Chieftain and enough survivors to keep the hold clock running.
        if (!(pre.attackPower > pre.defensePower * 1.25)) continue;
        if (pre.attackerSurvivors.chieftain < 1 || occupierPopulation(pre.attackerSurvivors) < HOLD_MIN_POPULATION) continue;
        const pts = villagePoints(arrival);
        if (pts > bestPoints || (pts === bestPoints && travel < bestTravel)) {
          best = i;
          bestPoints = pts;
          bestTravel = travel;
        }
      }
      if (best >= 0) {
        holder.state = applySend(holder.state, send, t, s);
        events.push({ at: t + bestTravel, kind: 'strike', from: holder.id, target: best, units: send, seed: hashSeed(styleSeed, 556, strikeSeq++), travel: bestTravel });
        sortEvents();
        chiefWaitSince = -1;
        return;
      }
      if (t - chiefWaitSince < TAKE_PATIENCE_HOURS * HOUR) return;
      expansion.fallbacks += 1;
    }
    const pos = findFoundTile(holder);
    if (!pos) return;
    // Chieftain + a handful of defenders as the new village's first garrison.
    const send = emptyUnits();
    send.chieftain = 1;
    let room = FOUND_ESCORT;
    for (const u of ['pikeman', 'guard', 'raider'] as UnitId[]) {
      const n = Math.min(holder.state.troops[u], room);
      send[u] = n;
      room -= n;
    }
    const travel = travelTimeMs(holder.pos, pos, send, s);
    holder.state = applySend(holder.state, send, t, s);
    events.push({ at: t + travel, kind: 'found', from: holder.id, pos, units: send, travel });
    sortEvents();
    chiefWaitSince = -1;
  };

  /** Is there a worthwhile move for the player right now in this village? (a build, a batch of >= 10 units, a research, a Feast, a Chieftain) */
  const hasAction = (vil: Vil, t: number, skipFeast = false): boolean => {
    const v = vil.state;
    if (!skipFeast && v.buildings.bannerhall >= 1 && checkFeast(v, 1, t, s).ok) return true;
    for (const b of BUILDING_IDS) if (checkBuild(v, b, t, s, QUEUE_LIMIT).ok) return true;
    for (const u of UNIT_IDS) {
      if (UNITS[u].attack <= 0 && UNITS[u].defenseInfantry <= 2) continue; // scouts alone are not a plan
      if (u === 'chieftain') {
        if (trainer() === vil && outstanding() === 0 && renownBalance() >= villageRenownPrice(vils.length, 0) && checkTrain(v, u, 1, t, s).ok) return true;
        continue;
      }
      if (checkTrain(v, u, 10, t, s).ok) return true;
    }
    for (const u of UNIT_IDS) if (UNITS[u].research && checkResearch(v, u, t, s).ok) return true;
    return false;
  };
  const anyAction = (t: number): boolean => vils.some((vil) => hasAction(vil, t));

  for (let t = 0; t <= end; t += STEP_MS) {
    while (events.length > 0 && (events[0] as Event).at <= t) resolveEvent(events.shift() as Event);
    for (const th of def.enemyRaids ? threatTimes : []) {
      if (th > t - STEP_MS && th <= t) {
        const day = Math.floor(th / (24 * HOUR));
        const raiders = day * 4;
        // The assumed enemy hits every village that is not under founding protection (4 x day raiders each).
        for (const vil of vils) {
          if (isAttackBlocked(vil.state, th) || vil.state.hearth) continue;
          vil.state = settleVillage(vil.state, th, s);
          const atk = emptyUnits();
          atk.raider = raiders;
          const r = resolveBattle({ attackerUnits: atk, defender: vil.state, seed: hashSeed(styleSeed, 777, day, vil.id) });
          const before = totalUnits(vil.state.troops);
          // The enemy is a real player of about our size: the defender earns Renown for the raiders that die (pair 'enemy').
          const points = villagePoints(vil.state);
          for (const a of battleRenown({
            result: r,
            attacker: { eligible: true, points },
            defender: { eligible: true, points },
            pairValue: () => pairRaw('enemy', th),
          })) {
            if (a.side !== 'defender') continue;
            renownTotal += a.renown;
            renownSources.defence += a.renown;
            pairAdd('enemy', th, a.counted);
          }
          vil.state = applyBattleToDefender(vil.state, r);
          threats.push({ day, raiders, defended: !r.attackerWon, lootLost: num(value(r.loot)), troopsLost: before - totalUnits(vil.state.troops) });
        }
      }
    }
    try {
      const day = t / (24 * HOUR);
      for (const vil of vils.slice()) {
        vil.state = settleVillage(vil.state, t, s);
        // Renown from finished building levels (paid once per level) and the defender trickle (nothing during protection).
        const br = collectBuildRenown(vil.state);
        vil.state = br.state;
        renownTotal += br.renown;
        renownSources.buildings += br.renown;
        const dr = collectDefenderRenown(vil.state, eligibleFrom, s);
        vil.state = dr.state;
        renownTotal += dr.renown;
        renownSources.trickle += dr.renown;
      }
      const home = (vils[0] as Vil).state;
      if (bannerHallHour === undefined && vils.some((x) => x.state.buildings.bannerhall >= 1)) bannerHallHour = t / HOUR;
      if (renownAffordableHour === undefined && renownTotal >= villageRenownCost(1)) renownAffordableHour = t / HOUR;
      // Affordability (first village only): first time requirements are met and one level / one unit can be paid.
      for (const b of BUILDING_IDS) {
        if (firstBuilding[b] !== undefined) continue;
        const next = home.buildings[b] + 1;
        const reqOk = (Object.keys(BUILDINGS[b].requires) as BuildingId[]).every((r) => home.buildings[r] >= (BUILDINGS[b].requires[r] ?? 0));
        if (reqOk && next <= BUILDINGS[b].maxLevel && canAfford(home.resources, buildingCost(b, next)) && buildingCost(b, next).wood <= storageCap(home)) {
          firstBuilding[b] = t / HOUR;
        }
      }
      for (const u of UNIT_IDS) {
        if (firstUnit[u] !== undefined) continue;
        const d = UNITS[u];
        const reqOk = (Object.keys(d.requires) as BuildingId[]).every((r) => home.buildings[r] >= (d.requires[r] ?? 0));
        if (reqOk && canAfford(home.resources, d.cost)) firstUnit[u] = t / HOUR;
      }
      // Pile-up: hours spent near a full storehouse.
      const cap = storageCap(home);
      for (const id of RESOURCE_IDS) if (home.resources[id] >= cap * 0.9) hoursNearCap[id] += STEP_MS / HOUR;

      for (const vil of vils.slice()) {
        tryChieftain(vil, t);
        tryBuild(vil, t);
        tryResearch(vil, t);
        tryTrain(vil, t, day);
        tryRaid(vil, t);
        tryFeast(vil, t);
      }
      tryExpand(t);

      // Dead time: nothing worthwhile to do in any village.
      if (anyAction(t)) {
        const gap = (t - idleStart) / HOUR;
        if (gap > longestIdle) {
          longestIdle = gap;
          idleStartHour = idleStart / HOUR;
        }
        if (idleStart >= LATE_DAY * 24 * HOUR && gap > lateIdle) {
          lateIdle = gap;
          lateIdleStartHour = idleStart / HOUR;
        }
        idleStart = t;
      }
    } catch (err) {
      errors.push(`t=${(t / HOUR).toFixed(1)}h: ${err instanceof Error ? err.stack?.split('\n').slice(0, 3).join(' | ') ?? err.message : String(err)}`);
    }
    if (t === nextDay * 24 * HOUR - STEP_MS) {
      // Daily snapshot at the last step of each day (all villages together).
      const curs = vils.map((x) => settleVillage(x.state, t, s));
      let army = emptyUnits();
      const res = emptyResources();
      let sum = 0;
      let points = 0;
      for (const cur of curs) {
        army = addUnits(addUnits(addUnits(army, cur.troops), cur.away), queuedUnits(cur));
        for (const id of RESOURCE_IDS) res[id] += cur.resources[id];
        for (const b of BUILDING_IDS) sum += cur.buildings[b];
        points += villagePoints(cur);
      }
      const levels: Partial<Record<BuildingId, number>> = {};
      for (const b of BUILDING_IDS) levels[b] = (curs[0] as VillageState).buildings[b];
      rows.push({
        day: nextDay,
        resources: res,
        buildings: levels,
        levelSum: sum,
        points,
        villages: curs.length,
        army,
        armySize: totalUnits(army),
        attack: armyAttack(army),
        defense: armyDefense(army),
        raidLoot: num(raidLoot),
        raidLosses: num(raidLosses),
        raids,
        raidWins,
        renownTotal: Math.floor(renownTotal),
        renownBalance: Math.floor(renownTotal - renownSpent),
      });
      nextDay += 1;
    }
  }
  const lastGap = (end - idleStart) / HOUR;
  if (lastGap > longestIdle) {
    longestIdle = lastGap;
    idleStartHour = idleStart / HOUR;
  }
  if (idleStart >= LATE_DAY * 24 * HOUR && lastGap > lateIdle) {
    lateIdle = lastGap;
    lateIdleStartHour = idleStart / HOUR;
  }
  const finals = vils.map((x) => villagePoints(settleVillage(x.state, end, s)));
  return {
    style,
    rows,
    firstBuilding,
    firstUnit,
    trained,
    raidByTier,
    longestIdleHours: longestIdle,
    idleStartHour,
    lateIdleHours: lateIdle,
    lateIdleStartHour,
    hoursNearCap,
    finalPoints: finals.reduce((a, b) => a + b, 0),
    threats,
    errors,
    renownTotal: Math.floor(renownTotal),
    renownSpent: Math.floor(renownSpent),
    renownSources: {
      buildings: Math.floor(renownSources.buildings),
      raids: Math.floor(renownSources.raids),
      defence: Math.floor(renownSources.defence),
      trickle: Math.floor(renownSources.trickle),
      feast: Math.floor(renownSources.feast),
    },
    feasts,
    ...(renownAffordableHour !== undefined ? { renownAffordableHour } : {}),
    ...(bannerHallHour !== undefined ? { bannerHallHour } : {}),
    ...(renownAffordableHour !== undefined && bannerHallHour !== undefined ? { secondVillageHour: Math.max(renownAffordableHour, bannerHallHour) } : {}),
    ...(chieftainQueuedHour !== undefined ? { chieftainQueuedHour } : {}),
    gains,
    expansion,
    villages: vils.length,
    villagePointsEach: finals,
    ...(opt.siege ? { siege: siegeStats } : {}),
  };
}

// ---- Findings -----------------------------------------------------------------------------------

export interface SimReport {
  options: SimOptions;
  results: StyleResult[];
  flags: string[];
}

export function runSimulation(options: Partial<SimOptions> = {}): SimReport {
  const opt: SimOptions = { days: 30, speed: 1, seed: 20261104, home: DEFAULT_HOME, ...options };
  const results = STYLES.map((st) => simulateStyle(st, opt));
  return { options: opt, results, flags: findProblems(results, opt) };
}

/**
 * Overall progress in "points": village points of ALL villages (the ranking) + 2 per Renown earned (Renown buys villages) + 1 per
 * 100 resources of troops alive or in training + 1 per 100 resources of net raid profit. (Before step 1 it was points +
 * 0.5 per unit + raid profit / 100, which let a pure builder win by 10x because army and Renown did not count.)
 */
function score(r: StyleResult): number {
  const last = r.rows[r.rows.length - 1];
  if (!last) return 0;
  let troops = 0;
  for (const u of UNIT_IDS) troops += last.army[u] * value(UNITS[u].cost);
  return last.points + 2 * r.renownTotal + troops / 100 + (last.raidLoot - last.raidLosses) / 100;
}

function findProblems(results: StyleResult[], opt: SimOptions): string[] {
  const flags: string[] = [];
  for (const r of results) for (const e of r.errors.slice(0, 3)) flags.push(`ERROR ${r.style}: ${e}`);

  const ranked = [...results].sort((a, b) => score(b) - score(a));
  const [top, second] = ranked as [StyleResult, StyleResult];
  if (score(top) > score(second) * 1.5) flags.push(`DOMINANT STYLE: ${top.style} scores ${num(score(top))} vs runner-up ${second.style} ${num(score(second))} (> 1.5x).`);

  for (const r of results) {
    if (r.longestIdleHours > 8) flags.push(`DEAD PERIOD: ${r.style} had nothing worthwhile to do for ${r.longestIdleHours.toFixed(1)} h (from hour ${num(r.idleStartHour)}).`);
    const days = opt.days * 24;
    for (const id of RESOURCE_IDS) {
      if (r.hoursNearCap[id] > days * 0.25) flags.push(`PILE-UP: ${r.style} sat at >= 90% storage in ${id} for ${num(r.hoursNearCap[id])} h of ${days} h.`);
    }
    const lootAll = r.raidByTier.reduce((a, x) => a + x.loot, 0);
    const lossAll = r.raidByTier.reduce((a, x) => a + x.losses, 0);
    if (lossAll > lootAll && lossAll > 0) flags.push(`LOSING RAIDS: ${r.style} lost ${num(lossAll)} in units for ${num(lootAll)} loot.`);
    for (const t of r.raidByTier) {
      if (t.sent >= 3 && t.losses >= t.loot) flags.push(`RAIDS COST MORE THAN THEY BRING: ${r.style}, tier ${t.tier} villages: ${t.sent} raids, loot ${num(t.loot)}, losses ${num(t.losses)}.`);
      if (t.sent >= 10 && t.losses === 0) flags.push(`RISK-FREE RAIDING: ${r.style}, tier ${t.tier}: ${t.sent} raids, no losses, ${num(t.loot)} loot.`);
    }
  }
  for (const u of UNIT_IDS) {
    const n = results.reduce((a, r) => a + r.trained[u], 0);
    const reach = results.map((r) => r.firstUnit[u]).filter((x): x is number => x !== undefined);
    if (n === 0 && u !== 'chieftain') {
      const when = reach.length > 0 ? `affordable from hour ${num(Math.min(...reach))} but never trained` : `never even affordable within ${opt.days} days`;
      flags.push(`UNUSED UNIT: ${UNITS[u].name} — nobody trained one (${when}).`);
    }
  }
  const raiderStyle = results.find((r) => r.style === 'raider');
  const builder = results.find((r) => r.style === 'builder');
  if (raiderStyle && builder) {
    const a = raiderStyle.rows[raiderStyle.rows.length - 1];
    const b = builder.rows[builder.rows.length - 1];
    if (a && b && a.levelSum >= b.levelSum * 0.9 && a.raidLoot - a.raidLosses > 0) flags.push('RAIDING IS FREE: the raider style kept up with the builder on buildings while also earning raid loot.');
  }
  return flags;
}

// ---- Output -------------------------------------------------------------------------------------

const DAYS_SHOWN = [1, 2, 3, 5, 7, 10, 14, 21, 30];

function fmtHour(h: number | undefined): string {
  if (h === undefined) return 'never';
  return h < 48 ? `${h.toFixed(1)} h` : `day ${(h / 24).toFixed(1)}`;
}

function fmtDay(h: number | undefined): string {
  return h === undefined ? 'not within run' : (h / 24).toFixed(1);
}

function formatSiegeStats(g: SiegeStats): string {
  if (g.firstTrainedDay === undefined) return 'Siege: switched on, but no siege unit was trained within the run.';
  return `Siege: trained ${g.trained.logram} Log Rams + ${g.trained.boulder} Boulder Slings (first on day ${g.firstTrainedDay.toFixed(1)}); ${g.raids} raids carried siege (${g.wins} won), ${g.levelsLowered} levels lowered (rebuild value ${num(g.loweredValue)}), siege units lost worth ${num(g.lossValue)}.`;
}

/** Side-by-side of a run without and with siege units (same seed, same options): what siege costs and brings the sim players. */
export function formatSiegeComparison(off: SimReport, on: SimReport): string {
  const out: string[] = ['## Computer players with and without siege units (same seed)', ''];
  out.push('| style | points day end (off / on) | villages (off / on) | raid loot - losses (off / on) | idle h (off / on) | Rams + Slings trained | first siege unit | siege raids (won) | levels lowered | siege units lost (value) |');
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  off.results.forEach((a, i) => {
    const b = on.results[i] as StyleResult;
    const la = a.rows[a.rows.length - 1];
    const lb = b.rows[b.rows.length - 1];
    const net = (r: DayRow | undefined): number => (r ? r.raidLoot - r.raidLosses : 0);
    const g = b.siege;
    out.push(
      `| ${a.style} | ${a.finalPoints} / ${b.finalPoints} | ${a.villages} / ${b.villages} | ${num(net(la))} / ${num(net(lb))} | ${a.longestIdleHours.toFixed(1)} / ${b.longestIdleHours.toFixed(1)} | ${g ? `${g.trained.logram} + ${g.trained.boulder}` : '-'} | ${g?.firstTrainedDay !== undefined ? `day ${g.firstTrainedDay.toFixed(1)}` : 'never'} | ${g ? `${g.raids} (${g.wins})` : '-'} | ${g ? g.levelsLowered : '-'} | ${g ? num(g.lossValue) : '-'} |`,
    );
  });
  out.push('');
  return out.join('\n');
}

export function formatReport(rep: SimReport, full = false): string {
  const out: string[] = [];
  out.push(`# Balance simulation — ${rep.options.days} days, speed ${rep.options.speed}, seed ${rep.options.seed}`, '');
  for (const r of rep.results) {
    out.push(`## ${r.style}`, '');
    out.push('| day | wood | food | iron | gold | villages | bldg lvls (all) | points | army | attack | defense | raid loot | raid losses | raids (won) | renown total / balance |');
    out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const row of r.rows) {
      if (!full && !DAYS_SHOWN.includes(row.day) && row.day !== rep.options.days) continue;
      const k = row.buildings;
      out.push(
        `| ${row.day} | ${num(row.resources.wood)} | ${num(row.resources.food)} | ${num(row.resources.iron)} | ${num(row.resources.gold)} | ${row.villages} | ${row.levelSum} (home: hall ${k.hall} farm ${k.farm} barr ${k.barracks}) | ${row.points} | ${row.armySize} | ${num(row.attack)} | ${num(row.defense)} | ${row.raidLoot} | ${row.raidLosses} | ${row.raids} (${row.raidWins}) | ${row.renownTotal} / ${row.renownBalance} |`,
      );
    }
    out.push('');
    const tiers = r.raidByTier.filter((t) => t.sent > 0).map((t) => `T${t.tier}: ${t.sent} raids, ${t.wins} won, loot ${num(t.loot)}, losses ${num(t.losses)}`);
    if (tiers.length > 0) out.push(`Raids by target tier — ${tiers.join('; ')}`, '');
    out.push(`Trained: ${UNIT_IDS.filter((u) => r.trained[u] > 0).map((u) => `${u} ${r.trained[u]}`).join(', ') || 'nothing'}. Longest idle stretch (nothing worthwhile to do in any village): ${r.longestIdleHours.toFixed(1)} h (from hour ${num(r.idleStartHour)}); starting from day ${LATE_DAY} on: ${r.lateIdleHours.toFixed(1)} h.`);
    out.push(`Enemy raids (assumed, day x4 raiders on every unprotected village): ${r.threats.map((t) => `d${t.day}: ${t.raiders} raiders ${t.defended ? 'held' : 'broke through, lost ' + t.lootLost}`).join('; ') || 'none'}.`);
    const src = r.renownSources;
    out.push(`Renown ${r.renownTotal} earned, ${r.renownSpent} reserved for Chieftains (buildings ${src.buildings}, raids ${src.raids}, defence kills ${src.defence}, defender trickle ${src.trickle}, Feast ${src.feast} from ${r.feasts} Feasts).`);
    const x = r.expansion;
    out.push(`Villages: ${r.villages} at the end (points each: ${r.villagePointsEach.join(', ')}). Gains: ${r.gains.map((g) => `${g.route === 'take' ? `taken (tier ${g.tier})` : 'founded'} on day ${(g.hour / 24).toFixed(1)} with ${g.points} points`).join('; ') || 'none'}. Chieftains ${x.chieftainsTrained} trained, strikes ${x.strikeWins}/${x.strikes} won, lost ${x.chieftainsLost}, hold failed ${x.holdFails}, founded ${x.founds}, waited and fell back to founding ${x.fallbacks}.`);
    if (r.siege) out.push(formatSiegeStats(r.siege));
    out.push('');
  }
  out.push('## Renown pace and several villages: when does the 2nd village come? (days since start)', '');
  out.push(`| | ${rep.results.map((r) => r.style).join(' | ')} |`, `|---|${rep.results.map(() => '---').join('|')}|`);
  out.push(`| Renown earned reaches ${villageRenownCost(1)} (2nd village price) | ${rep.results.map((r) => fmtDay(r.renownAffordableHour)).join(' | ')} |`);
  out.push(`| Banner Hall level 1 finished (Chieftain needs it) | ${rep.results.map((r) => fmtDay(r.bannerHallHour)).join(' | ')} |`);
  out.push(`| real pace: the later of both (Chieftain could be reserved; the pace measured before step 2) | ${rep.results.map((r) => fmtDay(r.secondVillageHour)).join(' | ')} |`);
  out.push(`| Chieftain queued (Renown reserved, resources paid) | ${rep.results.map((r) => fmtDay(r.chieftainQueuedHour)).join(' | ')} |`);
  out.push(`| **2nd village is the player's** | ${rep.results.map((r) => fmtDay(r.gains[0] ? r.gains[0].hour : undefined)).join(' | ')} |`);
  out.push(`| route of the 2nd village | ${rep.results.map((r) => (r.gains[0] ? (r.gains[0].route === 'take' ? `taken, tier ${r.gains[0].tier}` : 'founded') : '-')).join(' | ')} |`);
  out.push(`| 3rd village | ${rep.results.map((r) => fmtDay(r.gains[1] ? r.gains[1].hour : undefined)).join(' | ')} |`);
  out.push(`| villages at the end | ${rep.results.map((r) => r.villages).join(' | ')} |`);
  out.push(`| points at the end, all villages | ${rep.results.map((r) => r.finalPoints).join(' | ')} |`);
  out.push(`| longest idle stretch, whole run (target < 8 h) | ${rep.results.map((r) => `${r.longestIdleHours.toFixed(1)} h`).join(' | ')} |`);
  out.push(`| longest idle stretch starting after day ${LATE_DAY} | ${rep.results.map((r) => `${r.lateIdleHours.toFixed(1)} h`).join(' | ')} |`, '');
  out.push(`Score (points of all villages + 2 x Renown earned + troops/100 + net raid/100): ${rep.results.map((r) => `${r.style} ${num(score(r))}`).join(', ')}.`, '');
  out.push(`## Raid routes from the village at ${rep.options.home.x}|${rep.options.home.y} (10 Raiders; terrain from the world seed, GAME_DESIGN 18.4a)`, '');
  out.push('| target | tier | tiles | on flat ground | with terrain | slower by |', '|---|---|---|---|---|---|');
  const probe = { ...emptyUnits(), raider: 10 };
  const routeWorld: WorldSettings = { ...DEFAULT_WORLD, speed: rep.options.speed };
  TARGET_LAYOUT.forEach(([tier, tiles], i) => {
    const to = targetPos(rep.options.home, i, tiles);
    const p = travelPreview(rep.options.home, to, probe, routeWorld);
    out.push(`| ${to.x}\\|${to.y} | ${tier} | ${p.route.length.toFixed(1)} | ${(p.flatMs / 60_000).toFixed(0)} min | ${(p.ms / 60_000).toFixed(0)} min | ${((p.ms / p.flatMs - 1) * 100).toFixed(0)}% |`);
  });
  out.push('');
  out.push('## First affordable in the first village (hours / days since start, own economy)', '');
  out.push(`| item | ${rep.results.map((r) => r.style).join(' | ')} |`, `|---|${rep.results.map(() => '---').join('|')}|`);
  for (const b of BUILDING_IDS) out.push(`| building ${b} (next level) | ${rep.results.map((r) => fmtHour(r.firstBuilding[b])).join(' | ')} |`);
  for (const u of UNIT_IDS) out.push(`| unit ${u} | ${rep.results.map((r) => fmtHour(r.firstUnit[u])).join(' | ')} |`);
  out.push('', '## Unit value (static)', '', '| unit | attack/cost | defense/cost (avg) | carry/cost | pop | building |', '|---|---|---|---|---|---|');
  for (const u of UNIT_IDS) {
    const d = UNITS[u];
    const c = d.cost.wood + d.cost.food + d.cost.iron + d.cost.gold * 10;
    out.push(`| ${u} | ${(d.attack / c).toFixed(3)} | ${(((d.defenseInfantry + d.defenseCavalry) / 2) / c).toFixed(3)} | ${(d.carry / c).toFixed(3)} | ${POP_PER_UNIT[u]} | ${d.requires.stables ? 'stables' : 'barracks'} |`);
  }
  out.push('', '## Flags', '');
  if (rep.flags.length === 0) out.push('None.');
  for (const f of rep.flags) out.push(`- ${f}`);
  out.push(
    '',
    '## Model',
    '',
    '- 10-minute decision steps, free-player queues (2 builds, 2 batches per training building). Real engine calls only; no server.',
    '- 8 abandoned villages (tiers 1-5, 3-14 tiles away) per style; the garrison never refills (what a raid kills stays dead; only buildings grow) and loot is always full: min(what the survivors carry, the stock above the Vault), however often the same village is raided (rules of 2026-11-05).',
    '- Loot and losses valued wood+food+iron+10xgold. Troops eat no food (no upkeep); travel idle time and Drillyard ranks are not valued.',
    '- Enemy raiders hit every village that is not inside founding protection on days 7, 14, 21, 28 (4 x day raiders each) to give defence something to do; the turtle is never attacked (pure defender).',
    '- Raids pick the target with the best NET profit per travel time (loot minus the value of the units that die), need attack >= 1.25 x defence in a preview with another seed, and send all raiders (a won battle costs the winner (defence/attack)^1.5 of its army, so thin wins are never worth it).',
    '- Renown (engine renown.ts): building levels pay once per village and level after each settle (collectBuildRenown; a taken village pays nothing for the levels it came with); raid Renown through battleRenown for raids on the abandoned villages (attacker eligible, defender not; one 24 h pair window per target village; size factor from own village points vs the target); the assumed enemy raids pay the defender (pair key "enemy", enemy of about our size); Feast (applyFeast) once the Banner Hall exists, when a Feast resource is at >= 50% of storage or nothing else is worth doing, never touching what the next building needs.',
    '- Defender trickle (engine collectDefenderRenown, GAME_DESIGN 18.2 source 4): paid every step for EVERY village from the troops at home (troops away or in training do not count), nothing during the 72 h beginner protection of the account (the sim player never attacks a player).',
    '- Terrain: every route is the straight line from the village (`--home x,y`, default -30|-10) to the target, travel time from `travelTimeMs` with the default world seed. Try `--home` for other starts.',
    '- SEVERAL VILLAGES (step 2): Renown is reserved when a Chieftain is queued (villageRenownPrice; 500, 800, 1,280 ...; he costs 4,000/3,000/5,000 + 150 gold and 6 h) and half comes back if he dies in a strike (chieftainRefund). One Chieftain at a time. The first village with a Banner Hall trains him. Take styles first build an escort of 1.05 x HOLD_MIN_POPULATION fighters (they stop raiding and train as usual; only once the Banner Hall exists). Then, while the Renown is there, the village saves up: it only builds what leaves his cost untouched (plus the storehouse / farm he needs) and trains nothing.',
    '- TAKE (raider, balanced): all home troops (except Pathfinders) + the Chieftain strike the abandoned village with the most points that the army beats in a preview (attack >= 1.25 x defence, Chieftain survives, survivors >= HOLD_MIN_POPULATION). Real Strike and Hold from the engine: checkStrike, applyStrike (hearth out, village frozen), updateHold after 6 h, applyOwnerChange (all buildings kept, stock x TAKE_KEEP_RESOURCE_SHARE, old garrison gone, occupiers move in up to the population cap, the rest walks home). The strike army carries no loot (noLoot: a Strike attempt is not a raid). A take style keeps its army at home while a Chieftain exists and founds instead after 72 h without a beatable target.',
    '- FOUND (builder, turtle): the Chieftain + up to 30 defenders walk to the nearest free buildable tile (checkFoundTarget); createFoundedVillage (start levels, 300/300/150, 24 h protection, the escort is the garrison).',
    '- Extra villages play the same style script (build list, army, research, raids against the shared abandoned villages from their own tile, Feast), starting from their own levels; a taken village starts with all its buildings. Chieftains are only trained in the first village with a Banner Hall. Not modeled: sending resources or troops between the player\'s villages, a second hold wave (occupiers who arrive late), the Banner Hall of an extra village training Chieftains, enemy attacks on a village while it is struck, players as targets.',
    `- IDLE STRETCH ("dead period"): after the player did everything the style wants at a step, the longest time until the next step at which something useful was still possible in ANY village (a building, a batch of 10 units, a research, a Feast, a Chieftain with Renown to pay him). Target under 8 h. Reported for the whole run and for gaps that start on or after day ${LATE_DAY}. "Pile-up" = resource at >= 90% storage (first village).`,
  );
  if (rep.options.siege) {
    out.push(
      `- SIEGE (switched on with --siege; GAME_DESIGN 18.9): raider adds Drillyard 3 and 5 to its build list right after Barracks 8, balanced appends Barracks 8 and Drillyard 5; both research Log Ram then Boulder Sling and train batches of ${SIEGE_BATCH} (wheel weights 6 and 4) while they own fewer than ${SIEGE_OWN_CAP.logram} Rams / ${SIEGE_OWN_CAP.boulder} Slings. When a target's Wall is >= ${SIEGE_MIN_WALL} the siege units at home form a second candidate army next to the raiders alone (the slowest unit sets the travel time). That siege run is only chosen when the preview (other seed, attack >= 1.25 x defence) really lowers a Wall level; it then goes before the loot raids, valued at the build cost of the levels (siegeTarget 'wall', applyBattleToDefender). Siege never goes on a Chieftain strike (a taken village keeps its buildings).`,
    );
  }
  return out.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--conquest')) {
    // Player-vs-player conquest, 20 computer players (scripts/sim/conquest.ts; same command, other mode).
    void import('./conquest.ts').then((m) => m.main());
    return;
  }
  const get = (name: string, fallback: number): number => {
    const i = args.indexOf(name);
    const n = i >= 0 ? Number(args[i + 1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const homeAt = args.indexOf('--home');
  const homeParts = homeAt >= 0 ? String(args[homeAt + 1]).split(',').map(Number) : [];
  const home = homeParts.length === 2 && homeParts.every((n) => Number.isInteger(n)) ? { x: homeParts[0] as number, y: homeParts[1] as number } : DEFAULT_HOME;
  const base = { days: get('--days', 30), speed: get('--speed', 1), seed: get('--seed', 20261104), home };
  const siege = args.includes('--siege');
  const rep = runSimulation(siege ? { ...base, siege: true } : base);
  let text: string;
  if (args.includes('--json')) text = JSON.stringify(rep, null, 1);
  else if (siege) {
    // --siege: the focused siege experiments (scripts/sim/siege.ts), then the computer players without and with siege units.
    text = [formatSiegeExperiments(runSiegeExperiments(rep.options.home)), formatSiegeComparison(runSimulation(base), rep)].join('\n');
    if (args.includes('--full')) text += `\n${formatReport(rep, true)}`;
  } else text = formatReport(rep, args.includes('--full'));
  const outAt = args.indexOf('--out');
  if (outAt >= 0 && args[outAt + 1]) {
    writeFileSync(args[outAt + 1] as string, `${text}\n`);
    console.log(`Report written to ${args[outAt + 1]}`);
  } else console.log(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
