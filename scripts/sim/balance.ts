// Balance simulator: plays computer players through the REAL engine (settleVillage, applyBuild, applyTrain,
// applySend, resolveBattle, ...). No server, no database, no wall clock: all time is simulated, all luck
// comes from fixed seeds, so every run gives the same numbers.
//
//   npm run sim                      30 days, world speed 1, report to stdout (markdown)
//   npm run sim -- --days 5 --seed 7 --json
//
// Assumptions are listed at the end of the report ("Model") and in docs/BALANCE.md.

import { pathToFileURL } from 'node:url';
import {
  BUILDINGS,
  BUILDING_IDS,
  DEFAULT_WORLD,
  RESOURCE_IDS,
  UNITS,
  UNIT_IDS,
  applyAttackerLosses,
  applyBattleToDefender,
  applyBuild,
  applyResearch,
  applyReturn,
  applySend,
  applyTrain,
  buildingCost,
  canAfford,
  checkBuild,
  checkResearch,
  checkTrain,
  createNpcVillage,
  createPlayerVillage,
  emptyResources,
  emptyUnits,
  hashSeed,
  resolveBattle,
  settleVillage,
  storageCap,
  totalUnits,
  travelTimeMs,
  villagePoints,
} from '../../packages/engine/src/index.ts';
import type { BuildingId, Resources, UnitId, Units, VillageState, WorldSettings } from '../../packages/engine/src/index.ts';

const HOUR = 3_600_000;
const STEP_MS = 10 * 60_000; // a player "looks at the game" every 10 minutes
const QUEUE_LIMIT = 2; // free-player build queue (MAX_BUILD_QUEUE)
/** Gold is rare, so it counts 10x when raid profit and losses are valued. */
const VALUE_WEIGHT: Resources = { wood: 1, food: 1, iron: 1, gold: 10 };
const value = (r: Resources): number => RESOURCE_IDS.reduce((a, id) => a + r[id] * VALUE_WEIGHT[id], 0);
const num = (n: number): number => Math.round(n);

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
}

const eco: Step[] = [['lumber', 4], ['farm', 4], ['mine', 4], ['storehouse', 3]];

export const STYLE_DEFS: Record<StyleName, Style> = {
  builder: {
    order: [
      ...eco, ['hall', 3], ['lumber', 8], ['farm', 8], ['mine', 8], ['storehouse', 7], ['barracks', 1], ['vault', 2], ['hall', 5],
      ['goldmine', 3], ['lumber', 12], ['farm', 12], ['mine', 12], ['storehouse', 11], ['hall', 8], ['wall', 3], ['market', 3],
      ['goldmine', 8], ['lumber', 16], ['farm', 16], ['mine', 16], ['storehouse', 15], ['hall', 12],
    ],
    tail: ['lumber', 'farm', 'mine', 'storehouse', 'hall', 'goldmine'],
    army: [{ unit: 'pikeman', weight: 100 }],
    reserve: 1,
    trainFromDay: 4,
    raiders: [],
    research: [],
    keepHome: 0,
  },
  raider: {
    order: [
      ['lumber', 2], ['farm', 3], ['hall', 2], ['barracks', 2], ['mine', 3], ['storehouse', 3], ['farm', 5], ['lumber', 4],
      ['mine', 5], ['barracks', 4], ['farm', 7], ['storehouse', 5], ['hall', 4], ['lumber', 6], ['mine', 7], ['farm', 9],
      ['barracks', 6], ['storehouse', 8], ['lumber', 8], ['mine', 9], ['farm', 11], ['hall', 6], ['barracks', 8],
      ['lumber', 10], ['mine', 11], ['farm', 13], ['storehouse', 10],
    ],
    tail: ['farm', 'lumber', 'mine', 'storehouse', 'barracks', 'hall'],
    army: [{ unit: 'raider', weight: 90 }, { unit: 'pikeman', weight: 10 }],
    reserve: 0.25,
    trainFromDay: 0.25,
    raiders: ['raider'],
    research: [],
    keepHome: 0,
  },
  turtle: {
    order: [
      ['lumber', 3], ['farm', 4], ['hall', 2], ['barracks', 1], ['wall', 2], ['mine', 3], ['storehouse', 3], ['vault', 3],
      ['hall', 3], ['barracks', 3], ['wall', 5], ['farm', 6], ['lumber', 5], ['mine', 5], ['storehouse', 5], ['hall', 5],
      ['drillyard', 1], ['wall', 8], ['vault', 5], ['farm', 9], ['lumber', 8], ['mine', 8], ['storehouse', 8], ['wall', 12],
      ['hall', 7], ['farm', 12], ['lumber', 11], ['mine', 11], ['storehouse', 11], ['wall', 15], ['vault', 8],
    ],
    tail: ['wall', 'farm', 'lumber', 'mine', 'storehouse', 'hall'],
    army: [{ unit: 'pikeman', weight: 60 }, { unit: 'guard', weight: 40 }],
    reserve: 0.5,
    trainFromDay: 1,
    raiders: [],
    research: ['guard'],
    keepHome: 0,
  },
  balanced: {
    order: [
      ['lumber', 3], ['farm', 4], ['mine', 3], ['hall', 2], ['barracks', 2], ['storehouse', 3], ['lumber', 5], ['farm', 6],
      ['mine', 5], ['wall', 2], ['hall', 3], ['barracks', 3], ['vault', 2], ['storehouse', 5], ['farm', 8], ['lumber', 7],
      ['mine', 7], ['hall', 5], ['stables', 1], ['drillyard', 1], ['wall', 5], ['goldmine', 2], ['farm', 10], ['lumber', 9],
      ['mine', 9], ['storehouse', 8], ['barracks', 5], ['stables', 3], ['hall', 7], ['farm', 12], ['lumber', 11], ['mine', 11],
      ['goldmine', 5], ['storehouse', 10],
    ],
    tail: ['farm', 'lumber', 'mine', 'storehouse', 'wall', 'hall'],
    army: [{ unit: 'raider', weight: 40 }, { unit: 'pikeman', weight: 40 }, { unit: 'outrider', weight: 10 }, { unit: 'guard', weight: 10 }],
    reserve: 0.6,
    trainFromDay: 1.5,
    raiders: ['raider', 'outrider'],
    research: ['guard', 'outrider'],
    keepHome: 0,
  },
};

// ---- Report types -------------------------------------------------------------------------------

export interface DayRow {
  day: number;
  resources: Resources;
  buildings: Partial<Record<BuildingId, number>>;
  levelSum: number;
  points: number;
  army: Units; // home + away + queued
  armySize: number;
  attack: number;
  defense: number; // vs an even mix of infantry and cavalry, wall excluded
  raidLoot: number; // cumulative, valued
  raidLosses: number; // cumulative, valued
  raids: number;
  raidWins: number;
}

export interface RaidStat {
  tier: number;
  sent: number;
  wins: number;
  loot: number;
  losses: number;
}

export interface StyleResult {
  style: StyleName;
  rows: DayRow[];
  firstBuilding: Partial<Record<BuildingId, number>>; // hours when level 1 (next level for start buildings: level 2) first affordable with requirements met
  firstUnit: Partial<Record<UnitId, number>>; // hours when 1 unit was first affordable with requirements met
  trained: Units;
  raidByTier: RaidStat[];
  longestIdleHours: number;
  idleStartHour: number;
  hoursNearCap: Resources; // hours a resource sat at >= 90% of storage
  finalPoints: number;
  threats: Array<{ day: number; raiders: number; defended: boolean; lootLost: number; troopsLost: number }>;
  errors: string[];
}

export interface SimOptions {
  days: number;
  speed: number;
  seed: number;
}

// ---- Simulation of one style --------------------------------------------------------------------

interface Target {
  state: VillageState;
  tier: number;
  distance: number;
}

type Event =
  | { at: number; kind: 'battle'; target: number; units: Units; seed: number; travel: number }
  | { at: number; kind: 'return'; survivors: Units; loot: Resources };

const TARGET_LAYOUT: Array<[number, number]> = [[1, 3], [1, 5], [2, 5], [2, 7], [3, 8], [3, 10], [4, 12], [5, 14]]; // [tier, tiles]

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
function queuedUnits(v: VillageState): Units {
  const out = emptyUnits();
  for (const q of [v.trainQueues.barracks, v.trainQueues.stables]) for (const j of q) out[j.unit] += j.count - j.done;
  return out;
}

function simulateStyle(style: StyleName, opt: SimOptions): StyleResult {
  const def = STYLE_DEFS[style];
  const s: WorldSettings = { ...DEFAULT_WORLD, speed: opt.speed };
  const styleSeed = hashSeed(opt.seed, STYLES.indexOf(style));
  let v = createPlayerVillage(0);
  const targets: Target[] = TARGET_LAYOUT.map(([tier, distance]) => ({ state: createNpcVillage(tier, 0), tier, distance }));
  const events: Event[] = [];
  const errors: string[] = [];
  const firstBuilding: StyleResult['firstBuilding'] = {};
  const firstUnit: StyleResult['firstUnit'] = {};
  const trained = emptyUnits();
  const raidByTier: RaidStat[] = [1, 2, 3, 4, 5].map((tier) => ({ tier, sent: 0, wins: 0, loot: 0, losses: 0 }));
  const hoursNearCap = emptyResources();
  const threats: StyleResult['threats'] = [];
  const rows: DayRow[] = [];
  let raidLoot = 0;
  let raidLosses = 0;
  let raids = 0;
  let raidWins = 0;
  let raidSeq = 0;
  let idleStart = 0;
  let longestIdle = 0;
  let idleStartHour = 0;
  let nextDay = 1;
  let trainCursor = 0;
  const end = opt.days * 24 * HOUR;
  const threatTimes = [7, 14, 21, 28].filter((d) => d <= opt.days).map((d) => (d * 24 + 12) * HOUR);

  const levelWithQueue = (b: BuildingId): number => v.buildings[b] + v.buildQueue.filter((j) => j.building === b).length;

  /** Target village settled to `t`. */
  const targetAt = (i: number, t: number): VillageState => {
    const tg = targets[i] as Target;
    tg.state = settleVillage(tg.state, t, s);
    return tg.state;
  };

  const resolveEvent = (e: Event): void => {
    if (e.kind === 'return') {
      v = applyReturn(v, e.survivors, e.loot, e.at, s);
      return;
    }
    const tg = targets[e.target] as Target;
    const def0 = targetAt(e.target, e.at);
    const r = resolveBattle({ attackerUnits: e.units, defender: def0, seed: e.seed });
    tg.state = applyBattleToDefender(def0, r);
    v = applyAttackerLosses(settleVillage(v, e.at, s), r.attackerLosses);
    const stat = raidByTier[tg.tier - 1] as RaidStat;
    const lootVal = value(r.loot);
    let lossVal = 0;
    for (const id of UNIT_IDS) lossVal += r.attackerLosses[id] * value(UNITS[id].cost);
    stat.loot += lootVal;
    stat.losses += lossVal;
    raidLoot += lootVal;
    raidLosses += lossVal;
    if (r.attackerWon) {
      stat.wins += 1;
      raidWins += 1;
      events.push({ at: e.at + e.travel, kind: 'return', survivors: r.attackerSurvivors, loot: r.loot });
      events.sort((a, b) => a.at - b.at);
    }
  };

  const tryBuild = (t: number): void => {
    // Strict list first; fix storage / population blocks on the way.
    let want: BuildingId | undefined;
    for (const [b, lvl] of def.order) {
      if (levelWithQueue(b) < lvl) {
        want = b;
        break;
      }
    }
    if (!want) {
      want = [...def.tail].sort((a, b) => levelWithQueue(a) - levelWithQueue(b))[0];
    }
    if (!want) return;
    let cur: BuildingId = want;
    for (let guard = 0; guard < 4; guard++) {
      const c = checkBuild(v, cur, t, s, QUEUE_LIMIT);
      if (c.ok) {
        v = applyBuild(v, cur, t, s, QUEUE_LIMIT);
        return;
      }
      if (c.reason === 'exceeds_storage' && cur !== 'storehouse') cur = 'storehouse';
      else if (c.reason === 'population_full' && cur !== 'farm') cur = 'farm';
      else if (c.reason === 'requirements_not_met') {
        const reqs = BUILDINGS[cur].requires;
        const need: BuildingId | undefined = (Object.keys(reqs) as BuildingId[]).find((r) => v.buildings[r] < (reqs[r] ?? 0));
        if (!need || need === cur) return;
        cur = need;
      } else return;
    }
  };

  /** Resources the next building would need (reserved from training). */
  const nextBuildCost = (): Resources => {
    for (const [b, lvl] of def.order) if (levelWithQueue(b) < lvl) return buildingCost(b, levelWithQueue(b) + 1);
    return emptyResources();
  };

  const tryTrain = (t: number, day: number): void => {
    if (day < def.trainFromDay || def.army.length === 0) return;
    const total = def.army.reduce((a, x) => a + x.weight, 0);
    // Pick a unit by cycling a weighted wheel, skipping units that are not trainable yet.
    for (let k = 0; k < def.army.length * 4; k++) {
      const pick = (trainCursor++ * 37) % total;
      let acc = 0;
      let unit: UnitId = (def.army[0] as { unit: UnitId }).unit;
      for (const a of def.army) {
        acc += a.weight;
        if (pick < acc) {
          unit = a.unit;
          break;
        }
      }
      const building = UNITS[unit].building;
      if (v.trainQueues[building].length >= 2) continue;
      const reserve = nextBuildCost();
      const spare = emptyResources();
      for (const id of RESOURCE_IDS) spare[id] = Math.max(0, v.resources[id] - reserve[id] * def.reserve);
      let n = 40;
      for (const id of RESOURCE_IDS) if (UNITS[unit].cost[id] > 0) n = Math.min(n, Math.floor(spare[id] / UNITS[unit].cost[id]));
      while (n >= 1) {
        const c = checkTrain(v, unit, n, t, s);
        if (c.ok) {
          v = applyTrain(v, unit, n, t, s);
          trained[unit] += n;
          return;
        }
        if (c.reason !== 'population_full' && c.reason !== 'not_enough_food') break;
        n = Math.floor(n / 2);
      }
    }
  };

  const tryResearch = (t: number): void => {
    for (const u of def.research) {
      if ((v.researched ?? []).includes(u) || (v.researchQueue ?? []).some((j) => j.unit === u)) continue;
      if (checkResearch(v, u, t, s).ok) v = applyResearch(v, u, t, s);
      return;
    }
  };

  const tryRaid = (t: number): void => {
    if (def.raiders.length === 0) return;
    const send = emptyUnits();
    for (const u of def.raiders) send[u] = Math.max(0, v.troops[u] - def.keepHome);
    if (totalUnits(send) < 5) return;
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < targets.length; i++) {
      const tg = targets[i] as Target;
      const st = targetAt(i, t);
      const travel = travelTimeMs({ x: 0, y: 0 }, { x: tg.distance, y: 0 }, send, s);
      // Preview with a different seed: a player judges by scouting, not by knowing the luck.
      const arrival = settleVillage(st, t + travel, s);
      const pre = resolveBattle({ attackerUnits: send, defender: arrival, seed: hashSeed(styleSeed, 999, raidSeq) });
      if (!(pre.attackPower > pre.defensePower * 1.15)) continue;
      let cap = 0;
      for (const u of UNIT_IDS) cap += (send[u] - pre.attackerLosses[u]) * UNITS[u].carry;
      const lootable = Math.min(cap, value(pre.loot));
      const score = lootable / (2 * travel);
      if (lootable > 0 && score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    if (best < 0) return;
    const tg = targets[best] as Target;
    const travel = travelTimeMs({ x: 0, y: 0 }, { x: tg.distance, y: 0 }, send, s);
    v = applySend(v, send, t, s);
    raids += 1;
    (raidByTier[tg.tier - 1] as RaidStat).sent += 1;
    events.push({ at: t + travel, kind: 'battle', target: best, units: send, seed: hashSeed(styleSeed, raidSeq++), travel });
    events.sort((a, b) => a.at - b.at);
  };

  /** Is there a worthwhile move for the player right now? (a build, a batch of >= 10 units, a research, a raid) */
  const hasAction = (t: number): boolean => {
    for (const b of BUILDING_IDS) if (checkBuild(v, b, t, s, QUEUE_LIMIT).ok) return true;
    for (const u of UNIT_IDS) {
      if (UNITS[u].attack <= 0 && UNITS[u].defenseInfantry <= 2) continue; // scouts alone are not a plan
      if (checkTrain(v, u, 10, t, s).ok) return true;
    }
    for (const u of UNIT_IDS) if (UNITS[u].research && checkResearch(v, u, t, s).ok) return true;
    return false;
  };

  for (let t = 0; t <= end; t += STEP_MS) {
    while (events.length > 0 && (events[0] as Event).at <= t) resolveEvent(events.shift() as Event);
    for (const th of threatTimes) {
      if (th > t - STEP_MS && th <= t) {
        const day = Math.floor(th / (24 * HOUR));
        const raiders = day * 4;
        v = settleVillage(v, th, s);
        const atk = emptyUnits();
        atk.raider = raiders;
        const r = resolveBattle({ attackerUnits: atk, defender: v, seed: hashSeed(styleSeed, 777, day) });
        const before = totalUnits(v.troops);
        v = applyBattleToDefender(v, r);
        threats.push({ day, raiders, defended: !r.attackerWon, lootLost: num(value(r.loot)), troopsLost: before - totalUnits(v.troops) });
      }
    }
    try {
      v = settleVillage(v, t, s);
      const day = t / (24 * HOUR);
      // Affordability: first time requirements are met and one level / one unit can be paid.
      for (const b of BUILDING_IDS) {
        if (firstBuilding[b] !== undefined) continue;
        const next = v.buildings[b] + 1;
        const reqOk = (Object.keys(BUILDINGS[b].requires) as BuildingId[]).every((r) => v.buildings[r] >= (BUILDINGS[b].requires[r] ?? 0));
        if (reqOk && next <= BUILDINGS[b].maxLevel && canAfford(v.resources, buildingCost(b, next)) && buildingCost(b, next).wood <= storageCap(v)) {
          firstBuilding[b] = t / HOUR;
        }
      }
      for (const u of UNIT_IDS) {
        if (firstUnit[u] !== undefined) continue;
        const d = UNITS[u];
        const reqOk = (Object.keys(d.requires) as BuildingId[]).every((r) => v.buildings[r] >= (d.requires[r] ?? 0));
        if (reqOk && canAfford(v.resources, d.cost)) firstUnit[u] = t / HOUR;
      }
      // Pile-up: hours spent near a full storehouse.
      const cap = storageCap(v);
      for (const id of RESOURCE_IDS) if (v.resources[id] >= cap * 0.9) hoursNearCap[id] += STEP_MS / HOUR;

      tryBuild(t);
      tryResearch(t);
      tryTrain(t, day);
      tryRaid(t);

      // Dead time: nothing worthwhile to do.
      if (hasAction(t)) {
        const gap = (t - idleStart) / HOUR;
        if (gap > longestIdle) {
          longestIdle = gap;
          idleStartHour = idleStart / HOUR;
        }
        idleStart = t;
      }
    } catch (err) {
      errors.push(`t=${(t / HOUR).toFixed(1)}h: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (t === nextDay * 24 * HOUR - STEP_MS) {
      // Daily snapshot at the last step of each day.
      const cur = settleVillage(v, t, s);
      {
        const army = addUnits(addUnits(cur.troops, cur.away), queuedUnits(cur));
        const levels: Partial<Record<BuildingId, number>> = {};
        let sum = 0;
        for (const b of BUILDING_IDS) {
          levels[b] = cur.buildings[b];
          sum += cur.buildings[b];
        }
        rows.push({
          day: nextDay,
          resources: { ...cur.resources },
          buildings: levels,
          levelSum: sum,
          points: villagePoints(cur),
          army,
          armySize: totalUnits(army),
          attack: armyAttack(army),
          defense: armyDefense(army),
          raidLoot: num(raidLoot),
          raidLosses: num(raidLosses),
          raids,
          raidWins,
        });
        nextDay += 1;
      }
    }
  }
  const lastGap = (end - idleStart) / HOUR;
  if (lastGap > longestIdle) {
    longestIdle = lastGap;
    idleStartHour = idleStart / HOUR;
  }
  return {
    style,
    rows,
    firstBuilding,
    firstUnit,
    trained,
    raidByTier,
    longestIdleHours: longestIdle,
    idleStartHour,
    hoursNearCap,
    finalPoints: villagePoints(settleVillage(v, end, s)),
    threats,
    errors,
  };
}

// ---- Findings -----------------------------------------------------------------------------------

export interface SimReport {
  options: SimOptions;
  results: StyleResult[];
  flags: string[];
}

export function runSimulation(options: Partial<SimOptions> = {}): SimReport {
  const opt: SimOptions = { days: 30, speed: 1, seed: 20261104, ...options };
  const results = STYLES.map((st) => simulateStyle(st, opt));
  return { options: opt, results, flags: findProblems(results, opt) };
}

function score(r: StyleResult): number {
  const last = r.rows[r.rows.length - 1];
  return last ? last.points + last.armySize * 0.5 + (last.raidLoot - last.raidLosses) / 100 : 0;
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
    if (n === 0) {
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

export function formatReport(rep: SimReport, full = false): string {
  const out: string[] = [];
  out.push(`# Balance simulation — ${rep.options.days} days, speed ${rep.options.speed}, seed ${rep.options.seed}`, '');
  for (const r of rep.results) {
    out.push(`## ${r.style}`, '');
    out.push('| day | wood | food | iron | gold | bldg lvls | points | army | attack | defense | raid loot | raid losses | raids (won) |');
    out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const row of r.rows) {
      if (!full && !DAYS_SHOWN.includes(row.day) && row.day !== rep.options.days) continue;
      const k = row.buildings;
      out.push(
        `| ${row.day} | ${num(row.resources.wood)} | ${num(row.resources.food)} | ${num(row.resources.iron)} | ${num(row.resources.gold)} | ${row.levelSum} (hall ${k.hall} farm ${k.farm} barr ${k.barracks}) | ${row.points} | ${row.armySize} | ${num(row.attack)} | ${num(row.defense)} | ${row.raidLoot} | ${row.raidLosses} | ${row.raids} (${row.raidWins}) |`,
      );
    }
    out.push('');
    const tiers = r.raidByTier.filter((t) => t.sent > 0).map((t) => `T${t.tier}: ${t.sent} raids, ${t.wins} won, loot ${num(t.loot)}, losses ${num(t.losses)}`);
    if (tiers.length > 0) out.push(`Raids by target tier — ${tiers.join('; ')}`, '');
    out.push(`Trained: ${UNIT_IDS.filter((u) => r.trained[u] > 0).map((u) => `${u} ${r.trained[u]}`).join(', ') || 'nothing'}. Longest stretch with nothing worthwhile to do: ${r.longestIdleHours.toFixed(1)} h.`);
    out.push(`Enemy raids (assumed, day x4 raiders): ${r.threats.map((t) => `d${t.day}: ${t.raiders} raiders ${t.defended ? 'held' : 'broke through, lost ' + t.lootLost}`).join('; ') || 'none'}.`, '');
  }
  out.push('## First affordable (hours / days since start, own economy)', '');
  out.push(`| item | ${rep.results.map((r) => r.style).join(' | ')} |`, `|---|${rep.results.map(() => '---').join('|')}|`);
  for (const b of BUILDING_IDS) out.push(`| building ${b} (next level) | ${rep.results.map((r) => fmtHour(r.firstBuilding[b])).join(' | ')} |`);
  for (const u of UNIT_IDS) out.push(`| unit ${u} | ${rep.results.map((r) => fmtHour(r.firstUnit[u])).join(' | ')} |`);
  out.push('', '## Unit value (static)', '', '| unit | attack/cost | defense/cost (avg) | carry/cost | upkeep | pop |', '|---|---|---|---|---|---|');
  for (const u of UNIT_IDS) {
    const d = UNITS[u];
    const c = d.cost.wood + d.cost.food + d.cost.iron + d.cost.gold * 10;
    out.push(`| ${u} | ${(d.attack / c).toFixed(3)} | ${(((d.defenseInfantry + d.defenseCavalry) / 2) / c).toFixed(3)} | ${(d.carry / c).toFixed(3)} | ${d.upkeep} | ${d.requires.stables ? 'stables' : 'barracks'} |`);
  }
  out.push('', '## Flags', '');
  if (rep.flags.length === 0) out.push('None.');
  for (const f of rep.flags) out.push(`- ${f}`);
  out.push(
    '',
    '## Model',
    '',
    '- One village per style, 10-minute decision steps, free-player queues (2 builds, 2 batches per training building). Real engine calls only; no server.',
    '- 8 abandoned villages (tiers 1-5, 3-14 tiles away) per style; garrisons never refill (engine rule), so repeated raids get easier.',
    '- Loot and losses valued wood+food+iron+10xgold. Troop upkeep, travel idle time and Drillyard ranks are not valued.',
    '- Enemy raiders hit each village on days 7, 14, 21, 28 (4 x day raiders) to give defence something to do.',
    '- "Dead period" = no building, 10-unit batch or research possible; "pile-up" = resource at >= 90% storage.',
  );
  return out.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const get = (name: string, fallback: number): number => {
    const i = args.indexOf(name);
    const n = i >= 0 ? Number(args[i + 1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const rep = runSimulation({ days: get('--days', 30), speed: get('--speed', 1), seed: get('--seed', 20261104) });
  console.log(args.includes('--json') ? JSON.stringify(rep, null, 1) : formatReport(rep, args.includes('--full')));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
