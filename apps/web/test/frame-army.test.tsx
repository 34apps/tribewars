// Desktop Army page: movement filter/order, "+N more" split, queue summary and the recent-targets list.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MovementDto, TrainJob } from '@clanfire/engine';
import {
  RECENT_MAX,
  addRecent,
  filterMovements,
  moveCounts,
  parseRecent,
  queueDoneAt,
  queueUnitsLeft,
  splitSupportRows,
  sortMovements,
  takeRows,
} from '../src/views/army/frame-army-logic.ts';
import type { RecentTarget } from '../src/views/army/frame-army-logic.ts';

type M = Pick<MovementDto, 'id' | 'direction' | 'kind' | 'arriveAt'>;
const m = (id: number, direction: M['direction'], kind: M['kind'], arriveAt: number): M => ({ id, direction, kind, arriveAt });

test('movements: incoming attacks first, then other incoming, then own; each by arrival', () => {
  const list = [
    m(1, 'outgoing', 'return', 100),
    m(2, 'incoming', 'support', 50),
    m(3, 'incoming', 'attack', 900),
    m(4, 'outgoing', 'attack', 10),
    m(5, 'incoming', 'attack', 400),
  ];
  assert.deepEqual(sortMovements(list).map((x) => x.id), [5, 3, 2, 4, 1]);
  assert.deepEqual(list.map((x) => x.id), [1, 2, 3, 4, 5], 'the input is not changed');
});

test('movements: All / In / Out filter and the counts on the buttons', () => {
  const list = [m(1, 'outgoing', 'return', 1), m(2, 'incoming', 'attack', 2), m(3, 'outgoing', 'support', 3)];
  assert.equal(filterMovements(list, 'all').length, 3);
  assert.deepEqual(filterMovements(list, 'in').map((x) => x.id), [2]);
  assert.deepEqual(filterMovements(list, 'out').map((x) => x.id), [1, 3]);
  assert.deepEqual(moveCounts(list), { all: 3, in: 1, out: 2 });
  assert.deepEqual(moveCounts([]), { all: 0, in: 0, out: 0 });
});

test('takeRows: the first rows and the rest as "+N more"', () => {
  assert.deepEqual(takeRows([1, 2, 3, 4, 5], 3), { shown: [1, 2, 3], more: 2 });
  assert.deepEqual(takeRows([1, 2], 3), { shown: [1, 2], more: 0 });
  assert.deepEqual(takeRows([1, 2], 0), { shown: [], more: 2 });
  assert.deepEqual(takeRows([], 3), { shown: [], more: 0 });
});

test('support rows: every group with rows keeps at least one, the rest goes to the first group', () => {
  assert.deepEqual(splitSupportRows(0, 0), { here: 0, away: 0 });
  assert.deepEqual(splitSupportRows(1, 2), { here: 1, away: 2 });
  assert.deepEqual(splitSupportRows(5, 0), { here: 3, away: 0 });
  assert.deepEqual(splitSupportRows(0, 7), { here: 0, away: 3 });
  assert.deepEqual(splitSupportRows(4, 4), { here: 2, away: 1 });
  assert.deepEqual(splitSupportRows(1, 9), { here: 1, away: 2 });
});

const job = (unit: TrainJob['unit'], count: number, done: number, perUnitMs: number, startAt: number): TrainJob => ({ unit, count, done, perUnitMs, startAt });

test('training queue: done time is the end of the last batch, units left skip what is trained', () => {
  assert.equal(queueDoneAt([]), null);
  const q = [job('raider', 5, 1, 1000, 0), job('pikeman', 20, 0, 500, 5000)];
  assert.equal(queueDoneAt(q), 15000);
  assert.equal(queueUnitsLeft(q), 24);
  assert.equal(queueUnitsLeft([]), 0);
});

const t = (x: number, y: number, who = ''): RecentTarget => ({ x, y, kind: who ? 'player' : 'abandoned', who });

test('recent targets: newest first, one per tile, at most four', () => {
  let list: RecentTarget[] = [];
  for (let i = 0; i < 6; i++) list = addRecent(list, t(i, i));
  assert.equal(list.length, RECENT_MAX);
  assert.deepEqual(list.map((e) => e.x), [5, 4, 3, 2]);
  list = addRecent(list, t(3, 3, 'Tolvek'));
  assert.deepEqual(list.map((e) => e.x), [3, 5, 4, 2]);
  assert.equal(list[0]?.who, 'Tolvek');
});

test('recent targets: stored text is cleaned, bad input gives an empty list', () => {
  assert.deepEqual(parseRecent(null), []);
  assert.deepEqual(parseRecent('not json'), []);
  assert.deepEqual(parseRecent('{"x":1}'), []);
  const raw = JSON.stringify([
    { x: 1, y: 2, kind: 'abandoned', who: '' },
    { x: 'a', y: 2, kind: 'abandoned', who: '' },
    { x: 3, y: 4, kind: 'castle', who: '' },
    { x: 5, y: 6, kind: 'player', who: 7 },
    null,
  ]);
  assert.deepEqual(parseRecent(raw), [
    { x: 1, y: 2, kind: 'abandoned', who: '' },
    { x: 5, y: 6, kind: 'player', who: '' },
  ]);
  const many = JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ x: i, y: i, kind: 'own', who: '' })));
  assert.equal(parseRecent(many).length, RECENT_MAX);
});
