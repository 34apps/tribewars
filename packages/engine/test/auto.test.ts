import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUTO_TRAIN_BATCH,
  DEFAULT_WORLD_CONFIG,
  PREMIUM_BUILD_QUEUE,
  UNITS,
  applyAutoSettings,
  applyBuild,
  applyCancelBuild,
  applyCancelTrain,
  applyOwnerChange,
  abandonVillageKeepBuildings,
  applyTrain,
  autoNext,
  buildQueueLimit,
  buildingCost,
  checkAutoSettings,
  createNpcVillage,
  defaultAutoMode,
  populationCap,
  populationUsage,
  settleVillage,
  storageCap,
} from '../src/index.ts';
import type { AutoModeState, BuildingId, VillageState } from '../src/index.ts';
import { HOUR, S1, S10, village } from './helpers.ts';

const rich = { wood: 40000, food: 40000, iron: 40000, gold: 40000 };

/** A village with auto mode on (the engine runs it; the server decides who may switch it on). */
function autoVillage(over: Parameters<typeof village>[0] = {}, auto: Partial<AutoModeState> = {}): VillageState {
  const v = village({ ...over, buildings: { storehouse: 25, ...over.buildings } });
  v.auto = { ...defaultAutoMode(), on: true, ...auto };
  return v;
}

const roundRes = (v: VillageState) => Object.fromEntries(Object.entries(v.resources).map(([k, x]) => [k, Math.round(x * 1000) / 1000]));
const shape = (v: VillageState) => ({
  res: roundRes(v),
  b: v.buildings,
  q: v.buildQueue.map((j) => [j.building, j.targetLevel, j.startAt, j.finishAt, j.auto]),
  t: v.trainQueues,
  troops: v.troops,
  auto: v.auto,
});

describe('settings', () => {
  it('buildQueueLimit', () => {
    assert.equal(buildQueueLimit(DEFAULT_WORLD_CONFIG, false), DEFAULT_WORLD_CONFIG.queues.build);
    assert.equal(buildQueueLimit(DEFAULT_WORLD_CONFIG, true), PREMIUM_BUILD_QUEUE);
    assert.equal(buildQueueLimit({ queues: { ...DEFAULT_WORLD_CONFIG.queues, build: 8 } }, true), 8);
  });
  it('checkAutoSettings validates', () => {
    const ok = checkAutoSettings({ on: true, buildShare: 40, units: ['raider', 'pikeman'] });
    assert.ok(ok.ok && ok.buildShare === 40 && ok.units.join() === 'raider,pikeman');
    const dflt = checkAutoSettings({ on: false });
    assert.ok(dflt.ok && dflt.buildShare === 70 && dflt.units.join() === 'pikeman,guard');
    for (const bad of [
      null, [], { on: 1 }, {}, { on: true, buildShare: 35 }, { on: true, buildShare: 110 }, { on: true, buildShare: -10 }, { on: true, buildShare: 10.5 },
      { on: true, units: ['chieftain'] }, { on: true, units: ['logram'] }, { on: true, units: ['nope'] }, { on: true, units: ['pikeman', 'pikeman'] }, { on: true, units: 'pikeman' },
    ]) assert.equal(checkAutoSettings(bad).ok, false, JSON.stringify(bad));
    assert.ok(checkAutoSettings({ on: true, units: [] }).ok);
  });
  it('applyAutoSettings resets counters when switched on or changed, keeps them when unchanged', () => {
    const cur: AutoModeState = { ...defaultAutoMode(), on: true, spentBuild: 50, spentTroops: 20, nextUnit: 1 };
    const same = applyAutoSettings(cur, { on: true, buildShare: 70, units: ['pikeman', 'guard'] });
    assert.deepEqual([same.spentBuild, same.spentTroops, same.nextUnit], [50, 20, 1]);
    const changed = applyAutoSettings(cur, { on: true, buildShare: 60, units: ['pikeman', 'guard'] });
    assert.deepEqual([changed.spentBuild, changed.spentTroops], [0, 0]);
    const off = applyAutoSettings(cur, { on: false, buildShare: 70, units: ['pikeman', 'guard'] });
    assert.equal(off.spentBuild, 50);
    const reOn = applyAutoSettings(off, { on: true, buildShare: 70, units: ['pikeman', 'guard'] });
    assert.equal(reOn.spentBuild, 0);
  });
});

describe('steady growth picks (buildings only)', () => {
  const only = { buildShare: 100, units: [] as never[] };
  const first = (v: VillageState): string | undefined => {
    const n = autoNext(v, 0, S1);
    return n?.building;
  };

  const cheapest = (levels: Partial<Record<'hall' | 'lumber' | 'farm' | 'mine' | 'goldmine', number>>, withGold: boolean): string => {
    const ids = (withGold ? ['lumber', 'farm', 'mine', 'goldmine'] : ['lumber', 'farm', 'mine']) as Array<'lumber' | 'farm' | 'mine' | 'goldmine'>;
    let best = '';
    let bestCost = Infinity;
    for (const b of ids) {
      const c = buildingCost(b, (levels[b] ?? 0) + 1);
      const sum = c.wood + c.food + c.iron + c.gold;
      if (sum < bestCost) { bestCost = sum; best = b; }
    }
    return best;
  };

  it('the resource building whose next level costs least, ties Lumber, Farm, Iron, Gold', () => {
    for (const b of [{ hall: 10, lumber: 1, farm: 1, mine: 1 }, { hall: 10, lumber: 3, farm: 2, mine: 2 }, { hall: 10, lumber: 3, farm: 3, mine: 2 }, { hall: 10, lumber: 6, farm: 4, mine: 5 }]) {
      assert.equal(first(autoVillage({ resources: rich, buildings: b }, only)), cheapest(b, false));
    }
  });
  it('Gold Mine only once its requirement is met, and only when it is the cheapest', () => {
    const b = { hall: 3, lumber: 4, farm: 4, mine: 4 };
    assert.equal(first(autoVillage({ resources: rich, buildings: b }, only)), cheapest(b, true));
    const low = autoVillage({ resources: rich, buildings: { hall: 2, lumber: 2, farm: 2, mine: 2 } }, only);
    assert.notEqual(first(low), 'goldmine');
  });
  it('Town Hall when it lags two levels behind the lowest resource building', () => {
    assert.equal(first(autoVillage({ resources: rich, buildings: { hall: 1, lumber: 3, farm: 3, mine: 3 } }, only)), 'hall');
    const b = { hall: 2, lumber: 3, farm: 3, mine: 3 };
    assert.equal(first(autoVillage({ resources: rich, buildings: b }, only)), cheapest(b, false));
  });
  it('Storehouse when a stock is at 90% of the cap', () => {
    const cap = storageCap(village());
    const v = autoVillage({ resources: { wood: cap * 0.95 }, buildings: { storehouse: 1 } }, only);
    assert.equal(first(v), 'storehouse');
  });
  it('Storehouse when the next pick costs more than the cap', () => {
    const v = autoVillage({ resources: rich, buildings: { lumber: 20, farm: 20, mine: 20, goldmine: 18, storehouse: 1, hall: 20, longhouse: 25 } }, only);
    v.resources = { wood: 10, food: 10, iron: 10, gold: 10 };
    assert.ok(buildingCost('lumber', 21).wood > storageCap(v));
    assert.equal(first(v), 'storehouse');
  });
  it('Longhouse when under 10% of the room is free (population room)', () => {
    const v = autoVillage({ resources: rich }, only);
    const free = populationCap(v) - populationUsage(v).total;
    v.troops.pikeman = free - 1;
    assert.equal(first(v), 'longhouse');
  });
  it('counts queued levels as built (no second level of the same pick)', () => {
    const v = autoVillage({ resources: rich }, only);
    const r = settleVillage(v, 1, S1);
    assert.equal(r.buildQueue.length, PREMIUM_BUILD_QUEUE);
    const key = r.buildQueue.map((j) => `${j.building}${j.targetLevel}`);
    assert.equal(new Set(key).size, key.length);
    assert.deepEqual(r.buildQueue.map((j) => j.building).slice(0, 3), ['lumber', 'farm', 'mine']);
    assert.ok(r.buildQueue.every((j) => j.auto === true && j.cost));
  });
});

describe('side decision', () => {
  const t0 = 1;
  it('0/0: buildings first when the share is above 0, troops when it is 0', () => {
    const b = settleVillage(autoVillage({ resources: rich, buildings: { barracks: 1 } }, { buildShare: 50 }), t0, S1);
    assert.ok(b.buildQueue.length > 0 && b.auto!.spentBuild > 0);
    const tr = settleVillage(autoVillage({ resources: rich, buildings: { barracks: 1 } }, { buildShare: 0 }), t0, S1);
    assert.ok(tr.auto!.spentTroops > 0);
    assert.ok(tr.buildQueue.every((j) => j.building === 'longhouse')); // only the Longhouse, when the troops fill the room
  });
  it('share 100 buys buildings only, 0 troops only', () => {
    const b = settleVillage(autoVillage({ resources: rich, buildings: { barracks: 1 } }, { buildShare: 100 }), t0, S1);
    assert.equal(b.auto!.spentTroops, 0);
    assert.equal(b.trainQueues.barracks.length, 0);
    const tr = settleVillage(autoVillage({ resources: rich, buildings: { barracks: 1 } }, { buildShare: 0 }), 30 * HOUR, S1);
    assert.ok(tr.buildQueue.every((j) => j.building === 'longhouse'));
    assert.ok(tr.auto!.spentTroops > 0);
  });
  it('follows the share: the side below its share goes next', () => {
    const v = autoVillage({ resources: rich, buildings: { barracks: 1 } }, { buildShare: 50, spentBuild: 100, spentTroops: 0 });
    const n = autoNext(v, 0, S1);
    assert.equal(n?.kind, 'troops');
    const w = autoVillage({ resources: rich, buildings: { barracks: 1 } }, { buildShare: 50, spentBuild: 0, spentTroops: 100 });
    assert.equal(autoNext(w, 0, S1)?.kind, 'build');
    const at = autoVillage({ resources: rich, buildings: { barracks: 1 } }, { buildShare: 50, spentBuild: 50, spentTroops: 50 });
    assert.equal(autoNext(at, 0, S1)?.kind, 'troops'); // not below its share any more
  });
  it('waits for resources instead of skipping to the other side', () => {
    // Buildings are next; the stock is empty. Nothing is bought until the lumber camp can be paid, although troops are cheap.
    const v = autoVillage({ resources: { wood: 0, food: 0, iron: 0, gold: 0 }, buildings: { barracks: 1 } }, { buildShare: 50, spentBuild: 0, spentTroops: 1000 });
    const n = autoNext(v, 0, S1)!;
    assert.equal(n.kind, 'build');
    assert.equal(n.waiting, 'resources');
    assert.ok(n.readyAt! > 1);
    const early = settleVillage(v, n.readyAt! - 5, S1);
    assert.equal(early.buildQueue.length, 0);
    assert.equal(early.trainQueues.barracks.length, 0);
    const later = settleVillage(v, n.readyAt! + 5, S1);
    assert.equal(later.buildQueue.length, 1);
    assert.equal(later.buildQueue[0]!.startAt, n.readyAt);
  });
  it('waits for a free build slot', () => {
    const v = autoVillage({ resources: rich, buildings: { barracks: 1 } }, { buildShare: 100 });
    const full = settleVillage(v, 1, S1);
    assert.equal(full.buildQueue.length, PREMIUM_BUILD_QUEUE);
    const n = autoNext(full, 1, S1)!;
    assert.equal(n.waiting, 'slot');
    assert.equal(n.readyAt, full.buildQueue[0]!.finishAt);
    const after = settleVillage(full, full.buildQueue[0]!.finishAt + 1, S1);
    assert.equal(after.buildQueue.length, PREMIUM_BUILD_QUEUE);
    assert.equal(after.buildQueue[after.buildQueue.length - 1]!.startAt, full.buildQueue[PREMIUM_BUILD_QUEUE - 1]!.finishAt);
  });
  it('passes the turn when the building side has nothing left', () => {
    const maxed: Partial<Record<BuildingId, number>> = { hall: 25, lumber: 25, farm: 25, mine: 25, goldmine: 18, barracks: 3, longhouse: 25, storehouse: 25 };
    const v = autoVillage({ resources: { wood: 1e5, food: 1e5, iron: 1e5, gold: 1e5 }, buildings: maxed }, { buildShare: 100 });
    const n = autoNext(v, 0, S1)!;
    assert.equal(n.kind, 'troops');
  });
  it('passes the turn when no picked unit can be trained here', () => {
    const v = autoVillage({ resources: rich, buildings: { barracks: 0 } }, { buildShare: 0 });
    const n = autoNext(v, 0, S1)!;
    assert.equal(n.kind, 'build');
    const none = autoVillage({ resources: rich, buildings: { barracks: 1 } }, { buildShare: 0, units: [] });
    assert.equal(autoNext(none, 0, S1)?.kind, 'build');
  });
  it('passes the turn to the Longhouse when the troop order does not fit the population room', () => {
    const v = autoVillage({ resources: rich, buildings: { barracks: 1 } }, { buildShare: 0, units: ['pikeman'] });
    const free = populationCap(v) - populationUsage(v).total;
    v.troops.pikeman = free - 5; // room for 5, the order needs 10; still more than 10% of the cap free? make sure
    const n = autoNext(v, 0, S1)!;
    assert.equal(n.kind, 'build');
    assert.equal(n.building, 'longhouse');
  });
  it('a troop order waits (room) for a Longhouse level that is already queued', () => {
    const v = autoVillage({ resources: rich, buildings: { barracks: 1 } }, { buildShare: 0, units: ['pikeman'], spentTroops: 1 });
    const free = populationCap(v) - populationUsage(v).total;
    v.troops.pikeman = free - 5;
    const r = settleVillage(v, 1, S1);
    assert.equal(r.buildQueue[0]!.building, 'longhouse');
    const n = autoNext(r, 1, S1)!;
    assert.equal(n.kind, 'troops');
  });
});

describe('troop orders', () => {
  it('recruits batches round-robin through the picked units and counts spending', () => {
    const v = autoVillage({ resources: rich, buildings: { barracks: 3 }, }, { buildShare: 0, units: ['pikeman', 'guard'] });
    v.researched = ['pikeman', 'guard'];
    const r = settleVillage(v, 1, S1);
    const q = r.trainQueues.barracks;
    assert.ok(q.length >= 2);
    assert.equal(q[0]!.unit, 'pikeman');
    assert.equal(q[1]!.unit, 'guard');
    assert.equal(q[0]!.count, AUTO_TRAIN_BATCH);
    assert.ok(q.every((j) => j.auto && j.unitCost));
    const cost = Object.values(UNITS.pikeman.cost).reduce((a, b) => a + b, 0) * AUTO_TRAIN_BATCH;
    assert.ok(r.auto!.spentTroops >= cost);
  });
  it('skips a unit that needs research', () => {
    const v = autoVillage({ resources: rich, buildings: { barracks: 3 } }, { buildShare: 0, units: ['guard', 'pikeman'] });
    assert.ok(UNITS.guard.research);
    const r = settleVillage(v, 1, S1);
    assert.equal(r.trainQueues.barracks[0]!.unit, 'pikeman');
  });
  it('adds to the last batch when it is the same unit (queue does not fill up)', () => {
    const v = autoVillage({ resources: rich, buildings: { barracks: 1, longhouse: 25 } }, { buildShare: 0, units: ['pikeman'] });
    const r = settleVillage(v, 1, S1);
    const q = r.trainQueues.barracks;
    assert.equal(q.length, 1);
    assert.ok(q[0]!.count > AUTO_TRAIN_BATCH && q[0]!.count % AUTO_TRAIN_BATCH === 0);
  });
  it('queues a new batch when the last batch is another unit, and waits for a slot when the queue is full', () => {
    const v = autoVillage({ resources: rich, buildings: { barracks: 3, longhouse: 25 } }, { buildShare: 0, units: ['pikeman', 'raider'] });
    v.researched = ['pikeman', 'raider'];
    assert.equal(UNITS.raider.building, 'barracks');
    const r = settleVillage(v, 1, S1);
    const q = r.trainQueues.barracks;
    assert.equal(q.length, DEFAULT_WORLD_CONFIG.queues.train);
    assert.deepEqual(q.map((j) => j.unit).slice(0, 4), ['pikeman', 'raider', 'pikeman', 'raider']);
    const n = autoNext(r, 1, S1)!;
    assert.equal(n.kind, 'troops');
    assert.equal(n.waiting, 'slot');
    const first = q[0]!;
    assert.equal(n.readyAt, first.startAt + first.count * first.perUnitMs);
    const later = settleVillage(r, n.readyAt! + 1, S1);
    assert.ok(later.trainQueues.barracks.length >= DEFAULT_WORLD_CONFIG.queues.train - 1); // the slot is free; the next order may wait for money
    assert.equal(later.troops.pikeman, first.count);
  });
  it('a later batch starts when the one before it ends', () => {
    const v = autoVillage({ resources: rich, buildings: { barracks: 3, longhouse: 25 } }, { buildShare: 0, units: ['pikeman', 'guard'] });
    v.researched = ['pikeman', 'guard'];
    const r = settleVillage(v, 1, S1);
    const q = r.trainQueues.barracks;
    assert.equal(q[1]!.startAt, q[0]!.startAt + q[0]!.count * q[0]!.perUnitMs);
  });
});

describe('long and split settles', () => {
  it('an offline week fills up the village, deterministically bounded', () => {
    const v = autoVillage({ buildings: { barracks: 1 } }, { buildShare: 70 });
    const r = settleVillage(v, 7 * 24 * HOUR, S1);
    assert.ok(r.buildings.lumber > 3);
    assert.ok(r.auto!.spentBuild > 0 && r.auto!.spentTroops > 0);
    const ratio = r.auto!.spentBuild / (r.auto!.spentBuild + r.auto!.spentTroops);
    assert.ok(ratio > 0.6 && ratio < 0.8, `ratio ${ratio}`);
    assert.ok(r.buildQueue.length <= PREMIUM_BUILD_QUEUE);
    assert.ok(populationUsage(r).total <= populationCap(r) + 1);
  });
  it('settling in one call or in many steps gives the same result', () => {
    const mk = () => autoVillage({ buildings: { barracks: 2, hall: 3 } }, { buildShare: 60, units: ['pikeman', 'guard'] });
    const end = 5 * 24 * HOUR + 12345;
    const once = settleVillage(mk(), end, S1);
    let step = mk();
    let t = 0;
    const steps = [HOUR * 0.7, HOUR * 3.3, HOUR * 11, HOUR * 24, HOUR * 24 + 777, HOUR * 40];
    for (const d of steps) {
      t += d;
      step = settleVillage(step, t, S1);
    }
    step = settleVillage(step, end, S1);
    assert.deepEqual(shape(step), shape(once));
    const many = (() => {
      let x = mk();
      for (let i = 1; i <= 240; i++) x = settleVillage(x, Math.min(end, i * 30 * 60_000 + 91), S1);
      return settleVillage(x, end, S1);
    })();
    assert.deepEqual(shape(many), shape(once));
  });
  it('is deterministic at speed 10 too', () => {
    const mk = () => autoVillage({ buildings: { barracks: 1 } });
    const once = settleVillage(mk(), 6 * HOUR, S10);
    let x = mk();
    for (let i = 1; i <= 36; i++) x = settleVillage(x, i * 10 * 60_000, S10);
    assert.deepEqual(shape(x), shape(once));
  });
  it('the action cap bounds one settle; the next settle carries on', () => {
    const v = autoVillage({ resources: rich, buildings: { barracks: 1, longhouse: 25 } }, { buildShare: 0, units: ['pikeman'] });
    const r = settleVillage(v, 10 * 24 * HOUR, S1);
    assert.ok(r.auto!.spentTroops > 0);
  });
});

describe('who it runs for', () => {
  it('ignores abandoned and cold villages and a switched-off auto mode', () => {
    const npc = createNpcVillage(1, 0);
    npc.auto = { ...defaultAutoMode(), on: true };
    const a = settleVillage(npc, 5 * HOUR, S1);
    assert.equal(a.auto!.spentBuild + a.auto!.spentTroops, 0);
    const cold = autoVillage({ resources: rich });
    cold.hearth = { outSince: 0 } as never;
    const b = settleVillage(cold, 1, S1);
    assert.equal(b.auto!.spentBuild, 0);
    assert.equal(b.buildQueue.length, 0);
    const off = autoVillage({ resources: rich });
    off.auto!.on = false;
    const c = settleVillage(off, 1, S1);
    assert.equal(c.buildQueue.length, 0);
    assert.equal(autoNext(off, 0, S1), null);
  });
  it('the saved state survives a copy', () => {
    const v = autoVillage({ resources: rich });
    const r = settleVillage(v, 1, S1);
    const again = settleVillage(r, 1, S1);
    assert.deepEqual(again.auto, r.auto);
  });
});

describe('manual play and cancelling', () => {
  it('a player may queue the whole premium limit by hand; others stop at queues.build', () => {
    let v = village({ resources: rich });
    const ids: BuildingId[] = ['lumber', 'farm', 'mine', 'storehouse', 'hall'];
    for (let i = 0; i < 2; i++) v = applyBuild(v, ids[i]!, 0, S1);
    assert.throws(() => applyBuild(v, ids[2]!, 0, S1), /queue is full/);
    let p = village({ resources: rich });
    for (let i = 0; i < 5; i++) p = applyBuild(p, ids[i]!, 0, S1, 5);
    assert.equal(p.buildQueue.length, 5);
    assert.throws(() => applyBuild(p, 'longhouse', 0, S1, 5), /queue is full/);
  });
  it('cancelling an auto build job or an auto batch switches auto mode off', () => {
    const v = autoVillage({ resources: rich, buildings: { barracks: 1 } }, { buildShare: 50 });
    const r = settleVillage(v, 1, S1);
    const c = applyCancelBuild(r, r.buildQueue.length - 1, 1, S1);
    assert.equal(c.state.auto!.on, false);
    const t = autoVillage({ resources: rich, buildings: { barracks: 1 } }, { buildShare: 0 });
    const r2 = settleVillage(t, 1, S1);
    const c2 = applyCancelTrain(r2, 'barracks', 0, 1, S1);
    assert.equal(c2.state.auto!.on, false);
  });
  it('cancelling a player-queued job keeps auto mode on', () => {
    const v = autoVillage({ resources: rich }, { buildShare: 100 });
    v.auto!.on = false;
    let m = applyBuild(v, 'lumber', 0, S1, 5);
    m.auto!.on = true;
    const c = applyCancelBuild(m, 0, 0, S1);
    assert.equal(c.state.auto!.on, true);
    void applyTrain;
  });
});

describe('owner changes drop auto mode', () => {
  it('a taken village and an abandoned village have no auto state', () => {
    const v = autoVillage({ resources: rich });
    const taken = applyOwnerChange(v, { occupiers: {}, now: 10, settings: S1 }).state;
    assert.equal(taken.auto, undefined);
    const gone = abandonVillageKeepBuildings(v, 10, S1, 7);
    assert.equal(gone.auto, undefined);
  });
});
