// Realm page helpers: live stock, fullness, sorting, totals, summaries and the paging math.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RealmVillageDto } from '@clanfire/engine';
import { paging } from '../src/views/reports/frame-reports-logic.ts';
import {
  DEFAULT_SORT,
  SORT_KEYS,
  buildSummary,
  fillOf,
  freeSlots,
  liveStock,
  nextSort,
  parseSort,
  popRatio,
  ratioOf,
  realmTotals,
  rowsFit,
  sortVillages,
  stockFullness,
  trainingLines,
  troopEntries,
} from '../src/realm.ts';

const HOUR = 3_600_000;
const T0 = 1_000_000_000_000;

function village(id: number, over: Partial<RealmVillageDto> = {}): RealmVillageDto {
  return {
    id,
    name: `Village ${id}`,
    x: id,
    y: -id,
    points: 100,
    hearth: 'lit',
    claimBy: null,
    holdEndsAt: null,
    protectedUntil: null,
    resources: { wood: 100, food: 100, iron: 100, gold: 100 },
    income: { wood: 60, food: 60, iron: 30, gold: 10 },
    storageCap: 1000,
    population: { used: 50, cap: 100 },
    build: { queue: [], slots: 2 },
    training: [],
    troops: {},
    away: {},
    incoming: { attacks: 0, nextAt: null },
    outgoing: { marches: 0, nextAt: null },
    note: null,
    ...over,
  };
}

test('stock grows with the income since the poll and stops at the cap', () => {
  const v = village(1);
  assert.deepEqual(liveStock(v, T0, T0), v.resources);
  const later = liveStock(v, T0, T0 + HOUR / 2);
  assert.equal(later.wood, 130);
  assert.equal(later.gold, 105);
  assert.equal(liveStock(v, T0, T0 + 100 * HOUR).wood, 1000);
  // A full stock stays as it is; a clock behind the poll never takes stock away.
  assert.equal(liveStock(village(2, { resources: { wood: 1000, food: 0, iron: 0, gold: 0 } }), T0, T0 + HOUR).wood, 1000);
  assert.equal(liveStock(v, T0, T0 - HOUR).wood, 100);
  // A negative income (food) never goes below zero.
  assert.equal(liveStock(village(3, { income: { wood: 0, food: -500, iron: 0, gold: 0 } }), T0, T0 + HOUR).food, 0);
});

test('fullness: ratio, tone and the fullest stock', () => {
  assert.equal(ratioOf(50, 100), 0.5);
  assert.equal(ratioOf(50, 0), 0);
  assert.equal(ratioOf(500, 100), 1);
  assert.equal(fillOf(0.5), 'ok');
  assert.equal(fillOf(0.9), 'near');
  assert.equal(fillOf(1), 'full');
  assert.equal(stockFullness({ wood: 100, food: 900, iron: 0, gold: 0 }, 1000), 0.9);
  assert.equal(popRatio(village(1, { population: { used: 75, cap: 100 } })), 0.75);
});

test('free build slots and the build summary', () => {
  const job = (b: 'hall' | 'wall', level: number, at: number) => ({ building: b, targetLevel: level, finishAt: at });
  assert.equal(freeSlots(village(1)), 2);
  const one = village(1, { build: { queue: [job('hall', 3, T0 + 1000)], slots: 2 } });
  assert.equal(freeSlots(one), 1);
  assert.deepEqual(buildSummary(one), { first: job('hall', 3, T0 + 1000), second: null, more: 0, free: 1 });
  const three = village(1, { build: { queue: [job('hall', 3, 1), job('wall', 2, 2), job('hall', 4, 3)], slots: 3 } });
  assert.equal(buildSummary(three).more, 1);
  assert.equal(buildSummary(three).free, 0);
  assert.equal(freeSlots(village(1, { build: { queue: [job('hall', 3, 1), job('wall', 2, 2), job('hall', 4, 3)], slots: 2 } })), 0);
});

test('sorting: name, points, population, build (free queue first), stock (fullest first), incoming (soonest first, none last)', () => {
  const a = village(1, { name: 'Alder', points: 50, population: { used: 90, cap: 100 }, resources: { wood: 100, food: 100, iron: 100, gold: 100 } });
  const b = village(2, {
    name: 'birch',
    points: 300,
    population: { used: 10, cap: 100 },
    resources: { wood: 1000, food: 0, iron: 0, gold: 0 },
    build: { queue: [{ building: 'hall', targetLevel: 2, finishAt: T0 + 5000 }, { building: 'wall', targetLevel: 1, finishAt: T0 + 9000 }], slots: 2 },
    incoming: { attacks: 2, nextAt: T0 + 60_000 },
  });
  const c = village(3, {
    name: 'Cedar',
    points: 200,
    population: { used: 50, cap: 100 },
    build: { queue: [{ building: 'hall', targetLevel: 2, finishAt: T0 + 1000 }, { building: 'wall', targetLevel: 1, finishAt: T0 + 2000 }], slots: 2 },
    incoming: { attacks: 1, nextAt: T0 + 30_000 },
  });
  const list = [c, b, a];
  const ids = (choice: Parameters<typeof sortVillages>[1]) => sortVillages(list, choice, T0, T0).map((v) => v.id);
  assert.deepEqual(ids({ key: 'name', reverse: false }), [1, 2, 3]); // case-insensitive
  assert.deepEqual(ids({ key: 'name', reverse: true }), [3, 2, 1]);
  assert.deepEqual(ids({ key: 'points', reverse: false }), [2, 3, 1]);
  assert.deepEqual(ids({ key: 'population', reverse: false }), [1, 3, 2]);
  assert.deepEqual(ids({ key: 'build', reverse: false }), [1, 3, 2]); // Alder has an empty queue; Cedar's job ends before Birch's
  assert.deepEqual(ids({ key: 'stock', reverse: false })[0], 2);
  assert.deepEqual(ids({ key: 'incoming', reverse: false }), [3, 2, 1]);
  // The input list is not changed.
  assert.deepEqual(list.map((v) => v.id), [3, 2, 1]);
});

test('a queue with room sorts between an empty queue and a full one', () => {
  const empty = village(1);
  const room = village(2, { build: { queue: [{ building: 'hall', targetLevel: 2, finishAt: T0 + 9999 }], slots: 2 } });
  const full = village(3, { build: { queue: [{ building: 'hall', targetLevel: 2, finishAt: T0 + 1 }], slots: 1 } });
  assert.deepEqual(sortVillages([full, room, empty], { key: 'build', reverse: false }, T0, T0).map((v) => v.id), [1, 2, 3]);
});

test('sort choice: toggle, parse and default', () => {
  assert.deepEqual(nextSort({ key: 'name', reverse: false }, 'name'), { key: 'name', reverse: true });
  assert.deepEqual(nextSort({ key: 'name', reverse: true }, 'points'), { key: 'points', reverse: false });
  assert.deepEqual(parseSort(null), DEFAULT_SORT);
  assert.deepEqual(parseSort('not json'), DEFAULT_SORT);
  assert.deepEqual(parseSort('{"key":"hacked"}'), DEFAULT_SORT);
  assert.deepEqual(parseSort(JSON.stringify({ key: 'stock', reverse: true })), { key: 'stock', reverse: true });
  for (const key of SORT_KEYS) assert.deepEqual(parseSort(JSON.stringify({ key, reverse: false })), { key, reverse: false });
});

test('totals add up stock, income, population, troops, moves and free slots', () => {
  const a = village(1, {
    troops: { pikeman: 10, raider: 5 },
    incoming: { attacks: 2, nextAt: T0 + 5000 },
    outgoing: { marches: 1, nextAt: T0 + 9000 },
    build: { queue: [{ building: 'hall', targetLevel: 2, finishAt: T0 + 1 }], slots: 2 },
  });
  const b = village(2, {
    troops: { pikeman: 4, knight: 1 },
    incoming: { attacks: 1, nextAt: T0 + 1000 },
    outgoing: { marches: 2, nextAt: T0 + 3000 },
    population: { used: 20, cap: 200 },
  });
  const t = realmTotals([a, b], T0, T0);
  assert.equal(t.villages, 2);
  assert.deepEqual(t.resources, { wood: 200, food: 200, iron: 200, gold: 200 });
  assert.deepEqual(t.income, { wood: 120, food: 120, iron: 60, gold: 20 });
  assert.equal(t.cap, 2000);
  assert.deepEqual(t.population, { used: 70, cap: 300 });
  assert.deepEqual(t.troops, { pikeman: 14, raider: 5, knight: 1 });
  assert.deepEqual(t.incoming, { attacks: 3, nextAt: T0 + 1000 });
  assert.deepEqual(t.outgoing, { marches: 3, nextAt: T0 + 3000 });
  assert.equal(t.freeSlots, 3);
  assert.equal(realmTotals([], T0, T0).villages, 0);
});

test('troop entries keep the unit order and drop zeros; training lines cut with a rest', () => {
  assert.deepEqual(troopEntries({ knight: 2, pikeman: 5, guard: 0 }), [['pikeman', 5], ['knight', 2]]);
  assert.deepEqual(troopEntries({}), []);
  const batch = (n: number) => ({ building: 'barracks' as const, unit: 'pikeman' as const, left: n, finishAt: n });
  const r = trainingLines([batch(1), batch(2), batch(3)], 2);
  assert.equal(r.shown.length, 2);
  assert.equal(r.more, 1);
  assert.equal(trainingLines([], 2).more, 0);
});

test('paging: how many rows fit, never fewer than three, and the page split', () => {
  assert.equal(rowsFit(560, 66), 8);
  assert.equal(rowsFit(100, 66), 3);
  assert.equal(rowsFit(Number.NaN, 66), 3);
  assert.equal(rowsFit(500, 0), 3);
  const p = paging(20, 0, 8);
  assert.equal(p.pages, 3);
  assert.equal(p.from, 1);
  assert.equal(p.to, 8);
  const last = paging(20, 5, 8); // clamped
  assert.equal(last.page, 2);
  assert.equal(last.from, 17);
  assert.equal(last.to, 20);
  assert.equal(paging(1, 0, 3).pages, 1);
});

test('the Realm tab shows from the second village on; its route and the Notes page stay reachable', async () => {
  const { navTabs, TABS, MENU_PAGES } = await import('../src/game.ts');
  assert.ok(!navTabs(1).includes('realm'));
  assert.ok(navTabs(2).includes('realm'));
  assert.deepEqual(navTabs(2), TABS);
  assert.deepEqual(navTabs(1), TABS.filter((t) => t !== 'realm'));
  assert.ok(TABS.includes('realm'), 'route still valid with one village');
  assert.ok(MENU_PAGES.includes('notes'));
});

test('the Raid lists tab sits right after Army, only for a player who has the extra; without it the route and page still work', async () => {
  const { navTabs, TABS, RAID_TAB } = await import('../src/game.ts');
  assert.ok(!navTabs(2).includes(RAID_TAB), 'default: no tab');
  assert.ok(!navTabs(2, false).includes(RAID_TAB), 'not entitled: no tab');
  const t = navTabs(2, true);
  assert.equal(t[t.indexOf('army') + 1], 'raids');
  assert.equal(t.length, 9, 'village, realm, map, army, raids, reports, mail, tribe, ranks');
  assert.ok(!navTabs(1, true).includes('realm') && navTabs(1, true).includes('raids'), 'Realm still needs two villages');
  assert.deepEqual(navTabs(2, false), TABS);
});
