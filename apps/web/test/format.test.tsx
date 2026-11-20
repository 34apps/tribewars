// Compact numbers for the top bar: five-digit resources must stay short so the account menu keeps its place.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatClock, formatClockParts, formatCompact, formatCompactShort } from '../src/format.ts';

test('formatCompact keeps small numbers exact and shortens big ones, always rounding down', () => {
  const cases: [number, string][] = [
    [0, '0'], [935, '935'], [2_935, '2,935'], [9_999, '9,999'], [9999.9, '9,999'], [999.9, '999'],
    [10_000, '10k'], [12_345, '12.3k'], [48_250, '48.2k'], [52_100, '52.1k'], [99_999, '99.9k'],
    [100_000, '100k'], [999_999, '999k'], [1_000_000, '1M'], [1_912_345, '1.91M'], [9_999_999, '9.99M'],
    [12_400_000, '12.4M'], [99_999_999, '99.9M'], [125_000_000, '125M'], [999_999_999, '999M'],
    [1_000_000_000, '1B'], [1_234_567_890, '1.23B'], [12_345_678_901, '12.3B'], [123_456_789_012, '123B'],
    [-935, '-935'], [-48_250, '-48.2k'], [-999_999, '-999k'], [-1_912_345, '-1.91M'],
  ];
  for (const [n, want] of cases) assert.equal(formatCompact(n), want, String(n));
});

test('formatCompactShort is at most 4 glyphs (comma not counted) and never rounds up', () => {
  const cases: [number, string][] = [
    [0, '0'], [935, '935'], [2_935, '2,935'], [9_999, '9,999'], [999.9, '999'],
    [10_000, '10k'], [48_250, '48k'], [99_999, '99k'], [100_000, '100k'], [999_999, '999k'],
    [1_000_000, '1M'], [1_912_345, '1.9M'], [9_999_999, '9.9M'], [12_400_000, '12M'], [125_000_000, '125M'],
    [999_999_999, '999M'], [1_234_567_890, '1.2B'], [12_345_678_901, '12B'], [123_456_789_012, '123B'],
    [-935, '-935'], [-48_250, '-48k'], [-1_912_345, '-1.9M'],
  ];
  for (const [n, want] of cases) {
    assert.equal(formatCompactShort(n), want, String(n));
    if (n >= 0) assert.ok(want.replace(',', '').length <= 4, want);
  }
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
