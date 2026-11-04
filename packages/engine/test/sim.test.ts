import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STYLES, formatReport, runSimulation } from '../../../scripts/sim/balance.ts';

describe('balance simulator (scripts/sim/balance.ts)', () => {
  it('plays 1 day for every style without errors and is repeatable', () => {
    const a = runSimulation({ days: 1 });
    assert.deepEqual(a.results.map((r) => r.style), STYLES);
    for (const r of a.results) {
      assert.deepEqual(r.errors, []);
      assert.equal(r.rows.length, 1);
      assert.ok(r.rows[0]!.levelSum > 0);
    }
    assert.match(formatReport(a), /## builder/);
    assert.deepEqual(runSimulation({ days: 1 }).results, a.results);
  });
});
