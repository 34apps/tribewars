import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DOMINATION_DEFAULTS,
  checkDominationValue,
  dominationActiveMs,
  dominationEvalIntervalMs,
  dominationMinAgeMs,
  dominationRealDays,
  dominationStreakMs,
  evaluateDomination,
  meetsWinShare,
  mergeDominationSettings,
  minActivePlayersNeeded,
  type DominationInput,
} from '../src/index.ts';
import { deepFreeze } from './helpers.ts';

const DAY = 86_400_000;
const D = DOMINATION_DEFAULTS;

const base = (over: Partial<DominationInput> = {}): DominationInput => ({
  now: 200 * DAY,
  speed: 1,
  worldCreatedAt: 0,
  settings: D,
  activePlayers: 60,
  peakActivePlayers: 60,
  tribes: [
    { tribeId: 1, name: 'Ironwolves', tag: 'IRON', points: 75 },
    { tribeId: 2, name: 'Others', tag: 'OTH', points: 25 },
  ],
  totalPoints: 100,
  streak: null,
  ...over,
});

describe('settings', () => {
  it('missing, partial or damaged stored settings fall back per key to the defaults', () => {
    assert.deepEqual(mergeDominationSettings(undefined), D);
    assert.deepEqual(mergeDominationSettings({ winShare: 0.6 }), { ...D, winShare: 0.6 });
    assert.deepEqual(mergeDominationSettings({ winShare: 0.1, streakDays: 'x', minActivePlayers: 2.5, minAgeDays: -1 }), D);
    assert.deepEqual(mergeDominationSettings(null), D);
  });

  it('values are range checked', () => {
    assert.equal(checkDominationValue('winShare', 0.5).ok, true);
    assert.equal(checkDominationValue('winShare', 0.49).ok, false);
    assert.equal(checkDominationValue('winShare', 1.01).ok, false);
    assert.equal(checkDominationValue('minPeakShare', 0).ok, true);
    assert.equal(checkDominationValue('minPeakShare', 1.1).ok, false);
    assert.equal(checkDominationValue('minAgeDays', 3650).ok, true);
    assert.equal(checkDominationValue('minAgeDays', 3651).ok, false);
    assert.equal(checkDominationValue('streakDays', 0).ok, true);
    assert.equal(checkDominationValue('minActivePlayers', 0).ok, false);
    assert.equal(checkDominationValue('minActivePlayers', 100_001).ok, false);
    assert.equal(checkDominationValue('minActivePlayers', 2.5).ok, false);
    assert.equal(checkDominationValue('activeDays', Number.NaN).ok, false);
  });

  it('every duration is divided by the world speed', () => {
    assert.equal(dominationMinAgeMs(D, 1), 180 * DAY);
    assert.equal(dominationMinAgeMs(D, 10), 18 * DAY);
    assert.equal(dominationStreakMs(D, 2), 7 * DAY);
    assert.equal(dominationActiveMs(D, 7), DAY);
    assert.equal(dominationEvalIntervalMs(1), 15 * 60_000);
    assert.equal(dominationEvalIntervalMs(10), 90_000);
    assert.deepEqual(dominationRealDays(D, 10), { minAgeDays: 18, streakDays: 1.4, activeDays: 0.7 });
  });
});

describe('thresholds', () => {
  it('the player minimum is at least 30% of the peak (rounded up)', () => {
    assert.equal(minActivePlayersNeeded(D, 200), 60);
    assert.equal(minActivePlayersNeeded(D, 100), 50);
    assert.equal(minActivePlayersNeeded(D, 0), 50);
    assert.equal(minActivePlayersNeeded(D, 201), 61); // 60.3 rounds up
    assert.equal(minActivePlayersNeeded({ ...D, minPeakShare: 0 }, 1000), 50);
  });

  it('exactly the win share qualifies, a hair below does not', () => {
    assert.equal(meetsWinShare(75, 100, 0.75), true);
    assert.equal(meetsWinShare(7499, 10000, 0.75), false);
    assert.equal(meetsWinShare(7500, 10000, 0.75), true);
    assert.equal(meetsWinShare(1, 1, 0.75), true);
    assert.equal(meetsWinShare(0, 0, 0.75), false);
    assert.equal(meetsWinShare(50, 100, 0.5), true);
  });
});

describe('evaluateDomination', () => {
  it('age boundary: one ms before the minimum fails, exactly the minimum holds', () => {
    const min = dominationMinAgeMs(D, 1);
    assert.equal(evaluateDomination(base({ now: min - 1 })).ageOk, false);
    const at = evaluateDomination(base({ now: min }));
    assert.equal(at.ageOk, true);
    assert.equal(at.qualifies, true);
  });

  it('a streak starts at the first qualifying evaluation, is kept for the same tribe and wins at exactly its length', () => {
    const streakMs = dominationStreakMs(D, 1);
    const first = evaluateDomination(base());
    assert.deepEqual(first.streak, { tribeId: 1, startedAt: 200 * DAY });
    assert.equal(first.won, false);
    const later = evaluateDomination(base({ now: 205 * DAY, streak: first.streak }));
    assert.deepEqual(later.streak, { tribeId: 1, startedAt: 200 * DAY });
    const before = evaluateDomination(base({ now: 200 * DAY + streakMs - 1, streak: first.streak }));
    assert.equal(before.won, false);
    const exact = evaluateDomination(base({ now: 200 * DAY + streakMs, streak: first.streak }));
    assert.equal(exact.won, true);
    assert.equal(exact.wonAt, 200 * DAY + streakMs);
    const late = evaluateDomination(base({ now: 250 * DAY, streak: first.streak }));
    assert.equal(late.wonAt, 200 * DAY + streakMs, 'the win time is the exact end of the streak, not the evaluation time');
  });

  it('the streak is cleared when any condition fails or the tribe changes', () => {
    const streak = { tribeId: 1, startedAt: 195 * DAY };
    assert.equal(evaluateDomination(base({ streak, totalPoints: 10_000_000 / 7499 + 100_000 })).streak, null);
    assert.equal(evaluateDomination(base({ streak, activePlayers: 49 })).streak, null, 'active players drop');
    assert.equal(evaluateDomination(base({ streak, now: 100 * DAY })).streak, null, 'age condition (a longer minimum)');
    const switched = evaluateDomination(base({ streak, tribes: [{ tribeId: 2, name: 'Others', tag: 'OTH', points: 80 }, { tribeId: 1, name: 'Ironwolves', tag: 'IRON', points: 20 }] }));
    assert.deepEqual(switched.streak, { tribeId: 2, startedAt: 200 * DAY }, 'a new tribe starts its own streak');
  });

  it('74.99% does not qualify and the reason says so; exactly 75% does', () => {
    const near = evaluateDomination(base({ tribes: [{ tribeId: 1, name: 'Ironwolves', tag: 'IRON', points: 7499 }], totalPoints: 10_000 }));
    assert.equal(near.shareOk, false);
    assert.equal(near.streak, null);
    assert.deepEqual(near.reasons, ['Ironwolves hold 74.9% of village points; 75% is needed.']);
    assert.equal(evaluateDomination(base({ tribes: [{ tribeId: 1, name: 'Ironwolves', tag: 'IRON', points: 7500 }], totalPoints: 10_000 })).shareOk, true);
  });

  it('reasons are plain language', () => {
    const e = evaluateDomination(
      base({ now: 40 * DAY, activePlayers: 31, peakActivePlayers: 31, tribes: [{ tribeId: 1, name: 'Ironwolves', tag: 'IRON', points: 61 }] }),
    );
    assert.deepEqual(e.reasons, [
      'The world is 40 days old; domination counts from day 180.',
      'Only 31 players were active this week; at least 50 are needed.',
      'Ironwolves hold 61% of village points; 75% is needed.',
    ]);
    assert.deepEqual(evaluateDomination(base()).reasons, []);
  });

  it('no points means no leader; the peak only grows', () => {
    const none = evaluateDomination(base({ tribes: [], totalPoints: 0 }));
    assert.equal(none.leader, null);
    assert.equal(none.qualifies, false);
    assert.ok(none.reasons.includes('No player owns a village yet.'));
    assert.equal(evaluateDomination(base({ activePlayers: 10, peakActivePlayers: 200 })).peakActivePlayers, 200);
    assert.equal(evaluateDomination(base({ activePlayers: 300, peakActivePlayers: 200 })).peakActivePlayers, 300);
  });

  it('allies do not add up: only one tribe\'s own points count', () => {
    const e = evaluateDomination(
      base({ tribes: [{ tribeId: 1, name: 'A', tag: 'A', points: 40 }, { tribeId: 2, name: 'B', tag: 'B', points: 40 }, { tribeId: 3, name: 'C', tag: 'C', points: 20 }] }),
    );
    assert.equal(e.leader?.share, 0.4);
    assert.equal(e.qualifies, false);
    assert.equal(e.topTribes.length, 3);
  });

  it('a tie goes to the tribe already on a streak', () => {
    const tribes = [{ tribeId: 1, name: 'A', tag: 'A', points: 50 }, { tribeId: 2, name: 'B', tag: 'B', points: 50 }];
    const s = { settings: { ...D, winShare: 0.5 }, tribes };
    assert.equal(evaluateDomination(base({ ...s })).leader?.tribeId, 1);
    assert.equal(evaluateDomination(base({ ...s, streak: { tribeId: 2, startedAt: 1 } })).leader?.tribeId, 2);
  });

  it('never changes its input', () => {
    const input = deepFreeze(base({ streak: { tribeId: 1, startedAt: 5 } }));
    const copy = structuredClone(input);
    evaluateDomination(input);
    assert.deepEqual(input, copy);
  });
});
