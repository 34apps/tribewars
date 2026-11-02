import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BUILDINGS,
  GameError,
  MAX_BUILD_QUEUE,
  MAX_TRAIN_QUEUE,
  applyBuild,
  applyTrain,
  checkBuild,
  checkTrain,
  createNpcVillage,
  createPlayerVillage,
  settleVillage,
  trainTimeMs,
} from '../src/index.ts';
import type { VillageState } from '../src/index.ts';
import { HOUR, S1, S10, near, village } from './helpers.ts';

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
    assert.deepEqual(v.resources, { wood: 1466, food: 1466, iron: 1466, gold: 120 });
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
    const v = applyBuild(village(), 'lumber', 0, S1); // level 2 takes 78 s, costs 63/50/38
    assert.equal(v.buildQueue[0]?.finishAt, 78_000);
    const out = settleVillage(v, HOUR, S1);
    assert.equal(out.buildings.lumber, 2);
    assert.equal(out.buildQueue.length, 0);
    // 537 left after paying; 30/h for 78 s, then 35/h (level 2 = round(30*1.17)) for the remaining 3522 s
    assert.ok(near(out.resources.wood, 537 + (30 * 78) / 3600 + (35 * 3522) / 3600, 1e-6));
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
    const v = applyTrain(v0, 'pikeman', 3, 0, S1); // 90 s each
    assert.equal(settleVillage(v, 89_999, S1).troops.pikeman, 0);
    assert.equal(settleVillage(v, 90_000, S1).troops.pikeman, 1);
    assert.equal(settleVillage(v, 179_999, S1).troops.pikeman, 1);
    const two = settleVillage(v, 180_000, S1);
    assert.equal(two.troops.pikeman, 2);
    assert.equal(two.trainQueues.barracks[0]?.done, 2);
    const all = settleVillage(two, 270_000, S1);
    assert.equal(all.troops.pikeman, 3);
    assert.equal(all.trainQueues.barracks.length, 0);
    assert.equal(settleVillage(v, 10 * HOUR, S1).troops.pikeman, 3);
  });

  it('queued batches run back to back in the same building', () => {
    let v = village({ buildings: { barracks: 1 }, resources: { wood: 1000, food: 1000, iron: 1000 } });
    v = applyTrain(v, 'pikeman', 2, 0, S1);
    v = applyTrain(v, 'pikeman', 1, 10_000, S1);
    assert.equal(v.trainQueues.barracks[1]?.startAt, 180_000);
    assert.equal(settleVillage(v, 269_999, S1).troops.pikeman, 2);
    assert.equal(settleVillage(v, 270_000, S1).troops.pikeman, 3);
  });

  it('keeps food upkeep constant while units train (queued units already eat)', () => {
    const v0 = village({ buildings: { barracks: 1 }, resources: { wood: 1000, food: 500, iron: 1000 } });
    const v = applyTrain(v0, 'pikeman', 10, 0, S1); // pays 300 food; 90 s per unit
    // net food = 40 - 10 per hour from the moment of queuing, however many have finished
    const mid = settleVillage(v, 450_000, S1);
    assert.equal(mid.troops.pikeman, 5);
    assert.ok(near(mid.resources.food, 200 + (30 * 450) / 3600));
    const end = settleVillage(v, 2 * HOUR, S1);
    assert.equal(end.troops.pikeman, 10);
    assert.ok(near(end.resources.food, 200 + 30 * 2));
  });

  it('clamps food at zero when upkeep exceeds production', () => {
    const v = village({ troops: { pikeman: 100 }, resources: { food: 10 } });
    const out = settleVillage(v, 5 * HOUR, S1);
    assert.equal(out.resources.food, 0);
  });

  it('abandoned villages produce without upkeep', () => {
    const v = createNpcVillage(1, 0);
    const out = settleVillage(v, HOUR / 4, { ...S1, npcGrowthHours: 1000 });
    // level 2 farm = round(40*1.17) = 47/h
    assert.ok(near(out.resources.food, v.resources.food + 47 / 4, 1e-6));
  });
});

describe('abandoned village growth', () => {
  const startOf = (tier = 1): VillageState => createNpcVillage(tier, 0);

  it('adds one step per npcGrowthHours, in growth order', () => {
    const v = startOf();
    assert.equal(settleVillage(v, 6 * HOUR - 1, S1).npc?.growthSteps, 0);
    const one = settleVillage(v, 6 * HOUR, S1);
    assert.equal(one.npc?.growthSteps, 1);
    assert.equal(one.buildings.lumber, 3); // order: lumber, farm, mine, storehouse, hall, wall, vault
    const three = settleVillage(v, 18 * HOUR, S1);
    assert.deepEqual([three.buildings.lumber, three.buildings.farm, three.buildings.mine, three.buildings.storehouse], [3, 3, 3, 2]);
    const seven = settleVillage(v, 42 * HOUR, S1);
    assert.deepEqual(
      [seven.buildings.storehouse, seven.buildings.hall, seven.buildings.wall, seven.buildings.vault],
      [3, 2, 1, 1],
    );
  });

  it('steps are not repeated and speed shortens the interval', () => {
    const v = startOf();
    const a = settleVillage(v, 12 * HOUR, S1);
    const b = settleVillage(a, 12 * HOUR + 1000, S1);
    assert.equal(b.npc?.growthSteps, 2);
    assert.deepEqual(b.buildings, a.buildings);
    const fast = settleVillage(v, 0.6 * HOUR, S10);
    assert.equal(fast.npc?.growthSteps, 1);
  });

  it('refills a share of the garrison on each step, never above full', () => {
    const v = startOf();
    v.troops.pikeman = 0;
    v.troops.guard = 0;
    const one = settleVillage(v, 6 * HOUR, S1);
    // hall 1 -> full pikeman 4 / guard 2; regen = ceil(25%) = 1 / 1
    assert.equal(one.troops.pikeman, 1);
    assert.equal(one.troops.guard, 1);
    const four = settleVillage(v, 24 * HOUR, S1); // steps 0-3 raise lumber, farm, mine, storehouse
    assert.equal(four.troops.pikeman, 4);
    assert.equal(four.troops.guard, 2);
    // Step 4 raises the hall to 2: full becomes 8 / 4 and regen 2 / 1.
    const five = settleVillage(v, 30 * HOUR, S1);
    assert.equal(five.buildings.hall, 2);
    assert.equal(five.troops.pikeman, 6);
    assert.equal(five.troops.guard, 3);
    const full = settleVillage(startOf(), 6 * HOUR, S1);
    assert.equal(full.troops.pikeman, 4); // already full, stays full
  });

  it('stops at the max level and is cheap even when thousands of steps are overdue', () => {
    const v = startOf(5);
    const start = performance.now();
    const out = settleVillage(v, 1e6 * HOUR, S1);
    assert.ok(performance.now() - start < 200);
    for (const b of ['lumber', 'farm', 'mine', 'storehouse', 'hall', 'wall', 'vault', 'goldmine'] as const) {
      assert.equal(out.buildings[b], 10);
    }
    assert.equal(out.troops.pikeman, 40);
    assert.equal(out.troops.guard, 20);
    assert.equal(out.npc?.growthSteps, Math.floor((1e6 * HOUR) / (6 * HOUR)));
    // Nothing else grows once everything is maxed.
    assert.equal(out.buildings.barracks, 0);
    assert.equal(out.buildings.stables, 0);
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
      assert.equal(c.timeMs, 78_000);
    }
    const out = applyBuild(v, 'lumber', 5_000, S1);
    assert.deepEqual(out.buildQueue, [{ building: 'lumber', targetLevel: 2, startAt: 5_000, finishAt: 83_000 }]);
    assert.ok(near(out.resources.wood, 600 + 30 * (5 / 3600) - 63));
  });

  it('the same building twice targets the next level and starts after the first job', () => {
    let v = applyBuild(village(), 'lumber', 0, S1);
    v = applyBuild(v, 'lumber', 0, S1);
    assert.deepEqual(
      v.buildQueue.map((j) => [j.targetLevel, j.startAt, j.finishAt]),
      [
        [2, 0, 78_000],
        [3, 78_000, 78_000 + 101_400],
      ],
    );
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
    assert.equal(trainTimeMs('pikeman', village({ buildings: { barracks: 1 } }), S1), 90_000);
    assert.equal(trainTimeMs('pikeman', village({ buildings: { barracks: 4 } }), S1), 74_753);
    assert.equal(trainTimeMs('pikeman', village({ buildings: { barracks: 1 } }), S10), 9_000);
  });

  it('returns cost and per-unit time; applyTrain pays up front', () => {
    const v = barracksVillage();
    const c = checkTrain(v, 'pikeman', 4, 0, S1);
    assert.ok(c.ok);
    if (c.ok) {
      assert.deepEqual(c.cost, { wood: 200, food: 120, iron: 100, gold: 0 });
      assert.equal(c.perUnitMs, 90_000);
    }
    const out = applyTrain(v, 'pikeman', 4, 0, S1);
    assert.equal(out.resources.wood, 4800);
    assert.deepEqual(out.trainQueues.barracks, [{ unit: 'pikeman', count: 4, done: 0, perUnitMs: 90_000, startAt: 0 }]);
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

  it('refuses with not_enough_food when upkeep would exceed farm production', () => {
    const v = barracksVillage(); // farm level 1 = 40 food per hour, pikeman eats 1
    assert.ok(checkTrain(v, 'pikeman', 40, 0, S1).ok);
    const c = checkTrain(v, 'pikeman', 41, 0, S1);
    assert.ok(!c.ok && c.reason === 'not_enough_food');
    // Queued units already eat, so a second batch counts them.
    const queued = applyTrain(v, 'pikeman', 40, 0, S1);
    const more = checkTrain(queued, 'pikeman', 1, 0, S1);
    assert.ok(!more.ok && more.reason === 'not_enough_food');
    // Units at home and away count too.
    const home = village({ buildings: { barracks: 1, storehouse: 10 }, troops: { pikeman: 30 }, away: { pikeman: 10 }, resources: { wood: 5000, food: 5000, iron: 5000 } });
    assert.ok(!checkTrain(home, 'pikeman', 1, 0, S1).ok);
    // World speed scales both production and upkeep, so the limit is unchanged.
    assert.ok(checkTrain(v, 'pikeman', 40, 0, S10).ok);
    assert.ok(!checkTrain(v, 'pikeman', 41, 0, S10).ok);
    // A better farm lifts the limit.
    const farm = village({ buildings: { barracks: 1, storehouse: 10, farm: 5 }, resources: { wood: 5000, food: 5000, iron: 5000 } });
    assert.ok(checkTrain(farm, 'pikeman', 70, 0, S1).ok); // farm 5 = round(40*1.17^4) = 75
    assert.ok(!checkTrain(farm, 'pikeman', 76, 0, S1).ok);
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
    const out = applyTrain(applyTrain(v, 'pikeman', 1, 0, S1), 'outrider', 1, 0, S1);
    assert.equal(out.trainQueues.barracks.length, 1);
    assert.equal(out.trainQueues.stables.length, 1);
    assert.equal(out.trainQueues.stables[0]?.startAt, 0);
  });
});
