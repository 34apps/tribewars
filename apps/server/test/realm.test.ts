// Realm overview (GET /api/realm): only the caller's own villages, settled, with queues, troops, marches and notes;
// and its cost stays flat as the number of villages grows.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_BUILD_QUEUE,
  MAX_VILLAGES_PER_PLAYER,
  createPlayerVillage,
  emptyUnits,
  productionPerHour,
  populationCap,
  populationUsage,
  settleVillage,
  storageCap,
  villagePoints,
  type RealmResponse,
  type Resources,
  type VillageState,
} from '@clanfire/engine';
import { HOUR, MINUTE, errorOf, makeApp, ok } from './helpers.ts';
import { newPlayer, type App, type P } from './tribe-helpers.ts';
import { giveTroops, sendOk, unprotect, world } from './warfare-helpers.ts';

const floorResources = (r: Resources): Resources => ({ wood: Math.floor(r.wood), food: Math.floor(r.food), iron: Math.floor(r.iron), gold: Math.floor(r.gold) });
const realm = async (p: P): Promise<RealmResponse> => {
  const res = await p.c.get('/api/realm');
  ok(res);
  return res.json<RealmResponse>();
};
const homeOf = (app: App, p: P) => app.ctx.store.villagesOfPlayer(p.id)[0]!;
const save = (app: App, id: number, st: VillageState): void => app.ctx.store.saveVillage(id, st, villagePoints(st));

/** Give `p` more villages straight in the database (far tiles; this is not about founding). */
let tileCounter = 0;
function addVillages(app: App, p: P, n: number, now: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const st = createPlayerVillage(now);
    ids.push(app.ctx.store.insertVillage(p.id, `Extra ${i + 1}`, 500 + tileCounter++, 500, villagePoints(st), st));
  }
  return ids;
}

test('a plain village: every field is there and matches the engine', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  clock.advance(HOUR);
  const r = await realm(p);
  assert.equal(r.serverTime, clock.now());
  assert.equal(r.villages.length, 1);
  const v = r.villages[0]!;
  const rec = homeOf(app, p);
  const home = rec;
  const settled = settleVillage(rec.state, clock.now(), app.ctx.settings);
  assert.deepEqual(v.resources, floorResources(settled.resources));
  assert.deepEqual(v.income, productionPerHour(settled, app.ctx.settings));
  assert.equal(v.storageCap, storageCap(settled));
  assert.deepEqual(v.population, { used: populationUsage(settled).total, cap: populationCap(settled) });
  assert.equal(v.points, villagePoints(settled));
  assert.deepEqual([v.id, v.name, v.x, v.y], [rec.id, rec.name, rec.x, rec.y]);
  assert.equal(v.hearth, 'lit');
  assert.equal(v.claimBy, null);
  assert.equal(v.holdEndsAt, null);
  assert.deepEqual(v.build, { queue: [], slots: MAX_BUILD_QUEUE });
  assert.deepEqual([v.training, v.troops, v.away], [[], {}, {}]);
  assert.deepEqual(v.incoming, { attacks: 0, nextAt: null });
  assert.deepEqual(v.outgoing, { marches: 0, nextAt: null });
  assert.equal(v.note, null);
  assert.equal(v.protectedUntil, null, 'only the village\'s own protection (founded / restarted), like the village list');
  home.state.protectedUntil = clock.now() + HOUR;
  save(app, rec.id, home.state);
  assert.equal((await realm(p)).villages[0]!.protectedUntil, clock.now() + HOUR);
});

test('the stock is settled to now (not the stored moment) and nothing is written by the read', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  const before = JSON.stringify(homeOf(app, p).state);
  const stored = homeOf(app, p).state.resources;
  clock.advance(2 * HOUR);
  const v = (await realm(p)).villages[0]!;
  assert.ok(v.resources.wood > stored.wood, 'wood grew');
  assert.equal(JSON.stringify(homeOf(app, p).state), before, 'the stored village is untouched');
});

test('only the caller\'s own villages: another player\'s and abandoned villages never appear', async () => {
  const { app, clock } = await makeApp();
  const alice = await newPlayer(app, 'alice');
  const bob = await newPlayer(app, 'bob');
  addVillages(app, bob, 3, clock.now());
  const a = await realm(alice);
  assert.deepEqual(a.villages.map((v) => v.id), [homeOf(app, alice).id]);
  const b = await realm(bob);
  assert.equal(b.villages.length, 4);
  const mine = new Set(app.ctx.store.villagesOfPlayer(bob.id).map((v) => v.id));
  assert.ok(b.villages.every((v) => mine.has(v.id)));
  assert.equal(JSON.stringify(a).includes('Extra'), false);
});

test('build queue and free slots', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  const home = homeOf(app, p);
  home.state.resources = { wood: 50_000, food: 50_000, iron: 50_000, gold: 50_000 };
  save(app, home.id, home.state);
  ok(await p.c.post(`/api/villages/${home.id}/build`, { building: 'lumber' }));
  let v = (await realm(p)).villages[0]!;
  assert.equal(v.build.queue.length, 1);
  assert.equal(v.build.slots, MAX_BUILD_QUEUE);
  assert.equal(v.build.queue[0]!.building, 'lumber');
  ok(await p.c.post(`/api/villages/${home.id}/build`, { building: 'storehouse' }));
  v = (await realm(p)).villages[0]!;
  assert.deepEqual(v.build.queue.map((j) => j.building), ['lumber', 'storehouse']);
  const queued = homeOf(app, p).state.buildQueue;
  assert.deepEqual(v.build.queue, queued.map((j) => ({ building: j.building, targetLevel: j.targetLevel, finishAt: j.finishAt })));
  // Population counts the queued level already.
  assert.equal(v.population.used, populationUsage(homeOf(app, p).state).total);
  // A finished job leaves the queue.
  clock.set(Math.max(...queued.map((j) => j.finishAt)) + 1);
  assert.deepEqual((await realm(p)).villages[0]!.build.queue, []);
});

test('training batches: units left and when each batch is done; finished units are at home', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  const home = homeOf(app, p);
  const t = clock.now();
  home.state.buildings.barracks = 3;
  home.state.buildings.stables = 3;
  home.state.trainQueues.barracks = [{ unit: 'pikeman', count: 10, done: 0, perUnitMs: 120_000, startAt: t }];
  home.state.trainQueues.stables = [{ unit: 'outrider', count: 20, done: 0, perUnitMs: 30_000, startAt: t }];
  home.state.troops = { ...emptyUnits(), guard: 7 };
  save(app, home.id, home.state);
  clock.advance(5 * MINUTE + 1000);
  const v = (await realm(p)).villages[0]!;
  assert.deepEqual(v.training, [
    { building: 'stables', unit: 'outrider', left: 10, finishAt: t + 20 * 30_000 },
    { building: 'barracks', unit: 'pikeman', left: 8, finishAt: t + 10 * 120_000 },
  ]);
  assert.deepEqual(v.troops, { pikeman: 2, guard: 7, outrider: 10 });
});

test('troops at home and troops away list only non-zero entries; marches count every kind of mission', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, alice, { pikeman: 20, raider: 10, pathfinder: 3, guard: 4 });
  const bobHome = homeOf(app, bob);
  // An attack and a scout from alice's village.
  const attack = await sendOk(alice, bob, 'attack', { raider: 5 });
  const scout = await sendOk(alice, bob, 'scout', { pathfinder: 3 });
  const a = (await realm(alice)).villages[0]!;
  assert.deepEqual(a.troops, { pikeman: 20, raider: 5, guard: 4 });
  assert.deepEqual(a.away, { raider: 5, pathfinder: 3 });
  assert.equal(a.outgoing.marches, 2);
  assert.equal(a.outgoing.nextAt, Math.min(attack.movement.arriveAt, scout.movement.arriveAt));
  assert.deepEqual(a.incoming, { attacks: 0, nextAt: null });
  // Bob sees the attack but never the scout, and has no outgoing march of his own.
  const b = (await realm(bob)).villages[0]!;
  assert.equal(b.id, bobHome.id);
  assert.deepEqual(b.incoming, { attacks: 1, nextAt: attack.movement.arriveAt });
  assert.deepEqual(b.outgoing, { marches: 0, nextAt: null });
  // A support march and the returning troops are marches too.
  clock.set(attack.movement.arriveAt);
  clock.set(scout.movement.arriveAt);
  const after = (await realm(alice)).villages[0]!;
  assert.ok(after.outgoing.marches >= 1, 'the return trips are marches');
  assert.ok(after.outgoing.nextAt !== null && after.outgoing.nextAt > clock.now());
});

test('a second attacker and a second target: counts and the soonest arrival per village', async () => {
  const { app, clock, alice, bob, lou } = await world();
  giveTroops(app, alice, { raider: 10 });
  giveTroops(app, lou, { raider: 10 });
  const first = await sendOk(alice, bob, 'attack', { raider: 2 });
  clock.advance(10_000);
  const second = await sendOk(lou, bob, 'attack', { raider: 2 });
  const b = (await realm(bob)).villages[0]!;
  assert.equal(b.incoming.attacks, 2);
  assert.equal(b.incoming.nextAt, Math.min(first.movement.arriveAt, second.movement.arriveAt));
  // Not counted for the sender.
  assert.equal((await realm(lou)).villages[0]!.incoming.attacks, 0);
});

test('a village note shows on its row, a player note does not', async () => {
  const { app, clock } = await makeApp();
  const alice = await newPlayer(app, 'alice');
  const bob = await newPlayer(app, 'bob');
  const second = addVillages(app, alice, 1, clock.now())[0]!;
  const own = homeOf(app, alice).id;
  ok(await alice.c.post('/api/notes', { kind: 'village', targetId: second, text: 'Wood farm', tags: ['plan', 'prey'] }));
  ok(await alice.c.post('/api/notes', { kind: 'player', targetId: bob.id, text: 'not on a row', tags: [] }));
  // Bob's note on alice's village is bob's own and never shows on alice's realm.
  ok(await bob.c.post('/api/notes', { kind: 'village', targetId: own, text: 'bob only', tags: ['menace'] }));
  const r = await realm(alice);
  const byId = new Map(r.villages.map((v) => [v.id, v]));
  assert.deepEqual(byId.get(second)!.note, { text: 'Wood farm', tags: ['prey', 'plan'] });
  assert.equal(byId.get(own)!.note, null);
  assert.equal(JSON.stringify(r).includes('bob only'), false);
});

test('a village whose hearth is out shows the claimant and the hold end', async () => {
  const { app, clock } = await makeApp();
  const alice = await newPlayer(app, 'alice');
  const bob = await newPlayer(app, 'bob');
  const home = homeOf(app, alice);
  const t = clock.now();
  const holdMs = 6 * HOUR;
  home.state.hearth = { status: 'out', claimBy: bob.id, outAt: t, holdMs, runningSince: t, underSince: null };
  save(app, home.id, home.state);
  const v = (await realm(alice)).villages[0]!;
  assert.equal(v.hearth, 'out');
  assert.equal(v.claimBy, 'bob');
  assert.equal(v.holdEndsAt, t + holdMs);
  // The same row as the light village list.
  const list = (await alice.c.get('/api/villages')).json<{ villages: Array<{ id: number; hearth: string; holdEndsAt: number | null }> }>();
  assert.equal(list.villages[0]!.hearth, 'out');
  assert.equal(list.villages[0]!.holdEndsAt, v.holdEndsAt);
});

test('signed-out is 401, an extra query key is 400, the rate limit is 30 per minute', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  errorOf(await p.c.get('/api/realm?village=1'), 400, 'invalid_input');
  errorOf(await app.inject({ method: 'GET', url: '/api/realm', headers: { host: 'clanfire.test' } }), 401, 'unauthorized');
  for (let i = 0; i < 28; i++) assert.notEqual((await p.c.get('/api/realm')).statusCode, 429);
  assert.notEqual((await p.c.get('/api/realm')).statusCode, 429);
  errorOf(await p.c.get('/api/realm'), 429, 'rate_limited');
  clock.advance(MINUTE + 1);
  ok(await p.c.get('/api/realm'));
});

test('1, 4 and 20 villages: the same shape, one row per village, ordered by id', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  unprotect(app, p);
  let last = 1;
  for (const total of [1, 4, MAX_VILLAGES_PER_PLAYER]) {
    addVillages(app, p, total - last, clock.now() + last * 1000);
    last = total;
    const r = await realm(p);
    assert.equal(r.villages.length, total);
    const ids = r.villages.map((v) => v.id);
    assert.deepEqual(ids, [...ids].sort((x, y) => x - y));
    for (const v of r.villages) assert.deepEqual(Object.keys(v).sort(), Object.keys(r.villages[0]!).sort());
    clock.advance(3 * MINUTE); // keep the per-minute limit out of the way
  }
});

/** Count the statements the stores run inside `GameService.realm` during `fn` (not the request pipeline around it). */
async function countRealmStatements(app: App, fn: () => Promise<void>): Promise<number> {
  const store = app.ctx.store;
  const game = app.ctx.game as unknown as { realm: (...a: unknown[]) => unknown };
  const targets = [store, store.notes] as unknown as Array<Record<'all' | 'get' | 'run', (...a: unknown[]) => unknown>>;
  let n = 0;
  let inside = false;
  const saved = targets.map((t) => ({ t, all: t.all, get: t.get, run: t.run }));
  for (const t of targets) {
    for (const k of ['all', 'get', 'run'] as const) {
      const orig = t[k];
      t[k] = function (this: unknown, ...a: unknown[]) {
        if (inside) n++;
        return orig.apply(this, a);
      };
    }
  }
  const realmOrig = game.realm;
  game.realm = function (this: unknown, ...a: unknown[]) {
    inside = true;
    try {
      return realmOrig.apply(this, a);
    } finally {
      inside = false;
    }
  };
  try {
    await fn();
  } finally {
    game.realm = realmOrig;
    for (const x of saved) Object.assign(x.t, { all: x.all, get: x.get, run: x.run });
  }
  return n;
}

test('the number of SQL statements does not grow with the number of villages', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  const call = async (): Promise<number> => countRealmStatements(app, async () => void ok(await p.c.get('/api/realm')));
  await call(); // warm up (first-request work)
  clock.advance(2 * MINUTE);
  const one = await call();

  const ids = addVillages(app, p, MAX_VILLAGES_PER_PLAYER - 1, clock.now());
  for (const id of ids) ok(await p.c.post('/api/notes', { kind: 'village', targetId: id, text: 'n', tags: ['watch'] }));
  clock.advance(2 * MINUTE);
  const twenty = await call();
  assert.equal(twenty, one, `1 village: ${one} statements, 20 villages with 19 notes: ${twenty}`);
  assert.equal(twenty, 4, 'villages, incoming attacks, marches, notes: four statements');
  assert.equal((await realm(p)).villages.length, MAX_VILLAGES_PER_PLAYER);

  // With marches and incoming attacks it is still the same handful of grouped queries.
  const { app: app2, clock: clock2, alice, bob } = await world();
  giveTroops(app2, alice, { raider: 20 });
  const base = await countRealmStatements(app2, async () => void (await realm(bob)));
  await sendOk(alice, bob, 'attack', { raider: 5 });
  await sendOk(alice, bob, 'attack', { raider: 5 });
  clock2.advance(2 * MINUTE);
  const busy = await countRealmStatements(app2, async () => void (await realm(bob)));
  assert.equal(busy, base);
  assert.equal(busy, 4);
});
