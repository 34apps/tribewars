import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlayerProfileDto, PlayerRankingResponse } from '@clanfire/engine';
import { makeApp, ok } from './helpers.ts';
import { newPlayer, setBuilding } from './tribe-helpers.ts';

test('player profile: signed in only, public data, bad ids refused, tribe villages counted', async () => {
  const { app } = await makeApp();
  const a = await newPlayer(app, 'alpha');
  const b = await newPlayer(app, 'bravo');
  const anon = await app.inject({ method: 'GET', url: `/api/players/${a.id}`, headers: { host: 'clanfire.test' } });
  assert.equal(anon.statusCode, 401);

  setBuilding(app, b.id, 'hall', 5);
  const res = await a.c.get(`/api/players/${b.id}`);
  ok(res);
  const p = res.json<PlayerProfileDto>();
  assert.equal(p.username, 'bravo');
  assert.equal(p.rank, 1);
  assert.equal(p.villageCount, 1);
  assert.equal(p.villages.length, 1);
  assert.equal(p.tribe, null);
  assert.equal(typeof p.protectedNow, 'boolean');
  assert.equal(JSON.stringify(p).includes('password'), false);

  assert.equal((await a.c.get('/api/players/999999')).statusCode, 404);
  assert.equal((await a.c.get('/api/players/abc')).statusCode, 400);
  assert.equal((await a.c.get('/api/players/-1')).statusCode, 400);
});

test('player ranking: needs sign-in, orders by points, ties share a rank, caller outside top 100 still gets a row', async () => {
  const { app } = await makeApp();
  const a = await newPlayer(app, 'alpha');
  const b = await newPlayer(app, 'bravo');
  const c = await newPlayer(app, 'charlie');
  const anon = await app.inject({ method: 'GET', url: '/api/rankings/players', headers: { host: 'clanfire.test' } });
  assert.equal(anon.statusCode, 401);

  // alpha and bravo have identical new villages (a tie); charlie gets a bigger Town Hall.
  setBuilding(app, c.id, 'hall', 5);
  let res = await a.c.get('/api/rankings/players');
  ok(res);
  let r = res.json<PlayerRankingResponse>();
  assert.deepEqual(r.players.map((p) => p.username), ['charlie', 'alpha', 'bravo']);
  assert.deepEqual(r.players.map((p) => p.rank), [1, 2, 2]);
  assert.equal(r.total, 3);
  assert.equal(r.me?.username, 'alpha');
  assert.equal(r.me?.villages, 1);
  assert.ok(Number.isInteger(r.me?.villageX) && Number.isInteger(r.me?.villageY));
  assert.equal(r.players[0]?.tribe, null);

  // 105 stronger players: bravo falls out of the top 100 but still sees their own rank.
  const store = app.ctx.store;
  const state = store.villagesOfPlayer(c.id)[0]!.state;
  for (let i = 0; i < 105; i += 1) {
    const pid = store.insertPlayer(`filler${i}`, 'x', 0, 0);
    store.insertVillage(pid, `v${i}`, 500 + i, 500, 1000 + i, state);
  }
  res = await b.c.get('/api/rankings/players');
  ok(res);
  r = res.json<PlayerRankingResponse>();
  assert.equal(r.players.length, 100);
  assert.equal(r.total, 108);
  assert.equal(r.players[0]?.points, 1104);
  assert.ok(r.me && !r.players.some((p) => p.playerId === b.id));
  assert.equal(r.me.rank, 107);
});
