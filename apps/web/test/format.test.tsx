// Compact numbers for the top bar: five-digit resources must stay short so the account menu keeps its place.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatClock, formatClockParts, formatCompact, formatCompactShort, formatCoords, formatCoordsTag, formatLeftShort } from '../src/format.ts';

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

test('formatCoordsTag: spaces around the bar, true minus sign; formatCoords keeps the old style', () => {
  assert.equal(formatCoordsTag(-9, 24), '\u22129 | 24');
  assert.equal(formatCoordsTag(6, 2), '6 | 2');
  assert.equal(formatCoordsTag(0, -15), '0 | \u221215');
  assert.equal(formatCoordsTag(-120, -3), '\u2212120 | \u22123');
  assert.equal(formatCoords(-9, 24), '-9|24');
});

test('formatLeftShort: the largest whole unit only', () => {
  assert.equal(formatLeftShort((2 * 86400 + 23 * 3600) * 1000), '2d');
  assert.equal(formatLeftShort(86400 * 1000), '1d');
  assert.equal(formatLeftShort((23 * 3600 + 59 * 60) * 1000), '23h');
  assert.equal(formatLeftShort(45 * 60 * 1000), '45m');
  assert.equal(formatLeftShort(30_500), '31s');
  assert.equal(formatLeftShort(-5), '0s');
});
