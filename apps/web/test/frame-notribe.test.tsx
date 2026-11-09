// Desktop "no tribe yet" Tribe page and the Domination road: the pure helpers.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DominationStatusDto } from '@clanfire/engine';
import { joinAction, memberFill, WHO_MAY_JOIN } from '../src/views/tribe/frame-notribe-logic.ts';
import { pointsToLine, roadSteps, shareSegments } from '../src/views/ranks/frame-ranks-logic.ts';

const facts = { maxMembers: 30, appliedTo: [3], invitedBy: [7] };
const t = (id: number, members: number, recruitment: 'open' | 'application' | 'invite') => ({ id, members, recruitment });

test('action cell: invitation first, then Full, then recruitment, Applied for an open application', () => {
  assert.equal(joinAction(t(7, 30, 'invite'), facts), 'invited');
  assert.equal(joinAction(t(1, 30, 'open'), facts), 'full');
  assert.equal(joinAction(t(1, 5, 'open'), facts), 'join');
  assert.equal(joinAction(t(2, 5, 'application'), facts), 'apply');
  assert.equal(joinAction(t(3, 5, 'application'), facts), 'applied');
  assert.equal(joinAction(t(4, 5, 'invite'), facts), 'invite-only');
  assert.equal(WHO_MAY_JOIN.open, 'Open to all');
});

test('member bar fill is a clamped percentage', () => {
  assert.equal(memberFill(15, 30), 50);
  assert.equal(memberFill(40, 30), 100);
  assert.equal(memberFill(3, 0), 0);
});

const status = (over: Partial<DominationStatusDto> = {}): DominationStatusDto =>
  ({
    settings: { minAgeDays: 180, winShare: 0.75, streakDays: 14, activeDays: 7, minActivePlayers: 50 },
    now: 0,
    worldAgeDays: 38,
    minAgeDays: 180,
    ageOk: false,
    activePlayers: 451,
    peakActivePlayers: 512,
    minActivePlayers: 154,
    playersOk: true,
    leader: { tribeId: 1, name: 'Ashen Pact', tag: 'ASH', points: 100, share: 0.1 },
    topTribes: [
      { tribeId: 1, name: 'Ashen Pact', tag: 'ASH', points: 100, share: 0.1 },
      { tribeId: 2, name: 'Thornmark', tag: 'THN', points: 60, share: 0.06 },
    ],
    totalPoints: 1000,
    winShare: 0.75,
    qualifies: false,
    streakStartedAt: null,
    streakDays: 0,
    streakDaysNeeded: 14,
    reasons: [],
    ended: null,
    ...over,
  }) as DominationStatusDto;

test('share segments add up to one, biggest first, rest last', () => {
  const segs = shareSegments(status());
  assert.deepEqual(segs.map((s) => s.tag), ['ASH', 'THN', null]);
  assert.ok(Math.abs(segs.reduce((n, s) => n + s.share, 0) - 1) < 1e-9);
  assert.deepEqual(shareSegments(status({ topTribes: [], leader: null, totalPoints: 0 })).map((s) => [s.tag, s.share]), [[null, 1]]);
});

test('points to the line count the leader\'s own gain in the total', () => {
  // (100 + x) / (1000 + x) >= 0.75  ->  x >= 2600
  assert.equal(pointsToLine(status()), 2600);
  assert.equal(pointsToLine(status({ leader: { tribeId: 1, name: 'A', tag: 'A', points: 800, share: 0.8 } })), 0);
  assert.equal(pointsToLine(status({ leader: null })), null);
});

test('the road has five steps with the real numbers', () => {
  const steps = roadSteps(status());
  assert.deepEqual(steps.map((s) => s.key), ['age', 'players', 'share', 'streak', 'end']);
  assert.equal(steps[0]!.title, 'World is 180 days old');
  assert.equal(steps[0]!.value, '38 of 180 days');
  assert.equal(steps[0]!.note, 'about 142 days to go');
  assert.equal(steps[1]!.ok, true);
  assert.equal(steps[1]!.note, '154 needed (a share of the peak, 512)');
  assert.equal(steps[2]!.value, 'ASH 10%');
  assert.equal(steps[2]!.note, 'needs about 2,600 points more');
  assert.equal(steps[3]!.value, 'not started');
  const running = roadSteps(status({ streakStartedAt: 1, streakDays: 3.5, qualifies: true }));
  assert.equal(running[3]!.value, '3.5 of 14 days');
  assert.equal(running[3]!.note, '10.5 days to go');
  const done = roadSteps(status({ ended: { endedAt: 1, kind: 'domination', winner: { tribeId: 1, name: 'Ashen Pact', tag: 'ASH' }, reason: '' } as never }));
  assert.equal(done[4]!.ok, true);
  assert.equal(done[4]!.value, 'Ashen Pact [ASH] won');
});
