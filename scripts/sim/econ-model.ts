// Economy model on the real engine numbers (docs/proposals/economy-vs-genre.md).
// Prints tables: room by level, income / storage / cost per level, days of income to fill the room, time to max a village, points.
// Run: npx tsx scripts/sim/econ-model.ts [--pop current|A|B|C|power] [--markdown]
// It reads the live numbers from packages/engine/src/config.ts (through the economy functions), so rerun it after a config change.
// The population curve can be swapped with --pop to compare options without editing config.ts.

import { BUILDINGS, UNITS, POP_CAP_LEVEL0 } from '../../packages/engine/src/config.ts';
import {
  buildingCost,
  buildTimeMs,
  buildingPop,
  popCapForLevel,
  productionFromLevels,
  storageCapForLevel,
} from '../../packages/engine/src/economy.ts';
import { buildingPoints, levelPoints } from '../../packages/engine/src/world.ts';
import { BUILDING_IDS } from '../../packages/engine/src/types.ts';
import type { BuildingId, BuildingLevels, WorldSettings } from '../../packages/engine/src/types.ts';

const S = { speed: 1 } as unknown as WorldSettings;
const args = process.argv.slice(2);
const popOpt = args.includes('--pop') ? args[args.indexOf('--pop') + 1]! : 'current';

// ---- population room options (all reach 12,000 at level 25) ----
export const POP_OPTIONS: Record<string, (l: number) => number> = {
  current: (l) => popCapForLevel(l),
  // A "gentle": the same shape as today (a fixed factor per level), a lower factor and a bigger start
  A: (l) => (l <= 0 ? POP_CAP_LEVEL0 : Math.round(260 * 1.1731 ** (l - 1))),
  // B "balanced": between A and C
  B: (l) => (l <= 0 ? POP_CAP_LEVEL0 : Math.round(400 * 1.1522 ** (l - 1))),
  // C "income-matched": room grows as fast as production (x1.1244 per level), so the fill time stays about the same at every stage
  C: (l) => (l <= 0 ? POP_CAP_LEVEL0 : Math.round(720 * 1.1244 ** (l - 1))),
  // reference only (needs a new formula in the engine): a power curve
  power: (l) => (l <= 0 ? POP_CAP_LEVEL0 : Math.round(200 + (12000 - 200) * ((l - 1) / 24) ** 1.9)),
};
const room = POP_OPTIONS[popOpt] ?? POP_OPTIONS.current!;

const MAXL: Record<BuildingId, number> = Object.fromEntries(BUILDING_IDS.map((b) => [b, BUILDINGS[b].maxLevel])) as Record<BuildingId, number>;
const f = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const lvlAt = (share: number, b: BuildingId) => Math.max(BUILDINGS[b].startLevel, Math.round(MAXL[b] * share));
const levelsAt = (share: number): BuildingLevels => Object.fromEntries(BUILDING_IDS.map((b) => [b, lvlAt(share, b)])) as BuildingLevels;
const SHARES = [0.25, 0.5, 0.75, 1];

// ---- 1. room by level ----
console.log(`## Room by Longhouse level (${popOpt})`);
console.log('| level | ' + [1, 5, 10, 15, 20, 25].join(' | ') + ' |');
console.log('|---|' + '---|'.repeat(6));
console.log('| room | ' + [1, 5, 10, 15, 20, 25].map((l) => f(room(l))).join(' | ') + ' |');
const popBuildingsAt = (share: number) => BUILDING_IDS.reduce((s, b) => s + buildingPop(b, lvlAt(share, b)), 0);
console.log('| room taken by buildings at the same share of the ladder | ' + SHARES.map((s) => `${f(popBuildingsAt(s))}`).join(' / ') + ' |');

// ---- 2. income, storage, cost of a level, per share of the ladder ----
const MAIN: BuildingId[] = ['hall', 'lumber', 'farm', 'longhouse', 'mine', 'storehouse'];
const resSum = (c: { wood: number; food: number; iron: number; gold: number }) => c.wood + c.food + c.iron;
console.log('\n## Income, storage and price of the next level, villages with every building at the same share of the ladder (speed 1)');
console.log('| share | Lumber level | wood/h | food/h | iron/h | gold/h | storage | room | avg price of next level (w+f+i) | hours of income per level | hours to fill storage |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const sh of SHARES) {
  const lv = levelsAt(sh);
  const p = productionFromLevels(lv, 1);
  const inc = p.wood + p.food + p.iron;
  const st = storageCapForLevel(lv.storehouse);
  const costs = MAIN.map((b) => resSum(buildingCost(b, Math.min(MAXL[b], lv[b] + 1))));
  const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
  console.log(`| ${sh * 100}% | ${lv.lumber} | ${f(p.wood)} | ${f(p.food)} | ${f(p.iron)} | ${f(p.gold, 1)} | ${f(st)} | ${f(room(lv.longhouse))} | ${f(avg)} | ${f(avg / inc, 1)} | ${f(st / Math.min(p.wood, p.food, p.iron), 1)} |`);
}

// ---- 3. days of income to fill the room with a mixed army ----
// Mixed army by population: 35% Pikeman, 20% Shieldbearer, 25% Raider, 20% in Elk Riders (pop 2).
const MIX: Array<[keyof typeof UNITS, number]> = [['pikeman', 0.35], ['guard', 0.2], ['raider', 0.25], ['outrider', 0.2]];
const perPop = { wood: 0, food: 0, iron: 0, gold: 0 };
for (const [u, share] of MIX) {
  const def = UNITS[u];
  const pop = def.id === 'outrider' ? 2 : 1;
  for (const r of ['wood', 'food', 'iron', 'gold'] as const) perPop[r] += (share * def.cost[r]) / pop;
}
console.log('\n## Days of the village\'s own income to fill its free room with a mixed army (35% Pikeman, 20% Shieldbearer, 25% Raider, 20% Elk Rider by population)');
console.log(`cost per population: ${f(perPop.wood, 1)} wood, ${f(perPop.food, 1)} food, ${f(perPop.iron, 1)} iron, ${f(perPop.gold, 2)} gold`);
console.log('| share | room | free room | resources needed (w+f+i) | days at own income, no spending on anything else |');
console.log('|---|---|---|---|---|');
for (const sh of SHARES) {
  const lv = levelsAt(sh);
  const p = productionFromLevels(lv, 1);
  const free = Math.max(0, room(lv.longhouse) - popBuildingsAt(sh));
  const need = { wood: free * perPop.wood, food: free * perPop.food, iron: free * perPop.iron };
  const hours = Math.max(need.wood / p.wood, need.food / p.food, need.iron / p.iron, p.gold > 0 ? (free * perPop.gold) / p.gold : 0);
  console.log(`| ${sh * 100}% | ${f(room(lv.longhouse))} | ${f(free)} | ${f(need.wood + need.food + need.iron)} | ${f(hours / 24, 1)} |`);
}

// ---- 4. time to max a village (one builder, no troops, greedy: lowest share first) ----
type Sim = { days: number; daysHallFixed: number };
function timeToMax(hallFixed: boolean): number {
  const lv: BuildingLevels = Object.fromEntries(BUILDING_IDS.map((b) => [b, BUILDINGS[b].startLevel])) as BuildingLevels;
  if (hallFixed) lv.hall = MAXL.hall;
  const stock = { wood: 600, food: 600, iron: 600, gold: 100 };
  let t = 0; // hours
  const hourStep = 0.25;
  let safety = 0;
  while (BUILDING_IDS.some((b) => lv[b] < MAXL[b]) && safety++ < 100000) {
    // pick: the building with the lowest level/max share; the Longhouse when room is short
    const used = BUILDING_IDS.reduce((s, b) => s + buildingPop(b, lv[b]), 0);
    const cands = BUILDING_IDS.filter((b) => lv[b] < MAXL[b]).sort((a, b) => lv[a] / MAXL[a] - lv[b] / MAXL[b]);
    let pick: BuildingId | undefined;
    for (const b of cands) {
      const req = BUILDINGS[b].requires as Partial<Record<BuildingId, number>>;
      if (Object.entries(req).some(([rb, rl]) => lv[rb as BuildingId] < (rl as number))) continue;
      const extra = buildingPop(b, lv[b] + 1) - buildingPop(b, lv[b]);
      if (used + extra > room(lv.longhouse) && b !== 'longhouse') continue;
      pick = b;
      break;
    }
    if (!pick) pick = lv.longhouse < MAXL.longhouse ? 'longhouse' : cands[0]!;
    const cost = buildingCost(pick, lv[pick] + 1);
    // wait until affordable (storage caps may block: then raise the storehouse first, rare)
    const cap = storageCapForLevel(lv.storehouse);
    while ((stock.wood < cost.wood || stock.food < cost.food || stock.iron < cost.iron || stock.gold < cost.gold) && safety++ < 1000000) {
      const p = productionFromLevels(lv, 1);
      stock.wood = Math.min(cap, stock.wood + p.wood * hourStep);
      stock.food = Math.min(cap, stock.food + p.food * hourStep);
      stock.iron = Math.min(cap, stock.iron + p.iron * hourStep);
      stock.gold = Math.min(cap, stock.gold + p.gold * hourStep);
      t += hourStep;
      if (cost.wood > cap || cost.food > cap || cost.iron > cap) {
        pick = 'storehouse';
        break;
      }
    }
    const c2 = buildingCost(pick, lv[pick] + 1);
    stock.wood -= c2.wood; stock.food -= c2.food; stock.iron -= c2.iron; stock.gold -= c2.gold;
    const dur = buildTimeMs(pick, lv[pick] + 1, lv.hall, S) / 3600000;
    // while it builds, income accrues in steps
    for (let h = 0; h < dur; h += hourStep) {
      const p = productionFromLevels(lv, 1);
      const cap2 = storageCapForLevel(lv.storehouse);
      const step = Math.min(hourStep, dur - h);
      stock.wood = Math.min(cap2, stock.wood + p.wood * step);
      stock.food = Math.min(cap2, stock.food + p.food * step);
      stock.iron = Math.min(cap2, stock.iron + p.iron * step);
      stock.gold = Math.min(cap2, stock.gold + p.gold * step);
    }
    t += dur;
    lv[pick]++;
  }
  return t / 24;
}
// pure build-time sum, Town Hall already at 25 (no waiting for resources), as in BALANCE 13
let sumDays = 0;
let totalCost = 0;
for (const b of BUILDING_IDS) for (let l = BUILDINGS[b].startLevel + 1; l <= MAXL[b]; l++) {
  sumDays += buildTimeMs(b, l, 25, S) / 86400000;
  const c = buildingCost(b, l);
  totalCost += c.wood + c.food + c.iron + 10 * c.gold;
}
console.log('\n## Time to max a village (speed 1, one builder, no troops)');
console.log(`- Sum of all build times with the Town Hall already at max: ${f(sumDays, 1)} days (BALANCE 13 method; target about 25)`);
console.log(`- Price of every level of every building: ${f(totalCost / 1e6, 2)} million (wood + food + iron + 10 x gold)`);
console.log(`- Greedy build with real income and the Town Hall climbing as it goes (no troops): ${f(timeToMax(false), 1)} days`);

// ---- 5. points ----
console.log('\n## Village points at the same share of the ladder');
console.log('| share | points of the village | points of the last level of Town Hall | of Lumber Camp | share of a maxed village |');
console.log('|---|---|---|---|---|');
const pts = (lv: BuildingLevels) => BUILDING_IDS.reduce((s, b) => s + buildingPoints(b, lv[b]), 0);
const full = pts(levelsAt(1));
for (const sh of SHARES) {
  const lv = levelsAt(sh);
  console.log(`| ${sh * 100}% | ${f(pts(lv))} | ${levelPoints('hall', lv.hall)} | ${levelPoints('lumber', lv.lumber)} | ${f((pts(lv) / full) * 100, 1)}% |`);
}
console.log(`\nmaxed village = ${f(full)} points; Chieftains needed = 1 + floor(points / 12,000), at most 3`);
