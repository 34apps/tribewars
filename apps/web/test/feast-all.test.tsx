// "Feast in all villages": row states, default picks, clamping, totals, the request body and the result sentences.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEAST_RENOWN } from '@clanfire/engine';
import type { FeastVillageDto } from '@clanfire/engine';
import { buildFeastRequest, defaultPicks, pickCount, pickTotals, resultLine, rowNote, rowState, skippedLines, toggleAll } from '../src/feastAll.ts';

const res = { wood: 100, food: 100, iron: 100, gold: 100 };
const v = (id: number, bannerhall: number, max: number): FeastVillageDto => ({ id, name: `V${id}`, x: id, y: id, bannerhall, price: res, resources: res, max });
const list = [v(1, 3, 12), v(2, 0, 0), v(3, 2, 0), v(4, 1, 5)];

test('row states and notes', () => {
  assert.deepEqual(list.map(rowState), ['ready', 'no-hall', 'broke', 'ready']);
  assert.equal(rowNote('no-hall'), 'Needs Banner Hall level 1');
  assert.equal(rowNote('broke'), 'Not enough resources for one Feast');
  assert.equal(rowNote('ready'), null);
});

test('defaults: ticked at max where possible, unticked otherwise', () => {
  const p = defaultPicks(list);
  assert.deepEqual([p[1]!.on, p[2]!.on, p[3]!.on, p[4]!.on], [true, false, false, true]);
  assert.equal(pickCount(list[0]!, p[1]), 12);
  assert.equal(pickCount(list[1]!, p[2]), 0);
});

test('numbers are clamped to 1..max, junk becomes 1', () => {
  assert.equal(pickCount(list[0]!, { on: true, text: '99' }), 12);
  assert.equal(pickCount(list[0]!, { on: true, text: '0' }), 1);
  assert.equal(pickCount(list[0]!, { on: true, text: '' }), 1);
  assert.equal(pickCount(list[0]!, { on: true, text: '7' }), 7);
});

test('totals and request only count ticked rows', () => {
  const p = defaultPicks(list);
  assert.deepEqual(pickTotals(list, p), { villages: 2, feasts: 17, renown: 17 * FEAST_RENOWN });
  p[4] = { on: false, text: '5' };
  p[1] = { on: true, text: '3' };
  assert.deepEqual(buildFeastRequest(list, p), [{ id: 1, count: 3 }]);
  assert.deepEqual(buildFeastRequest(list, { ...p, 1: { on: false, text: '3' } }), []);
});

test('tick all / untick all only touches rows that can Feast', () => {
  const p = defaultPicks(list);
  const off = toggleAll(list, p);
  assert.deepEqual([off[1]!.on, off[2]!.on, off[3]!.on, off[4]!.on], [false, false, false, false]);
  const on = toggleAll(list, off);
  assert.deepEqual([on[1]!.on, on[2]!.on, on[3]!.on, on[4]!.on], [true, false, false, true]);
});

test('result sentence and skipped villages', () => {
  const r = {
    gained: 370,
    results: [
      { id: 1, held: 30, gained: 300 },
      { id: 4, held: 7, gained: 70 },
      { id: 3, held: 0, gained: 0, skipped: { reason: 'not_enough_resources', message: 'Not enough resources.' } },
    ],
  };
  assert.equal(resultLine(r), 'Held 37 Feasts in 2 villages: +370 Renown');
  assert.deepEqual(skippedLines(r, list), ['V3: Not enough resources.']);
  assert.equal(resultLine({ gained: 0, results: [r.results[2]!] }), 'Nothing was held.');
  assert.equal(resultLine({ gained: 10, results: [{ id: 1, held: 1, gained: 10 }] }), 'Held 1 Feast in 1 village: +10 Renown');
});
