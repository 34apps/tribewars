// The "Call back" / "Recall" form (Army page and map site panel): what the typed amounts turn into.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyUnits } from '@clanfire/engine';
import { recallChoice } from '../src/recallChoice.ts';

const have = { ...emptyUnits(), raider: 40, pikeman: 25 };

test('part of a contingent: only the typed amounts, whole numbers, each up to what stands there', () => {
  assert.deepEqual(recallChoice(have, { raider: '10', pikeman: '' }), { chosen: { raider: 10 }, total: 10 });
  assert.deepEqual(recallChoice(have, { raider: '999', pikeman: '25' }), { chosen: { raider: 40, pikeman: 25 }, total: 65 });
});

test('empty, zero, negative and fractional amounts choose nothing (the button stays off)', () => {
  assert.deepEqual(recallChoice(have, {}), { chosen: {}, total: 0 });
  assert.deepEqual(recallChoice(have, { raider: '0', pikeman: '-4' }), { chosen: {}, total: 0 });
  assert.deepEqual(recallChoice(have, { raider: '2.5', pikeman: 'abc' }), { chosen: {}, total: 0 });
});

test('a unit type that is not standing there can never be chosen', () => {
  assert.deepEqual(recallChoice(have, { guard: '5' }), { chosen: {}, total: 0 });
});
