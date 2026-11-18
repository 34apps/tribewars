// Feast (docs/GAME_DESIGN.md section 18.2): POST /api/villages/:id/feast turns resources into Renown.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEAST_COST, FEAST_MAX_COUNT, FEAST_RENOWN, feastPrice, type FeastResponse, type GameStateResponse } from '@clanfire/engine';
import { HOST, errorOf, makeApp, ok } from './helpers.ts';
import { newPlayer } from './tribe-helpers.ts';
import { renownOf, setVillage } from './renown-helpers.ts';

const RICH = { wood: 50_000, food: 50_000, iron: 50_000, gold: 1_000 };

/** A player whose village has a Banner Hall of `bannerhall` and room (and stock) for many Feasts. */
async function feaster(bannerhall = 1) {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  setVillage(app, p.id, { levels: { bannerhall, storehouse: 20 }, resources: RICH });
  const vid = (await p.c.village()).id;
  const feast = (count: unknown, who = p) => who.c.post(`/api/villages/${vid}/feast`, { count });
  return { app, clock, p, vid, feast };
}

test('a Feast costs the Banner Hall level price, pays FEAST_RENOWN each, and shows in the answer and in the state', async () => {
  const { app, p, feast } = await feaster();
  const before = (await p.c.village()).state.resources;
  const res = await feast(2);
  ok(res);
  const body = res.json<FeastResponse>();
  assert.equal(body.gained, 2 * FEAST_RENOWN);
  assert.equal(body.renown.total, 2 * FEAST_RENOWN);
  assert.equal(body.renown.balance, 2 * FEAST_RENOWN);
  assert.equal(body.renown.spent, 0);
  assert.equal(body.renown.villages, 1);
  assert.equal(body.village.state.resources.wood, before.wood - 2 * FEAST_COST.wood);
  assert.equal(body.village.state.resources.food, before.food - 2 * FEAST_COST.food);
  assert.equal(body.village.state.resources.iron, before.iron - 2 * FEAST_COST.iron);
  assert.equal(body.village.state.resources.gold, before.gold - 2 * FEAST_COST.gold);
  assert.equal('feastAllowance' in body.village, false, 'the daily allowance is gone');

  const st = await p.c.state();
  assert.equal(st.renown.total, 2 * FEAST_RENOWN);
  assert.equal(st.villages[0]?.state.feast, undefined);
  assert.equal(renownOf(app, p), 2 * FEAST_RENOWN);
  await app.close();
});

test('the state of a fresh player: Renown 0, price of the next village, no Feast without a Banner Hall', async () => {
  const { app } = await makeApp();
  const p = await newPlayer(app, 'bob');
  const st = await p.c.get('/api/state');
  ok(st);
  const body = st.json<GameStateResponse>();
  assert.equal(body.renown.total, 0);
  assert.equal(body.renown.balance, 0);
  assert.equal(body.renown.villages, 1);
  assert.ok(body.renown.nextVillageCost > 0);
  assert.equal(body.villages[0] !== undefined && 'feastAllowance' in body.villages[0], false);
  assert.equal('premium' in body.player, false, 'the premium flag is gone');
  await app.close();
});

test('Banner Hall level 1 is required: 409 requirements_not_met, nothing is paid', async () => {
  const { app, p, vid } = await feaster(0);
  const before = (await p.c.village()).state.resources;
  errorOf(await p.c.post(`/api/villages/${vid}/feast`, { count: 1 }), 409, 'requirements_not_met');
  assert.deepEqual((await p.c.village()).state.resources, before);
  assert.equal(renownOf(app, p), 0);
  await app.close();
});

test('not enough resources: 409 not_enough_resources, nothing is paid', async () => {
  const { app, p, feast } = await feaster();
  setVillage(app, p.id, { resources: { wood: FEAST_COST.wood - 1, food: 50_000, iron: 50_000, gold: 1_000 } });
  errorOf(await feast(1), 409, 'not_enough_resources');
  assert.equal(renownOf(app, p), 0);
  assert.equal((await p.c.village()).state.feast, undefined);
  await app.close();
});

test('no daily limit: many Feasts in one request, and again right after; the level makes them cheaper', async () => {
  for (const level of [1, 4]) {
    const { app, p, feast } = await feaster(level);
    const price = feastPrice(level);
    const before = (await p.c.village()).state.resources;
    const res = await feast(15);
    ok(res);
    const body = res.json<FeastResponse>();
    assert.equal(body.gained, 15 * FEAST_RENOWN);
    assert.equal(body.village.state.resources.food, before.food - 15 * price.food);
    ok(await feast(1)); // no window, no counter
    ok(await feast(3));
    assert.equal(renownOf(app, p), 19 * FEAST_RENOWN);
    await app.close();
  }
});

test('all or nothing: a count the village cannot pay is refused whole, even one Feast too many', async () => {
  const { app, p, feast } = await feaster(2);
  const price = feastPrice(2);
  setVillage(app, p.id, { resources: { wood: 50_000, food: price.food * 7 + 5, iron: 50_000, gold: 0 } });
  errorOf(await feast(8), 409, 'not_enough_resources');
  assert.equal(renownOf(app, p), 0);
  assert.equal((await p.c.village()).state.resources.food, price.food * 7 + 5);
  ok(await feast(7));
  assert.equal(renownOf(app, p), 7 * FEAST_RENOWN);
  await app.close();
});

test('the biggest allowed count works; one more is a 400', async () => {
  const { app, p, feast } = await feaster(4);
  const price = feastPrice(4);
  setVillage(app, p.id, { resources: { wood: price.wood * FEAST_MAX_COUNT, food: price.food * FEAST_MAX_COUNT, iron: price.iron * FEAST_MAX_COUNT, gold: 0 } });
  ok(await feast(FEAST_MAX_COUNT));
  assert.equal(renownOf(app, p), FEAST_MAX_COUNT * FEAST_RENOWN);
  errorOf(await feast(FEAST_MAX_COUNT + 1), 400, 'invalid_input');
  await app.close();
});

test('rate limit: 30 Feast requests a minute per account, then 429', async () => {
  const { app, p, feast } = await feaster(1);
  setVillage(app, p.id, { resources: { wood: 1_000_000, food: 1_000_000, iron: 1_000_000, gold: 0 } });
  for (let i = 0; i < 30; i++) ok(await feast(1));
  errorOf(await feast(1), 429, 'rate_limited');
  await app.close();
});

test('input: count must be a whole number from 1 to FEAST_MAX_COUNT, nothing else is accepted', async () => {
  const { app, p, feast, vid } = await feaster(4);
  for (const bad of [0, -1, 1.5, '2', null, FEAST_MAX_COUNT + 1, 1e9]) errorOf(await feast(bad), 400, 'invalid_input');
  errorOf(await p.c.post(`/api/villages/${vid}/feast`, {}), 400, 'invalid_input');
  errorOf(await p.c.post(`/api/villages/${vid}/feast`, { count: 1, renown: 99999 }), 400, 'invalid_input');
  errorOf(await p.c.post('/api/villages/abc/feast', { count: 1 }), 400, 'invalid_input');
  assert.equal(renownOf(app, p), 0);
  await app.close();
});

test('owner only: a stranger gets 403, an unknown village 404, nobody signed in 401; the owner is unharmed', async () => {
  const { app, p, vid, feast } = await feaster();
  const mallory = await newPlayer(app, 'mallory');
  errorOf(await feast(1, mallory), 403, 'forbidden');
  errorOf(await mallory.c.post('/api/villages/999999/feast', { count: 1 }), 404, 'not_found');
  const anon = await app.inject({ method: 'POST', url: `/api/villages/${vid}/feast`, headers: { host: HOST, origin: `http://${HOST}`, 'content-type': 'application/json' }, payload: '{"count":1}' });
  errorOf(anon, 401, 'unauthorized');
  assert.equal(renownOf(app, p), 0);
  assert.equal(renownOf(app, mallory), 0);
  await app.close();
});

test('a time of the client is never used: a request carrying a time is refused', async () => {
  const { app, p, vid } = await feaster();
  const res = await p.c.post(`/api/villages/${vid}/feast`, { count: 1, now: 0 });
  errorOf(res, 400, 'invalid_input');
  await app.close();
});
