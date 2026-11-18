// Troop analysis: a read-only look at the troop roster, recruiting speed, battles and loot, on the REAL engine and config
// (resolveBattle, trainTimeMs, productionFromLevels, createNpcVillage, flatTravelTimeMs, resolveScouting). Nothing here
// copies a game rule: the only arithmetic is ratios, a search for the smallest army the engine lets win, and a simple money model.
// Re-run it after changing numbers in packages/engine/src/config.ts.
//
//   npm run sim:troops                           markdown tables to stdout
//   npm run sim:troops -- --out docs/sim/<file>.txt   write them to a file as well
//   npm run sim:troops -- --set firecart.siege.power=3 --set knight.attack=140   preview UNITS changes without editing config.ts
//     (only numeric UNITS fields; `firecart.power=3` is short for `firecart.siege.power=3`; the active overrides are printed in the header)
//
// Deterministic: fixed seed, battles use BattleInput.fixedLuck = 0 unless a row says otherwise. World speed 1, flat ground.
// Value convention: wood + food + iron + 10 * gold (RENOWN_VALUE_WEIGHT, engine `resourceValue`).

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  BATTLE_LUCK,
  BUILDINGS,
  BUILDING_IDS,
  DEFAULT_WORLD,
  MAX_TRAIN_BATCH,
  MAX_TRAIN_QUEUE,
  NPC_PRODUCTION_FACTOR,
  POP_PER_UNIT,
  RESOURCE_IDS,
  SCOUT_DEFENSE_FACTOR,
  SIEGE_BASE_POINTS,
  SIEGE_DURING_SHARE,
  SIEGE_LOST_SHARE,
  SIEGE_POINTS_PER_LEVEL,
  SCOUT_LOSS_EXPONENT,
  SCOUT_UNIT,
  UNITS,
  UNIT_IDS,
  buildingCost,
  createNpcVillage,
  createPlayerVillage,
  emptyUnits,
  flatTravelTimeMs,
  popCapForLevel,
  populationUsage,
  productionFromLevels,
  resolveBattle,
  resolveScouting,
  resolveSiege,
  resourceValue,
  settleVillage,
  siegeFloor,
  storageCap,
  storageCapForLevel,
  trainTimeMs,
  vaultProtection,
} from '../../packages/engine/src/index.ts';
import type { BattleResult, BuildingId, ResourceId, Resources, UnitId, Units, VillageState, WorldSettings } from '../../packages/engine/src/index.ts';

const S: WorldSettings = DEFAULT_WORLD; // world speed 1
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const SEED = 1;
const PCTS = [0.25, 0.5, 0.75, 1] as const;

// ---- Small helpers ---------------------------------------------------------------------------------

function fmt(n: number, d = 1): string {
  if (!Number.isFinite(n)) return n > 0 ? 'inf' : '-';
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
}
const pct = (x: number): string => `${fmt(x * 100, 0)}%`;

function table(headers: string[], rows: Array<Array<string | number>>): string {
  const line = (cells: Array<string | number>): string => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

const value = (r: Partial<Resources>): number => resourceValue(r);
const unitValue = (u: UnitId): number => value(UNITS[u].cost);
const army = (spec: Partial<Units>): Units => ({ ...emptyUnits(), ...spec });
function armyValue(a: Units): number {
  let v = 0;
  for (const u of UNIT_IDS) v += a[u] * unitValue(u);
  return v;
}
function armyPop(a: Units): number {
  let p = 0;
  for (const u of UNIT_IDS) p += a[u] * POP_PER_UNIT[u];
  return p;
}
function armyCarry(a: Units): number {
  let c = 0;
  for (const u of UNIT_IDS) c += a[u] * UNITS[u].carry;
  return c;
}
function describe(a: Units): string {
  const parts = UNIT_IDS.filter((u) => a[u] > 0).map((u) => `${fmt(a[u], 0)} ${UNITS[u].name}`);
  return parts.join(' + ') || '-';
}

/** A player village (Town Hall 10 unless overridden) with the given levels and garrison. */
function village(levels: Partial<Record<BuildingId, number>>, troops: Partial<Units> = {}): VillageState {
  const v = createPlayerVillage(0);
  v.buildings = { ...v.buildings, hall: 10, ...levels };
  v.troops = army(troops);
  return v;
}

/** Seconds to train one `u` with its building at `level`. */
function trainSec(u: UnitId, level: number): number {
  return trainTimeMs(u, village({ [UNITS[u].building]: level }), S) / 1000;
}

/** Level at pct of the building's max (rounded, at least 1). */
const levelAt = (b: BuildingId, p: number): number => Math.max(1, Math.round(BUILDINGS[b].maxLevel * p));

// ---- 1. Roster -------------------------------------------------------------------------------------

function roster(): string {
  const out: string[] = ['## 1. Roster', '', 'Value = wood + food + iron + 10 x gold. Defence columns: vs foot = against an infantry attack, vs riders = against cavalry. Speed in tiles per hour at world speed 1.', ''];
  const per100 = (x: number, u: UnitId): number => (unitValue(u) > 0 ? (x / unitValue(u)) * 100 : 0);
  const perPop = (x: number, u: UnitId): number => x / POP_PER_UNIT[u];

  out.push('### 1a. Stats');
  out.push(
    table(
      ['unit', 'cost (w/f/i/g)', 'value', 'pop', 'attack', 'def foot', 'def riders', 'carry', 'speed'],
      UNIT_IDS.map((u) => {
        const d = UNITS[u];
        return [d.name, `${d.cost.wood}/${d.cost.food}/${d.cost.iron}/${d.cost.gold}`, unitValue(u), POP_PER_UNIT[u], d.attack, d.defenseInfantry, d.defenseCavalry, d.carry, d.speed];
      }),
    ),
  );
  out.push('', '### 1b. Efficiency (per 100 value, per pop)');
  out.push(
    table(
      ['unit', 'atk/100v', 'atk/pop', 'defFoot/100v', 'defRiders/100v', 'defFoot/pop', 'defRiders/pop', 'carry/100v', 'carry/pop'],
      UNIT_IDS.map((u) => {
        const d = UNITS[u];
        return [d.name, fmt(per100(d.attack, u)), fmt(perPop(d.attack, u)), fmt(per100(d.defenseInfantry, u)), fmt(per100(d.defenseCavalry, u)), fmt(perPop(d.defenseInfantry, u)), fmt(perPop(d.defenseCavalry, u)), fmt(per100(d.carry, u)), fmt(perPop(d.carry, u))];
      }),
    ),
  );
  out.push('', '### 1c. Travel on flat grass (hours, one way)');
  out.push(
    table(
      ['unit', 'speed', '10 tiles', '30 tiles', '60 tiles'],
      UNIT_IDS.map((u) => {
        const hours = (tiles: number): number => flatTravelTimeMs({ x: 0, y: 0 }, { x: tiles, y: 0 }, army({ [u]: 1 }), S) / HOUR_MS;
        return [UNITS[u].name, UNITS[u].speed, fmt(hours(10), 2), fmt(hours(30), 2), fmt(hours(60), 2)];
      }),
    ),
  );
  out.push('', '### 1d. Training time (seconds for ONE unit; units one building at max level trains per day)');
  out.push(
    table(
      ['unit', 'building', 'max lvl', 'sec @ L1', 'sec @ L10', 'sec @ max', 'units/day @ L1', 'units/day @ max', 'value/day @ max'],
      UNIT_IDS.map((u) => {
        const b = UNITS[u].building;
        const max = BUILDINGS[b].maxLevel;
        const l10 = Math.min(10, max);
        return [UNITS[u].name, BUILDINGS[b].name, max, fmt(trainSec(u, 1), 0), `${fmt(trainSec(u, l10), 0)}${l10 < 10 ? ` (L${l10})` : ''}`, fmt(trainSec(u, max), 0), fmt(86400 / trainSec(u, 1), 0), fmt(86400 / trainSec(u, max), 0), fmt((86400 / trainSec(u, max)) * unitValue(u), 0)];
      }),
    ),
  );
  return out.join('\n');
}

// ---- 2. Recruit ------------------------------------------------------------------------------------

/** A village where every building is at `p` of its max level (levels are rounded, at least 1). Only used for income, storage and room. */
function villageAtPct(p: number): VillageState {
  const levels: Partial<Record<BuildingId, number>> = {};
  for (const b of BUILDING_IDS) levels[b] = levelAt(b, p);
  return village(levels);
}

interface Mix {
  name: string;
  /** Units of one "set" (the smallest repeating bundle). */
  set: Partial<Units>;
  building: 'barracks' | 'stables' | 'wrightyard';
}
const MIXES: Mix[] = [
  { name: 'Raiders', set: { raider: 1 }, building: 'barracks' },
  { name: 'Defence (Pikeman+Shieldbearer 50/50)', set: { pikeman: 1, guard: 1 }, building: 'barracks' },
  { name: 'Elk Riders', set: { outrider: 1 }, building: 'stables' },
  { name: 'Log Rams', set: { logram: 1 }, building: 'wrightyard' },
  { name: 'Firecarts', set: { firecart: 1 }, building: 'wrightyard' },
];

function setCost(set: Partial<Units>): Resources {
  const c: Resources = { wood: 0, food: 0, iron: 0, gold: 0 };
  for (const u of UNIT_IDS) for (const r of RESOURCE_IDS) c[r] += (set[u] ?? 0) * UNITS[u].cost[r];
  return c;
}
const setUnits = (set: Partial<Units>): number => UNIT_IDS.reduce((n, u) => n + (set[u] ?? 0), 0);
const setPop = (set: Partial<Units>): number => UNIT_IDS.reduce((n, u) => n + (set[u] ?? 0) * POP_PER_UNIT[u], 0);
function setSec(set: Partial<Units>, level: number): number {
  return UNIT_IDS.reduce((n, u) => n + (set[u] ?? 0) * trainSec(u, level), 0);
}

/** Days until the income (per hour) plus the starting stock has paid `sets` sets; Infinity when a needed resource has no income. */
function daysForMoney(sets: number, cost: Resources, income: Resources, stock: Resources): number {
  let worst = 0;
  for (const r of RESOURCE_IDS) {
    const need = sets * cost[r] - stock[r];
    if (cost[r] <= 0 || need <= 0) continue;
    if (!(income[r] > 0)) return Infinity;
    worst = Math.max(worst, need / (income[r] * 24));
  }
  return worst;
}

function recruit(): string {
  const out: string[] = ['## 2. Recruit', ''];
  out.push(
    'Ladder: every building at 25 / 50 / 75 / 100% of its max level (rounded). Income = engine production for those levels (Gold Mine included at the same pct, otherwise gold would be 0). ' +
      'Pop room = Longhouse cap minus the pop of ALL buildings at that pct. The player spends 100% of income on one army type; stock starts at one full Storehouse of wood/food/iron (no gold). ' +
      'Money days include that stock. One building trains one unit at a time. Binding = which of money / the one training building is slower (the room caps the size, the queue only limits how far ahead one can order).',
    '',
  );
  const rows: Array<Array<string | number>> = [];
  for (const p of PCTS) {
    const v = villageAtPct(p);
    const inc = productionFromLevels(v.buildings, 1);
    const cap = storageCapForLevel(v.buildings.storehouse);
    const popCap = popCapForLevel(v.buildings.longhouse);
    const used = populationUsage(v).buildings;
    rows.push([pct(p), `Lumber/Farm/Mine ${v.buildings.lumber}, Gold ${v.buildings.goldmine}, Longhouse ${v.buildings.longhouse}, Store ${v.buildings.storehouse}, Barracks ${v.buildings.barracks}, Stables ${v.buildings.stables}, Wright ${v.buildings.wrightyard}`, fmt(inc.wood, 0), fmt(inc.food, 0), fmt(inc.iron, 0), fmt(inc.gold, 0), fmt(value(inc), 0), fmt(cap, 0), fmt(popCap, 0), fmt(used, 0), fmt(Math.max(0, popCap - used), 0)]);
  }
  out.push('### 2a. Income, storage, population per ladder step');
  out.push(table(['pct', 'levels', 'wood/h', 'food/h', 'iron/h', 'gold/h', 'value/h', 'storage cap', 'pop cap', 'building pop', 'pop room'], rows));

  const rows2: Array<Array<string | number>> = [];
  const queueUnits = MAX_TRAIN_QUEUE * MAX_TRAIN_BATCH;
  for (const mix of MIXES) {
    for (const p of PCTS) {
      const v = villageAtPct(p);
      const inc = productionFromLevels(v.buildings, 1);
      const cap = storageCapForLevel(v.buildings.storehouse);
      const stock: Resources = { wood: cap, food: cap, iron: cap, gold: 0 };
      const room = Math.max(0, popCapForLevel(v.buildings.longhouse) - populationUsage(v).buildings);
      const cost = setCost(mix.set);
      const perSet = setUnits(mix.set);
      // (a) money: sets per day the income pays, and which resource limits it
      let moneyRate = Infinity;
      let limiting: ResourceId = 'wood';
      for (const r of RESOURCE_IDS) {
        if (cost[r] <= 0) continue;
        const rate = (inc[r] * 24) / cost[r];
        if (rate < moneyRate) {
          moneyRate = rate;
          limiting = r;
        }
      }
      // (b) one training building
      const level = v.buildings[mix.building];
      const secPerSet = setSec(mix.set, level);
      const buildRate = 86400 / secPerSet;
      // (c) queue: the most one building can hold, and how many days of work that is
      const queueSets = queueUnits / perSet;
      const queueDays = (queueSets * secPerSet) / 86400;
      // (d) room
      const roomSets = Math.floor(room / setPop(mix.set));
      const days = (sets: number): { d: number; by: string } => {
        const m = daysForMoney(sets, cost, inc, stock);
        const b = sets / buildRate;
        return { d: Math.max(m, b), by: m > b ? `money (${limiting})` : 'building' };
      };
      const fill = days(roomSets);
      const rebuild = (pop: number): string => {
        const sets = Math.floor(pop / setPop(mix.set));
        const r = days(sets);
        return `${fmt(r.d, 1)}${sets > roomSets ? ' (over room)' : ''}`;
      };
      rows2.push([
        mix.name,
        pct(p),
        fmt(value(cost) / perSet, 0),
        `${fmt(moneyRate * perSet, 0)} (${limiting})`,
        `${fmt(buildRate * perSet, 0)}`,
        fmt(moneyRate / buildRate, 2),
        `${fmt(queueUnits, 0)} units = ${fmt(queueDays, 1)} d`,
        `${fmt(roomSets * perSet, 0)} units`,
        `${fmt(fill.d, 1)} (${fill.by})`,
        rebuild(1000),
        rebuild(3000),
      ]);
    }
  }
  out.push('', '### 2b. Per army and ladder step');
  out.push(table(['army', 'pct', 'value/unit', 'units/day money', 'units/day building', 'money / building', 'max queued (5 x 1000)', 'room (units)', 'days to fill room (binding)', 'days: rebuild 1000 pop', 'days: rebuild 3000 pop'], rows2));
  out.push('', '"money / building" above 1 means the one training building is the bottleneck, below 1 means money is.');
  return out.join('\n');
}

// ---- 3. Battle -------------------------------------------------------------------------------------

function defender(n: number, wall: number, guardShare = 0.5): VillageState {
  const guards = Math.round(n * guardShare);
  return village({ hall: 10, wall }, { pikeman: n - guards, guard: guards });
}

function fight(att: Units, def: VillageState, luck = 0): BattleResult {
  return resolveBattle({ attackerUnits: att, defender: def, seed: SEED, fixedLuck: luck, noLoot: true });
}

interface Attacker {
  name: string;
  /** The army for a count `n` of its main unit (carts stay fixed). */
  make: (n: number) => Units;
}
const ATTACKERS: Attacker[] = [
  { name: 'Raiders', make: (n) => army({ raider: n }) },
  // 50/50 by attack points: n Raiders and as many Elk Riders as carry the same attack.
  { name: 'Raiders + Elk Riders', make: (n) => army({ raider: n, outrider: Math.round((n * UNITS.raider.attack) / UNITS.outrider.attack) }) },
  { name: 'Ember Guards', make: (n) => army({ knight: n }) },
  ...[6, 12, 24].map((c): Attacker => ({ name: `Raiders + ${c} Log Rams`, make: (n) => army({ raider: n, logram: c }) })),
];

/** Smallest n whose army wins at luck 0 (exponential then binary search; the engine decides). */
function minWin(make: (n: number) => Units, def: VillageState): number {
  let hi = 1;
  while (!fight(make(hi), def).attackerWon) {
    hi *= 2;
    if (hi > 5_000_000) return Infinity;
  }
  let lo = Math.floor(hi / 2);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fight(make(mid), def).attackerWon) hi = mid;
    else lo = mid;
  }
  return hi;
}

function battle(): string {
  const out: string[] = ['## 3. Battle', ''];
  out.push(
    'Real engine, luck 0, no morale, no ranks, no loot. Defender: N pop of Pikeman + Shieldbearer 50/50 by count at home, Town Hall 10, Wall 0/10/22 (the Wall adds its militia and bonus in the engine). ' +
      'Attacker = smallest count of the main unit (Raiders) that the engine lets win. Survivors % and losses are by value. A won battle kills ALL defenders; a lost one kills ALL attackers. ' +
      'Firecarts stay fixed when the count is scaled; the Wall is lowered during the battle as the engine does (D already uses the lowered Wall).',
    '',
  );
  const rowsA: Array<Array<string | number>> = [];
  const rowsB: Array<Array<string | number>> = [];
  const sized = (n: number, a: Attacker, f: number): Units => a.make(Math.max(1, Math.round(n * f)));
  for (const n of [500, 2000]) {
    for (const wall of [0, 10, 22]) {
      const def = defender(n, wall);
      const defValue = armyValue(army({ pikeman: n / 2, guard: n / 2 }));
      for (const a of ATTACKERS) {
        const nMin = minWin(a.make, def);
        const att = a.make(nMin);
        const r = fight(att, def);
        const attV = armyValue(att);
        const attLoss = armyValue(r.attackerLosses);
        const defLoss = armyValue(r.defenderLosses);
        rowsA.push([n, wall, a.name, describe(att), fmt(r.attackPower, 0), fmt(r.defensePower, 0), fmt(attV / defValue, 2), fmt(armyPop(att) / n, 2), pct(1 - attLoss / attV), pct(1 - defLoss / defValue), fmt(attLoss, 0), fmt(defLoss, 0)]);
        const f = (x: number): string => {
          const rr = fight(sized(nMin, a, x), def);
          return `${fmt(armyValue(rr.attackerLosses), 0)} / ${fmt(armyValue(rr.defenderLosses), 0)}`;
        };
        const lk = (luck: number): string => {
          const rr = fight(att, def, luck);
          return `${rr.attackerWon ? 'win' : 'LOSE'} ${fmt(armyValue(rr.attackerLosses), 0)} / ${fmt(armyValue(rr.defenderLosses), 0)}`;
        };
        const big = fight(sized(nMin, a, 1.5), def);
        const big2 = fight(sized(nMin, a, 2), def);
        rowsB.push([n, wall, a.name, fmt(nMin, 0), f(0.9), f(0.7), lk(-BATTLE_LUCK), lk(BATTLE_LUCK), pct(armyValue(big.attackerLosses) / armyValue(sized(nMin, a, 1.5))), pct(armyValue(big2.attackerLosses) / armyValue(sized(nMin, a, 2)))]);
      }
    }
  }
  out.push('### 3a. Smallest winning army (luck 0)');
  out.push(table(['N def pop', 'Wall', 'attacker', 'army', 'A (attack)', 'D (defence)', 'att value / def value', 'att pop / def pop', 'att survivors', 'def survivors', 'att loss (value)', 'def loss (value)'], rowsA));
  out.push('', '### 3b. Near misses, luck, bigger armies (loss in value, attacker / defender)');
  out.push(table(['N def pop', 'Wall', 'attacker', 'min wins', 'at 0.9x', 'at 0.7x', 'luck -10% (win count)', 'luck +10% (win count)', 'att loss share at 1.5x', 'att loss share at 2x'], rowsB));

  // Reference: the real battle the owner saw, ~96k attack lost against ~4,100 defenders behind a Wall 20 (defence ~142k).
  const refRows: Array<Array<string | number>> = [];
  for (const share of [0, 0.15, 0.3, 0.5, 1]) {
    const def = defender(4100, 20, share);
    const r = fight(army({ raider: 1 }), def);
    const nRaiders = minWin((n) => army({ raider: n }), def);
    refRows.push([pct(share), fmt(r.defensePower, 0), fmt(nRaiders, 0), fmt(nRaiders * UNITS.raider.attack, 0)]);
  }
  out.push('', '### 3c. Reference: 4,100 defenders behind Wall 20 (a real battle: attack ~96k lost, defence ~142k)');
  out.push(table(['Shieldbearer share of 4,100', 'D vs infantry attack', 'Raiders needed', 'attack points of those'], refRows));
  const real = fight(army({ raider: Math.round(96_000 / UNITS.raider.attack) }), defender(4100, 20, 0.15));
  out.push('', `Check: ${fmt(Math.round(96_000 / UNITS.raider.attack), 0)} Raiders (A=${fmt(real.attackPower, 0)}) against 4,100 defenders with 15% Shieldbearers behind Wall 20: D=${fmt(real.defensePower, 0)}, ${real.attackerWon ? 'attacker wins' : 'defender holds'}.`);
  return out.join('\n');
}

// ---- 4. Loot ---------------------------------------------------------------------------------------

/** Smallest Raider count whose survivors carry everything lootable (or the most the village holds); search with the engine. */
function minLoad(def: VillageState, lootable: number): number {
  const loot = (n: number): number => {
    const r = resolveBattle({ attackerUnits: army({ raider: n }), defender: def, seed: SEED, fixedLuck: 0 });
    return r.attackerWon ? value(r.loot) : -1;
  };
  let hi = 1;
  while (loot(hi) < lootable - 1e-9 && hi < 5_000_000) hi *= 2;
  let lo = Math.floor(hi / 2);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (loot(mid) >= lootable - 1e-9) hi = mid;
    else lo = mid;
  }
  return hi;
}

function loot(): string {
  const out: string[] = ['## 4. Loot', ''];
  out.push(
    'Abandoned villages from `createNpcVillage(tier)` (tier start levels), produce at NPC_PRODUCTION_FACTOR (' +
      `${NPC_PRODUCTION_FACTOR}) of a player. "Fresh" = stock at creation. "10 d no build" = stock after 10 days of production only, capped by its storage. "Lootable" = stock minus what the Vault hides, per resource. ` +
      'After the first raid the garrison is dead (the engine never retrains it), so later raids only need carriers. Sustained loot/day = min(trips x carry, the village\'s production per day). Trips at 10 tiles: flat ground, Raiders, there and back only.',
    '',
  );
  const rowsStock: Array<Array<string | number>> = [];
  const rowsRaid: Array<Array<string | number>> = [];
  const trip = flatTravelTimeMs({ x: 0, y: 0 }, { x: 10, y: 0 }, army({ raider: 1 }), S) * 2;
  const tripsPerDay = DAY_MS / trip;
  const ownIncome = PCTS.map((p) => value(productionFromLevels(villageAtPct(p).buildings, 1)) * 24);
  for (let tier = 1; tier <= 5; tier++) {
    const v = createNpcVillage(tier, 0);
    const prod = productionFromLevels(v.buildings, NPC_PRODUCTION_FACTOR);
    const cap = storageCap(v);
    const grown: Resources = { wood: 0, food: 0, iron: 0, gold: 0 };
    for (const r of RESOURCE_IDS) grown[r] = Math.min(cap, v.resources[r] + prod[r] * 240);
    const settled = settleVillage(v, 10 * DAY_MS, S);
    const garrison = v.troops; // none since 2026-11-17 (only the Wall defends a map-born village)
    const hidden = vaultProtection(v);
    const lootableOf = (res: Resources): number => RESOURCE_IDS.reduce((n, r) => n + Math.max(0, res[r] - hidden) * (r === 'gold' ? 10 : 1), 0);
    rowsStock.push([
      tier,
      `Hall ${v.buildings.hall}, Wall ${v.buildings.wall}, Vault ${v.buildings.vault}, Store ${v.buildings.storehouse}`,
      `${fmt(v.resources.wood, 0)}/${fmt(v.resources.food, 0)}/${fmt(v.resources.iron, 0)}/${fmt(v.resources.gold, 0)} = ${fmt(value(v.resources), 0)}`,
      `${fmt(grown.wood, 0)}/${fmt(grown.food, 0)}/${fmt(grown.iron, 0)}/${fmt(grown.gold, 0)} = ${fmt(value(grown), 0)}`,
      `${fmt(settled.resources.wood, 0)}/${fmt(settled.resources.food, 0)}/${fmt(settled.resources.iron, 0)}/${fmt(settled.resources.gold, 0)} = ${fmt(value(settled.resources), 0)}`,
      `${fmt(prod.wood, 1)}/${fmt(prod.food, 1)}/${fmt(prod.iron, 1)}/${fmt(prod.gold, 2)} = ${fmt(value(prod), 1)}`,
      fmt(hidden, 0),
      describe(garrison),
    ]);
    const kill = minWin((n) => army({ raider: n }), v);
    const killR = resolveBattle({ attackerUnits: army({ raider: kill }), defender: v, seed: SEED, fixedLuck: 0 });
    const lootFresh = lootableOf(v.resources);
    const load = minLoad(v, lootFresh);
    const loadArmy = army({ raider: load });
    const loadR = resolveBattle({ attackerUnits: loadArmy, defender: v, seed: SEED, fixedLuck: 0 });
    // Sustained: a later trip meets no garrison; the army that survived carries away what the village produced since.
    const carry = armyCarry(army({ raider: load - loadR.attackerLosses.raider }));
    const supplyDay = value(prod) * 24;
    const sustained = Math.min(tripsPerDay * carry, supplyDay);
    rowsRaid.push([
      tier,
      fmt(kill, 0),
      `${fmt(armyCarry(killR.attackerSurvivors), 0)} (loot ${fmt(value(killR.loot), 0)} of ${fmt(lootFresh, 0)})`,
      `${fmt(load, 0)} (cost ${fmt(load * unitValue('raider'), 0)}, carry ${fmt(carry, 0)}, loot ${fmt(value(loadR.loot), 0)})`,
      fmt(tripsPerDay, 2),
      fmt(supplyDay, 0),
      fmt(sustained, 0),
      ...ownIncome.map((inc) => pct(sustained / inc)),
    ]);
  }
  out.push('### 4a. Abandoned villages (w/f/i/g = value)');
  out.push(table(['tier', 'buildings', 'fresh stock', '10 d no build', '10 d real (self-build)', 'production/h (value)', 'vault hides (each)', 'garrison'], rowsStock));
  out.push('', '### 4b. Raiding them with Raiders (10 tiles)');
  out.push(table(['tier', 'Raiders to kill garrison (min)', 'min army carry (and loot it took)', 'Raiders to also carry all lootable', 'round trips/day', 'village production/day', 'sustained loot/day', 'ratio vs own income @25%', '@50%', '@75%', '@100%'], rowsRaid));
  out.push('', `Own income per day (value): ${PCTS.map((p, i) => `${pct(p)} = ${fmt(ownIncome[i] as number, 0)}`).join(', ')}. Ratio = sustained raid loot per day / own income per day.`);

  // Scouting duel.
  const pf = unitValue(SCOUT_UNIT);
  const loots: string[] = [];
  const scoutRows: Array<Array<string | number>> = [];
  for (const defScouts of [0, 1, 2, 3, 4, 5, 10]) {
    const r = resolveScouting({ scouts: 5, defenderScouts: defScouts });
    scoutRows.push([defScouts, r.success ? 'success' : 'caught', r.scoutLosses, fmt(r.scoutLosses * pf, 0), r.defenderScoutLosses]);
  }
  for (let tier = 1; tier <= 5; tier++) {
    const v = createNpcVillage(tier, 0);
    loots.push(`tier ${tier}: ${fmt(value(v.resources), 0)}`);
  }
  out.push('', '### 4c. Scouting duel (SCOUT_DEFENSE_FACTOR ' + SCOUT_DEFENSE_FACTOR + ', loss exponent ' + SCOUT_LOSS_EXPONENT + ')');
  out.push(`5 ${UNITS[SCOUT_UNIT].name}s cost ${fmt(5 * pf, 0)} value (${fmt(pf, 0)} each). Fresh stock of an abandoned village: ${loots.join('; ')}. Abandoned villages have no Pathfinders, so scouting them is free.`);
  out.push('');
  out.push(table(['defending Pathfinders', '5 scouts', 'scouts lost', 'loss (value)', 'defender scouts lost'], scoutRows));
  return out.join('\n');
}

// ---- 5. Firecart value ----------------------------------------------------------------------------

/** Smallest Raider count that wins together with `carts` Firecarts (0 when the carts alone win). */
function minRaidersWith(carts: number, def: VillageState): number {
  const make = (n: number): Units => army({ raider: n, logram: carts }); // the Log Ram is the unit that works in the battle (the Wall)
  if (carts > 0 && fight(make(0), def).attackerWon) return 0;
  return minWin(make, def);
}

/** Smallest count of surviving siege units (Log Rams for the Wall, Firecarts for everything else) that lowers `building` (at `level`) by `levels` in the after-battle step. */
function cartsToLower(building: BuildingId, level: number, levels: number): number {
  const unit = building === 'wall' ? 'logram' : 'firecart';
  const lowered = (c: number): number => {
    const hits = resolveSiege(army({ [unit]: c }), village({ [building]: level }).buildings, building);
    const h = hits.find((x) => x.building === building && x.unit === unit);
    return h ? h.from - h.to : 0;
  };
  let hi = 1;
  while (lowered(hi) < levels) {
    hi *= 2;
    if (hi > 5_000_000) return Infinity;
  }
  let lo = Math.floor(hi / 2);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (lowered(mid) >= levels) hi = mid;
    else lo = mid;
  }
  return hi;
}

function firecartValue(): string {
  const f = UNITS.firecart;
  const cartValue = unitValue('firecart');
  const ramValue = unitValue('logram');
  const raiderValue = unitValue('raider');
  const out: string[] = ['## 5. Siege value (Log Ram in the battle and on the Wall, Firecart on other buildings)', ''];
  out.push(
    `Siege numbers in use: Log Ram power ${UNITS.logram.siege?.power ?? 'none'}, max ${UNITS.logram.siege?.maxLevels ?? '-'} levels per step, value ${fmt(unitValue('logram'), 0)}; Firecart power ${f.siege?.power ?? 'none'} point(s) each, max ${f.siege?.maxLevels ?? '-'} level(s) per step, value ${fmt(cartValue, 0)} each (pop ${POP_PER_UNIT.firecart}); ` +
      `SIEGE_BASE_POINTS ${SIEGE_BASE_POINTS}, SIEGE_POINTS_PER_LEVEL ${SIEGE_POINTS_PER_LEVEL} (lowering level L costs ${SIEGE_BASE_POINTS} + ${SIEGE_POINTS_PER_LEVEL} x L points), ` +
      `SIEGE_DURING_SHARE ${SIEGE_DURING_SHARE} (share of the points that fire at the Wall during the battle), SIEGE_LOST_SHARE ${SIEGE_LOST_SHARE} (share of carts counted after a LOST attack). ` +
      `Raider value ${fmt(raiderValue, 0)}. Luck 0, no morale, noLoot.`,
    '',
  );
  const rowsA: Array<Array<string | number>> = [];
  for (const n of [500, 2000]) {
    for (const wall of [10, 22]) {
      const def = defender(n, wall);
      const base = minRaidersWith(0, def);
      for (const c of [0, 10, 25, 50, 100, 200]) {
        const need = minRaidersWith(c, def);
        const r = fight(army({ raider: need, logram: c }), def);
        const savedV = (base - need) * raiderValue;
        const cartsV = c * ramValue;
        rowsA.push([n, wall, c, fmt(need, 0), fmt(base - need, 0), fmt(savedV, 0), fmt(cartsV, 0), fmt(savedV - cartsV, 0), r.wallDuring, fmt(r.defensePower, 0)]);
      }
    }
  }
  out.push('### 5a. In the battle: Raiders saved by Log Rams (smallest Raider count that wins, rams sent)');
  out.push(table(['N def pop', 'Wall', 'carts', 'min Raiders', 'Raiders saved', 'value saved', 'value of carts', 'net (saved - carts)', 'Wall during battle', 'D'], rowsA));

  const rowsB: Array<Array<string | number>> = [];
  const targets: Array<[BuildingId, number]> = [['wall', 10], ['wall', 22], ['bannerhall', 4], ['barracks', 20], ['lumber', 25], ['storehouse', 25]];
  for (const [b, level] of targets) {
    for (const k of [1, 2]) {
      const c = cartsToLower(b, level, k);
      let rebuild = 0;
      for (let l = level; l > level - k; l--) rebuild += value(buildingCost(b, l));
      const cost = c * (b === 'wall' ? ramValue : cartValue);
      rowsB.push([`${BUILDINGS[b].name} ${level}`, siegeFloor(b), k, fmt(c, 0), fmt(cost, 0), fmt(rebuild, 0), fmt(rebuild / cost, 2)]);
    }
  }
  out.push('', '### 5b. After a WON battle: surviving siege units needed to lower the building (Wall: Log Rams; others: Firecarts picked; after step only, no during-the-battle Wall step)');
  out.push(table(['building', 'floor', 'levels lowered', 'surviving carts', 'carts value', 'defender rebuild cost (value, money only)', 'defender loss / cart cost'], rowsB));
  out.push('', 'Carts to SEND = surviving carts / (1 - attacker loss share of the battle). Rebuild time is not counted.');
  return out.join('\n');
}

// ---- Overrides ---------------------------------------------------------------------------------------

const ACTIVE_OVERRIDES: string[] = [];

/** `--set unit.field=number` (also `unit.cost.wood=5`, `firecart.siege.power=3`, short `firecart.power=3`): changes UNITS in this process only. */
function applyOverrides(args: string[]): void {
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--set') continue;
    const spec = args[i + 1] ?? '';
    const eq = spec.indexOf('=');
    const path = (eq < 0 ? spec : spec.slice(0, eq)).split('.');
    const num = Number(eq < 0 ? NaN : spec.slice(eq + 1));
    const id = path[0] ?? '';
    if (eq < 0 || !Number.isFinite(num) || path.length < 2 || !(UNIT_IDS as readonly string[]).includes(id)) {
      throw new Error(`Bad --set "${spec}": use <unit>.<field>=<number>, unit one of ${UNIT_IDS.join(', ')}.`);
    }
    const unit = UNITS[id as UnitId] as unknown as Record<string, unknown>;
    let obj = unit;
    const mid = path.slice(1, -1);
    if (mid.length === 0 && !(path[1] as string in unit) && unit.siege && typeof unit.siege === 'object') obj = unit.siege as Record<string, unknown>; // firecart.power
    for (const key of mid) {
      const next = obj[key];
      if (typeof next !== 'object' || next === null) throw new Error(`Bad --set "${spec}": no field "${key}".`);
      obj = next as Record<string, unknown>;
    }
    const last = path[path.length - 1] as string;
    if (typeof obj[last] !== 'number') throw new Error(`Bad --set "${spec}": "${path.slice(1).join('.')}" is not a number field of ${id}.`);
    const was = obj[last];
    obj[last] = num;
    ACTIVE_OVERRIDES.push(`${spec} (was ${String(was)})`);
  }
}

// ---- Flags -----------------------------------------------------------------------------------------

/** Units with a role of their own (scout, founder, siege): left out of the combat flags. */
const SPECIAL: UnitId[] = ['pathfinder', 'chieftain', 'firecart'];

function flags(): string {
  const out: string[] = ['## Flags (derived from the tables above)', ''];
  const metrics: Array<{ name: string; of: (u: UnitId) => number }> = [
    { name: 'attack / value', of: (u) => UNITS[u].attack / unitValue(u) },
    { name: 'def vs foot / value', of: (u) => UNITS[u].defenseInfantry / unitValue(u) },
    { name: 'def vs riders / value', of: (u) => UNITS[u].defenseCavalry / unitValue(u) },
    { name: 'carry / value', of: (u) => UNITS[u].carry / unitValue(u) },
    { name: 'attack / pop', of: (u) => UNITS[u].attack / POP_PER_UNIT[u] },
    { name: 'def vs foot / pop', of: (u) => UNITS[u].defenseInfantry / POP_PER_UNIT[u] },
    { name: 'def vs riders / pop', of: (u) => UNITS[u].defenseCavalry / POP_PER_UNIT[u] },
    { name: 'carry / pop', of: (u) => UNITS[u].carry / POP_PER_UNIT[u] },
    { name: 'speed', of: (u) => UNITS[u].speed },
  ];
  const combat = UNIT_IDS.filter((u) => !SPECIAL.includes(u));
  const lines: string[] = [];

  // 1. Never worth building: not the best of the combat units in ANY metric.
  const bestIn = (m: (typeof metrics)[number], pool: UnitId[]): UnitId => pool.reduce((a, b) => (m.of(b) > m.of(a) ? b : a));
  const wins = new Map<UnitId, string[]>(combat.map((u) => [u, []]));
  for (const m of metrics) wins.get(bestIn(m, combat))?.push(m.name);
  for (const u of combat) {
    if ((wins.get(u) ?? []).length === 0) lines.push(`NEVER WORTH BUILDING: ${UNITS[u].name} is not the best combat unit in any of the ${metrics.length} metrics (value, pop, speed, carry).`);
  }
  // Pareto: another combat unit is at least as good in every per-value metric (and speed) and better in one.
  for (const x of combat) {
    const dom = combat.find((y) => y !== x && metrics.slice(0, 4).every((m) => m.of(y) >= m.of(x)) && UNITS[y].speed >= UNITS[x].speed && metrics.some((m) => m.of(y) > m.of(x)));
    if (dom) lines.push(`DOMINATED: ${UNITS[x].name} is beaten or matched by ${UNITS[dom].name} in attack, both defences and carry per value and in speed.`);
  }

  // 2. Outliers: a unit more than 2x the next best in a metric.
  for (const m of metrics) {
    const sorted = [...combat].sort((a, b) => m.of(b) - m.of(a));
    const first = sorted[0] as UnitId;
    const second = sorted[1] as UnitId;
    if (m.of(second) > 0 && m.of(first) > 2 * m.of(second)) lines.push(`OUTLIER: ${UNITS[first].name} has ${fmt(m.of(first) / m.of(second), 1)}x the ${UNITS[second].name} (next best) in ${m.name}.`);
  }
  // Best unit per metric, for reading.
  const bestRows = metrics.map((m) => [m.name, UNITS[bestIn(m, combat)].name, fmt(m.of(bestIn(m, combat)), 2)]);
  out.push(lines.length ? lines.map((l) => `- ${l}`).join('\n') : '- none');
  out.push('', 'Best combat unit per metric (Pathfinder, Chieftain and Firecart left out):');
  out.push(table(['metric', 'best', 'value'], bestRows));
  return out.join('\n');
}

// ---- Main ------------------------------------------------------------------------------------------

export function report(): string {
  return [
    '# Troop analysis (real engine, world speed 1, luck 0)',
    '',
    `Value = wood + food + iron + 10 x gold. Train queue: ${MAX_TRAIN_QUEUE} batches x ${MAX_TRAIN_BATCH} units per building.`,
    `Overrides (UNITS, this run only): ${ACTIVE_OVERRIDES.length ? ACTIVE_OVERRIDES.join(', ') : 'none'}.`,
    '',
    roster(),
    '',
    recruit(),
    '',
    battle(),
    '',
    loot(),
    '',
    firecartValue(),
    '',
    flags(),
  ].join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  applyOverrides(args);
  const text = report();
  console.log(text);
  const outAt = args.indexOf('--out');
  if (outAt >= 0 && args[outAt + 1]) writeFileSync(args[outAt + 1] as string, `${text}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
