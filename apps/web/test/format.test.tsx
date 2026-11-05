// Compact numbers for the top bar: five-digit resources must stay short so the account menu keeps its place.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCompact } from '../src/format.ts';

test('formatCompact keeps small numbers exact and shortens big ones', () => {
  assert.equal(formatCompact(0), '0');
  assert.equal(formatCompact(9999.9), '9,999');
  assert.equal(formatCompact(12_345), '12.3k');
  assert.equal(formatCompact(52_100), '52.1k');
  assert.equal(formatCompact(100_000), '100k');
  assert.equal(formatCompact(1_234_567), '1.23M');
});
