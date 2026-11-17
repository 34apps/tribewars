// Queries whose cost must not grow with the world: the ranking cache and the indexes behind the map's
// strike-chain lookup and the village search (SQL plans are read back from the statements the store really runs).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RANKINGS_CACHE_MS, type PlayerRankingResponse, type RenownRankingResponse } from '@clanfire/engine';
import type { Store } from '../src/store.ts';
import { makeApp } from './helpers.ts';
import { newPlayer, setBuilding } from './tribe-helpers.ts';

/** Run `fn`, then the EXPLAIN QUERY PLAN of every SELECT the store ran during it (all plan lines in one string). */
function plansOf(store: Store, fn: () => void): string {
  const seen: Array<{ sql: string; params: Array<string | number | null> }> = [];
  const target = store as unknown as { all: (sql: string, ...params: Array<string | number | null>) => unknown };
  const orig = target.all;
  target.all = function (this: unknown, sql, ...params) {
    seen.push({ sql, params });
    return orig.call(store, sql, ...params);
  };
  try {
    fn();
  } finally {
    target.all = orig;
  }
  assert.ok(seen.length > 0, 'the store ran a query');
  return seen
    .map(({ sql, params }) =>
      store.db
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...params)
        .map((r) => String((r as { detail: string }).detail))
        .join(' | '),
    )
    .join(' || ');
}

test('ranking cache: a second call inside 15 s is served from the cache, after 15 s it is rebuilt', async () => {
  const { app, clock } = await makeApp({ rankingsCacheMs: RANKINGS_CACHE_MS });
  const a = await newPlayer(app, 'alpha');
  await newPlayer(app, 'bravo');
  const store = app.ctx.store;
  let builds = 0;
  const origPlayers = store.playerRanking.bind(store);
  const origRenown = store.renownRanking.bind(store);
  store.playerRanking = () => (builds++, origPlayers());
  store.renownRanking = () => (builds++, origRenown());

  assert.equal((await a.c.get('/api/rankings/players')).json<PlayerRankingResponse>().total, 2);
  assert.equal((await a.c.get('/api/rankings/renown')).json<RenownRankingResponse>().total, 2);
  assert.equal(builds, 2, 'one build per kind');

  // A change inside the window is not seen yet; nothing is rebuilt.
  setBuilding(app, a.id, 'hall', 5);
  clock.advance(RANKINGS_CACHE_MS - 1);
  const cached = (await a.c.get('/api/rankings/players')).json<PlayerRankingResponse>();
  await a.c.get('/api/rankings/renown');
  assert.equal(builds, 2);
  const before = cached.me?.points ?? 0;

  clock.advance(1);
  const fresh = (await a.c.get('/api/rankings/players')).json<PlayerRankingResponse>();
  assert.equal(builds, 3);
  assert.ok((fresh.me?.points ?? 0) > before, 'the new Town Hall level shows after the cache expired');
  assert.equal(fresh.me?.rank, 1);
  await app.close();
});

test('ranking cache: the list is shared but every player sees their own row; the default is on, tests can turn it off', async () => {
  const { app } = await makeApp({ rankingsCacheMs: RANKINGS_CACHE_MS });
  const a = await newPlayer(app, 'alpha');
  const b = await newPlayer(app, 'bravo');
  const c = await newPlayer(app, 'charlie');
  setBuilding(app, c.id, 'hall', 5);
  const ra = (await a.c.get('/api/rankings/players')).json<PlayerRankingResponse>();
  const rb = (await b.c.get('/api/rankings/players')).json<PlayerRankingResponse>();
  const rc = (await c.c.get('/api/rankings/players')).json<PlayerRankingResponse>();
  assert.deepEqual([ra.me?.username, rb.me?.username, rc.me?.username], ['alpha', 'bravo', 'charlie']);
  assert.equal(rc.me?.rank, 1);
  assert.deepEqual(ra.players, rb.players);
  // Renown too.
  const na = (await a.c.get('/api/rankings/renown')).json<RenownRankingResponse>();
  const nb = (await b.c.get('/api/rankings/renown')).json<RenownRankingResponse>();
  assert.equal(na.me?.username, 'alpha');
  assert.equal(nb.me?.username, 'bravo');
  await app.close();

  assert.equal(RANKINGS_CACHE_MS, 15_000);
  const off = await makeApp();
  assert.equal(off.app.ctx.rankingsCacheMs, 0, 'makeApp turns the cache off');
  await off.app.close();
  const dflt = await makeApp({ rankingsCacheMs: undefined });
  assert.equal(dflt.app.ctx.rankingsCacheMs, undefined, 'unset means the default (RANKINGS_CACHE_MS)');
  await dflt.app.close();
});

test('strikeChainsOfPlayer uses the player index', async () => {
  const { app } = await makeApp();
  const store = app.ctx.store;
  const plan = plansOf(store, () => store.strikeChainsOfPlayer(5));
  assert.match(plan, /idx_strike_chain_player/);
  assert.doesNotMatch(plan, /SCAN c\b/);
  await app.close();
});

test('village search finds its ids in narrow indexes, not in the village rows', async () => {
  const { app } = await makeApp();
  await newPlayer(app, 'alpha');
  const store = app.ctx.store;
  const byVillage = plansOf(store, () => store.searchVillages('village', 'ab', null, 10));
  assert.match(byVillage.split(' || ')[0]!, /idx_villages_search/);
  assert.match(byVillage.split(' || ')[0]!, /COVERING INDEX/);
  const near = plansOf(store, () => store.searchVillages('village', 'ab', { x: 0, y: 0 }, 10));
  assert.match(near.split(' || ')[0]!, /COVERING INDEX idx_villages_search/);
  const byPlayer = plansOf(store, () => store.searchVillages('player', 'al', null, 10));
  assert.match(byPlayer.split(' || ')[0]!, /SCAN p/);
  assert.match(byPlayer.split(' || ')[0]!, /idx_villages_owner/);
  // The full rows are fetched by id, for the winners only.
  assert.equal(store.searchVillages('village', 'zzzz-no-such', null, 10).length, 0);
  await app.close();
});
