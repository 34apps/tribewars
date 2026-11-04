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
    for (const r of a.results) {
      // Renown model: building levels pay (the first day builds something), nothing negative, sources add up.
      assert.ok(r.renownTotal >= 0);
      const src = r.renownSources;
      assert.ok(Math.abs(src.buildings + src.raids + src.defence + src.feast - r.renownTotal) <= 4);
      assert.equal(r.rows[0]!.renownTotal, r.renownTotal);
      assert.equal(r.rows[0]!.renownBalance, r.rows[0]!.renownTotal);
    }
    assert.ok(a.results.find((r) => r.style === 'builder')!.renownTotal > 0);
    // The turtle is never attacked in the Renown model.
    assert.deepEqual(a.results.find((r) => r.style === 'turtle')!.threats, []);
    const text = formatReport(a);
    assert.match(text, /## builder/);
    assert.match(text, /## Renown pace/);
    assert.match(text, /real pace: the later of both/);
    assert.deepEqual(runSimulation({ days: 1 }).results, a.results);
  });
});
