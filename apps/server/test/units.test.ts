import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addUnits, isWithin, only, splitScoutLosses, subtractUnits, sumUnits } from '../src/units.ts';
import { units } from './warfare-helpers.ts';

test('splitScoutLosses: own Pathfinders first, the rest in proportion, never more than a group has', () => {
  // Fewer losses than own Pathfinders: contingents are not touched.
  assert.deepEqual(splitScoutLosses(5, [4, 4], 3), { own: 3, support: [0, 0] });
  assert.deepEqual(splitScoutLosses(5, [4, 4], 5), { own: 5, support: [0, 0] });
  // The rest is split by size.
  assert.deepEqual(splitScoutLosses(1, [4, 4], 5), { own: 1, support: [2, 2] });
  assert.deepEqual(splitScoutLosses(0, [6, 3], 6), { own: 0, support: [4, 2] });
  assert.deepEqual(splitScoutLosses(0, [9, 1], 5), { own: 0, support: [5, 0] }, '4.5 and 0.5 tie on the remainder: the older contingent takes the extra unit');
  assert.deepEqual(splitScoutLosses(0, [1, 9], 5), { own: 0, support: [1, 4] }, 'the same tie again: the older (smaller) contingent takes the extra unit');
  assert.deepEqual(splitScoutLosses(0, [1, 9], 10), { own: 0, support: [1, 9] }, 'losing everything takes every unit');
  assert.deepEqual(splitScoutLosses(0, [9, 3], 7), { own: 0, support: [5, 2] }, '5.25 and 1.75: the larger remainder gets the extra unit');
  // An odd leftover goes to the larger remainder, a tie to the older contingent.
  assert.deepEqual(splitScoutLosses(1, [4, 4], 8), { own: 1, support: [4, 3] });
  assert.deepEqual(splitScoutLosses(0, [3, 3, 3], 4), { own: 0, support: [2, 1, 1] });
  assert.deepEqual(splitScoutLosses(0, [2, 5], 3), { own: 0, support: [1, 2] });
  // Always the exact total, capped by what exists.
  assert.deepEqual(splitScoutLosses(2, [3], 99), { own: 2, support: [3] });
  assert.deepEqual(splitScoutLosses(0, [], 4), { own: 0, support: [] });
  assert.deepEqual(splitScoutLosses(3, [2, 2], 0), { own: 0, support: [0, 0] });
  for (let own = 0; own < 4; own++) {
    for (const group of [[1], [1, 1], [5, 2], [3, 3, 3], [7, 1, 1]]) {
      for (let loss = 0; loss <= own + group.reduce((a, b) => a + b, 0); loss++) {
        const r = splitScoutLosses(own, group, loss);
        assert.equal(r.own + r.support.reduce((a, b) => a + b, 0), loss, `${own} ${group} ${loss}`);
        assert.ok(r.own <= own && r.support.every((n, i) => n <= (group[i] ?? 0)));
        assert.ok(r.own === own || r.support.every((n) => n === 0), 'contingents lose nothing while own Pathfinders remain');
      }
    }
  }
});

test('unit arithmetic keeps every key and never goes negative', () => {
  const a = units({ pikeman: 5, pathfinder: 2 });
  const b = units({ pikeman: 7, guard: 1 });
  assert.deepEqual(addUnits(a, b), units({ pikeman: 12, guard: 1, pathfinder: 2 }));
  assert.deepEqual(subtractUnits(a, b), units({ pathfinder: 2 }));
  assert.deepEqual(sumUnits([a, b, a]), units({ pikeman: 17, guard: 1, pathfinder: 4 }));
  assert.deepEqual(sumUnits([]), units({}));
  assert.equal(isWithin(units({ pikeman: 5 }), a), true);
  assert.equal(isWithin(units({ pikeman: 6 }), a), false);
  assert.equal(isWithin(units({ raider: 1 }), a), false);
  assert.deepEqual(only('pathfinder', 3), units({ pathfinder: 3 }));
});
