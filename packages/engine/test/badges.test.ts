import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BADGE_COUNT_MAX, parseBadgeSummary, summarizeBadges, worldEndBadges, type BadgePlayerInput, type WorldEndBadgeInput } from '../src/index.ts';

const DAY = 86_400_000;
const END = 100 * DAY;

const player = (playerId: number, over: Partial<BadgePlayerInput> = {}): BadgePlayerInput => ({
  playerId,
  createdAt: END - 30 * DAY,
  lastActive: END - DAY,
  banned: false,
  test: false,
  villages: 0,
  tribeId: null,
  tribeJoinedAt: null,
  ...over,
});
const input = (players: BadgePlayerInput[], over: Partial<WorldEndBadgeInput> = {}): WorldEndBadgeInput => ({
  endedAt: END,
  speed: 1,
  winnerTribeId: null,
  finalTribes: [],
  finalPlayers: [],
  players,
  ...over,
});
const kinds = (list: ReturnType<typeof worldEndBadges>, id: number): string[] => list.filter((b) => b.playerId === id).map((b) => (b.place === null ? b.badge : `${b.badge}#${b.place}`));
const member = (id: number, tribeId: number, over: Partial<BadgePlayerInput> = {}): BadgePlayerInput => player(id, { tribeId, tribeJoinedAt: END - 30 * DAY, villages: 1, ...over });
const TRIBES = [1, 2, 3, 4].map((tribeId, i) => ({ rank: i + 1, tribeId }));

test('joined 14 days before the end: 13.9 days is too new, exactly 14 is enough', () => {
  const list = worldEndBadges(input([player(1, { createdAt: END - 13.9 * DAY, villages: 1 }), player(2, { createdAt: END - 14 * DAY, villages: 1 })]));
  assert.deepEqual(kinds(list, 1), []);
  assert.deepEqual(kinds(list, 2), ['veteran']);
});

test('last active within 7 days of the end: edge inclusive, older or never active gets nothing', () => {
  const list = worldEndBadges(
    input([
      player(1, { lastActive: END - 7 * DAY, villages: 1 }),
      player(2, { lastActive: END - 7 * DAY - 1, villages: 1 }),
      player(3, { lastActive: null, villages: 1 }),
      player(4, { lastActive: END, villages: 1 }),
    ]),
  );
  assert.deepEqual(kinds(list, 1), ['veteran']);
  assert.deepEqual(kinds(list, 2), []);
  assert.deepEqual(kinds(list, 3), []);
  assert.deepEqual(kinds(list, 4), ['veteran']);
});

test('speed 10 divides both limits: 33.6 hours in the world, 16.8 hours since last play', () => {
  const H = DAY / 24;
  const list = worldEndBadges(
    input(
      [
        player(1, { createdAt: END - 33.6 * H, lastActive: END - 16.8 * H, villages: 1 }),
        player(2, { createdAt: END - 33.5 * H, lastActive: END, villages: 1 }),
        player(3, { createdAt: END - 40 * H, lastActive: END - 16.9 * H, villages: 1 }),
      ],
      { speed: 10 },
    ),
  );
  assert.deepEqual(kinds(list, 1), ['veteran']);
  assert.deepEqual(kinds(list, 2), []);
  assert.deepEqual(kinds(list, 3), []);
});

test('banned and test accounts get nothing, even as the best player of the winning tribe', () => {
  const list = worldEndBadges(
    input([member(1, 1, { banned: true }), member(2, 1, { test: true }), member(3, 1)], {
      winnerTribeId: 1,
      finalTribes: TRIBES,
      finalPlayers: [1, 2, 3].map((playerId, i) => ({ rank: i + 1, playerId })),
    }),
  );
  assert.deepEqual(kinds(list, 1), []);
  assert.deepEqual(kinds(list, 2), []);
  assert.deepEqual(kinds(list, 3), ['champion', 'top10#3', 'veteran']);
});

test('no winner (manual end) means no tribe badges at all; top 10 and veteran stay', () => {
  const list = worldEndBadges(input([member(1, 1)], { winnerTribeId: null, finalTribes: TRIBES, finalPlayers: [{ rank: 1, playerId: 1 }] }));
  assert.deepEqual(kinds(list, 1), ['top10#1', 'veteran']);
});

test('tribe badges: winner, then the next two of the ranking; the winner need not be rank 1; 4th gets none', () => {
  const players = [1, 2, 3, 4].map((t) => member(10 + t, t));
  const list = worldEndBadges(input(players, { winnerTribeId: 3, finalTribes: TRIBES }));
  assert.deepEqual(kinds(list, 13), ['champion', 'veteran']);
  assert.deepEqual(kinds(list, 11), ['second_tribe', 'veteran'], 'ranked first, but the winner took the champion place');
  assert.deepEqual(kinds(list, 12), ['third_tribe', 'veteran']);
  assert.deepEqual(kinds(list, 14), ['veteran']);
});

test('tribe badges need 14 days in THAT tribe (scaled by speed); joining late or leaving gives none', () => {
  const list = worldEndBadges(
    input(
      [
        member(1, 1, { tribeJoinedAt: END - 14 * DAY }),
        member(2, 1, { tribeJoinedAt: END - 13.9 * DAY }),
        member(3, 1, { tribeId: null, tribeJoinedAt: null }),
      ],
      { winnerTribeId: 1, finalTribes: TRIBES },
    ),
  );
  assert.deepEqual(kinds(list, 1), ['champion', 'veteran']);
  assert.deepEqual(kinds(list, 2), ['veteran']);
  assert.deepEqual(kinds(list, 3), ['veteran']);
  const fast = worldEndBadges(input([member(1, 1, { tribeJoinedAt: END - 1.5 * DAY, lastActive: END })], { speed: 10, winnerTribeId: 1, finalTribes: TRIBES }));
  assert.deepEqual(kinds(fast, 1), ['champion', 'veteran']);
});

test('top 10: ranks 1-10 only, ties share a rank (all tied at 10 get it, 11 does not), place = final rank', () => {
  const players = Array.from({ length: 12 }, (_, i) => player(i + 1));
  const finalPlayers = [
    ...Array.from({ length: 9 }, (_, i) => ({ rank: i + 1, playerId: i + 1 })),
    { rank: 10, playerId: 10 },
    { rank: 10, playerId: 11 },
    { rank: 12, playerId: 12 },
  ];
  const list = worldEndBadges(input(players, { finalPlayers }));
  assert.deepEqual(kinds(list, 9), ['top10#9']);
  assert.deepEqual(kinds(list, 10), ['top10#10']);
  assert.deepEqual(kinds(list, 11), ['top10#10']);
  assert.deepEqual(kinds(list, 12), []);
});

test('veteran needs a village at the end; badges stack and come out ordered by player then kind', () => {
  const list = worldEndBadges(
    input([member(2, 1), member(1, 2, { villages: 0 })], {
      winnerTribeId: 1,
      finalTribes: [{ rank: 1, tribeId: 1 }, { rank: 2, tribeId: 2 }],
      finalPlayers: [{ rank: 1, playerId: 2 }, { rank: 2, playerId: 1 }],
    }),
  );
  assert.deepEqual(list.map((b) => b.playerId), [1, 1, 2, 2, 2]);
  assert.deepEqual(kinds(list, 1), ['second_tribe', 'top10#2']);
  assert.deepEqual(kinds(list, 2), ['champion', 'top10#1', 'veteran']);
});

test('summarizeBadges: count per kind in fixed order, best top-10 place, count capped', () => {
  assert.deepEqual(summarizeBadges([]), []);
  const s = summarizeBadges([
    { badge: 'veteran', place: null },
    { badge: 'top10', place: 7 },
    { badge: 'champion', place: null },
    { badge: 'top10', place: 3 },
    { badge: 'veteran', place: null },
  ]);
  assert.deepEqual(s, [
    { badge: 'champion', count: 1, bestPlace: null },
    { badge: 'top10', count: 2, bestPlace: 3 },
    { badge: 'veteran', count: 2, bestPlace: null },
  ]);
  const many = summarizeBadges(Array.from({ length: BADGE_COUNT_MAX + 5 }, () => ({ badge: 'veteran' as const, place: null })));
  assert.equal(many[0]?.count, BADGE_COUNT_MAX);
});

test('parseBadgeSummary: accepts what summarize makes; rejects every malformed shape', () => {
  const good = summarizeBadges([{ badge: 'top10', place: 2 }, { badge: 'champion', place: null }]);
  assert.deepEqual(parseBadgeSummary(good), good);
  assert.deepEqual(parseBadgeSummary([]), []);
  const e = (o: object): unknown[] => [{ badge: 'champion', count: 1, bestPlace: null, ...o }];
  const bad: unknown[] = [
    undefined,
    null,
    'x',
    {},
    [null],
    [[]],
    e({ badge: 'king' }),
    e({ badge: 5 }),
    e({ count: 0 }),
    e({ count: 1.5 }),
    e({ count: BADGE_COUNT_MAX + 1 }),
    e({ count: '1' }),
    e({ bestPlace: 1 }),
    e({ bestPlace: undefined }),
    e({ extra: true }),
    [{ badge: 'top10', count: 1, bestPlace: null }],
    [{ badge: 'top10', count: 1, bestPlace: 0 }],
    [{ badge: 'top10', count: 1, bestPlace: 11 }],
    [{ badge: 'top10', count: 1, bestPlace: 2.5 }],
    [...e({}), ...e({})],
    Array.from({ length: 6 }, () => ({ badge: 'veteran', count: 1, bestPlace: null })),
  ];
  for (const v of bad) assert.equal(parseBadgeSummary(v), null, JSON.stringify(v));
});
