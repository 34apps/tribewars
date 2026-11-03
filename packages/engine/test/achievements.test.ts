import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACHIEVEMENTS, ACHIEVEMENT_TIERS, STAT_KEYS, achievementProgress, emptyStats } from '../src/index.ts';

describe('achievements', () => {
  it('has about twenty, with unique ids, names and ascending tiers', () => {
    assert.ok(ACHIEVEMENTS.length >= 18);
    assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
    assert.equal(new Set(ACHIEVEMENTS.map((a) => a.name)).size, ACHIEVEMENTS.length);
    assert.equal(Object.keys(ACHIEVEMENT_TIERS).length, ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) {
      assert.ok(a.tiers[0] < a.tiers[1] && a.tiers[1] < a.tiers[2], `${a.id} tiers ascend`);
      if (a.stat) assert.ok(STAT_KEYS.includes(a.stat));
    }
  });

  it('everything is locked at zero with the bronze threshold next', () => {
    const p = achievementProgress(emptyStats());
    assert.equal(p.length, ACHIEVEMENTS.length);
    for (const [i, a] of ACHIEVEMENTS.entries()) assert.deepEqual(p[i], { id: a.id, value: 0, tier: 0, next: a.tiers[0] });
  });

  it('reports tier, value and next threshold, and gold has no next', () => {
    const [bronze, silver] = ACHIEVEMENT_TIERS.fireStarter;
    const at = (n: number) => achievementProgress({ ...emptyStats(), attacksWon: n }).find((x) => x.id === 'fireStarter');
    assert.deepEqual(at(bronze - 1), { id: 'fireStarter', value: bronze - 1, tier: 0, next: bronze });
    assert.deepEqual(at(bronze), { id: 'fireStarter', value: bronze, tier: 1, next: silver });
    assert.equal(at(silver)?.tier, 2);
    assert.deepEqual(at(ACHIEVEMENT_TIERS.fireStarter[2] + 5), { id: 'fireStarter', value: ACHIEVEMENT_TIERS.fireStarter[2] + 5, tier: 3, next: null });
  });

  it('derived achievements add up their counters', () => {
    const s = { ...emptyStats(), lootWood: 4000, lootFood: 4000, lootIron: 2000, lootGold: 0 };
    const hoard = achievementProgress(s).find((x) => x.id === 'hoardOfHoards');
    assert.equal(hoard?.value, 10000);
    assert.equal(hoard?.tier, 1);
  });
});
