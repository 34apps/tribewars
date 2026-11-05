// Pure helpers behind the Domination bar and the world-end screen (src/domination.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DominationStatusDto, WorldEndDto } from '@clanfire/engine';
import {
  FINAL_ROWS,
  WORLD_ENDED_MESSAGE,
  bannerText,
  barWidth,
  conditionRows,
  daysOfText,
  daysText,
  dominationHeadline,
  dominationPhase,
  endKindText,
  finalRows,
  isWorldEndedError,
  leaderLine,
  percentText,
  reasonList,
  streakText,
  topTribeRows,
  winnerLine,
} from '../src/domination.ts';

const tribe = (id: number, tag: string, share: number) => ({ tribeId: id, name: `Tribe ${tag}`, tag, points: Math.round(share * 10000), share });

function status(over: Partial<DominationStatusDto> = {}): DominationStatusDto {
  return {
    settings: { minAgeDays: 180, winShare: 0.75, streakDays: 14, activeDays: 7, minActivePlayers: 50 },
    now: 1_000_000,
    worldAgeDays: 90,
    minAgeDays: 180,
    ageOk: false,
    activePlayers: 30,
    peakActivePlayers: 40,
    minActivePlayers: 50,
    playersOk: false,
    leader: tribe(1, 'EW', 0.4),
    topTribes: [tribe(1, 'EW', 0.4), tribe(2, 'AB', 0.2)],
    totalPoints: 10000,
    winShare: 0.75,
    qualifies: false,
    streakStartedAt: null,
    streakDays: 0,
    streakDaysNeeded: 14,
    reasons: [],
    ended: null,
    ...over,
  };
}

test('percentText rounds to one decimal and never shows a tiny share as 0%', () => {
  assert.equal(percentText(0.7432), '74.3%');
  assert.equal(percentText(0.75), '75%');
  assert.equal(percentText(0), '0%');
  assert.equal(percentText(0.0004), '<0.1%');
  assert.equal(percentText(1), '100%');
  assert.equal(percentText(1.4), '100%');
  assert.equal(percentText(-1), '0%');
  assert.equal(percentText(Number.NaN), '0%');
});

test('barWidth clamps to 0..100', () => {
  assert.equal(barWidth(0.5), 50);
  assert.equal(barWidth(2), 100);
  assert.equal(barWidth(-3), 0);
  assert.equal(barWidth(Number.NaN), 0);
  assert.equal(barWidth(0.12345), 12.3);
});

test('daysText and daysOfText read naturally', () => {
  assert.equal(daysText(1), '1 day');
  assert.equal(daysText(14), '14 days');
  assert.equal(daysText(3.46), '3.5 days');
  assert.equal(daysText(0), '0 days');
  assert.equal(daysText(-2), '0 days');
  assert.equal(daysOfText(3.5, 14), '3.5 of 14 days');
  assert.equal(daysOfText(1, 1), '1 of 1 day');
});

test('leaderLine names the leader and its share, or says nobody owns a village', () => {
  assert.equal(leaderLine(status()), 'Tribe EW [EW] holds 40% of all village points');
  assert.equal(leaderLine(status({ leader: null })), 'No tribe owns a village yet.');
});

test('streakText says when no streak runs', () => {
  assert.equal(streakText(status()), 'No streak running (14 days needed)');
  assert.equal(streakText(status({ streakStartedAt: 5, streakDays: 3.5 })), '3.5 of 14 days');
});

test('conditionRows give x of y lines, fractions and which conditions hold', () => {
  const rows = conditionRows(status());
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.share!.value, '40% of 75% needed');
  assert.equal(by.share!.ok, false);
  assert.ok(Math.abs(by.share!.fraction - 0.4 / 0.75) < 1e-9);
  assert.equal(by.age!.value, '90 of 180 days');
  assert.equal(by.age!.fraction, 0.5);
  assert.equal(by.players!.value, '30 of 50 needed');
  assert.equal(by.players!.fraction, 0.6);
  assert.equal(by.streak!.fraction, 0);

  const ok = conditionRows(status({ leader: tribe(1, 'EW', 0.8), ageOk: true, worldAgeDays: 200, playersOk: true, activePlayers: 70, qualifies: true, streakStartedAt: 1, streakDays: 14 }));
  assert.ok(ok.every((r) => r.ok));
  assert.ok(ok.every((r) => r.fraction === 1));
});

test('conditionRows survive a zero minimum', () => {
  const rows = conditionRows(status({ minAgeDays: 0, minActivePlayers: 0, winShare: 0 }));
  assert.ok(rows.every((r) => Number.isFinite(r.fraction)));
});

test('dominationPhase and headline follow the streak', () => {
  assert.equal(dominationPhase(status()), 'quiet');
  assert.equal(dominationHeadline(status()), 'No tribe dominates the world');
  const close = status({ leader: tribe(1, 'EW', 0.62) });
  assert.equal(dominationPhase(close), 'close');
  assert.match(dominationHeadline(close), /closing in/);
  const counting = status({ leader: tribe(1, 'EW', 0.8), qualifies: true, streakStartedAt: 1, streakDays: 4 });
  assert.equal(dominationPhase(counting), 'counting');
  assert.equal(dominationHeadline(counting), '[EW] is winning: 10 days to go');
  const end: WorldEndDto = { endedAt: 5, kind: 'domination', winner: { tribeId: 1, name: 'Ember Wolves', tag: 'EW' }, reason: 'x', finalTribes: [], finalPlayers: [] };
  assert.equal(dominationPhase(status({ ended: end })), 'ended');
  assert.equal(dominationHeadline(status({ ended: end })), 'Ember Wolves [EW] won the world');
});

test('reasonList trims and de-duplicates the server reasons, and falls back to the conditions', () => {
  assert.deepEqual(reasonList(status({ reasons: ['  The world is too young. ', 'The world is too young.', '', 'Too few players.'] })), ['The world is too young.', 'Too few players.']);
  const fallback = reasonList(status({ reasons: [] }));
  assert.equal(fallback.length, 3);
  assert.match(fallback[0]!, /only 90 days old/);
  assert.deepEqual(reasonList(status({ reasons: [], qualifies: true })), []);
});

test('topTribeRows sorts, limits and scales the bar to the win share', () => {
  const s = status({ topTribes: [tribe(2, 'AB', 0.2), tribe(1, 'EW', 0.6), tribe(3, 'CD', 0.1)] });
  const rows = topTribeRows(s, 2);
  assert.deepEqual(rows.map((r) => r.tag), ['EW', 'AB']);
  assert.equal(rows[0]!.width, 80);
  assert.equal(rows[0]!.text, '60%');
});

test('isWorldEndedError only matches the 403 world-ended refusal', () => {
  assert.equal(isWorldEndedError(403, WORLD_ENDED_MESSAGE), true);
  assert.equal(isWorldEndedError(403, 'This world has ended. '), true);
  assert.equal(isWorldEndedError(403, 'You cannot attack that player.'), false);
  assert.equal(isWorldEndedError(400, WORLD_ENDED_MESSAGE), false);
});

test('winnerLine, bannerText and endKindText', () => {
  const w = { tribeId: 1, name: 'Ember Wolves', tag: 'EW' };
  assert.equal(winnerLine({ winner: w }), 'Ember Wolves [EW] won the world');
  assert.equal(winnerLine({ winner: null }), 'The world has ended');
  assert.equal(bannerText({ winner: w, reason: 'Held 75% for 14 days.' }), 'Ember Wolves [EW] won the world. Held 75% for 14 days.');
  assert.equal(bannerText({ winner: null, reason: '' }), 'The world has ended.');
  assert.equal(endKindText('domination'), 'Won by domination');
  assert.equal(endKindText('manual'), 'Ended by the operators');
});

test('finalRows orders by rank and keeps the top rows only', () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({ rank: 80 - i }));
  const top = finalRows(rows);
  assert.equal(top.length, FINAL_ROWS);
  assert.equal(top[0]!.rank, 1);
  assert.equal(top[FINAL_ROWS - 1]!.rank, FINAL_ROWS);
  assert.equal(finalRows(rows, 3).length, 3);
});
