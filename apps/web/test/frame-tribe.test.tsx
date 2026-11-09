// Desktop Tribe page: summary lines, alert detail, latest forum threads, member ordering and the side-panel pick.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ForumThreadSummaryDto } from '@clanfire/engine';
import { alertDetail, atEnd, chatClock, formatHms, diplomacyLine, landsAt, latestThreads, logTime, pickedMember, projectsLine, relationSection, shortDate, sortMembers, sortRelations, threadPaging, topMember, watchtowerSteps } from '../src/views/tribe/frame-tribe-logic.ts';

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

test('relations are grouped allies, non-aggression, enemies with a heading where a group starts', () => {
  const list = sortRelations([{ kind: 'enemy' }, { kind: 'ally' }, { kind: 'nap' }, { kind: 'ally' }] as const as never[]) as Array<{ kind: 'ally' | 'nap' | 'enemy' }>;
  assert.deepEqual(list.map((r) => r.kind), ['ally', 'ally', 'nap', 'enemy']);
  assert.deepEqual(list.map((_, i) => relationSection(list, i)), ['Allies', null, 'Non-aggression', 'Enemies']);
  assert.equal(relationSection(list, 9), null);
});

test('watchtower steps light up to the built level', () => {
  assert.deepEqual(watchtowerSteps(0).map((s) => s.on), [false, false, false]);
  assert.deepEqual(watchtowerSteps(2).map((s) => s.on), [true, true, false]);
  assert.equal(watchtowerSteps(3).length, 3);
});

test('log, chat and landing times use the 24-hour clock', () => {
  const now = new Date(2026, 10, 9, 15, 30).getTime();
  assert.equal(logTime(new Date(2026, 10, 9, 9, 5).getTime(), now), 'Today 09:05');
  assert.equal(logTime(new Date(2026, 10, 8, 22, 10).getTime(), now), 'Yesterday 22:10');
  assert.match(logTime(new Date(2026, 10, 7, 20, 15).getTime(), now), /^7 Nov 20:15$/);
  assert.equal(chatClock(new Date(2026, 10, 9, 14, 2).getTime(), now), '14:02');
  assert.match(chatClock(new Date(2026, 10, 5, 14, 2).getTime(), now), /^5 Nov 14:02$/);
  assert.equal(landsAt(new Date(2026, 10, 9, 15, 23).getTime(), now), '15:23');
  assert.match(landsAt(new Date(2026, 10, 10, 1, 5).getTime(), now), /^\w{3} 01:05$/);
});

test('thread paging: client pages over the loaded threads, a server fetch only at the end', () => {
  assert.deepEqual(threadPaging(0, 0, false), { page: 0, from: 0, to: 0, hasNext: false, needsFetch: false });
  assert.deepEqual(threadPaging(14, 0, false), { page: 0, from: 1, to: 6, hasNext: true, needsFetch: false });
  assert.deepEqual(threadPaging(14, 2, false), { page: 2, from: 13, to: 14, hasNext: false, needsFetch: false });
  assert.deepEqual(threadPaging(30, 4, true), { page: 4, from: 25, to: 30, hasNext: true, needsFetch: true });
  assert.equal(threadPaging(10, 9, false).page, 1);
});

test('a scroll list counts as at the end within the slack', () => {
  assert.equal(atEnd({ scrollHeight: 1000, scrollTop: 560, clientHeight: 400 }), true);
  assert.equal(atEnd({ scrollHeight: 1000, scrollTop: 400, clientHeight: 400 }), false);
});
