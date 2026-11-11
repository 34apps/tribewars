// Compact numbers for the top bar: five-digit resources must stay short so the account menu keeps its place.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatClock, formatClockParts, formatCompact } from '../src/format.ts';

test('formatCompact keeps small numbers exact and shortens big ones', () => {
  assert.equal(formatCompact(0), '0');
  assert.equal(formatCompact(9999.9), '9,999');
  assert.equal(formatCompact(12_345), '12.3k');
  assert.equal(formatCompact(52_100), '52.1k');
  assert.equal(formatCompact(100_000), '100k');
  assert.equal(formatCompact(1_234_567), '1.23M');
});

test('formatClockParts splits the day off the clock time; formatClock joins them', () => {
  const now = new Date(2026, 10, 11, 20, 0, 0).getTime();
  const today = new Date(2026, 10, 11, 22, 5, 9).getTime();
  const tomorrow = new Date(2026, 10, 12, 2, 36, 0).getTime();
  const later = new Date(2026, 10, 14, 9, 0, 0).getTime();
  assert.equal(formatClockParts(today, now).day, '');
  assert.match(formatClockParts(today, now).time, /22.05.09/);
  assert.equal(formatClockParts(tomorrow, now).day, 'tomorrow');
  assert.equal(formatClock(tomorrow, now), `tomorrow ${formatClockParts(tomorrow, now).time}`);
  const far = formatClockParts(later, now);
  assert.notEqual(far.day, '');
  assert.equal(formatClock(later, now), `${far.day} ${far.time}`);
});
