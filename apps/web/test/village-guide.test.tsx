// Which building the Village page points at (src/views/village/guide.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BuildingId, FirstStepDto, FirstStepId, FirstStepsDto } from '@clanfire/engine';
import { FIRST_STEPS } from '@clanfire/engine';
import { pickGuide } from '../src/views/village/guide.ts';

function dto(done: FirstStepId[]): FirstStepsDto {
  const steps: FirstStepDto[] = FIRST_STEPS.map((s) => ({ id: s.id, done: done.includes(s.id), claimed: false, reward: { ...s.reward } }));
  return { steps, hidden: false, allClaimed: false };
}
type Kind = 'build' | 'afford' | 'upgrading' | 'queued' | 'max' | 'locked';
const info = (kinds: Partial<Record<BuildingId, Kind>>, costs: Partial<Record<BuildingId, number>> = {}) => (id: BuildingId) => {
  const k = kinds[id] ?? 'locked';
  return {
    level: k === 'locked' ? 0 : 1,
    pick: { kind: k, actionable: k === 'build' } as never,
    cost: { wood: costs[id] ?? 100, food: 0, iron: 0, gold: 0 },
  };
};

test('points at the building the current step asks for', () => {
  const g = pickGuide(dto([]), info({ lumber: 'build' }), true);
  assert.deepEqual(g, { id: 'lumber', kind: 'upgrade', title: 'Upgrade the Lumber Camp' });
  assert.equal(pickGuide(dto(['lumber2']), info({ farm: 'afford' }), true)?.id, 'farm');
});

test('a step building that is already being upgraded gets no pointer', () => {
  assert.equal(pickGuide(dto([]), info({ lumber: 'upgrading', farm: 'build' }), false), null);
});

test('train step opens the barracks; tab steps fall back to the cheapest affordable resource building when idle', () => {
  const upTo = ['lumber2', 'farm2', 'hall2', 'barracks2'] as FirstStepId[];
  assert.deepEqual(pickGuide(dto(upTo), info({ barracks: 'build' }), true), { id: 'barracks', kind: 'open', title: 'Train 5 Raiders' });
  const done = FIRST_STEPS.map((s) => s.id).filter((s) => s !== 'raid' && s !== 'report' && s !== 'tribe');
  const g = pickGuide(dto(done), info({ lumber: 'build', farm: 'build', mine: 'afford' }, { lumber: 300, farm: 120 }), true);
  assert.equal(g?.id, 'farm');
  assert.equal(pickGuide(dto(done), info({ lumber: 'build' }), false), null);
  assert.equal(pickGuide(undefined, info({}), true), null);
});
