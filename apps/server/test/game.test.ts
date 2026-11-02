import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUILDINGS,
  MAP_MAX_SPAN,
  MAX_BUILD_QUEUE,
  UNITS,
  buildingCost,
  type MapResponse,
  type OwnVillageDto,
  type ReportListResponse,
  type VillageState,
} from '@clanfire/engine';
import { HOUR, MINUTE, errorOf, makeApp, ok, register, type Client } from './helpers.ts';

/** White-box helper: rewrite a village's stored state. */
function patchVillage(app: Awaited<ReturnType<typeof makeApp>>['app'], id: number, fn: (s: VillageState) => void): void {
  const v = app.ctx.store.getVillage(id);
  assert.ok(v);
  fn(v.state);
  app.ctx.store.saveVillage(id, v.state, v.points);
}

test('GET /api/state has the documented shape', async () => {
  const { app, clock } = await makeApp();
  const c = await register(app, 'alice');
  clock.advance(HOUR);
  const st = await c.state();

  assert.equal(st.serverTime, clock.now());
  assert.deepEqual(st.settings, app.ctx.settings);
  assert.equal(st.settings.radius, 12);
  assert.equal(st.player.username, 'alice');
  assert.equal(st.player.protectedUntil, app.ctx.store.getPlayer(st.player.id)?.protectedUntil);
  assert.deepEqual(st.movements, []);
  assert.equal(st.unreadReports, 0);

  assert.equal(st.villages.length, 1);
  const v = st.villages[0];
  assert.ok(v);
  assert.equal(v.name, "alice's village");
  assert.ok(Math.abs(v.x) <= 12 && Math.abs(v.y) <= 12);
  // Settled to serverTime: an hour of production on the start resources.
  assert.equal(v.state.lastUpdate, clock.now());
  assert.ok(v.state.resources.wood > 600);
  assert.equal(v.state.buildings.hall, 1);
  assert.equal(v.state.buildings.barracks, 0);
  assert.deepEqual(v.state.buildQueue, []);

  // Reads settle in memory only: the stored state still has the creation time.
  assert.ok((app.ctx.store.getVillage(v.id)?.state.lastUpdate ?? 0) < clock.now());
  await app.close();
});

test('the world has abandoned villages and is stored once', async () => {
  const { app } = await makeApp();
  const rows = app.ctx.store.db.prepare("SELECT COUNT(*) AS n FROM villages WHERE owner_id IS NULL").get() as { n: number };
  assert.ok(rows.n >= 5, `expected several abandoned villages, got ${rows.n}`);
  const stored = app.ctx.store.getSettings();
  assert.deepEqual(stored, app.ctx.settings);
  await app.close();
});

test('build: success charges the cost, queues the job and completes with time', async () => {
  const { app, clock } = await makeApp();
  const c = await register(app, 'builder');
  const before = await c.village();

  const res = await c.post(`/api/villages/${before.id}/build`, { building: 'lumber' });
  ok(res);
  const after = res.json<OwnVillageDto>();
  assert.equal(after.id, before.id);
  assert.equal(after.state.buildQueue.length, 1);
  assert.equal(after.state.buildQueue[0]?.building, 'lumber');
  assert.equal(after.state.buildQueue[0]?.targetLevel, 2);
  const cost = buildingCost('lumber', 2);
  assert.ok(Math.abs(after.state.resources.wood - (before.state.resources.wood - cost.wood)) < 1);
  assert.equal(after.state.buildings.lumber, 1, 'level rises only when the job finishes');

  // Persisted.
  const stored = app.ctx.store.getVillage(before.id);
  assert.equal(stored?.state.buildQueue.length, 1);

  clock.advance(10 * MINUTE);
  const done = await c.village();
  assert.equal(done.state.buildings.lumber, 2);
  assert.deepEqual(done.state.buildQueue, []);

  // The map's cached points follow once the owner has looked.
  const map = (await c.get(`/api/map?x=${done.x}&y=${done.y}&w=1&h=1`)).json<MapResponse>();
  assert.equal(map.villages[0]?.points, Object.values(done.state.buildings).reduce((a, b) => a + b, 0));
  await app.close();
});

test('build: refusals map to clear errors', async () => {
  const { app } = await makeApp();
  const c = await register(app, 'refused');
  const vid = (await c.village()).id;
  const url = `/api/villages/${vid}/build`;

  // Requirements: barracks need Town Hall 2.
  errorOf(await c.post(url, { building: 'barracks' }), 409, 'requirements_not_met');

  // Not enough resources.
  patchVillage(app, vid, (s) => {
    s.resources.wood = 0;
  });
  errorOf(await c.post(url, { building: 'lumber' }), 409, 'not_enough_resources');
  // A refused action changes nothing.
  assert.equal(app.ctx.store.getVillage(vid)?.state.buildQueue.length, 0);

  // Queue full.
  patchVillage(app, vid, (s) => {
    s.resources.wood = 1000;
  });
  for (let i = 0; i < MAX_BUILD_QUEUE; i++) ok(await c.post(url, { building: 'lumber' }));
  errorOf(await c.post(url, { building: 'lumber' }), 409, 'queue_full');
  assert.equal(app.ctx.store.getVillage(vid)?.state.buildQueue.length, MAX_BUILD_QUEUE);

  // Max level.
  patchVillage(app, vid, (s) => {
    s.buildQueue = [];
    s.buildings.vault = BUILDINGS.vault.maxLevel;
    s.buildings.hall = 20;
    s.resources = { wood: 1000, food: 1000, iron: 1000, gold: 1000 };
  });
  errorOf(await c.post(url, { building: 'vault' }), 409, 'max_level');

  // Malformed input never reaches the rules.
  errorOf(await c.post(url, { building: 'castle' }), 400, 'invalid_input');
  errorOf(await c.post(url, { building: 'constructor' }), 400, 'invalid_input');
  errorOf(await c.post(url, {}), 400, 'invalid_input');
  errorOf(await c.post(url, { building: 'lumber', free: true }), 400, 'invalid_input');
  errorOf(await c.post(url, { building: ['lumber'] }), 400, 'invalid_input');
  errorOf(await c.post('/api/villages/abc/build', { building: 'lumber' }), 400, 'invalid_input');
  await app.close();
});

test('train: needs barracks, queues a batch and delivers units over time', async () => {
  const { app, clock } = await makeApp();
  const c = await register(app, 'trainer');
  const vid = (await c.village()).id;
  const train = (unit: string, count: number) => c.post(`/api/villages/${vid}/train`, { unit, count });

  errorOf(await train('pikeman', 5), 409, 'requirements_not_met');

  ok(await c.post(`/api/villages/${vid}/build`, { building: 'hall' }));
  clock.advance(10 * MINUTE);
  ok(await c.post(`/api/villages/${vid}/build`, { building: 'barracks' }));
  clock.advance(10 * MINUTE);
  assert.equal((await c.village()).state.buildings.barracks, 1);

  const before = await c.village();
  const res = await train('pikeman', 5);
  ok(res);
  const queued = res.json<OwnVillageDto>();
  const job = queued.state.trainQueues.barracks[0];
  assert.ok(job);
  assert.equal(job.unit, 'pikeman');
  assert.equal(job.count, 5);
  assert.ok(Math.abs(before.state.resources.wood - queued.state.resources.wood - 5 * UNITS.pikeman.cost.wood) < 1);
  assert.equal(queued.state.troops.pikeman, 0);

  // Units finish one by one.
  clock.set(job.startAt + 2 * job.perUnitMs + 10);
  assert.equal((await c.village()).state.troops.pikeman, 2);
  clock.set(job.startAt + 5 * job.perUnitMs + 10);
  const finished = await c.village();
  assert.equal(finished.state.troops.pikeman, 5);
  assert.deepEqual(finished.state.trainQueues.barracks, []);

  // Rules still apply: stables not built, raiders need Barracks 2, bad input.
  errorOf(await train('outrider', 1), 409, 'requirements_not_met');
  errorOf(await train('raider', 1), 409, 'requirements_not_met');
  errorOf(await train('dragon', 1), 400, 'invalid_input');
  errorOf(await train('pikeman', 0), 400, 'invalid_input');
  errorOf(await train('pikeman', -3), 400, 'invalid_input');
  errorOf(await train('pikeman', 1.5), 400, 'invalid_input');
  errorOf(await train('pikeman', 1_000_000), 400, 'invalid_input');
  errorOf(await c.post(`/api/villages/${vid}/train`, { unit: 'pikeman', count: '5' }), 400, 'invalid_input');
  errorOf(await c.post(`/api/villages/${vid}/train`, { unit: 'pikeman', count: 1, cost: 0 }), 400, 'invalid_input');
  // Too expensive.
  errorOf(await train('pikeman', 1000), 409, 'not_enough_resources');
  await app.close();
});

test('map: bounds are validated and kinds are relative to the requester', async () => {
  const { app } = await makeApp();
  const a = await register(app, 'alice', '10.0.0.1');
  const b = await register(app, 'bob', '10.0.0.2');
  const va = await a.village();
  const vb = await b.village();

  const rect = (c: Client, x: number, y: number, w: number, h: number) => c.get(`/api/map?x=${x}&y=${y}&w=${w}&h=${h}`);

  const whole = (await rect(a, -12, -12, 25, 25)).json<MapResponse>().villages;
  const kinds = new Set(whole.map((v) => v.kind));
  assert.deepEqual([...kinds].sort(), ['abandoned', 'own', 'player']);
  assert.equal(whole.filter((v) => v.kind === 'own').length, 1);
  const mine = whole.find((v) => v.kind === 'own');
  assert.deepEqual([mine?.id, mine?.name, mine?.x, mine?.y, mine?.ownerName, mine?.protected], [va.id, va.name, va.x, va.y, 'alice', true]);
  const theirs = whole.find((v) => v.kind === 'player');
  assert.deepEqual([theirs?.id, theirs?.ownerName, theirs?.protected], [vb.id, 'bob', true]);
  const npc = whole.find((v) => v.kind === 'abandoned');
  assert.equal(npc?.ownerName, null);
  assert.equal(npc?.protected, false);
  assert.equal(npc?.name, 'Abandoned village');
  // Bob sees the same world from his side.
  const bobView = (await rect(b, -12, -12, 25, 25)).json<MapResponse>().villages;
  assert.equal(bobView.find((v) => v.id === va.id)?.kind, 'player');
  assert.equal(bobView.find((v) => v.id === vb.id)?.kind, 'own');
  // Public info only.
  assert.deepEqual(Object.keys(theirs ?? {}).sort(), ['id', 'kind', 'name', 'ownerName', 'points', 'protected', 'relation', 'tribeId', 'tribeTag', 'x', 'y']);
  assert.deepEqual([theirs?.relation, theirs?.tribeTag, theirs?.tribeId, npc?.relation, npc?.tribeTag, npc?.tribeId], ['neutral', null, null, null, null, null]);

  // The rectangle is [x, x+w) x [y, y+h).
  const one = (await rect(a, vb.x, vb.y, 1, 1)).json<MapResponse>().villages;
  assert.deepEqual(one.map((v) => v.id), [vb.id]);
  assert.deepEqual((await rect(a, vb.x + 1, vb.y, 1, 1)).json<MapResponse>().villages.map((v) => v.id), []);
  assert.deepEqual((await rect(a, vb.x - 1, vb.y - 1, 2, 2)).json<MapResponse>().villages.map((v) => v.id), [vb.id]);
  // Outside the world is just empty.
  assert.deepEqual((await rect(a, 500, 500, 10, 10)).json<MapResponse>().villages, []);
  // The largest allowed span works.
  ok(await rect(a, -30, -30, MAP_MAX_SPAN, MAP_MAX_SPAN));

  // Bounds validation.
  for (const q of [
    `x=0&y=0&w=0&h=5`,
    `x=0&y=0&w=5&h=0`,
    `x=0&y=0&w=${MAP_MAX_SPAN + 1}&h=5`,
    `x=0&y=0&w=5&h=${MAP_MAX_SPAN + 1}`,
    `x=0&y=0&w=-3&h=5`,
    `x=1.5&y=0&w=5&h=5`,
    `x=abc&y=0&w=5&h=5`,
    `x=0&y=0&w=5`,
    ``,
    `x=0&y=0&w=5&h=5&extra=1`,
    `x=0&x=1&y=0&w=5&h=5`,
    `x=99999999&y=0&w=5&h=5`,
    `x=0&y=0&w=1e1&h=5`,
  ]) {
    errorOf(await a.get(`/api/map?${q}`), 400, 'invalid_input');
  }
  await app.close();
});

test('map: protection flag expires with the clock', async () => {
  const { app, clock } = await makeApp();
  const a = await register(app, 'alice', '10.0.0.1');
  const b = await register(app, 'bob', '10.0.0.2');
  const vb = await b.village();
  const q = `/api/map?x=${vb.x}&y=${vb.y}&w=1&h=1`;
  assert.equal((await a.get(q)).json<MapResponse>().villages[0]?.protected, true);
  clock.advance(8 * HOUR); // protection is 72 h / speed 10 = 7.2 h
  assert.equal((await a.get(q)).json<MapResponse>().villages[0]?.protected, false);
  await app.close();
});

test('one player cannot act on, or read, another player\'s things', async () => {
  const { app } = await makeApp();
  const a = await register(app, 'alice', '10.0.0.1');
  const b = await register(app, 'bob', '10.0.0.2');
  const va = await a.village();
  const vb = await b.village();

  errorOf(await b.post(`/api/villages/${va.id}/build`, { building: 'lumber' }), 403, 'forbidden');
  errorOf(await b.post(`/api/villages/${va.id}/train`, { unit: 'pikeman', count: 1 }), 403, 'forbidden');
  errorOf(await b.post(`/api/villages/${va.id}/send`, { x: vb.x, y: vb.y, units: { pikeman: 1 }, mission: 'attack' }), 403, 'forbidden');
  // Nothing happened to Alice's village.
  assert.equal(app.ctx.store.getVillage(va.id)?.state.buildQueue.length, 0);

  // Abandoned villages belong to nobody; missing ones do not exist.
  const npc = app.ctx.store.db.prepare('SELECT id FROM villages WHERE owner_id IS NULL LIMIT 1').get() as { id: number };
  errorOf(await b.post(`/api/villages/${npc.id}/build`, { building: 'lumber' }), 403, 'forbidden');
  errorOf(await b.post('/api/villages/999999/build', { building: 'lumber' }), 404, 'not_found');

  // /state only ever lists the caller's villages.
  assert.deepEqual((await b.state()).villages.map((v) => v.id), [vb.id]);
  await app.close();
});

test('send: target must be someone else\'s village; protected players are off limits', async () => {
  const { app } = await makeApp();
  const a = await register(app, 'alice', '10.0.0.1');
  const b = await register(app, 'bob', '10.0.0.2');
  const va = await a.village();
  const vb = await b.village();
  const send = (x: number, y: number, units: object = { raider: 1 }) => a.post(`/api/villages/${va.id}/send`, { x, y, units, mission: 'attack' });

  // Own village, and tiles with no village.
  errorOf(await send(va.x, va.y), 400, 'invalid_target');
  const empty = [-12, -11, -10].flatMap((x) => [-12, -11].map((y) => ({ x, y }))).find((p) => !app.ctx.store.villageExistsAt(p.x, p.y));
  assert.ok(empty);
  errorOf(await send(empty.x, empty.y), 400, 'invalid_target');
  errorOf(await send(500, 500), 400, 'invalid_target');

  // A brand-new player is protected, even before the attacker's own army question comes up.
  const blocked = await send(vb.x, vb.y);
  errorOf(blocked, 409, 'target_protected');
  assert.match(blocked.json<{ message: string }>().message, /protection/i);

  // Army checks.
  const npc = app.ctx.store.db.prepare('SELECT x, y FROM villages WHERE owner_id IS NULL LIMIT 1').get() as { x: number; y: number };
  errorOf(await send(npc.x, npc.y, {}), 400, 'no_troops');
  errorOf(await send(npc.x, npc.y, { raider: 0 }), 400, 'no_troops');
  errorOf(await send(npc.x, npc.y, { raider: 1 }), 409, 'not_enough_troops');
  errorOf(await send(npc.x, npc.y, { raider: -1 }), 400, 'invalid_input');
  errorOf(await send(npc.x, npc.y, { wizard: 1 }), 400, 'invalid_input');
  errorOf(await send(npc.x, npc.y, { raider: 1.5 }), 400, 'invalid_input');
  errorOf(await a.post(`/api/villages/${va.id}/send`, { x: npc.x, y: npc.y, mission: 'attack' }), 400, 'invalid_input');
  errorOf(await a.post(`/api/villages/${va.id}/send`, { x: 'a', y: npc.y, units: { raider: 1 }, mission: 'attack' }), 400, 'invalid_input');
  assert.deepEqual((await a.state()).movements, []);
  await app.close();
});

test('reports: empty list, 404 for unknown ids, 400 for malformed ids', async () => {
  const { app } = await makeApp();
  const c = await register(app, 'reader');
  assert.deepEqual((await c.get('/api/reports')).json<ReportListResponse>(), { reports: [] });
  errorOf(await c.get('/api/reports/12345'), 404, 'not_found');
  errorOf(await c.get('/api/reports/abc'), 400, 'invalid_input');
  errorOf(await c.get('/api/reports/-1'), 400, 'invalid_input');
  await app.close();
});
