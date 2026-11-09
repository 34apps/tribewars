// Desktop Ranks page: list building (sample mix, ties), search, paging.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlayerRankDto, PlayerRankingResponse, RenownRankingResponse, TribeSummaryDto } from '@clanfire/engine';
import { averagePoints, pageItems, pageOfIndex, playerRows, renownRows, rerank, searchPlayers, searchTribes, tribeRows } from '../src/views/ranks/frame-ranks-logic.ts';

const p = (playerId: number, username: string, points: number, tag: string | null = null): PlayerRankDto => ({ rank: 0, playerId, username, tribe: tag ? { id: 1, tag } : null, villages: 1, points, villageX: 0, villageY: 0 });

test('rerank sorts by points and ties share a rank', () => {
  assert.deepEqual(rerank([p(1, 'a', 5), p(2, 'b', 9), p(3, 'c', 5), p(4, 'd', 1)] as never[]).map((r) => [r.playerId, r.rank]), [[2, 1], [1, 2], [3, 2], [4, 4]]);
});

test('player rows add my own row when it is outside the list, and mix sample rows in', () => {
  const real: PlayerRankingResponse = { players: [{ ...p(1, 'a', 9), rank: 1 }], me: { ...p(7, 'me', 2), rank: 40 }, total: 40 };
  assert.deepEqual(playerRows(real, null).map((r) => r.playerId), [1, 7]);
  assert.deepEqual(playerRows({ ...real, me: real.players[0]! }, null).map((r) => r.playerId), [1]);
  assert.deepEqual(playerRows(real, [p(-1, 's', 5)]).map((r) => [r.playerId, r.rank]), [[1, 1], [-1, 2], [7, 3]]);
});

test('tribe rows rerank only with sample rows', () => {
  const t = (id: number, points: number): TribeSummaryDto => ({ id, name: `T${id}`, tag: `T${id}`, members: 1, points, villages: 1, recruitment: 'open', rank: id });
  assert.deepEqual(tribeRows([t(1, 5)], null).map((r) => r.id), [1]);
  assert.deepEqual(tribeRows([t(1, 5)], [t(-1, 8)]).map((r) => [r.id, r.rank]), [[-1, 1], [1, 2]]);
});

test('renown rows: sample renown comes from points and ranks by renown', () => {
  const data: RenownRankingResponse = { players: [{ ...p(1, 'a', 0), rank: 1, renown: 100 }], me: null, total: 1 };
  const rows = renownRows(data, [p(-1, 's', 100)]);
  assert.deepEqual(rows.map((r) => [r.playerId, r.renown, r.rank]), [[-1, 140, 1], [1, 100, 2]]);
});

test('search matches names and tribe tags, ignoring case and spaces around', () => {
  const rows = [p(1, 'Brannoch', 1, 'ASH'), p(2, 'Tolvek', 1, 'CND'), p(3, 'Lorcan', 1)];
  assert.equal(searchPlayers(rows, '').length, 3);
  assert.deepEqual(searchPlayers(rows, ' ash ').map((r) => r.playerId), [1]);
  assert.deepEqual(searchPlayers(rows, 'LOR').map((r) => r.playerId), [3]);
  const t = { id: 1, name: 'Ashen Pact', tag: 'ASH' } as TribeSummaryDto;
  assert.equal(searchTribes([t], 'pact').length, 1);
  assert.equal(searchTribes([t], 'zzz').length, 0);
});

test('jump page and page buttons', () => {
  assert.equal(pageOfIndex(-1), -1);
  assert.equal(pageOfIndex(19), 0);
  assert.equal(pageOfIndex(213), 10);
  assert.deepEqual(pageItems(0, 25), [0, 1, 'gap', 24]);
  assert.deepEqual(pageItems(10, 25), [0, 'gap', 9, 10, 11, 'gap', 24]);
  assert.deepEqual(pageItems(0, 1), [0]);
  assert.equal(averagePoints([{ points: 10 }, { points: 15 }]), 13);
  assert.equal(averagePoints([]), 0);
});
