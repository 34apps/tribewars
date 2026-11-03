import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CANCEL_REFUND_PERCENT,
  GameError,
  UNITS,
  applyBuild,
  applyCancelBuild,
  applyCancelResearch,
  applyCancelTrain,
  applyResearch,
  applyTrain,
  buildingCost,
} from '../src/index.ts';
import { S1, village } from './helpers.ts';

const rich = { wood: 50_000, food: 50_000, iron: 50_000, gold: 5_000 };
const fail = (fn: () => unknown) => assert.throws(fn, (e: unknown) => e instanceof GameError && e.code === 'invalid_input');

describe('cancelling queued jobs', () => {
  it('refund is 80% of the build cost, rounded down; the job leaves the queue', () => {
    assert.equal(CANCEL_REFUND_PERCENT, 80);
    const start = village({ resources: rich, buildings: { storehouse: 20 } });
    const queued = applyBuild(start, 'lumber', 0, S1);
    const cost = buildingCost('lumber', queued.buildQueue[0]!.targetLevel);
    const { state, refund } = applyCancelBuild(queued, 0, 0, S1);
    assert.deepEqual(state.buildQueue, []);
    assert.equal(refund.wood, Math.floor(cost.wood * 0.8));
    assert.equal(state.resources.wood, queued.resources.wood + refund.wood);
  });

  it('only the newest build job can be cancelled; bad indexes are refused', () => {
    let v = village({ resources: rich, buildings: { storehouse: 20 } });
    v = applyBuild(v, 'lumber', 0, S1);
    v = applyBuild(v, 'mine', 0, S1);
    fail(() => applyCancelBuild(v, 0, 0, S1));
    fail(() => applyCancelBuild(v, 5, 0, S1));
    fail(() => applyCancelBuild(v, 1.5, 0, S1));
    assert.equal(applyCancelBuild(v, 1, 0, S1).state.buildQueue.length, 1);
  });

  it('cancelling a training batch refunds 80% of the untrained rest and moves later batches up', () => {
    let v = village({ resources: rich, buildings: { barracks: 3, storehouse: 20 } });
    v = applyTrain(v, 'pikeman', 10, 0, S1);
    v = applyTrain(v, 'pikeman', 4, 0, S1);
    const second = v.trainQueues.barracks[1]!;
    const before = v.resources.wood;
    const { state, refund } = applyCancelTrain(v, 'barracks', 0, 0, S1);
    assert.equal(state.trainQueues.barracks.length, 1);
    assert.equal(state.trainQueues.barracks[0]!.startAt, 0);
    assert.ok(second.startAt > 0);
    assert.equal(refund.wood, Math.floor(UNITS.pikeman.cost.wood * 10 * 0.8));
    assert.equal(state.resources.wood, before + refund.wood);
  });

  it('units already trained stay and only the rest is refunded', () => {
    let v = village({ resources: rich, buildings: { barracks: 3, storehouse: 20 } });
    v = applyTrain(v, 'pikeman', 10, 0, S1);
    const perUnit = v.trainQueues.barracks[0]!.perUnitMs;
    const t = perUnit * 3 + 1;
    const { state, refund } = applyCancelTrain(v, 'barracks', 0, t, S1);
    assert.equal(state.troops.pikeman, v.troops.pikeman + 3);
    assert.equal(refund.wood, Math.floor(UNITS.pikeman.cost.wood * 7 * 0.8));
    assert.deepEqual(state.trainQueues.barracks, []);
  });

  it('bad training input is refused', () => {
    const v = village({ resources: rich, buildings: { barracks: 3 } });
    fail(() => applyCancelTrain(v, 'barracks', 0, 0, S1));
    fail(() => applyCancelTrain(v, 'tavern', 0, 0, S1));
  });
});

describe('cancelling research', () => {
  it('refunds 80% of the cost, clears the job and leaves the unit unresearched', () => {
    const base = { hall: 10, barracks: 5, stables: 5, storehouse: 20, farm: 20, drillyard: 10 };
    const started = applyResearch(village({ buildings: base, resources: rich }), 'guard', 0, S1);
    const cost = UNITS.guard.research!.cost;
    const { state, refund } = applyCancelResearch(started, 0, S1);
    assert.equal(state.researchJob, undefined);
    assert.equal(refund.wood, Math.floor(cost.wood * 0.8));
    assert.equal(state.resources.wood, started.resources.wood + refund.wood);
    assert.ok(!(state.researched ?? []).includes('guard'));
    fail(() => applyCancelResearch(state, 0, S1));
    assert.ok(applyResearch(state, 'guard', 0, S1).researchJob);
  });
});
