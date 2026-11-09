// Reports list helpers: short titles, compact age, Today / Yesterday / Earlier groups.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayGroup, formatShortAgo, groupByDay, reportLine } from '../src/reports.ts';

test('report titles become one short line with the coordinates split off', () => {
  assert.deepEqual(reportLine('Attack from Tolvek (-2|4)'), { text: 'Tolvek attacked', coords: '-2|4' });
  assert.deepEqual(reportLine('Raid on Hillfort (3|-4)'), { text: 'You raided Hillfort', coords: '3|-4' });
  assert.deepEqual(reportLine('Scouting Hillfort (3|-4)'), { text: 'You scouted Hillfort', coords: '3|-4' });
  assert.deepEqual(reportLine('Enemy scouts from Brannoch (1|1)'), { text: 'Scouts from Brannoch', coords: '1|1' });
  assert.equal(reportLine('Your troops at Oak (5|5) were attacked').text, 'Support at Oak attacked');
  assert.equal(reportLine('Support for Oak (5|5) turned back: left the pact').text, 'Support for Oak turned back');
  assert.equal(reportLine('Attack on Oak (5|5) called off: protected').text, 'Attack on Oak called off: protected');
  assert.deepEqual(reportLine('Something else'), { text: 'Something else', coords: null });
});

test("default village names drop the 's village", () => {
  assert.equal(reportLine("Attack from Tolvek's village (1|2)").text, 'Tolvek attacked');
  assert.equal(reportLine("Raid on Abandoned village (1|2)").text, 'You raided Abandoned village');
});

test('compact age', () => {
  const now = 10 * 86_400_000;
  assert.equal(formatShortAgo(now - 10_000, now), 'now');
  assert.equal(formatShortAgo(now - 5 * 60_000, now), '5m');
  assert.equal(formatShortAgo(now - 4 * 3_600_000, now), '4h');
  assert.equal(formatShortAgo(now - 2 * 86_400_000, now), '2d');
});

test('day groups follow the local calendar', () => {
  const now = new Date(2026, 10, 9, 15, 0, 0).getTime();
  assert.equal(dayGroup(new Date(2026, 10, 9, 0, 5).getTime(), now), 'today');
  assert.equal(dayGroup(new Date(2026, 10, 8, 23, 55).getTime(), now), 'yesterday');
  assert.equal(dayGroup(new Date(2026, 10, 8, 0, 0).getTime(), now), 'yesterday');
  assert.equal(dayGroup(new Date(2026, 10, 7, 23, 59).getTime(), now), 'earlier');
  const items = [
    { createdAt: new Date(2026, 10, 7, 10).getTime() },
    { createdAt: new Date(2026, 10, 9, 10).getTime() },
  ];
  assert.deepEqual(groupByDay(items, now).map((g) => [g.group, g.items.length]), [['today', 1], ['earlier', 1]]);
});
