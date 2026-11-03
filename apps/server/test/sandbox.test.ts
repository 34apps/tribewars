// Sandbox / test mode: only accounts in SANDBOX_USERS (SECURITY_ROADMAP.md section 4 gate).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, BUILDING_IDS, SANDBOX_ARMY_PER_UNIT, START_RESOURCES, UNIT_IDS, storageCapForLevel, type GameStateResponse } from '@clanfire/engine';
import { loadEnv } from '../src/env.ts';
import { errorOf, ok } from './helpers.ts';
import { giveTroops, movementsOf, sendOk, stateOf, world } from './warfare-helpers.ts';

test('SANDBOX_USERS: default is the owner, list is lowercased, empty means nobody', () => {
  assert.deepEqual(loadEnv({}).sandboxUsers, ['metinaltinbas']);
  assert.deepEqual(loadEnv({ SANDBOX_USERS: ' Alice, BOB ,,' }).sandboxUsers, ['alice', 'bob']);
  assert.deepEqual(loadEnv({ SANDBOX_USERS: '' }).sandboxUsers, []);
});

test('sandbox endpoints refuse everyone not on the list, and signed-out requests', async () => {
  const { app, alice, bob } = await world();
  app.ctx.store.sandboxUsers = new Set(['alice']);
  const before = (await stateOf(bob)).villages[0]!.state.buildings;
  errorOf(await bob.c.post('/api/sandbox/max', {}), 403, 'forbidden');
  errorOf(await bob.c.post('/api/sandbox/reset', {}), 403, 'forbidden');
  assert.deepEqual((await stateOf(bob)).villages[0]!.state.buildings, before, 'nothing changed');
  const anon = await app.inject({ method: 'POST', url: '/api/sandbox/max', payload: {} });
  errorOf(anon, 401, 'unauthorized');
  assert.equal((await bob.c.state()).player.sandbox, false);
  assert.equal((await alice.c.state()).player.sandbox, true);
});

test('sandbox is off for everyone when the list is empty', async () => {
  const { alice } = await world();
  errorOf(await alice.c.post('/api/sandbox/max', {}), 403, 'forbidden');
});

test('warp: pulls my movements forward, refuses others and bad input', async () => {
  const { app, alice, bob } = await world();
  app.ctx.store.sandboxUsers = new Set(['alice']);
  errorOf(await bob.c.post('/api/sandbox/warp', { seconds: 5 }), 403, 'forbidden');
  giveTroops(app, alice, { raider: 5 });
  await sendOk(alice, bob, 'attack', { raider: 5 });
  const before = (await movementsOf(alice))[0]!;
  errorOf(await alice.c.post('/api/sandbox/warp', { seconds: -1 }), 400, 'invalid_input');
  const res = await alice.c.post('/api/sandbox/warp', { seconds: 60 });
  ok(res);
  const after = res.json<GameStateResponse>().movements[0]!;
  assert.ok(after.arriveAt < before.arriveAt, 'arrives sooner');
  assert.ok(after.departAt < after.arriveAt, 'span stays positive');
});

test('clear-abandoned: refuses others; afterwards every abandoned village has no troops', async () => {
  const { app, alice, bob } = await world();
  app.ctx.store.sandboxUsers = new Set(['alice']);
  errorOf(await bob.c.post('/api/sandbox/clear-abandoned', {}), 403, 'forbidden');
  const count = (): number => (app.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM villages WHERE owner_id IS NULL').get() as { n: number }).n;
  const n = count();
  assert.ok(n > 0, 'world has abandoned villages');
  ok(await alice.c.post('/api/sandbox/clear-abandoned', {}));
  assert.equal(count(), n);
  for (const id of app.ctx.store.abandonedVillageIds()) {
    const troops = Object.values(app.ctx.store.getVillage(id)!.state.troops);
    assert.ok(troops.every((x) => !x), `village ${id} is empty`);
  }
});

test('own timing: test-mode accounts set the way out and home; others are refused', async () => {
  const { app, alice, bob } = await world();
  app.ctx.store.sandboxUsers = new Set(['alice']);
  giveTroops(app, alice, { raider: 5 });
  giveTroops(app, bob, { raider: 5 });
  const home = await alice.c.village();
  const target = await bob.c.village();
  const body = { x: target.x, y: target.y, units: { raider: 5 }, mission: 'attack' };
  const bobHome = await bob.c.village();
  errorOf(await bob.c.post(`/api/villages/${bobHome.id}/send`, { x: home.x, y: home.y, units: { raider: 5 }, mission: 'attack', travelSeconds: 5 }), 403, 'forbidden');
  errorOf(await alice.c.post(`/api/villages/${home.id}/send`, { ...body, travelSeconds: -1 }), 400, 'invalid_input');
  const res = await alice.c.post(`/api/villages/${home.id}/send`, { ...body, travelSeconds: 30, returnSeconds: 45 });
  ok(res, 201);
  const m = res.json<{ movement: { departAt: number; arriveAt: number } }>().movement;
  assert.equal(m.arriveAt - m.departAt, 30_000);
  const row = app.ctx.store.db.prepare('SELECT return_secs FROM movements').get() as { return_secs: number };
  assert.equal(row.return_secs, 45);
});

test('max: every building at max, stores full, an army of every unit, queues cleared; reset: fresh village', async () => {
  const { app, alice, bob } = await world();
  app.ctx.store.sandboxUsers = new Set(['alice']);
  const res = await alice.c.post('/api/sandbox/max', {});
  ok(res);
  const home = res.json<GameStateResponse>().villages[0]!.state;
  for (const b of BUILDING_IDS) assert.equal(home.buildings[b], BUILDINGS[b].maxLevel, b);
  for (const u of UNIT_IDS) assert.ok(home.troops[u] >= SANDBOX_ARMY_PER_UNIT, u);
  const cap = storageCapForLevel(BUILDINGS.storehouse.maxLevel);
  assert.ok(home.resources.wood >= cap - 1 && home.resources.gold >= cap - 1);
  assert.deepEqual([home.buildQueue.length, home.trainQueues.barracks.length], [0, 0]);

  // Troops on the road, then reset at any time.
  giveTroops(app, alice, { raider: 5 });
  await sendOk(alice, bob, 'attack', { raider: 5 });
  assert.equal((await movementsOf(alice)).length, 1);
  const reset = await alice.c.post('/api/sandbox/reset', {});
  ok(reset);
  const fresh = reset.json<GameStateResponse>();
  const v = fresh.villages[0]!.state;
  for (const b of BUILDING_IDS) assert.equal(v.buildings[b], BUILDINGS[b].startLevel, b);
  for (const u of UNIT_IDS) assert.equal(v.troops[u] + v.away[u], 0, u);
  assert.ok(v.resources.wood <= START_RESOURCES.wood + 5);
  assert.deepEqual(fresh.movements, []);
  assert.deepEqual(await movementsOf(alice), []);
});
