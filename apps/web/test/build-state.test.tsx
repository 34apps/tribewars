// The building state control: one pure picker for the Village list and the building page, and the shared training-row check.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_WORLD, createPlayerVillage } from '@clanfire/engine';
import { pickBuildState, refusalOf } from '../src/buildState.ts';
import type { BuildStateInput } from '../src/buildState.ts';
import { trainRowState } from '../src/views/trainRow.ts';

const base: BuildStateInput = {
  level: 3,
  jobsOfThis: 0,
  upgradingLeftMs: null,
  atMax: false,
  locked: false,
  refusal: 'none',
  affordInMs: null,
  queueFreesInMs: null,
};
const kind = (over: Partial<BuildStateInput>) => pickBuildState({ ...base, ...over }).kind;

test('each state of the control is picked, and only the gold one is actionable', () => {
  assert.deepEqual(pickBuildState(base), { kind: 'build', actionable: true });
  assert.equal(kind({ refusal: 'not_enough_resources', affordInMs: 4_800_000 }), 'afford');
  assert.equal(kind({ refusal: 'queue_full', queueFreesInMs: 60_000 }), 'queuefull');
  assert.equal(kind({ jobsOfThis: 1, upgradingLeftMs: 5_000 }), 'upgrading');
  assert.equal(kind({ jobsOfThis: 1 }), 'queued');
  assert.equal(kind({ atMax: true }), 'max');
  assert.equal(kind({ level: 0, locked: true }), 'locked');
  assert.equal(kind({ refusal: 'other' }), 'blocked');
  for (const k of ['afford', 'queuefull', 'upgrading', 'queued', 'max', 'locked', 'blocked'] as const) {
    const refusal = k === 'afford' ? 'not_enough_resources' : k === 'queuefull' ? 'queue_full' : k === 'blocked' ? 'other' : 'none';
    const pick = pickBuildState({ ...base, refusal, jobsOfThis: k === 'upgrading' || k === 'queued' ? 1 : 0, upgradingLeftMs: k === 'upgrading' ? 1 : null, atMax: k === 'max', locked: k === 'locked' });
    assert.equal(pick.kind, k);
    assert.equal(pick.actionable, false);
  }
});

test('the order of the states: a running job beats everything, max beats locked, locked beats the stock', () => {
  assert.equal(kind({ upgradingLeftMs: 1, jobsOfThis: 1, atMax: true, locked: true, refusal: 'queue_full' }), 'upgrading');
  assert.equal(kind({ jobsOfThis: 1, atMax: true }), 'queued');
  assert.equal(kind({ atMax: true, locked: true }), 'max');
  assert.equal(kind({ locked: true, refusal: 'not_enough_resources' }), 'locked');
  assert.equal(kind({ refusal: 'queue_full' }), 'queuefull');
});

test('refusalOf maps the engine check to the picker, a cold village always blocks', () => {
  assert.equal(refusalOf({ ok: true }, null), 'none');
  assert.equal(refusalOf({ ok: true }, 'Hearth is out'), 'other');
  assert.equal(refusalOf({ ok: false, reason: 'queue_full' }, null), 'queue_full');
  assert.equal(refusalOf({ ok: false, reason: 'not_enough_resources' }, null), 'not_enough_resources');
  assert.equal(refusalOf({ ok: false, reason: 'exceeds_storage' }, null), 'other');
});

test('training row: amount, max, and the reason Train is refused (same rules as the Army page)', () => {
  const now = 1_000;
  const live = createPlayerVillage(now, { wood: 5000, food: 5000, iron: 5000, gold: 5000 });
  live.buildings.barracks = 3;
  const args = { live, unit: 'pikeman' as const, building: 'barracks' as const, now, settings: DEFAULT_WORLD, trainQueueLimit: 5, hearthOut: false };
  const empty = trainRowState({ ...args, text: '' });
  assert.equal(empty.count, 0);
  assert.equal(empty.reason, 'Enter amount');
  assert.ok(empty.max >= 1);
  const ten = trainRowState({ ...args, text: '10' });
  assert.equal(ten.count, 10);
  assert.equal(ten.reason, null);
  assert.ok(ten.batchCost.wood > 0);
  assert.equal(trainRowState({ ...args, text: '2.5' }).count, 0);
  assert.equal(trainRowState({ ...args, text: '-4' }).count, 0);
  assert.equal(trainRowState({ ...args, text: '10', hearthOut: true }).reason !== null, true);
  assert.equal(trainRowState({ ...args, text: '10', trainQueueLimit: 0 }).reason, 'Queue full');
  const poor = createPlayerVillage(now, { wood: 0, food: 0, iron: 0, gold: 0 });
  poor.buildings.barracks = 3;
  assert.equal(trainRowState({ ...args, live: poor, text: '3' }).reason !== null, true);
  assert.equal(trainRowState({ ...args, live: poor, text: '' }).reason, 'Cannot afford one');
});

test('training row: a unit whose building level is missing is locked with its requirement', () => {
  const now = 1_000;
  const live = createPlayerVillage(now);
  live.buildings.barracks = 1;
  const row = trainRowState({ live, unit: 'logram', building: 'barracks', text: '1', now, settings: DEFAULT_WORLD, trainQueueLimit: 5, hearthOut: false });
  assert.equal(row.locked, true);
  assert.equal(row.max, 0);
  assert.match(row.reason ?? '', /^Needs Barracks 5/);
});
