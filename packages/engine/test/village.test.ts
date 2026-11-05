import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BUILDINGS,
  DEFAULT_WORLD_CONFIG,
  NPC_GROWTH_ORDER,
  NPC_MAX_LEVEL,
  NPC_START_RESOURCE_SHARE,
  UNITS,
  GameError,
  MAX_BUILD_QUEUE,
  MAX_TRAIN_QUEUE,
  applyBuild,
  applyTrain,
  checkBuild,
  checkTrain,
  createNpcVillage,
  createPlayerVillage,
  populationCap,
  populationUsage,
  storageCap,
  buildTimeMs,
  buildingCost,
  settleVillage,
  setWorldConfigValue,
  trainTimeMs,
} from '../src/index.ts';
import type { VillageState, WorldSettings } from '../src/index.ts';
import { HOUR, S1, S10, near, village } from './helpers.ts';

/** Settings of a world whose abandoned villages do not build (npc.selfBuild off). */
const NO_SELF_BUILD: WorldSettings = { ...S1, config: setWorldConfigValue(DEFAULT_WORLD_CONFIG, 'npc.selfBuild', false) };

const expectGameError = (fn: () => unknown, code: string): void => {
  assert.throws(fn, (e: unknown) => e instanceof GameError && e.code === code);
};

describe('village creation', () => {
  it('player village starts with start resources and start levels', () => {
    const v = createPlayerVillage(1234);
    assert.equal(v.lastUpdate, 1234);
    assert.deepEqual(v.resources, { wood: 600, food: 600, iron: 600, gold: 100 });
    for (const def of Object.values(BUILDINGS)) assert.equal(v.buildings[def.id], def.startLevel);
    assert.equal(v.npc, undefined);
    assert.deepEqual(v.buildQueue, []);
  });

  it('abandoned village of tier T gets tier levels, half-full storage and a full garrison', () => {
    const v = createNpcVillage(3, 500);
    assert.deepEqual(v.npc, { tier: 3, growthSteps: 0, createdAt: 500 });
    assert.equal(v.buildings.hall, 3);
    assert.equal(v.buildings.lumber, 6);
    assert.equal(v.buildings.storehouse, 6);
    assert.equal(v.buildings.wall, 2);
    assert.equal(v.buildings.vault, 2);
    assert.equal(v.buildings.barracks, 0);
    assert.equal(v.buildings.goldmine, 2);
    // Gold is rare: a small per-tier stock instead of half the cap.
    const half = Math.floor(storageCap(v) * NPC_START_RESOURCE_SHARE);
    assert.deepEqual(v.resources, { wood: half, food: half, iron: half, gold: 120 });
    assert.equal(v.troops.pikeman, 12);
    assert.equal(v.troops.guard, 6);
    assert.equal(v.troops.raider, 0);
    assert.equal(createNpcVillage(1, 0).buildings.wall, 0);
    expectGameError(() => createNpcVillage(0, 0), 'invalid_input');
    expectGameError(() => createNpcVillage(6, 0), 'invalid_input');
    expectGameError(() => createNpcVillage(1.5, 0), 'invalid_input');
  });
});

describe('settleVillage', () => {
  it('is a no-op (but a copy) when t <= lastUpdate or t is not finite', () => {
    const v = village();
    for (const t of [0, -5, Number.NaN, Infinity]) {
      const out = settleVillage(v, t, S1);
      assert.deepEqual(out, v);
      assert.notEqual(out, v);
    }
  });

  it('accrues production per hour and respects world speed', () => {
    const v = village();
    const out = settleVillage(v, HOUR / 2, S1);
    assert.ok(near(out.resources.wood, 615));
    assert.ok(near(out.resources.food, 620));
    assert.ok(near(out.resources.gold, 100));
    assert.equal(out.lastUpdate, HOUR / 2);
    const fast = settleVillage(v, HOUR / 2, S10);
    assert.ok(near(fast.resources.wood, 750));
  });

  it('applies new production rates from the moment a build completes', () => {
    const v = applyBuild(village(), 'lumber', 0, S1); // level 2 takes 468 s, costs 63/50/38
    assert.equal(v.buildQueue[0]?.finishAt, 468_000);
    const out = settleVillage(v, HOUR, S1);
    assert.equal(out.buildings.lumber, 2);
    assert.equal(out.buildQueue.length, 0);
    // 537 left after paying; 30/h for 468 s, then 35/h (level 2 = round(30*1.17)) for the remaining 3132 s
    assert.ok(near(out.resources.wood, 537 + (30 * 468) / 3600 + (35 * 3132) / 3600, 1e-6));
    // Settling in two steps gives the same result as one.
    const half = settleVillage(v, 1_800_000, S1);
    assert.deepEqual(settleVillage(half, HOUR, S1).resources, out.resources);
  });

  it('handles several build completions in one span, in order', () => {
    let v = applyBuild(village(), 'farm', 0, S1);
    v = applyBuild(v, 'lumber', 0, S1);
    const [a, b] = v.buildQueue;
    assert.ok(a && b && b.startAt === a.finishAt);
    const mid = settleVillage(v, a.finishAt + 1, S1);
    assert.equal(mid.buildings.farm, 2);
    assert.equal(mid.buildings.lumber, 1);
    assert.equal(mid.buildQueue.length, 1);
    const end = settleVillage(v, b.finishAt + HOUR, S1);
    assert.equal(end.buildings.lumber, 2);
    assert.equal(end.buildQueue.length, 0);
  });

  it('clamps to the storage cap and never reduces an amount already above it', () => {
    const v = village({ resources: { wood: 990, gold: 1500 } });
    const out = settleVillage(v, 100 * HOUR, S1);
    assert.equal(out.resources.wood, 1000);
    assert.equal(out.resources.food, 1000);
    assert.equal(out.resources.iron, 1000);
    assert.equal(out.resources.gold, 1500); // above cap: untouched
  });

  it('uses the old cap until a storehouse upgrade finishes', () => {
    const v = village({ resources: { wood: 990 } });
    v.buildQueue.push({ building: 'storehouse', targetLevel: 2, startAt: 0, finishAt: HOUR });
    const atFinish = settleVillage(v, HOUR, S1);
    assert.equal(atFinish.resources.wood, 1000); // clamped by the old cap (would be 1020)
    assert.equal(atFinish.buildings.storehouse, 2);
    const later = settleVillage(v, 2 * HOUR, S1);
    assert.ok(near(later.resources.wood, 1030)); // new cap 1240 applies after completion
  });

  it('trains units one by one and drops finished batches', () => {
    const v0 = village({ buildings: { barracks: 1 }, resources: { wood: 1000, food: 1000, iron: 1000 } });
    const v = applyTrain(v0, 'pikeman', 3, 0, S1); // 270 s each
    assert.equal(settleVillage(v, 269_999, S1).troops.pikeman, 0);
    assert.equal(settleVillage(v, 270_000, S1).troops.pikeman, 1);
    assert.equal(settleVillage(v, 539_999, S1).troops.pikeman, 1);
    const two = settleVillage(v, 540_000, S1);
    assert.equal(two.troops.pikeman, 2);
    assert.equal(two.trainQueues.barracks[0]?.done, 2);
    const all = settleVillage(two, 810_000, S1);
    assert.equal(all.troops.pikeman, 3);
    assert.equal(all.trainQueues.barracks.length, 0);
    assert.equal(settleVillage(v, 10 * HOUR, S1).troops.pikeman, 3);
  });

  it('queued batches run back to back in the same building', () => {
    let v = village({ buildings: { barracks: 1 }, resources: { wood: 1000, food: 1000, iron: 1000 } });
    v = applyTrain(v, 'pikeman', 2, 0, S1);
    v = applyTrain(v, 'pikeman', 1, 10_000, S1);
    assert.equal(v.trainQueues.barracks[1]?.startAt, 540_000);
    assert.equal(settleVillage(v, 809_999, S1).troops.pikeman, 2);
    assert.equal(settleVillage(v, 810_000, S1).troops.pikeman, 3);
  });

  it('troops eat no food: food grows at the farm rate while units train and with a big army', () => {
    const foodLeft = 700; // after paying the batch
    const v0 = village({ buildings: { barracks: 1 }, resources: { wood: 1000, food: UNITS.pikeman.cost.food * 10 + foodLeft, iron: 1000 } });
    const v = applyTrain(v0, 'pikeman', 10, 0, S1); // pays the food; 270 s per unit
    const mid = settleVillage(v, 1_350_000, S1);
    assert.equal(mid.troops.pikeman, 5);
    assert.ok(near(mid.resources.food, foodLeft + (40 * 1350) / 3600));
    const end = settleVillage(v, 2 * HOUR, S1);
    assert.equal(end.troops.pikeman, 10);
    assert.ok(near(end.resources.food, foodLeft + 40 * 2));
    const big = village({ troops: { pikeman: 200 }, away: { raider: 50 }, resources: { food: 10 } });
    assert.ok(near(settleVillage(big, 5 * HOUR, S1).resources.food, 10 + 40 * 5));
  });

  it('abandoned villages produce like any village', () => {
    const v = createNpcVillage(1, 0);
    const out = settleVillage(v, HOUR / 4, NO_SELF_BUILD);
    // level 2 farm = round(40*1.17) = 47/h
    assert.ok(near(out.resources.food, v.resources.food + 47 / 4, 1e-6));
  });
});

describe('abandoned village builds from its own stock (owner 2026-11-05)', () => {
  const startOf = (tier = 1, seed?: number): VillageState => createNpcVillage(tier, 0, seed);
  const levels = (v: VillageState): number => Object.values(v.buildings).reduce((x, y) => x + y, 0);
  const ORDER = [...new Set(NPC_GROWTH_ORDER)];

  it('pays the next level from its stock and finishes it after the normal build time', () => {
    const v0 = startOf();
    const lvl = v0.buildings.lumber + 1;
    const cost = buildingCost('lumber', lvl);
    const early = settleVillage(v0, 1000, S1); // one second in: the first build is paid and queued, not finished
    assert.equal(early.buildQueue.length, 1);
    const job = early.buildQueue[0]!;
    assert.deepEqual([job.building, job.targetLevel, job.startAt], ['lumber', lvl, 0]);
    assert.equal(job.finishAt, buildTimeMs('lumber', lvl, v0.buildings.hall, S1));
    assert.equal(early.buildings.lumber, v0.buildings.lumber);
    assert.ok(early.resources.wood < v0.resources.wood - cost.wood + 20, 'the cost left the stock');
    assert.ok(early.resources.wood > v0.resources.wood - cost.wood - 1);
    const done = settleVillage(early, job.finishAt, S1);
    assert.equal(done.buildings.lumber, lvl);
    assert.ok(done.buildQueue.length <= 1, 'the next build may already be queued');
    // speed divides the build time like for everyone
    assert.equal(settleVillage(v0, 1000, S10).buildQueue[0]!.finishAt, buildTimeMs('lumber', lvl, v0.buildings.hall, S10));
  });

  it('follows its build order, one build at a time', () => {
    const seenJob = new Set<string>();
    let v = startOf();
    const seen: string[] = [];
    for (let t = 20_000; seen.length < NPC_GROWTH_ORDER.length && t < 2000 * HOUR; t += 20_000) {
      v = settleVillage(v, t, S1);
      assert.ok(v.buildQueue.length <= 1, 'never more than one build queued');
      const job = v.buildQueue[0];
      if (job && (seen.length === 0 || job.startAt > 0) && !seenJob.has(`${job.building}${job.targetLevel}`)) {
        seenJob.add(`${job.building}${job.targetLevel}`);
        seen.push(job.building);
      }
    }
    assert.deepEqual(seen, [...NPC_GROWTH_ORDER]);
  });

  it('a village raided empty has nothing to build with and stays small; an unraided one grows', () => {
    const rich = startOf();
    const raided = startOf();
    for (const r of ['wood', 'food', 'iron', 'gold'] as const) raided.resources[r] = 0;
    const t = 20 * HOUR; // the raided village makes about 4 + 4 + 3 ... per hour: far too little for a first level in 20 h
    const a = settleVillage(rich, t, S1);
    const b = settleVillage(raided, t, S1);
    assert.ok(levels(a) > levels(rich) + 3, 'the unraided one built several levels');
    // Raided empty again right after the first build is paid: it ends with far fewer levels.
    assert.ok(levels(b) < levels(a));
    // Whatever a raid takes, the village does not conjure resources: total spent <= start stock + production.
    const emptied = { ...a, resources: { wood: 0, food: 0, iron: 0, gold: 0 }, buildQueue: [] };
    const after = settleVillage(emptied, t + 2 * HOUR, S1);
    assert.ok(levels(after) - levels(a) <= 1);
  });

  it('never builds without enough stock: no resource goes below zero and a build waits for the missing resource', () => {
    const v = startOf();
    v.resources = { wood: 0, food: 100000, iron: 100000, gold: 0 };
    const out = settleVillage(v, 30 * HOUR, S1);
    assert.ok(Object.values(out.resources).every((x) => x >= 0));
    const first = out.buildQueue[0] ?? null;
    // wood production at the time of the first build tells when it could start: never earlier
    const woodPerHour = Math.round(30 * 1.17 ** (v.buildings.lumber - 1)); // PRODUCTION_BASE.lumber = 30 (config)
    if (first) assert.ok(first.startAt >= (buildingCost('lumber', v.buildings.lumber + 1).wood / woodPerHour) * HOUR * 0.99);
  });

  it('settles a long downtime in one go, in time order: same result as settling in many small steps', () => {
    for (const seed of [undefined, 5]) {
      const v = startOf(2, seed);
      const once = settleVillage(v, 400 * HOUR, S1);
      let stepped = v;
      for (let h = 7; h <= 400; h += 7) stepped = settleVillage(stepped, h * HOUR, S1);
      stepped = settleVillage(stepped, 400 * HOUR, S1);
      assert.deepEqual(once.buildings, stepped.buildings);
      assert.deepEqual(once.buildQueue.map((j) => j.building), stepped.buildQueue.map((j) => j.building));
      for (const r of ['wood', 'food', 'iron', 'gold'] as const) assert.ok(near(once.resources[r], stepped.resources[r], 1e-3 * Math.max(1, once.resources[r])));
      assert.ok(levels(once) > levels(v) + 10, 'many builds happened in a single settle');
    }
  });

  it('seeded villages start like a player village and build in their own order', () => {
    const player = createPlayerVillage(0);
    const a = createNpcVillage(5, 0, 1);
    assert.deepEqual(a.buildings, player.buildings);
    assert.deepEqual(a.resources, player.resources);
    assert.equal(a.npc?.growthSeed, 1);
    const firstBuild = (seed: number): string => settleVillage(createNpcVillage(1, 0, seed), 1, S1).buildQueue[0]!.building;
    assert.equal(firstBuild(7), firstBuild(7));
    assert.ok(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(firstBuild)).size > 1);
  });

  it('does nothing when the world switched self-building off', () => {
    const v = startOf(3);
    const out = settleVillage(v, 500 * HOUR, NO_SELF_BUILD);
    assert.deepEqual(out.buildings, v.buildings);
    assert.deepEqual(out.buildQueue, []);
  });

  it('never trains or regains troops (owner 2026-11-05): the starting garrison stays, what a raid kills stays dead', () => {
    const v = startOf(); // Town Hall 1: garrison 4 pikemen + 2 shieldbearers at the start
    assert.equal(v.troops.pikeman, 4);
    assert.equal(v.troops.guard, 2);
    const grown = settleVillage(v, 300 * HOUR, S1);
    assert.ok(grown.buildings.hall >= 2);
    assert.equal(grown.troops.pikeman, 4);
    assert.equal(grown.troops.guard, 2);
    assert.deepEqual(grown.trainQueues, { barracks: [], stables: [], bannerhall: [] });
    v.troops.pikeman = 1;
    v.troops.guard = 0;
    const later = settleVillage(v, 300 * HOUR, S1);
    assert.equal(later.troops.pikeman, 1);
    assert.equal(later.troops.guard, 0);
    assert.ok(later.npc && later.npc.growthSteps > 0);
  });

  it('stops at the max level and is cheap even after an absurdly long downtime', () => {
    const v = startOf(5);
    const start = performance.now();
    const out = settleVillage(v, 1e6 * HOUR, S1);
    assert.ok(performance.now() - start < 200);
    for (const b of ORDER) assert.equal(out.buildings[b], Math.max(NPC_MAX_LEVEL, startOf(5).buildings[b]));
    assert.equal(out.troops.pikeman, 20); // the start garrison of tier 5 (Town Hall 5): no growth, no refill
    assert.equal(out.troops.guard, 10);
    assert.equal(out.buildQueue.length, 0);
    // Buildings outside the order never grow.
    assert.equal(out.buildings.barracks, 0);
    assert.equal(out.buildings.stables, 0);
  });

  it('a state saved with the old growth timer (growthSteps, createdAt long ago, empty queue) just carries on from its pointer', () => {
    const old = startOf(2);
    old.npc = { tier: 2, growthSteps: 3, createdAt: -90 * 24 * HOUR }; // pointer 3 -> the 4th entry of the order
    old.lastUpdate = 0;
    const out = settleVillage(old, 1000, S1);
    assert.equal(out.buildQueue[0]?.building, NPC_GROWTH_ORDER[3]);
    const later = settleVillage(old, 200 * HOUR, S1);
    assert.ok(levels(later) > levels(old) + 5);
    assert.equal(later.troops.pikeman, old.troops.pikeman);
  });
});

describe('checkBuild / applyBuild', () => {
  it('returns target level, cost and time, and applyBuild pays and queues', () => {
    const v = village();
    const c = checkBuild(v, 'lumber', 0, S1);
    assert.ok(c.ok);
    if (c.ok) {
      assert.equal(c.targetLevel, 2);
      assert.deepEqual(c.cost, { wood: 63, food: 50, iron: 38, gold: 0 });
      assert.equal(c.timeMs, 468_000);
    }
    const out = applyBuild(v, 'lumber', 5_000, S1);
    assert.deepEqual(out.buildQueue, [{ building: 'lumber', targetLevel: 2, startAt: 5_000, finishAt: 473_000 }]);
    assert.ok(near(out.resources.wood, 600 + 30 * (5 / 3600) - 63));
  });

  it('the same building twice targets the next level and starts after the first job', () => {
    let v = applyBuild(village(), 'lumber', 0, S1);
    v = applyBuild(v, 'lumber', 0, S1);
    assert.deepEqual(
      v.buildQueue.map((j) => [j.targetLevel, j.startAt, j.finishAt]),
      [
        [2, 0, 468_000],
        [3, 468_000, 468_000 + 608_400],
      ],
    );
  });

  it('everyone has the same queue: 2 build jobs (the premium queue was removed)', () => {
    assert.equal(MAX_BUILD_QUEUE, 2);
    let v = village({ resources: { wood: 9000, food: 9000, iron: 9000 } });
    for (let i = 0; i < 2; i++) v = applyBuild(v, i % 2 ? 'farm' : 'lumber', 0, S1);
    assert.equal(v.buildQueue.length, 2);
    expectGameError(() => applyBuild(v, 'mine', 0, S1), 'queue_full');
  });

  it('refuses with queue_full beyond MAX_BUILD_QUEUE', () => {
    let v = village({ resources: { wood: 900, food: 900, iron: 900 } });
    for (let i = 0; i < MAX_BUILD_QUEUE; i++) v = applyBuild(v, i % 2 ? 'farm' : 'lumber', 0, S1);
    const c = checkBuild(v, 'mine', 0, S1);
    assert.ok(!c.ok && c.reason === 'queue_full');
    expectGameError(() => applyBuild(v, 'mine', 0, S1), 'queue_full');
  });

  it('refuses with the documented reasons', () => {
    const reason = (v: VillageState, b: string): string | undefined => {
      const c = checkBuild(v, b, 0, S1);
      return c.ok ? undefined : c.reason;
    };
    assert.equal(reason(village({ buildings: { hall: 1 } }), 'barracks'), 'requirements_not_met');
    assert.equal(reason(village({ buildings: { hall: 2 } }), 'barracks'), undefined);
    assert.equal(reason(village(), 'goldmine'), 'requirements_not_met');
    assert.equal(reason(village({ buildings: { lumber: 20 } }), 'lumber'), 'max_level');
    assert.equal(reason(village({ resources: { wood: 10 } }), 'lumber'), 'not_enough_resources');
    // Level 20 hall costs 7266 wood, more than a level 1 storehouse (1000) can ever hold.
    const rich = village({ buildings: { hall: 19 }, resources: { wood: 1000, food: 1000, iron: 1000 } });
    assert.equal(reason(rich, 'hall'), 'exceeds_storage');
    assert.equal(reason(village(), 'castle'), 'invalid_input');
    assert.equal(reason(village(), '__proto__'), 'invalid_input');
    assert.equal(reason(village(), 'toString'), 'invalid_input');
    assert.equal(checkBuild(village(), 'lumber', Number.NaN, S1).ok, false);
  });

  it('max level counts jobs already queued', () => {
    const v0 = village({ buildings: { vault: 9, hall: 3 }, resources: { wood: 1000, food: 1000, iron: 1000 } });
    const first = checkBuild(v0, 'vault', 0, S1);
    assert.ok(first.ok && first.targetLevel === 10);
    const v1 = applyBuild(v0, 'vault', 0, S1);
    const second = checkBuild(v1, 'vault', 0, S1);
    assert.ok(!second.ok && second.reason === 'max_level');
    expectGameError(() => applyBuild(v1, 'vault', 0, S1), 'max_level');
  });

  it('requirements use current levels, not queued ones', () => {
    const v = applyBuild(village({ buildings: { hall: 1 } }), 'hall', 0, S1); // hall -> 2 queued
    const c = checkBuild(v, 'barracks', 0, S1);
    assert.ok(!c.ok && c.reason === 'requirements_not_met');
    const later = checkBuild(v, 'barracks', v.buildQueue[0]!.finishAt, S1);
    assert.ok(later.ok);
  });

  it('settles to t first: finished jobs free queue slots and resources arrive', () => {
    let v = village({ resources: { wood: 900, food: 900, iron: 900 } });
    v = applyBuild(v, 'lumber', 0, S1);
    v = applyBuild(v, 'farm', 0, S1);
    assert.ok(!checkBuild(v, 'mine', 0, S1).ok);
    assert.ok(checkBuild(v, 'mine', 2 * HOUR, S1).ok);
  });

  it('uses the Town Hall level when queued for the time', () => {
    const slow = checkBuild(village({ buildings: { hall: 1 } }), 'farm', 0, S1);
    const quick = checkBuild(village({ buildings: { hall: 6 } }), 'farm', 0, S1);
    assert.ok(slow.ok && quick.ok);
    if (slow.ok && quick.ok) assert.ok(quick.timeMs < slow.timeMs);
  });
});

describe('checkTrain / applyTrain', () => {
  const barracksVillage = (): VillageState =>
    village({ buildings: { barracks: 1, storehouse: 10 }, resources: { wood: 5000, food: 5000, iron: 5000, gold: 1000 } });

  it('trainTimeMs follows the training building level and world speed', () => {
    assert.equal(trainTimeMs('pikeman', village({ buildings: { barracks: 1 } }), S1), 270_000);
    assert.equal(trainTimeMs('pikeman', village({ buildings: { barracks: 4 } }), S1), 224_258);
    assert.equal(trainTimeMs('pikeman', village({ buildings: { barracks: 1 } }), S10), 27_000);
  });

  it('returns cost and per-unit time; applyTrain pays up front', () => {
    const v = barracksVillage();
    const c = checkTrain(v, 'pikeman', 4, 0, S1);
    assert.ok(c.ok);
    if (c.ok) {
      assert.deepEqual(c.cost, { wood: UNITS.pikeman.cost.wood * 4, food: UNITS.pikeman.cost.food * 4, iron: UNITS.pikeman.cost.iron * 4, gold: 0 });
      assert.equal(c.perUnitMs, 270_000);
    }
    const out = applyTrain(v, 'pikeman', 4, 0, S1);
    assert.equal(out.resources.wood, 5000 - UNITS.pikeman.cost.wood * 4);
    assert.deepEqual(out.trainQueues.barracks, [{ unit: 'pikeman', count: 4, done: 0, perUnitMs: 270_000, startAt: 0 }]);
  });

  it('refuses when requirements are missing', () => {
    const v = barracksVillage();
    const r = (u: string): string | undefined => {
      const c = checkTrain(v, u, 1, 0, S1);
      return c.ok ? undefined : c.reason;
    };
    assert.equal(r('pikeman'), undefined);
    assert.equal(r('raider'), 'requirements_not_met'); // barracks 2
    assert.equal(r('guard'), 'requirements_not_met'); // barracks 3
    assert.equal(r('outrider'), 'requirements_not_met'); // stables
    assert.equal(r('knight'), 'requirements_not_met');
  });

  it('trains Pathfinders like any other unit (barracks 2)', () => {
    const rich = { wood: 5000, food: 5000, iron: 5000, gold: 1000 };
    const level1 = village({ buildings: { barracks: 1, storehouse: 10 }, resources: rich });
    const refused = checkTrain(level1, 'pathfinder', 1, 0, S1);
    assert.ok(!refused.ok && refused.reason === 'requirements_not_met');
    assert.ok(!refused.ok && /Barracks level 2/.test(refused.message));

    const v = village({ buildings: { barracks: 2, storehouse: 10 }, resources: rich });
    const c = checkTrain(v, 'pathfinder', 4, 0, S1);
    assert.ok(c.ok);
    if (c.ok) {
      assert.deepEqual(c.cost, { wood: UNITS.pathfinder.cost.wood * 4, food: UNITS.pathfinder.cost.food * 4, iron: UNITS.pathfinder.cost.iron * 4, gold: 0 });
      assert.equal(c.perUnitMs, 169_200); // 180 s * 0.94 at barracks level 2
      assert.equal(c.perUnitMs, trainTimeMs('pathfinder', v, S1));
    }
    assert.equal(trainTimeMs('pathfinder', v, S10), 16_920);

    const queued = applyTrain(v, 'pathfinder', 4, 0, S1);
    assert.deepEqual(queued.trainQueues.barracks, [{ unit: 'pathfinder', count: 4, done: 0, perUnitMs: 169_200, startAt: 0 }]);
    assert.deepEqual(queued.trainQueues.stables, []);
    assert.equal(queued.resources.wood, 5000 - UNITS.pathfinder.cost.wood * 4);
    assert.equal(settleVillage(queued, 70_499, S1).troops.pathfinder, 0);
    assert.equal(settleVillage(queued, 169_200, S1).troops.pathfinder, 1);
    assert.equal(settleVillage(queued, 4 * 169_200, S1).troops.pathfinder, 4);
    assert.deepEqual(settleVillage(queued, 4 * 169_200, S1).trainQueues.barracks, []);
    expectGameError(() => applyTrain(level1, 'pathfinder', 1, 0, S1), 'requirements_not_met');
  });

  it('Pathfinders eat no food either: only the population room limits a big batch', () => {
    const v = village({ buildings: { barracks: 2, storehouse: 10, farm: 0 }, resources: { wood: 5000, food: 5000, iron: 5000 } });
    assert.ok(checkTrain(v, 'pathfinder', 21, 0, S1).ok);
    const room = populationCap(v) - populationUsage(v).total;
    assert.ok(!checkTrain(v, 'pathfinder', room + 1, 0, S1).ok);
  });

  it('refuses invalid ids and counts with invalid_input', () => {
    const v = barracksVillage();
    for (const count of [0, -1, 1.5, Number.NaN, Infinity, 1001, '5' as unknown as number]) {
      const c = checkTrain(v, 'pikeman', count, 0, S1);
      assert.ok(!c.ok && c.reason === 'invalid_input', `count ${String(count)}`);
    }
    for (const u of ['dragon', '', 'constructor', undefined as unknown as string]) {
      const c = checkTrain(v, u, 1, 0, S1);
      assert.ok(!c.ok && c.reason === 'invalid_input', `unit ${String(u)}`);
    }
    expectGameError(() => applyTrain(v, 'dragon', 1, 0, S1), 'invalid_input');
    expectGameError(() => applyTrain(v, 'pikeman', 0, 0, S1), 'invalid_input');
  });

  it('refuses when resources are short', () => {
    const v = village({ buildings: { barracks: 1 }, resources: { wood: 100 } });
    const c = checkTrain(v, 'pikeman', 5, 0, S1);
    assert.ok(!c.ok && c.reason === 'not_enough_resources');
    expectGameError(() => applyTrain(v, 'pikeman', 5, 0, S1), 'not_enough_resources');
  });

  it('troops eat no food (owner 2026-11-05): only resources, queue and the population room limit training', () => {
    const stock = { wood: 50_000, food: 5000, iron: 50_000 };
    // Farm level 0 makes 5 food an hour; the old upkeep rule refused anything above 20 pikemen. Now only population matters.
    const v = village({ buildings: { barracks: 1, storehouse: 10, farm: 0 }, resources: stock });
    assert.ok(checkTrain(v, 'pikeman', 21, 0, S1).ok);
    const room = populationCap(v) - populationUsage(v).total;
    assert.ok(room > 21 && room < 1000, `room ${room}`);
    assert.ok(checkTrain(v, 'pikeman', room, 0, S1).ok);
    const full = checkTrain(v, 'pikeman', room + 1, 0, S1);
    assert.ok(!full.ok && full.reason === 'population_full');
    // Units at home, away and queued all use population room.
    const busy = village({ buildings: { barracks: 1, storehouse: 10, farm: 0 }, troops: { pikeman: 15 }, away: { pikeman: 5 }, resources: stock });
    const queued = applyTrain(busy, 'pikeman', 10, 0, S1);
    assert.equal(populationCap(queued) - populationUsage(queued).total, room - 30);
    // World speed changes nothing about the room.
    assert.ok(checkTrain(v, 'pikeman', room, 0, S10).ok);
    assert.ok(!checkTrain(v, 'pikeman', room + 1, 0, S10).ok);
  });

  it('refuses with queue_full beyond MAX_TRAIN_QUEUE batches per building', () => {
    let v = barracksVillage();
    for (let i = 0; i < MAX_TRAIN_QUEUE; i++) v = applyTrain(v, 'pikeman', 1, 0, S1);
    const c = checkTrain(v, 'pikeman', 1, 0, S1);
    assert.ok(!c.ok && c.reason === 'queue_full');
    // Finished batches free their slot.
    assert.ok(checkTrain(v, 'pikeman', 1, 10 * HOUR, S1).ok);
  });

  it('keeps separate queues for barracks and stables', () => {
    const v = village({
      buildings: { barracks: 3, stables: 1, hall: 5, storehouse: 10 },
      resources: { wood: 5000, food: 5000, iron: 5000, gold: 1000 },
    });
    v.researched = ['outrider']; // Outrider needs Drillyard research (docs/GAME_DESIGN.md section 4)
    const out = applyTrain(applyTrain(v, 'pikeman', 1, 0, S1), 'outrider', 1, 0, S1);
    assert.equal(out.trainQueues.barracks.length, 1);
    assert.equal(out.trainQueues.stables.length, 1);
    assert.equal(out.trainQueues.stables[0]?.startAt, 0);
  });
});
