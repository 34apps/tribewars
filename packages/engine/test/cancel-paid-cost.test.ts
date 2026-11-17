// Cancel refunds come from the cost paid when the job was queued, not from today's price.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UNITS, applyBuild, applyCancelBuild, applyCancelResearch, applyCancelTrain, applyResearch, applyTrain, buildingCost, settleVillage } from '../src/index.ts';
import { S1, village } from './helpers.ts';

const rich = { wood: 50_000, food: 50_000, iron: 50_000, gold: 5_000 };
const base = () => village({ resources: rich, buildings: { storehouse: 25, barracks: 3, drillyard: 3, hall: 5 } });
const price = { wood: 1000, food: 500, iron: 200, gold: 0 };

describe('cancel refunds the stored paid cost', () => {
  it('queueing stamps the cost that was deducted', () => {
    const v0 = base();
    const b = applyBuild(v0, 'lumber', 0, S1);
    assert.deepEqual(b.buildQueue[0]!.cost, buildingCost('lumber', b.buildQueue[0]!.targetLevel));
    assert.equal(v0.resources.wood - b.resources.wood, b.buildQueue[0]!.cost!.wood);
    const t = applyTrain(v0, 'pikeman', 3, 0, S1);
    assert.deepEqual(t.trainQueues.barracks[0]!.unitCost, UNITS.pikeman.cost);
    const guard = UNITS.guard.research!;
    const r = applyResearch(v0, 'guard', 0, S1);
    assert.deepEqual(r.researchQueue![0]!.cost, guard.cost);
  });

  it('build: the stored cost wins over a changed price; a job without it falls back to today\'s price; inputs are not mutated', () => {
    const queued = applyBuild(base(), 'lumber', 0, S1);
    const stamped = structuredClone(queued);
    stamped.buildQueue[0]!.cost = price;
    const frozen = structuredClone(stamped);
    const { state, refund } = applyCancelBuild(stamped, 0, 0, S1);
    assert.deepEqual(refund, { wood: 800, food: 400, iron: 160, gold: 0 });
    assert.deepEqual(stamped, frozen, 'input untouched');
    assert.equal(state.buildQueue.length, 0);
    const old = structuredClone(queued);
    delete old.buildQueue[0]!.cost;
    const cost = buildingCost('lumber', old.buildQueue[0]!.targetLevel);
    assert.equal(applyCancelBuild(old, 0, 0, S1).refund.wood, Math.floor(cost.wood * 0.8));
  });

  it('training: partly trained batch refunds only the untrained rest at the stamped unit cost; no field falls back', () => {
    const queued = applyTrain(base(), 'pikeman', 10, 0, S1);
    const job = queued.trainQueues.barracks[0]!;
    const stamped = structuredClone(queued);
    stamped.trainQueues.barracks[0]!.unitCost = { wood: 100, food: 50, iron: 10, gold: 0 };
    const t = job.startAt + job.perUnitMs * 4 + 1; // 4 done, 6 left
    const settled = settleVillage(stamped, t, S1);
    assert.equal(settled.trainQueues.barracks[0]!.done, 4);
    const frozen = structuredClone(stamped);
    const { refund } = applyCancelTrain(stamped, 'barracks', 0, t, S1);
    assert.deepEqual(refund, { wood: Math.floor((600 * 80) / 100), food: Math.floor((300 * 80) / 100), iron: Math.floor((60 * 80) / 100), gold: 0 });
    assert.deepEqual(stamped, frozen);
    const old = structuredClone(queued);
    delete old.trainQueues.barracks[0]!.unitCost;
    assert.equal(applyCancelTrain(old, 'barracks', 0, t, S1).refund.wood, Math.floor((UNITS.pikeman.cost.wood * 6 * 80) / 100));
  });

  it('research: the stored cost wins; no field falls back to the rule cost', () => {
    const queued = applyResearch(base(), 'guard', 0, S1);
    const stamped = structuredClone(queued);
    stamped.researchQueue![0]!.cost = price;
    const frozen = structuredClone(stamped);
    assert.deepEqual(applyCancelResearch(stamped, 0, 0, S1).refund, { wood: 800, food: 400, iron: 160, gold: 0 });
    assert.deepEqual(stamped, frozen);
    const old = structuredClone(queued);
    delete old.researchQueue![0]!.cost;
    const rc = UNITS.guard.research!.cost;
    assert.equal(applyCancelResearch(old, 0, 0, S1).refund.wood, Math.floor((rc.wood * 80) / 100));
  });
});
