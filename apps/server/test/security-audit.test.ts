// Security and fairness audit of the state-changing game routes (docs/SECURITY_ROADMAP.md sections 2 and 4,
// results table in section 5). Every probe asserts the refusal AND that nothing changed.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_TRAIN_BATCH, type MovementResponse, type Resources } from '@clanfire/engine';
import { errorOf, makeApp, ok, register } from './helpers.ts';
import { giveTroops, movementsOf, reports, sendOk, village, world, type App, type P } from './warfare-helpers.ts';

const CANCEL_MS = 120_000;

function setStock(app: App, p: P, res: Partial<Resources>, market = 1): void {
  const v = app.ctx.store.villagesOfPlayer(p.id)[0]!;
  Object.assign(v.state.resources, res);
  if (v.state.buildings.market < market) v.state.buildings.market = market;
  app.ctx.store.saveVillage(v.id, v.state, v.points);
}

const snapshot = (app: App, p: P): string => JSON.stringify(app.ctx.store.villagesOfPlayer(p.id)[0]!.state);

test('malformed numbers and ids on every village route are refused and change nothing', async () => {
  const { app, alice, bob } = await world();
  setStock(app, alice, { wood: 5000, food: 5000, iron: 5000, gold: 5000 });
  giveTroops(app, alice, { raider: 5 });
  const vid = (await village(alice)).id;
  const vb = await village(bob);
  const before = snapshot(app, alice);
  const bad = async (url: string, body: unknown): Promise<void> => {
    const res = await alice.c.post(url, body);
    assert.equal(res.statusCode, 400, `${url} ${JSON.stringify(body)} -> ${res.statusCode} ${res.body}`);
  };

  for (const id of ['-1', '1.5', 'abc', '1e3', '99999999999999999999', '0x10']) {
    await bad(`/api/villages/${id}/build`, { building: 'lumber' });
  }
  await bad(`/api/villages/${vid}/build`, { building: 'nope' });
  await bad(`/api/villages/${vid}/build`, { building: 'lumber', extra: 1 });
  await bad(`/api/villages/${vid}/build`, {});
  for (const count of [0, -1, 1.5, 1e12, MAX_TRAIN_BATCH + 1, '5', null, Number.MAX_SAFE_INTEGER]) {
    await bad(`/api/villages/${vid}/train`, { unit: 'raider', count });
  }
  await bad(`/api/villages/${vid}/train`, { unit: 'dragon', count: 1 });
  for (const index of [-1, 0.5, 1e9, '0', null]) {
    await bad(`/api/villages/${vid}/cancel-build`, { index });
    await bad(`/api/villages/${vid}/cancel-research`, { index });
    await bad(`/api/villages/${vid}/cancel-train`, { building: 'barracks', index });
  }
  await bad(`/api/villages/${vid}/cancel-train`, { building: 'hall', index: 0 });
  await bad(`/api/villages/${vid}/research`, { unit: 'dragon' });
  await bad(`/api/villages/${vid}/rank`, { unit: 'raider', track: 'speed' });

  const send = (b: object) => alice.c.post(`/api/villages/${vid}/send`, { mission: 'attack', ...b });
  for (const x of [1e9, -1e9, 1.5, NaN, '3', null, Infinity]) errorOf(await send({ x, y: vb.y, units: { raider: 1 } }), 400, 'invalid_input');
  for (const raider of [-5, 1e12, 0.1, '1', null]) errorOf(await send({ x: vb.x, y: vb.y, units: { raider } }), 400, 'invalid_input');
  errorOf(await send({ x: vb.x, y: vb.y, units: { raider: 1 }, mission: 'conquer' }), 400, 'invalid_input');
  errorOf(await send({ x: vb.x, y: vb.y, units: { raider: 1 }, owner: 1 }), 400, 'invalid_input');
  // A prototype-poisoning key in raw JSON never reaches the rules.
  const res = await app.inject({
    method: 'POST',
    url: `/api/villages/${vid}/send`,
    headers: { host: 'clanfire.test', origin: 'http://clanfire.test', cookie: alice.c.cookie, 'content-type': 'application/json' },
    payload: `{"x":${vb.x},"y":${vb.y},"mission":"attack","units":{"raider":1,"__proto__":{"raider":999}}}`,
    remoteAddress: '127.0.0.1',
  });
  assert.equal(res.statusCode >= 400, true, res.body);

  assert.equal(snapshot(app, alice), before, 'no probe changed the village');
  assert.deepEqual(await movementsOf(alice), []);
});

test('shipments: negative, fractional, unknown, oversized or overdrawn cargo is refused; stock never goes negative', async () => {
  const { app, alice, bob } = await world();
  setStock(app, alice, { wood: 100, food: 100, iron: 100, gold: 100 });
  const home = await village(alice);
  const dest = await village(bob);
  const before = snapshot(app, alice);
  const ship = (resources: unknown) => alice.c.post(`/api/villages/${home.id}/ship`, { x: dest.x, y: dest.y, resources });

  errorOf(await ship({ wood: -50, food: 60 }), 400, 'invalid_input'); // a negative amount would add stock to the sender
  errorOf(await ship({ wood: 0.5 }), 400, 'invalid_input');
  errorOf(await ship({ wood: '10' }), 400, 'invalid_input');
  errorOf(await ship({ wood: 1e12 }), 400, 'invalid_input');
  errorOf(await ship({ mana: 10 }), 400, 'invalid_input');
  errorOf(await ship({}), 400, 'invalid_input');
  errorOf(await ship(null), 400, 'invalid_input');
  errorOf(await ship({ wood: 101 }), 409, 'not_enough_resources');
  errorOf(await alice.c.post(`/api/villages/${home.id}/ship`, { x: home.x, y: home.y, resources: { wood: 1 } }), 400, 'invalid_target');
  errorOf(await alice.c.post(`/api/villages/${home.id}/ship`, { x: 1e9, y: 0, resources: { wood: 1 } }), 400, 'invalid_input');
  assert.equal(snapshot(app, alice), before);
  assert.deepEqual(await movementsOf(alice), []);
});

test('double spend: simultaneous requests for one affordable action only succeed once', async () => {
  const { app, alice, bob } = await world();
  const v = await village(alice);
  setStock(app, alice, { wood: 400, food: 400, iron: 400, gold: 400 });

  const builds = await Promise.all([1, 2, 3].map(() => alice.c.post(`/api/villages/${v.id}/build`, { building: 'lumber' })));
  const built = builds.filter((r) => r.statusCode === 200).length;
  assert.ok(built >= 1 && built < 3, `the queue limit stops the third: ${builds.map((r) => r.statusCode).join()}`);
  const afterBuild = app.ctx.store.getVillage(v.id)!;
  assert.equal(afterBuild.state.buildQueue.length, built, 'every accepted build is in the queue exactly once');
  for (const r of ['wood', 'food', 'iron', 'gold'] as const) assert.ok(afterBuild.state.resources[r] >= 0, `${r} not negative`);

  setStock(app, alice, { wood: 300, food: 0, iron: 0, gold: 0 });
  const dest = await village(bob);
  const ships = await Promise.all([1, 2, 3, 4].map(() => alice.c.post(`/api/villages/${v.id}/ship`, { x: dest.x, y: dest.y, resources: { wood: 300 } })));
  assert.equal(ships.filter((r) => r.statusCode === 201).length, 1, ships.map((r) => `${r.statusCode}`).join());
  assert.ok(app.ctx.store.getVillage(v.id)!.state.resources.wood >= 0);
  assert.equal((await movementsOf(alice)).filter((m) => m.kind === 'shipment').length, 1);
});

test('double spend: the same troops cannot march twice, one movement cancels once, one refund is paid once', async () => {
  const { app, alice, bob } = await world();
  giveTroops(app, alice, { raider: 5 });
  const vid = (await village(alice)).id;
  const dest = await village(bob);
  const body = { x: dest.x, y: dest.y, units: { raider: 5 }, mission: 'attack' };
  const sends = await Promise.all([1, 2, 3].map(() => alice.c.post(`/api/villages/${vid}/send`, body)));
  assert.equal(sends.filter((r) => r.statusCode === 201).length, 1);
  const mv = sends.find((r) => r.statusCode === 201)!.json<{ movement: { id: number } }>().movement;

  const cancels = await Promise.all([1, 2, 3].map(() => alice.c.post(`/api/movements/${mv.id}/cancel`, {})));
  assert.equal(cancels.filter((r) => r.statusCode === 201).length, 1, 'exactly one cancel wins');
  const list = await movementsOf(alice);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.kind, 'return');
  assert.equal(list[0]?.units?.raider, 5, 'troops are not duplicated');

  setStock(app, alice, { wood: 1000, food: 1000, iron: 1000, gold: 1000 });
  ok(await alice.c.post(`/api/villages/${vid}/build`, { building: 'lumber' }));
  const refunds = await Promise.all([1, 2, 3].map(() => alice.c.post(`/api/villages/${vid}/cancel-build`, { index: 0 })));
  assert.equal(refunds.filter((r) => r.statusCode === 200).length, 1);
});

test('cancel-and-resend: the return takes exactly the elapsed time, the window closes at 2 min, nothing is gained', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, alice, { raider: 4 });
  const va = await village(alice);
  const vb = await village(bob);
  const first = (await sendOk(alice, bob, 'attack', { raider: 4 })).movement;
  clock.advance(119_000);
  const back = (await alice.c.post(`/api/movements/${first.id}/cancel`, {})).json<MovementResponse>().movement;
  assert.equal(back.arriveAt - back.departAt, 119_000);
  // While they walk home they cannot march again, and the return cannot be cancelled (that would reset its clock).
  errorOf(await alice.c.post(`/api/villages/${va.id}/send`, { x: vb.x, y: vb.y, units: { raider: 1 }, mission: 'attack' }), 409, 'not_enough_troops');
  errorOf(await alice.c.post(`/api/movements/${back.id}/cancel`, {}), 400, 'invalid_target');
  clock.advance(119_000);
  const again = (await sendOk(alice, bob, 'attack', { raider: 4 })).movement;
  assert.equal(again.arriveAt - again.departAt, first.arriveAt - first.departAt, 'a resend is not faster than the first send');
  clock.advance(CANCEL_MS + 1);
  errorOf(await alice.c.post(`/api/movements/${again.id}/cancel`, {}), 409, 'too_late');
  assert.equal((await reports(bob)).length, 0);
});

test('another player cannot cancel, recall, send back, ship from or read anything of mine', async () => {
  const { app, alice, bob } = await world();
  giveTroops(app, alice, { raider: 3 });
  setStock(app, alice, { wood: 200 });
  const va = await village(alice);
  const vb = await village(bob);
  const mv = (await sendOk(alice, bob, 'attack', { raider: 3 })).movement;
  ok(await alice.c.post(`/api/villages/${va.id}/build`, { building: 'lumber' }));

  errorOf(await bob.c.post(`/api/movements/${mv.id}/cancel`, {}), 404, 'not_found');
  for (const [path, body] of [
    ['cancel-build', { index: 0 }],
    ['cancel-train', { building: 'barracks', index: 0 }],
    ['cancel-research', { index: 0 }],
    ['research', { unit: 'raider' }],
    ['rank', { unit: 'raider', track: 'might' }],
    ['respec', { unit: 'raider', track: 'might' }],
    ['ship', { x: vb.x, y: vb.y, resources: { wood: 100 } }],
  ] as const) {
    errorOf(await bob.c.post(`/api/villages/${va.id}/${path}`, body), 403, 'forbidden');
  }
  assert.equal(app.ctx.store.getVillage(va.id)!.state.buildQueue.length, 1, 'my queue is untouched');
  errorOf(await bob.c.post('/api/stationed/424242/recall', {}), 404, 'not_found');
  errorOf(await bob.c.post('/api/stationed/424242/send-back', {}), 404, 'not_found');

  // The target sees an incoming attack with times, but not the army; /state never lists foreign villages.
  const incoming = (await movementsOf(bob)).find((m) => m.id === mv.id);
  assert.ok(incoming);
  assert.ok(incoming.units === null || incoming.units === undefined, 'defender does not see the attacker army');
  assert.deepEqual((await bob.c.state()).villages.map((v) => v.id), [vb.id]);
});

test('public endpoints show no resources, troops, queues or reports of other players', async () => {
  const { app, clock, alice, amy, bob, lou } = await world();
  giveTroops(app, alice, { raider: 7 });
  setStock(app, alice, { wood: 777, food: 778, iron: 779, gold: 780 });
  const va = await village(alice);
  ok(await alice.c.post(`/api/villages/${va.id}/build`, { building: 'lumber' }));
  const mv = (await sendOk(alice, bob, 'attack', { raider: 7 })).movement;
  clock.set(mv.arriveAt);

  const mine = await reports(alice);
  assert.ok(mine.length > 0, 'alice has a battle report');
  for (const r of mine) {
    errorOf(await lou.c.get(`/api/reports/${r.id}`), 404, 'not_found');
    errorOf(await amy.c.get(`/api/reports/${r.id}`), 404, 'not_found'); // tribe-mates do not share reports
  }
  assert.deepEqual(await reports(lou), []);

  const tribeId = (await alice.c.get('/api/tribe')).json<{ tribe: { id: number } }>().tribe.id;
  const secrets = ['"wood":777', '"food":778', '"iron":779', '"gold":780', 'buildQueue', 'trainQueues', '"troops"', '"resources"'];
  const urls = ['/api/map?x=-12&y=-12&w=25&h=25', `/api/players/${alice.id}`, '/api/rankings/players', '/api/rankings/tribes', `/api/tribes/${tribeId}`, '/api/tribes?q=alpha'];
  let seen = 0;
  for (const url of urls) {
    const res = await lou.c.get(url);
    if (res.statusCode !== 200) continue;
    seen += 1;
    for (const s of secrets) assert.equal(res.body.includes(s), false, `${url} leaks ${s}`);
  }
  assert.ok(seen >= 3, 'most public endpoints answered');
  errorOf(await lou.c.get('/api/tribe/alerts'), 409, 'not_in_tribe');
});

test('a banned player is locked out of every action at once, and cannot sign back in', async () => {
  const { app, alice, bob } = await world();
  giveTroops(app, alice, { raider: 2 });
  setStock(app, alice, { wood: 100 });
  const va = await village(alice);
  const vb = await village(bob);
  const mv = (await sendOk(alice, bob, 'attack', { raider: 2 })).movement;
  app.ctx.store.banPlayer(alice.id, 'test', Date.now());
  const calls: Array<['GET' | 'POST', string, unknown?]> = [
    ['GET', '/api/state'],
    ['POST', `/api/villages/${va.id}/build`, { building: 'lumber' }],
    ['POST', `/api/villages/${va.id}/train`, { unit: 'raider', count: 1 }],
    ['POST', `/api/villages/${va.id}/send`, { x: vb.x, y: vb.y, units: { raider: 1 }, mission: 'attack' }],
    ['POST', `/api/villages/${va.id}/ship`, { x: vb.x, y: vb.y, resources: { wood: 1 } }],
    ['POST', `/api/movements/${mv.id}/cancel`, {}],
    ['POST', '/api/stationed/1/recall', {}],
    ['GET', '/api/reports'],
    ['GET', '/api/tribe'],
    ['POST', '/api/tribe/leave', {}],
  ];
  for (const [method, url, body] of calls) {
    const res = await alice.c.call(method, url, body);
    assert.equal(res.statusCode, 401, `${method} ${url} -> ${res.statusCode}`);
  }
  const login = await alice.c.post('/api/auth/login', { username: 'alice', password: 'correct horse battery' });
  assert.equal(login.statusCode >= 400, true);
});

test('test-mode shortcuts (custom travel time, warp, max) are refused for normal accounts', async () => {
  const { app, alice, bob } = await world();
  giveTroops(app, alice, { raider: 1 });
  const va = await village(alice);
  const vb = await village(bob);
  const send = (extra: object) => alice.c.post(`/api/villages/${va.id}/send`, { x: vb.x, y: vb.y, units: { raider: 1 }, mission: 'attack', ...extra });
  errorOf(await send({ travelSeconds: 0 }), 403, 'forbidden');
  errorOf(await send({ returnSeconds: 0 }), 403, 'forbidden');
  errorOf(await alice.c.post('/api/sandbox/max', {}), 403, 'forbidden');
  errorOf(await alice.c.post('/api/sandbox/reset', {}), 403, 'forbidden');
  errorOf(await alice.c.post('/api/sandbox/warp', { seconds: 3600 }), 403, 'forbidden');
  errorOf(await alice.c.post('/api/sandbox/clear-abandoned', {}), 403, 'forbidden');
  assert.deepEqual(await movementsOf(alice), []);
  void app;
});

test('accounts on one connection cannot move resources between them, not even through an abandoned village', async () => {
  const { app } = await makeApp();
  const a = await register(app, 'home_a', '10.5.5.5');
  const b = await register(app, 'home_b', '10.5.5.5');
  const solo = await register(app, 'solo_x', '10.5.5.6');
  const pa: P = { c: a, id: (await a.state()).player.id, name: 'home_a' };
  const ps: P = { c: solo, id: (await solo.state()).player.id, name: 'solo_x' };
  setStock(app, pa, { wood: 300 });
  setStock(app, ps, { wood: 300 });
  const npc = app.ctx.store.db.prepare('SELECT x, y FROM villages WHERE owner_id IS NULL LIMIT 1').get() as { x: number; y: number };
  const vb = await b.village();
  const va = await a.village();

  errorOf(await a.post(`/api/villages/${va.id}/ship`, { x: vb.x, y: vb.y, resources: { wood: 100 } }), 400, 'invalid_target');
  // Feeding an abandoned village is the back door: the partner would then raid it.
  errorOf(await a.post(`/api/villages/${va.id}/ship`, { x: npc.x, y: npc.y, resources: { wood: 100 } }), 400, 'invalid_target');
  // A player who shares a connection with nobody may still do it (owner decision, 2026-11-03).
  const vs = await solo.village();
  ok(await solo.post(`/api/villages/${vs.id}/ship`, { x: npc.x, y: npc.y, resources: { wood: 100 } }), 201);
});
