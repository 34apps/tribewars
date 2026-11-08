import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FIRST_STEPS, claimReward, emptyUnits, firstStepReward, firstStepsSatisfied, raidersOwned, type FirstStepId, type VillageState } from '../src/index.ts';
import { deepFreeze, village } from './helpers.ts';

const fresh = (): VillageState => village();
const snap = (villages: VillageState[], inTribe = false, events: FirstStepId[] = []) => firstStepsSatisfied(deepFreeze({ villages: structuredClone(villages), inTribe, events: new Set(events) }));

describe('first steps config', () => {
  it('has the eight approved steps in order', () => {
    assert.deepEqual(FIRST_STEPS.map((s) => s.id), ['lumber2', 'farm2', 'hall2', 'barracks2', 'raiders5', 'raid', 'report', 'tribe']);
    assert.deepEqual(firstStepReward('tribe'), { wood: 250, food: 250, iron: 250, gold: 50 });
    assert.equal(firstStepReward('nope'), null);
  });
});

describe('firstStepsSatisfied', () => {
  it('a new village has nothing done', () => {
    assert.equal(snap([fresh()]).size, 0);
  });
  it('building level 2 counts, also when only queued', () => {
    const a = fresh();
    a.buildings.lumber = 2;
    const b = fresh();
    b.buildQueue = [{ building: 'farm', targetLevel: 2, startAt: 0, finishAt: 1000 }];
    const c = fresh();
    c.buildQueue = [{ building: 'hall', targetLevel: 1, startAt: 0, finishAt: 1000 }];
    assert.deepEqual([...snap([a])], ['lumber2']);
    assert.deepEqual([...snap([b])], ['farm2']);
    assert.equal(snap([c]).size, 0);
    assert.deepEqual([...snap([a, b])].sort(), ['farm2', 'lumber2']); // any village
  });
  it('raiders at home, away and in training add up to five', () => {
    const v = fresh();
    v.troops = { ...emptyUnits(), raider: 2 };
    v.away = { ...emptyUnits(), raider: 1 };
    v.trainQueues.barracks = [{ unit: 'raider', count: 3, done: 1, perUnitMs: 1000, startAt: 0 }];
    assert.equal(raidersOwned([v]), 5);
    assert.ok(snap([v]).has('raiders5'));
    v.away = emptyUnits();
    assert.ok(!snap([v]).has('raiders5'));
  });
  it('tribe and event steps come from the snapshot', () => {
    assert.deepEqual([...snap([fresh()], true, ['raid', 'report'])].sort(), ['raid', 'report', 'tribe']);
  });
});

describe('claimReward', () => {
  it('adds the reward and reports what arrived', () => {
    const r = claimReward(1000, { wood: 10, food: 20, iron: 30, gold: 0 }, { wood: 150, food: 80, iron: 80, gold: 20 });
    assert.deepEqual(r.resources, { wood: 160, food: 100, iron: 110, gold: 20 });
    assert.deepEqual(r.added, { wood: 150, food: 80, iron: 80, gold: 20 });
  });
  it('caps at storage; overflow is lost; a stock above the cap is left alone', () => {
    const r = claimReward(100, { wood: 90, food: 100, iron: 150, gold: 0 }, { wood: 50, food: 50, iron: 50, gold: 0 });
    assert.deepEqual(r.resources, { wood: 100, food: 100, iron: 150, gold: 0 });
    assert.deepEqual(r.added, { wood: 10, food: 0, iron: 0, gold: 0 });
  });
  it('does not mutate its input', () => {
    const cur = deepFreeze({ wood: 1, food: 1, iron: 1, gold: 1 });
    claimReward(10, cur, { wood: 1, food: 1, iron: 1, gold: 1 });
  });
});
