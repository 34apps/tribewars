// Desktop Tribe page: summary lines, alert detail, latest forum threads, member ordering and the side-panel pick.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ForumThreadSummaryDto } from '@clanfire/engine';
import { alertDetail, formatHms, diplomacyLine, latestThreads, pickedMember, projectsLine, shortDate, sortMembers, topMember } from '../src/views/tribe/frame-tribe-logic.ts';

test('diplomacy line counts each kind and the proposals waiting', () => {
  assert.equal(diplomacyLine([]), 'no relations yet');
  assert.equal(diplomacyLine([{ kind: 'ally' }, { kind: 'nap' }, { kind: 'enemy' }]), '1 ally · 1 non-aggression · 1 enemy');
  assert.equal(diplomacyLine([{ kind: 'ally' }, { kind: 'ally' }, { kind: 'enemy' }, { kind: 'enemy' }], 1), '2 allies · 2 enemies · 1 proposal waiting');
  assert.equal(diplomacyLine([], 3), '3 proposals waiting');
});

test('projects line: running project, finished levels, or nothing', () => {
  assert.equal(projectsLine({ project: 'watchtower', level: 3 }, '31:12:00', undefined), 'building Watchtower 3 · 31:12:00 left');
  assert.equal(projectsLine(null, '', { roads: 1, watchtower: 2, wards: 0 }), 'nothing running · Roads 1 · Watchtower 2');
  assert.equal(projectsLine(null, '', { roads: 0, watchtower: 0, wards: 0 }), 'nothing built yet');
});

test('top member is the one with most points (ties by name)', () => {
  assert.equal(topMember([]), null);
  assert.equal(topMember([{ username: 'B', points: 5 }, { username: 'A', points: 9 }, { username: 'C', points: 9 }])?.username, 'A');
});

test('alert detail shows only what the Watchtower gives', () => {
  const name = (u: string) => (u === 'logram' ? 'Log Rams' : 'Raiders');
  assert.equal(alertDetail({}, name as never), '');
  assert.equal(alertDetail({ sizeBand: 'medium', slowestUnit: 'logram' }, name as never), 'medium, Log Rams');
  assert.equal(alertDetail({ sizeBand: 'small', sizeAbout: 1200, slowestUnit: 'raider' }, name as never), 'small ~1,200, Raiders');
  assert.equal(alertDetail({ sizeBand: 'large' }, name as never), 'large');
});

const th = (id: number, lastPostAt: number): ForumThreadSummaryDto => ({ id, boardId: 1, title: `t${id}`, authorId: 1, author: 'A', pinned: false, locked: false, createdAt: 0, lastPostAt, postCount: 1, unread: false });

test('latest threads: newest first over boards, no duplicates, capped', () => {
  const list = [th(1, 10), th(2, 50), th(3, 30), th(2, 50), th(4, 40)];
  assert.deepEqual(latestThreads(list, 3).map((t) => t.id), [2, 4, 3]);
  assert.equal(latestThreads(list).length, 4);
});

test('members sort by points then name; the side panel falls back to the first manageable member', () => {
  const m = sortMembers([{ playerId: 1, username: 'B', points: 5 }, { playerId: 2, username: 'A', points: 5 }, { playerId: 3, username: 'C', points: 9 }]);
  assert.deepEqual(m.map((x) => x.playerId), [3, 2, 1]);
  assert.equal(pickedMember(m, 1, () => false)?.playerId, 1);
  assert.equal(pickedMember(m, 99, (x) => x.playerId === 2)?.playerId, 2);
  assert.equal(pickedMember(m, null, () => false)?.playerId, 3);
  assert.equal(pickedMember([], null, () => true), null);
});

test('short date has day and month only', () => {
  assert.match(shortDate(new Date(2026, 9, 3, 12).getTime()), /^3 Oct$/);
});

test('hours-minutes-seconds countdown keeps counting hours past a day', () => {
  assert.equal(formatHms((31 * 3600 + 12 * 60) * 1000), '31:12:00');
  assert.equal(formatHms(0), '0:00:00');
  assert.equal(formatHms(59_001), '0:01:00');
});
