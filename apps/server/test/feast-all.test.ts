// Feast in all villages (premium tools): GET/POST /api/feasts. Contract: packages/engine/src/api.ts. Instant: no real waiting.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXTRA_PREMIUM_TOOLS, FEAST_ALL_MAX_VILLAGES, FEAST_MAX_COUNT, FEAST_RENOWN, feastPrice, villagePoints, type FeastAllResponse, type FeastOverviewResponse, type Resources, type VillageState } from '@clanfire/engine';
import { Client, errorOf, makeApp, ok } from './helpers.ts';
import { newPlayer, type App, type P } from './tribe-helpers.ts';
import { renownOf } from './renown-helpers.ts';

const RICH = { wood: 50_000, food: 50_000, iron: 50_000, gold: 1_000 };

async function setup(over: { switchOn?: boolean; entitleAlice?: boolean } = {}) {
  const { app, clock } = await makeApp({ worldConfig: { npc: { selfBuild: false }, features: { premium: over.switchOn ?? true } } });
  const alice = await newPlayer(app, 'alice');
  const bob = await newPlayer(app, 'bob');
  if (over.entitleAlice ?? true) app.ctx.store.setPremiumBit(alice.id, EXTRA_PREMIUM_TOOLS, true);
  return { app, clock, alice, bob };
}

/** Insert another village for `p` on a free tile, copying `state`. */
function addVillage(app: App, p: P, name: string, state: VillageState): number {
  const store = app.ctx.store;
  const taken = new Set(store.villagesOfPlayer(p.id).map((v) => `${v.x},${v.y}`));
  const base = store.villagesOfPlayer(p.id)[0]!;
  for (let d = 2; d < 60; d++) {
    const x = base.x + d;
    const y = base.y;
    if (taken.has(`${x},${y}`)) continue;
    try {
      return store.insertVillage(p.id, name, x, y, villagePoints(state), structuredClone(state));
    } catch {
      /* tile occupied: try the next one */
    }
  }
  throw new Error('no free tile');
}

/** Give `p` a second village (a copy of the first) and set each village's Banner Hall level and stock. Returns both ids. */
function twoVillages(app: App, p: P, halls: [number, number], stock: [Partial<Resources>, Partial<Resources>] = [RICH, RICH]): [number, number] {
  const store = app.ctx.store;
  const first = store.villagesOfPlayer(p.id)[0]!;
  const ids: [number, number] = [first.id, addVillage(app, p, 'Second', first.state)];
  ids.forEach((id, i) => {
    const v = store.getVillage(id)!;
    v.state.buildings.bannerhall = halls[i]!;
    v.state.buildings.storehouse = 20;
    if (v.state.renownPaid) v.state.renownPaid.bannerhall = Math.max(v.state.renownPaid.bannerhall, halls[i]!);
    v.state.resources = { ...v.state.resources, ...stock[i]! } as Resources;
    store.saveVillage(id, v.state, villagePoints(v.state));
  });
  return ids;
}

const overview = async (p: P): Promise<FeastOverviewResponse> => {
  const res = await p.c.get('/api/feasts');
  ok(res);
  return res.json<FeastOverviewResponse>();
};
const post = (p: P, villages: unknown) => p.c.post('/api/feasts', { villages });
const stock = (app: App, id: number): Resources => app.ctx.store.getVillage(id)!.state.resources;

test('GET /api/feasts: only own villages with price and max by Banner Hall level; query key 400; 401 signed out', async () => {
  const { app, alice, bob } = await setup();
  const [a1, a2] = twoVillages(app, alice, [1, 2]);
  const o = await overview(alice);
  assert.equal(o.feature, true);
  assert.equal(o.entitled, true);
  assert.deepEqual(o.villages.map((v) => v.id).sort(), [a1, a2].sort());
  const v1 = o.villages.find((v) => v.id === a1)!;
  const v2 = o.villages.find((v) => v.id === a2)!;
  assert.equal(v1.bannerhall, 1);
  assert.equal(v2.bannerhall, 2);
  assert.deepEqual(v1.price, feastPrice(1));
  assert.deepEqual(v2.price, feastPrice(2));
  assert.ok(v2.price.wood < v1.price.wood, 'level 2 is cheaper');
  assert.ok(v1.max >= 1 && v1.max <= FEAST_MAX_COUNT);
  assert.equal(o.renown.villages, 2);
  const b = await overview(bob);
  assert.equal(b.entitled, false);
  assert.equal(b.villages.length, 1);
  assert.ok(!b.villages.some((v) => v.id === a1 || v.id === a2));
  errorOf(await alice.c.get('/api/feasts?x=1'), 400, 'invalid_input');
  errorOf(await new Client(app, '10.7.7.7').get('/api/feasts'), 401, 'unauthorized');
  await app.close();
});

test('POST /api/feasts: entitled holds in both villages, cost and Renown add up, gained and fresh overview are right', async () => {
  const { app, alice } = await setup();
  const [a1, a2] = twoVillages(app, alice, [1, 2]);
  const before = [stock(app, a1), stock(app, a2)];
  const r0 = renownOf(app, alice);
  const res = await post(alice, [{ id: a1, count: 2 }, { id: a2, count: 3 }]);
  ok(res);
  const body = res.json<FeastAllResponse>();
  assert.equal(body.gained, 5 * FEAST_RENOWN);
  assert.deepEqual(body.results.map((r) => [r.id, r.held, r.gained, r.skipped]), [[a1, 2, 2 * FEAST_RENOWN, undefined], [a2, 3, 3 * FEAST_RENOWN, undefined]]);
  const after = [stock(app, a1), stock(app, a2)];
  const hall: [number, number] = [1, 2];
  const counts = [2, 3];
  for (let i = 0; i < 2; i++) {
    const price = feastPrice(hall[i]!);
    for (const r of ['wood', 'food', 'iron', 'gold'] as const) assert.equal(after[i]![r], before[i]![r] - counts[i]! * price[r], `${i} ${r}`);
  }
  assert.ok(Math.abs(renownOf(app, alice) - r0 - 5 * FEAST_RENOWN) < 1e-9);
  assert.ok(Math.abs(body.overview.renown.total - r0 - 5 * FEAST_RENOWN) < 1e-9);
  assert.equal(body.overview.villages.find((v) => v.id === a1)!.resources.wood, after[0]!.wood);
  await app.close();
});

test('POST /api/feasts: a village without Banner Hall and one with too little stock are skipped with reasons, the other goes ahead', async () => {
  const { app, alice } = await setup();
  const [a1, a2] = twoVillages(app, alice, [0, 1], [RICH, { wood: 0, food: 0, iron: 0, gold: 0 }]);
  const thirdId = addVillage(app, alice, 'Third', app.ctx.store.getVillage(a1)!.state);
  const third = { id: thirdId };
  const t = app.ctx.store.getVillage(thirdId)!;
  t.state.buildings.bannerhall = 1;
  t.state.buildings.storehouse = 20;
  t.state.resources = { ...t.state.resources, ...RICH } as Resources;
  app.ctx.store.saveVillage(t.id, t.state, villagePoints(t.state));
  const r0 = renownOf(app, alice);
  const res = await post(alice, [{ id: a1, count: 1 }, { id: a2, count: 1 }, { id: third.id, count: 1 }]);
  ok(res);
  const body = res.json<FeastAllResponse>();
  assert.equal(body.results[0]!.held, 0);
  assert.ok(body.results[0]!.skipped?.reason && body.results[0]!.skipped.message);
  assert.equal(body.results[1]!.held, 0);
  assert.ok(body.results[1]!.skipped?.reason);
  assert.equal(body.results[2]!.held, 1);
  assert.equal(body.results[2]!.skipped, undefined);
  assert.equal(body.gained, FEAST_RENOWN);
  assert.ok(Math.abs(renownOf(app, alice) - r0 - FEAST_RENOWN) < 1e-9);
  await app.close();
});

test('POST /api/feasts: 403 without the bit, 403 with the bit but world switch off, nothing spent; 401 signed out', async () => {
  const { app, alice, bob } = await setup();
  const [b1] = twoVillages(app, bob, [1, 1]);
  const before = stock(app, b1);
  const rb = renownOf(app, bob);
  errorOf(await post(bob, [{ id: b1, count: 1 }]), 403, 'forbidden');
  assert.deepEqual(stock(app, b1), before);
  assert.equal(renownOf(app, bob), rb);
  errorOf(await new Client(app, '10.7.7.8').post('/api/feasts', { villages: [{ id: b1, count: 1 }] }), 401, 'unauthorized');
  void alice;
  const off = await setup({ switchOn: false });
  const [o1] = twoVillages(off.app, off.alice, [1, 1]);
  const o = await overview(off.alice);
  assert.equal(o.feature, false);
  assert.equal(o.entitled, false);
  errorOf(await post(off.alice, [{ id: o1, count: 1 }]), 403, 'forbidden');
  await app.close();
  await off.app.close();
});

test('POST /api/feasts: a stranger id is 403 and nothing is held anywhere; unknown id 404; duplicate id 400', async () => {
  const { app, alice, bob } = await setup();
  const [a1, a2] = twoVillages(app, alice, [1, 1]);
  const bobId = (await bob.c.village()).id;
  const before = [stock(app, a1), stock(app, a2)];
  const r0 = renownOf(app, alice);
  errorOf(await post(alice, [{ id: a1, count: 1 }, { id: bobId, count: 1 }]), 403, 'forbidden');
  errorOf(await post(alice, [{ id: a1, count: 1 }, { id: 999999, count: 1 }]), 404, 'not_found');
  errorOf(await post(alice, [{ id: a1, count: 1 }, { id: a1, count: 2 }]), 400, 'invalid_input');
  assert.deepEqual([stock(app, a1), stock(app, a2)], before);
  assert.equal(renownOf(app, alice), r0);
  await app.close();
});

test('POST /api/feasts: strict body (extra keys, count 0 / over max, 0 and too many villages, bad id) is 400', async () => {
  const { app, alice } = await setup();
  const [a1] = twoVillages(app, alice, [1, 1]);
  errorOf(await alice.c.post('/api/feasts', { villages: [{ id: a1, count: 1 }], extra: 1 }), 400, 'invalid_input');
  errorOf(await post(alice, [{ id: a1, count: 1, extra: 1 }]), 400, 'invalid_input');
  errorOf(await post(alice, [{ id: a1, count: 0 }]), 400, 'invalid_input');
  errorOf(await post(alice, [{ id: a1, count: FEAST_MAX_COUNT + 1 }]), 400, 'invalid_input');
  errorOf(await post(alice, [{ id: 0, count: 1 }]), 400, 'invalid_input');
  errorOf(await post(alice, []), 400, 'invalid_input');
  errorOf(await alice.c.post('/api/feasts', {}), 400, 'invalid_input');
  const many = Array.from({ length: FEAST_ALL_MAX_VILLAGES + 1 }, (_, i) => ({ id: i + 1, count: 1 }));
  errorOf(await post(alice, many), 400, 'invalid_input');
  await app.close();
});

test('the /api/feasts routes share the `feast` rate bucket', async () => {
  const { routeBucket } = await import('../src/security.ts');
  assert.equal(routeBucket('GET', '/api/feasts'), 'feast');
  assert.equal(routeBucket('POST', '/api/feasts'), 'feast');
  assert.equal(routeBucket('POST', '/api/villages/:id/feast'), 'feast');
});
