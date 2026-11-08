// Pure helpers behind the First steps card (src/firstSteps.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FirstStepDto, FirstStepId, FirstStepsDto, Resources } from '@clanfire/engine';
import { FIRST_STEPS } from '@clanfire/engine';
import { FIRST_STEP_LABEL, FIRST_STEP_TARGET, addedText, claimableSteps, doneCount, firstStepsVisible, nextOpenStep, wouldOverflow } from '../src/firstSteps.ts';

const res = (wood: number, food: number, iron: number, gold = 0): Resources => ({ wood, food, iron, gold });

function dto(done: FirstStepId[], claimed: FirstStepId[] = [], extra: Partial<FirstStepsDto> = {}): FirstStepsDto {
  const steps: FirstStepDto[] = FIRST_STEPS.map((s) => ({ id: s.id, done: done.includes(s.id), claimed: claimed.includes(s.id), reward: { ...s.reward } }));
  return { steps, hidden: false, allClaimed: false, ...extra };
}

test('every step has a label and a Show me target', () => {
  for (const s of FIRST_STEPS) {
    assert.ok(FIRST_STEP_LABEL[s.id]);
    assert.ok(FIRST_STEP_TARGET[s.id]);
  }
});

test('next step is the first one not done, in display order; claimable are done but not claimed', () => {
  const fs = dto(['farm2', 'lumber2'], ['lumber2']);
  assert.equal(nextOpenStep(fs)?.id, 'hall2');
  assert.deepEqual(claimableSteps(fs).map((s) => s.id), ['farm2']);
  assert.equal(doneCount(fs), 2);
  assert.equal(nextOpenStep(dto(FIRST_STEPS.map((s) => s.id))), null);
});

test('the card hides when folded away or all claimed', () => {
  assert.equal(firstStepsVisible(dto([])), true);
  assert.equal(firstStepsVisible(dto([], [], { hidden: true })), false);
  assert.equal(firstStepsVisible(dto([], [], { allClaimed: true })), false);
  assert.equal(firstStepsVisible(undefined), false);
});

test('overflow is true only when a rewarded resource would pass the storage cap', () => {
  assert.equal(wouldOverflow(res(150, 80, 80), res(100, 100, 100), 1000), false);
  assert.equal(wouldOverflow(res(150, 80, 80), res(900, 0, 0), 1000), true);
  assert.equal(wouldOverflow(res(150, 80, 80, 0), res(0, 0, 0, 5000), 1000), false); // gold not rewarded
  assert.equal(wouldOverflow(res(150, 0, 0), res(850, 0, 0), 1000), false); // exactly fits
});

test('addedText lists what arrived and says so when nothing did', () => {
  assert.equal(addedText(res(150, 80, 0, 20)), '150 wood, 80 food, 20 gold');
  assert.equal(addedText(res(0, 0, 0)), 'nothing (storage full)');
});
