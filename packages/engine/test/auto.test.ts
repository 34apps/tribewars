import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUTO_GOAL_MAX_TROOPS,
  AUTO_TRAIN_BATCH,
  BUILDINGS,
  DEFAULT_WORLD_CONFIG,
  PREMIUM_BUILD_QUEUE,
  PREMIUM_RESEARCH_QUEUE,
  UNITS,
  applyAutoSettings,
  applyBuild,
  applyCancelBuild,
  applyCancelTrain,
  applyOwnerChange,
  abandonVillageKeepBuildings,
  applyTrain,
  autoNext,
  autoProgress,
  autoSummary,
  buildQueueLimit,
  researchQueueLimit,
  buildingCost,
  checkAutoSettings,
  cloneVillage,
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

const goalVillage = (
  over: Parameters<typeof village>[0],
  goals: { troops?: Partial<Record<'pikeman' | 'guard' | 'raider', number>>; build?: Partial<Record<BuildingId, number>>; on?: boolean },
): VillageState => autoVillage(over, { troopGoals: goals.troops ?? {}, buildingGoals: goals.build ?? {}, on: goals.on ?? true });
const nextOf = (v: VillageState) => autoNext(v, 0, S1);

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
  it('researchQueueLimit', () => {
    assert.equal(researchQueueLimit(DEFAULT_WORLD_CONFIG, false), DEFAULT_WORLD_CONFIG.queues.research);
    assert.equal(researchQueueLimit(DEFAULT_WORLD_CONFIG, true), PREMIUM_RESEARCH_QUEUE);
    assert.equal(researchQueueLimit({ queues: { ...DEFAULT_WORLD_CONFIG.queues, research: 8 } }, true), 8);
  });

  it('buildQueueLimit', () => {
    assert.equal(buildQueueLimit(DEFAULT_WORLD_CONFIG, false), DEFAULT_WORLD_CONFIG.queues.build);
    assert.equal(buildQueueLimit(DEFAULT_WORLD_CONFIG, true), PREMIUM_BUILD_QUEUE);
    assert.equal(buildQueueLimit({ queues: { ...DEFAULT_WORLD_CONFIG.queues, build: 8 } }, true), 8);
  });
  it('checkAutoSettings validates goals strictly', () => {
    const ok = checkAutoSettings({ on: true, troopGoals: { pikeman: 3000, raider: 0 }, buildingGoals: { wall: 5, barracks: 0 } });
    assert.ok(ok.ok);
    assert.deepEqual(ok.ok && ok.troopGoals, { pikeman: 3000 });
    assert.deepEqual(ok.ok && ok.buildingGoals, { wall: 5 });
    const keep = checkAutoSettings({ on: false }, { troopGoals: { pikeman: 7 }, buildingGoals: { hall: 3 } });
    assert.ok(keep.ok && keep.troopGoals.pikeman === 7 && keep.buildingGoals.hall === 3, 'missing keeps the saved goals');
    const maxWall = BUILDINGS.wall.maxLevel;
    for (const bad of [
      null, [], { on: 1 }, {}, { on: true, troopGoals: [] }, { on: true, troopGoals: { chieftain: 1 } }, { on: true, troopGoals: { logram: 1 } }, { on: true, troopGoals: { firecart: 1 } },
      { on: true, troopGoals: { nope: 1 } }, { on: true, troopGoals: { pikeman: -1 } }, { on: true, troopGoals: { pikeman: 1.5 } }, { on: true, troopGoals: { pikeman: '5' } },
      { on: true, troopGoals: { pikeman: AUTO_GOAL_MAX_TROOPS + 1 } }, { on: true, buildingGoals: { nope: 1 } }, { on: true, buildingGoals: { wall: maxWall + 1 } },
      { on: true, buildingGoals: { wall: -1 } }, { on: true, buildingGoals: { wall: 2.5 } }, { on: true, buildingGoals: [] },
    ]) assert.equal(checkAutoSettings(bad).ok, false, JSON.stringify(bad));
    assert.ok(checkAutoSettings({ on: true, troopGoals: { pikeman: AUTO_GOAL_MAX_TROOPS }, buildingGoals: { wall: maxWall } }).ok);
  });
  it('applyAutoSettings stores the goals', () => {
    const next = applyAutoSettings(undefined, { on: true, troopGoals: { pikeman: 5 }, buildingGoals: { hall: 4 } });
    assert.deepEqual(next, { on: true, troopGoals: { pikeman: 5 }, buildingGoals: { hall: 4 } });
  });
  it('old balance / units settings migrate to empty goals with auto off', () => {
    const v = village();
    v.auto = { on: true, buildShare: 70, units: ['pikeman'], spentBuild: 5, spentTroops: 1, nextUnit: 0 } as never;
    assert.deepEqual(cloneVillage(v).auto, { on: false, troopGoals: {}, buildingGoals: {} });
    v.auto = { on: true, troopGoals: { pikeman: 4, bogus: 3 }, buildingGoals: { hall: 2 } } as never;
    assert.deepEqual(cloneVillage(v).auto, { on: true, troopGoals: { pikeman: 4 }, buildingGoals: { hall: 2 } });
  });
});

describe('the goal picker', () => {
  it('works on the goal that is furthest behind; ties go to buildings', () => {
    const b = goalVillage({ resources: rich, buildings: { barracks: 1, lumber: 5 }, troops: { pikeman: 10 } }, { troops: { pikeman: 100 }, build: { lumber: 10 } });
    assert.equal(nextOf(b)?.kind, 'troops'); // 0.1 < 0.5
    const c = goalVillage({ resources: rich, buildings: { barracks: 1, lumber: 2 }, troops: { pikeman: 90 } }, { troops: { pikeman: 100 }, build: { lumber: 10 } });
    assert.deepEqual([nextOf(c)?.kind, nextOf(c)?.building, nextOf(c)?.level], ['build', 'lumber', 3]); // 0.2 < 0.9
    const tie = goalVillage({ resources: rich, buildings: { barracks: 1, lumber: 5 }, troops: { pikeman: 5 } }, { troops: { pikeman: 10 }, build: { lumber: 10 } });
    assert.equal(nextOf(tie)?.kind, 'build');
  });
  it('a goal already met is skipped; the start level counts as progress', () => {
    const v = goalVillage({ resources: rich, buildings: { barracks: 1, lumber: 5, farm: 1 } }, { build: { lumber: 5, farm: 6 } });
    assert.equal(nextOf(v)?.building, 'farm');
    const t = goalVillage({ resources: rich, buildings: { barracks: 1 }, troops: { pikeman: 20 } }, { troops: { pikeman: 20 }, build: { farm: 3 } });
    assert.equal(nextOf(t)?.kind, 'build');
  });
  it('counts troops home + away + in training toward a troop goal', () => {
    const v = goalVillage({ resources: rich, buildings: { barracks: 1, longhouse: 12 }, troops: { pikeman: 10 }, away: { pikeman: 5 } }, { troops: { pikeman: 30 } });
    v.trainQueues.barracks.push({ unit: 'pikeman', count: 10, done: 5, perUnitMs: 1000, startAt: 0, unitCost: { ...UNITS.pikeman.cost } });
    assert.equal(autoProgress(v).have.pikeman, 20);
    const n = nextOf(v)!;
    assert.deepEqual([n.kind, n.unit, n.count], ['troops', 'pikeman', 10]);
    v.auto!.troopGoals.pikeman = 20;
    assert.equal(nextOf(v), null, 'met');
  });
  it('troop steps are batches of up to 10, or what remains', () => {
    const v = goalVillage({ resources: rich, buildings: { barracks: 1, longhouse: 12 } }, { troops: { pikeman: 25 } });
    assert.equal(nextOf(v)?.count, AUTO_TRAIN_BATCH);
    const t = goalVillage({ resources: rich, buildings: { barracks: 1, longhouse: 12 }, troops: { pikeman: 22 } }, { troops: { pikeman: 25 } });
    assert.equal(nextOf(t)?.count, 3);
  });
  it('a missing requirement of a troop goal is built first', () => {
    const v = goalVillage({ resources: rich, buildings: { barracks: 0, hall: 2 } }, { troops: { pikeman: 50 } });
    const n = nextOf(v)!;
    assert.deepEqual([n.kind, n.building, n.level], ['build', 'barracks', 1]);
  });
  it('a building goal whose requirements are unmet builds them first, down the chain', () => {
    assert.deepEqual(BUILDINGS.wall.requires, { barracks: 1 });
    const v = goalVillage({ resources: rich, buildings: { barracks: 0, hall: 1 } }, { build: { wall: 3 } });
    assert.equal(nextOf(v)?.building, 'hall', 'wall needs barracks, barracks needs hall 2');
    const w = goalVillage({ resources: rich, buildings: { barracks: 0, hall: 3 } }, { build: { wall: 3 } });
    assert.equal(nextOf(w)?.building, 'barracks');
    const x = goalVillage({ resources: rich, buildings: { barracks: 1, hall: 3 } }, { build: { wall: 3 } });
    assert.deepEqual([nextOf(x)?.building, nextOf(x)?.level], ['wall', 1]);
  });
  it('waits for a requirement that is queued but not built yet', () => {
    const v = goalVillage({ resources: rich, buildings: { barracks: 0, hall: 3 } }, { build: { wall: 3 } });
    const r = settleVillage(v, 1, S1);
    assert.equal(r.buildQueue[0]!.building, 'barracks');
    const n = autoNext(r, 1, S1)!;
    assert.equal(n.building, 'wall');
    assert.equal(n.waiting, 'requirement');
    assert.equal(n.readyAt, r.buildQueue[0]!.finishAt);
    const later = settleVillage(r, r.buildQueue[0]!.finishAt + 1, S1);
    assert.equal(later.buildings.barracks, 1);
    assert.ok(later.buildQueue.some((j) => j.building === 'wall'));
  });
  it('Longhouse when under 10% of the room is free and a troop goal is open; not for building goals only', () => {
    const v = goalVillage({ resources: rich, buildings: { barracks: 1 } }, { troops: { pikeman: 500 } });
    v.troops.pikeman = populationCap(v) - populationUsage(v).total - 1;
    v.auto!.troopGoals.pikeman = v.troops.pikeman + 500;
    assert.equal(nextOf(v)?.building, 'longhouse');
    const only = goalVillage({ resources: rich, buildings: { barracks: 1 } }, { build: { farm: 5 } });
    only.troops.pikeman = populationCap(only) - populationUsage(only).total - 1;
    assert.equal(nextOf(only)?.building, 'farm');
  });
  it('a troop order that does not fit the room builds the Longhouse first', () => {
    const v = goalVillage({ resources: rich, buildings: { barracks: 1 } }, { troops: { pikeman: 5000 } });
    v.troops.pikeman = populationCap(v) - populationUsage(v).total - 5;
    v.auto!.troopGoals.pikeman = v.troops.pikeman + 1000;
    assert.equal(nextOf(v)?.building, 'longhouse');
  });
  it('Storehouse when a stock is at 90% of the cap', () => {
    const cap = storageCap(village());
    const v = goalVillage({ resources: { wood: cap * 0.95 }, buildings: { storehouse: 1 } }, { build: { lumber: 8 } });
    assert.equal(nextOf(v)?.building, 'storehouse');
  });
  it('Storehouse when the chosen step costs more than the cap', () => {
    const v = goalVillage({ buildings: { lumber: 20, storehouse: 1, hall: 20 } }, { build: { lumber: 25 } });
    v.resources = { wood: 10, food: 10, iron: 10, gold: 10 };
    assert.ok(buildingCost('lumber', 21).wood > storageCap(v));
    assert.equal(nextOf(v)?.building, 'storehouse');
  });
  it('a unit that needs research is skipped (auto never researches); the next goal goes', () => {
    assert.ok(UNITS.guard.research);
    const only = goalVillage({ resources: rich, buildings: { barracks: 3 } }, { troops: { guard: 50 } });
    assert.equal(nextOf(only), null);
    assert.equal(autoSummary(settleVillage(only, 0, S1), S1).status, 'blocked');
    const r = settleVillage(only, HOUR, S1);
    assert.equal(r.trainQueues.barracks.length, 0);
    assert.equal(r.buildQueue.length, 0);
    const both = goalVillage({ resources: rich, buildings: { barracks: 3 } }, { troops: { guard: 50, pikeman: 50 } });
    assert.equal(nextOf(both)?.unit, 'pikeman');
  });
  it('a goal that cannot happen at all passes to the next one', () => {
    // The Banner Hall is paid partly in gold and nothing here produces gold, so that goal can never be paid; the Lumber Camp goal goes.
    const b = { hall: 7, drillyard: 2, market: 2, barracks: 3, lumber: 5, goldmine: 0 };
    const v = goalVillage({ resources: { wood: 40000, food: 40000, iron: 40000, gold: 0 }, buildings: b }, { build: { bannerhall: 3, lumber: 6 } });
    assert.ok(buildingCost('bannerhall', 1).gold > 0);
    assert.equal(nextOf(v)?.building, 'lumber');
  });
  it('stops when every goal is met ("reached"), and resumes when a goal is raised', () => {
    const v = goalVillage({ resources: rich, buildings: { barracks: 1, longhouse: 12 } }, { troops: { pikeman: 20 }, build: { lumber: 3, farm: 3 } });
    const r = settleVillage(v, 24 * HOUR, S1);
    assert.equal(r.troops.pikeman, 20);
    assert.equal(r.buildings.lumber, 3, 'not one level above the goal');
    assert.equal(r.buildings.farm, 3);
    assert.equal(r.buildQueue.length, 0);
    assert.deepEqual(autoSummary(r, S1), { status: 'reached', next: null });
    const later = settleVillage(r, 48 * HOUR, S1);
    assert.equal(later.buildQueue.length, 0);
    assert.equal(later.troops.pikeman, 20);
    assert.ok(later.resources.wood >= r.resources.wood, 'nothing bought');
    later.auto!.buildingGoals.lumber = 4;
    assert.equal(autoSummary(later, S1).next?.building, 'lumber');
  });
  it('no goals: nothing happens', () => {
    const v = goalVillage({ resources: rich }, {});
    assert.equal(autoSummary(settleVillage(v, 0, S1), S1).status, 'empty');
    assert.equal(settleVillage(v, 5 * HOUR, S1).buildQueue.length, 0);
  });
  it('waits for resources instead of skipping to something cheaper', () => {
    const v = goalVillage({ resources: { wood: 0, food: 0, iron: 0, gold: 0 }, buildings: { barracks: 1 } }, { build: { lumber: 3 }, troops: { pikeman: 500 } });
    const n = nextOf(v)!;
    assert.equal(n.waiting, 'resources');
    assert.ok(n.readyAt! > 1);
    const early = settleVillage(v, n.readyAt! - 5, S1);
    assert.equal(early.buildQueue.length, 0);
    assert.equal(early.trainQueues.barracks.length, 0);
    const later = settleVillage(v, n.readyAt! + 5, S1);
    assert.equal(later.buildQueue.length + later.trainQueues.barracks.length, 1);
  });
  it('is deterministic: the same picks, in one settle or in many', () => {
    const mk = () => goalVillage({ buildings: { barracks: 2, hall: 3 } }, { troops: { pikeman: 60, raider: 20 }, build: { lumber: 8, wall: 4, market: 3 } });
    assert.deepEqual(nextOf(mk()), nextOf(mk()));
    const end = 6 * 24 * HOUR + 4321;
    const once = settleVillage(mk(), end, S1);
    let step = mk();
    let t = 0;
    for (const d of [HOUR * 0.7, HOUR * 3.3, HOUR * 11, HOUR * 24, HOUR * 24 + 777, HOUR * 40]) {
      t += d;
      step = settleVillage(step, t, S1);
    }
    step = settleVillage(step, end, S1);
    assert.deepEqual(shape(step), shape(once));
    let many = mk();
    for (let i = 1; i <= 200; i++) many = settleVillage(many, Math.min(end, i * 30 * 60_000 + 91), S1);
    assert.deepEqual(shape(settleVillage(many, end, S1)), shape(once));
    let x = mk();
    for (let i = 1; i <= 36; i++) x = settleVillage(x, i * 10 * 60_000, S10);
    assert.deepEqual(shape(x), shape(settleVillage(mk(), 6 * HOUR, S10)));
  });
});

describe('at most one auto job per queue', () => {
  const count = (jobs: Array<{ auto?: true }>) => jobs.filter((j) => j.auto).length;
  it('full stores and 5 build slots: auto queues only one building job', () => {
    const v = goalVillage({ resources: rich, buildings: { barracks: 1, hall: 10 } }, { build: { lumber: 20, farm: 20, mine: 20 } });
    const r = settleVillage(v, 1, S1);
    assert.equal(r.buildQueue.length, 1);
    assert.equal(count(r.buildQueue), 1);
    const n = autoNext(r, 1, S1)!;
    assert.equal(n.waiting, 'slot');
    assert.equal(n.readyAt, r.buildQueue[0]!.finishAt);
    const after = settleVillage(r, r.buildQueue[0]!.finishAt + 1, S1);
    assert.equal(after.buildQueue.length, 1);
    assert.equal(count(after.buildQueue), 1);
    assert.equal(after.buildQueue[0]!.startAt, r.buildQueue[0]!.finishAt, 'the next step is queued once the job is done');
  });
  it("the player's own jobs do not count and keep their slots", () => {
    let v = goalVillage({ resources: rich, buildings: { barracks: 1, hall: 10 } }, { build: { lumber: 20 }, on: false });
    v = applyBuild(v, 'farm', 0, S1, 5);
    v = applyBuild(v, 'mine', 0, S1, 5);
    v.auto!.on = true;
    const r = settleVillage(v, 1, S1);
    assert.equal(r.buildQueue.length, 3);
    assert.equal(count(r.buildQueue), 1);
    assert.equal(r.buildQueue.filter((j) => !j.auto).length, 2);
  });
  it('one auto batch per training queue at a time', () => {
    const v = goalVillage({ resources: rich, buildings: { barracks: 3, hall: 6, longhouse: 25 } }, { troops: { pikeman: 500, raider: 500 } });
    assert.equal(UNITS.raider.building, 'barracks');
    v.researched = ['raider', 'pikeman'];
    const r = settleVillage(v, 1, S1);
    assert.equal(count(r.trainQueues.barracks), 1);
    assert.equal(r.trainQueues.barracks.length, 1);
    const n = autoNext(r, 1, S1)!;
    assert.equal(n.kind, 'troops');
    assert.equal(n.waiting, 'slot');
    const job = r.trainQueues.barracks[0]!;
    assert.equal(n.readyAt, job.startAt + job.count * job.perUnitMs);
    const later = settleVillage(r, n.readyAt! + 1, S1);
    assert.equal(count(later.trainQueues.barracks), 1);
    assert.ok(later.troops.pikeman + later.troops.raider >= AUTO_TRAIN_BATCH);
  });
  it('a manual batch in the queue is not an auto job', () => {
    let v = goalVillage({ resources: rich, buildings: { barracks: 3, longhouse: 25 } }, { troops: { pikeman: 500 }, on: false });
    v = applyTrain(v, 'pikeman', 10, 0, S1);
    v.auto!.on = true;
    const r = settleVillage(v, 1, S1);
    assert.equal(r.trainQueues.barracks.length, 2);
    assert.equal(count(r.trainQueues.barracks), 1);
  });
  it('settles toward the goal and stops exactly there', () => {
    const v = goalVillage({ resources: rich, buildings: { barracks: 1, longhouse: 25 } }, { troops: { pikeman: 25 } });
    const r = settleVillage(v, 10 * 24 * HOUR, S1);
    assert.equal(r.troops.pikeman, 25);
    assert.equal(r.trainQueues.barracks.length, 0);
  });
});

describe('who it runs for', () => {
  it('ignores abandoned and cold villages and a switched-off auto mode', () => {
    const npc = createNpcVillage(1, 0);
    npc.auto = { ...defaultAutoMode(), on: true, buildingGoals: { hall: 9 } };
    const a = settleVillage(npc, 5 * HOUR, S1);
    assert.ok(a.buildQueue.every((j) => !j.auto));
    const cold = goalVillage({ resources: rich }, { build: { lumber: 9 } });
    cold.hearth = { outSince: 0 } as never;
    assert.equal(settleVillage(cold, 1, S1).buildQueue.length, 0);
    const off = goalVillage({ resources: rich }, { build: { lumber: 9 }, on: false });
    assert.equal(settleVillage(off, 1, S1).buildQueue.length, 0);
    assert.equal(autoNext(off, 0, S1), null);
  });
  it('the saved state survives a copy', () => {
    const v = goalVillage({ resources: rich }, { build: { lumber: 9 }, troops: { pikeman: 5 } });
    const r = settleVillage(v, 1, S1);
    assert.deepEqual(settleVillage(r, 1, S1).auto, r.auto);
    assert.deepEqual(cloneVillage(r).auto, r.auto);
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
    const v = goalVillage({ resources: rich, buildings: { barracks: 1 } }, { build: { lumber: 9 } });
    const r = settleVillage(v, 1, S1);
    const c = applyCancelBuild(r, r.buildQueue.length - 1, 1, S1);
    assert.equal(c.state.auto!.on, false);
    const t = goalVillage({ resources: rich, buildings: { barracks: 1, longhouse: 25 } }, { troops: { pikeman: 50 } });
    const r2 = settleVillage(t, 1, S1);
    const c2 = applyCancelTrain(r2, 'barracks', 0, 1, S1);
    assert.equal(c2.state.auto!.on, false);
  });
  it('cancelling a player-queued job keeps auto mode on', () => {
    const v = goalVillage({ resources: rich }, { build: { lumber: 9 }, on: false });
    const m = applyBuild(v, 'lumber', 0, S1, 5);
    m.auto!.on = true;
    const c = applyCancelBuild(m, 0, 0, S1);
    assert.equal(c.state.auto!.on, true);
  });
});

describe('owner changes drop auto mode', () => {
  it('a taken village and an abandoned village have no auto state', () => {
    const v = goalVillage({ resources: rich }, { build: { lumber: 9 } });
    const taken = applyOwnerChange(v, { occupiers: {}, now: 10, settings: S1 }).state;
    assert.equal(taken.auto, undefined);
    const gone = abandonVillageKeepBuildings(v, 10, S1, 7);
    assert.equal(gone.auto, undefined);
  });
});
