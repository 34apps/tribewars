// Premium whole-world overview (GET /api/map/overview): premium bit checked on the server, 401 signed out, compact rows, the same villages and
// relations as GET /api/map, nothing but x / y / code, the 60 s cache, and no query keys.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXTRA_RAID_LISTS, EXTRA_WIDE_OVERVIEW, MAP_OVERVIEW_CACHE_MS, type MapOverviewResponse, type MapResponse } from '@clanfire/engine';
import { Client, errorOf, makeApp, ok } from './helpers.ts';
import { found, formPact, newPlayer, setHall } from './tribe-helpers.ts';

const CODE = { abandoned: 0, own: 1, tribe: 2, ally: 3, nap: 4, enemy: 5, neutral: 6 } as const;

async function setup() {
  const { app, clock } = await makeApp();
  const alice = await newPlayer(app, 'alice');
  const bob = await newPlayer(app, 'bob');
  const cara = await newPlayer(app, 'cara');
  setHall(app, alice.id, 3);
  setHall(app, bob.id, 3);
  await found(alice, 'Alpha Pack', 'ALPHA', 'invite');
  await found(bob, 'Bravo Clan', 'BRAVO', 'invite');
  await formPact(alice, 'BRAVO', bob, 'ally');
  app.ctx.store.setPremiumBit(alice.id, EXTRA_WIDE_OVERVIEW, true);
  return { app, clock, alice, bob, cara };
}

const overview = (c: Client) => c.get('/api/map/overview');

test('premium gets rows; same villages and relations as the map; rows are only [x, y, code]', async () => {
  const { alice } = await setup();
  const res = await overview(alice.c);
  ok(res);
  const body = res.json<MapOverviewResponse>();
  const map = (await alice.c.get('/api/map?x=-12&y=-12&w=25&h=25')).json<MapResponse>().villages;
  assert.equal(body.villages.length, map.length);
  assert.ok(Object.keys(body).sort().join() === 'serverTime,villages');
  const byTile = new Map(body.villages.map((r) => [`${r[0]},${r[1]}`, r]));
  const seen = new Set<number>();
  for (const v of map) {
    const row = byTile.get(`${v.x},${v.y}`);
    assert.ok(row, 'village present');
    assert.equal(row.length, 3);
    const want = v.kind === 'abandoned' ? CODE.abandoned : v.kind === 'own' ? CODE.own : (CODE[(v.relation ?? 'neutral') as keyof typeof CODE] ?? CODE.neutral);
    assert.equal(row[2], want, `${v.name} code`);
    seen.add(want);
  }
  assert.ok(seen.has(CODE.own) && seen.has(CODE.ally) && seen.has(CODE.neutral) && seen.has(CODE.abandoned), `codes seen ${[...seen]}`);
});

test('a player without the extra gets 403, signed out gets 401, another extra bit is not enough', async () => {
  const { app, bob, cara } = await setup();
  assert.equal((await overview(bob.c)).statusCode, 403);
  errorOf(await overview(cara.c), 403, 'forbidden');
  app.ctx.store.setPremiumBit(cara.id, EXTRA_RAID_LISTS, true);
  assert.equal((await overview(cara.c)).statusCode, 403);
  assert.equal((await new Client(app, '10.8.8.8').get('/api/map/overview')).statusCode, 401);
  // The entitlement is read live from the database: taking it away closes the door at once.
  app.ctx.store.setPremiumBit(cara.id, EXTRA_WIDE_OVERVIEW, true);
  assert.equal((await overview(cara.c)).statusCode, 200);
  app.ctx.store.setPremiumBit(cara.id, EXTRA_WIDE_OVERVIEW, false);
  assert.equal((await overview(cara.c)).statusCode, 403);
});

test('the base rows are cached for about 60 s per world; the relation is still per viewer', async () => {
  const { app, clock, alice } = await setup();
  const before = (await overview(alice.c)).json<MapOverviewResponse>().villages.length;
  await newPlayer(app, 'dave'); // a new village appears
  clock.advance(MAP_OVERVIEW_CACHE_MS - 5_000);
  assert.equal((await overview(alice.c)).json<MapOverviewResponse>().villages.length, before, 'still the cached rows');
  clock.advance(10_000);
  assert.equal((await overview(alice.c)).json<MapOverviewResponse>().villages.length, before + 1, 'refreshed after the cache time');
  // A second premium viewer reuses the cache but sees his own relations.
  const { bob } = { bob: await newPlayer(app, 'erin') };
  app.ctx.store.setPremiumBit(bob.id, EXTRA_WIDE_OVERVIEW, true);
  clock.advance(MAP_OVERVIEW_CACHE_MS);
  const mine = (await overview(bob.c)).json<MapOverviewResponse>().villages;
  assert.equal(mine.filter((r) => r[2] === CODE.own).length, 1);
  assert.equal(mine.filter((r) => r[2] === CODE.ally).length, 0);
});

test('no query keys are accepted, and the route is rate limited like other world reads', async () => {
  const { alice } = await setup();
  assert.equal((await alice.c.get('/api/map/overview?x=1')).statusCode, 400);
});
