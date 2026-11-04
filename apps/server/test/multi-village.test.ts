// Playing with several villages (docs/GAME_DESIGN.md 18.2, step 2): everything per village, the light village list, rename,
// troops and resources between own villages, and the rankings counting every village.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyStrike,
  createPlayerVillage,
  holdDueAt,
  settleVillage,
  villagePoints,
  type OwnVillageDto,
  type PlayerRankingResponse,
  type SendResponse,
  type VillageListResponse,
} from '@clanfire/engine';
import { Client, errorOf, makeApp, ok } from './helpers.ts';
import { giveTroops, sendFails, sendOk, unprotect } from './warfare-helpers.ts';
import { newPlayer, setBuilding, type App, type P } from './tribe-helpers.ts';
import { homeOf, runTo, strongHome, villagesOf } from './village-helpers.ts';

/** Give the player a second village (created straight in the database, as step 2's founding and taking do). */
function addVillage(app: App, clock: { now(): number }, p: P, x: number, y: number, name = 'Second'): number {
  const state = createPlayerVillage(clock.now());
  return app.ctx.store.insertVillage(p.id, name, x, y, villagePoints(state), state);
}

const list = async (c: Client) => {
  const res = await c.get('/api/villages');
  ok(res);
  return res.json<VillageListResponse>();
};

test('queues, stock and troops are per village; the state lists every village', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  const home = homeOf(app, p);
  const second = addVillage(app, clock, p, home.x + 10, home.y);
  const st0 = await p.c.state();
  assert.equal(st0.villages.length, 2);
  assert.equal(st0.renown.villages, 2);

  ok(await p.c.post(`/api/villages/${second}/build`, { building: 'lumber' }));
  const st1 = await p.c.state();
  const a = st1.villages.find((v) => v.id === home.id)!;
  const b = st1.villages.find((v) => v.id === second)!;
  assert.equal(a.state.buildQueue.length, 0, 'the first village is untouched');
  assert.equal(b.state.buildQueue.length, 1);
  assert.ok(b.state.resources.wood < st0.villages.find((v) => v.id === second)!.state.resources.wood, 'only the second village paid');
  assert.deepEqual(a.state.resources, st0.villages.find((v) => v.id === home.id)!.state.resources, 'the first village paid nothing');

  giveTroops(app, p, { pikeman: 10 });
  assert.equal((await p.c.state()).villages.find((v) => v.id === second)!.state.troops.pikeman, 0, 'troops belong to one village');
  await app.close();
});

test('GET /api/villages: light list with hearth status, stock and the incoming-attack flag; own villages only', async () => {
  const { app, clock } = await makeApp();
  const alice = await newPlayer(app, 'alice');
  const bob = await newPlayer(app, 'bob');
  unprotect(app, alice, bob);
  const home = homeOf(app, alice);
  const second = addVillage(app, clock, alice, home.x + 10, home.y, 'Outpost');
  const bobHome = strongHome(app, clock, bob, { raider: 50 });

  const quiet = await list(alice.c);
  assert.equal(quiet.villages.length, 2);
  assert.deepEqual(quiet.villages.map((v) => v.name), ['alice\'s village', 'Outpost']);
  for (const v of quiet.villages) {
    assert.equal(v.hearth, 'lit');
    assert.equal(v.incomingAttack, false);
    assert.equal(v.nextAttackAt, null);
    assert.equal(v.holdEndsAt, null);
    assert.equal(v.protectedUntil, null);
    assert.equal(typeof v.resources.wood, 'number');
    assert.equal(v.resources.wood, Math.floor(v.resources.wood));
    assert.ok(v.points > 0);
  }
  assert.equal((await list(bob.c)).villages.length, 1, 'bob sees only his own');

  // An attack on the second village flags exactly that village.
  const target = app.ctx.store.getVillage(second)!;
  const res = await bob.c.post(`/api/villages/${bobHome}/send`, { x: target.x, y: target.y, units: { raider: 50 }, mission: 'attack' });
  ok(res, 201);
  const { movement } = res.json<SendResponse>();
  const hit = await list(alice.c);
  assert.deepEqual(hit.villages.map((v) => v.incomingAttack), [false, true]);
  assert.equal(hit.villages[1]?.nextAttackAt, movement.arriveAt);
  assert.equal((await list(bob.c)).villages[0]?.incomingAttack, false, 'the sender has no incoming attack');

  // A cold village reports its hearth and when the clock ends.
  const cold = applyStrike(settleVillage(target.state, clock.now(), app.ctx.settings), {
    claimBy: bob.id,
    now: clock.now(),
    settings: app.ctx.settings,
    occupiers: { raider: 200 },
  });
  app.ctx.store.saveVillage(second, cold, target.points);
  app.ctx.store.setHoldDue(second, holdDueAt(cold.hearth!, app.ctx.settings));
  const out = await list(alice.c);
  assert.equal(out.villages[1]?.hearth, 'out');
  assert.equal(out.villages[1]?.holdEndsAt, holdDueAt(cold.hearth!, app.ctx.settings));
  const dto = (await alice.c.state()).villages.find((v) => v.id === second) as OwnVillageDto;
  assert.equal(dto.hearth?.claimBy, 'bob');
  assert.equal(dto.hearth?.running, true);

  errorOf(await new Client(app).get('/api/villages'), 401, 'unauthorized');
  await app.close();
});

test('rename: trimmed and validated; only the owner, everybody else sees a missing village', async () => {
  const { app, clock } = await makeApp();
  const alice = await newPlayer(app, 'alice');
  const bob = await newPlayer(app, 'bob');
  const vid = homeOf(app, alice).id;
  const rename = (c: Client, id: number | string, body: unknown) => c.post(`/api/villages/${id}/rename`, body);

  const res = await rename(alice.c, vid, { name: '  Ünï   Hill 2  ' });
  ok(res);
  assert.equal(res.json<OwnVillageDto>().name, 'Ünï Hill 2');
  assert.equal((await list(alice.c)).villages[0]?.name, 'Ünï Hill 2');
  assert.equal(app.ctx.store.getVillage(vid)?.name, 'Ünï Hill 2');

  for (const name of ['', '   ', 'x'.repeat(31), '<b>hi</b>', 'a\nb', 'a;drop']) {
    errorOf(await rename(alice.c, vid, { name }), 400, 'invalid_input');
  }
  errorOf(await rename(alice.c, vid, { name: 5 }), 400, 'invalid_input');
  errorOf(await rename(alice.c, vid, {}), 400, 'invalid_input');
  errorOf(await rename(alice.c, vid, { name: 'ok', extra: 1 }), 400, 'invalid_input');
  errorOf(await rename(bob.c, vid, { name: 'Mine now' }), 404, 'not_found');
  errorOf(await rename(alice.c, 99999, { name: 'Nowhere' }), 404, 'not_found');
  errorOf(await rename(alice.c, 'abc', { name: 'Nowhere' }), 400, 'invalid_input');
  errorOf(await rename(new Client(app), vid, { name: 'Anon' }), 401, 'unauthorized');
  assert.equal(app.ctx.store.getVillage(vid)?.name, 'Ünï Hill 2', 'nothing changed');

  // A banned account is signed out everywhere.
  app.ctx.store.banPlayer(alice.id, 'test', clock.now());
  errorOf(await rename(alice.c, vid, { name: 'Banned' }), 401, 'unauthorized');
  await app.close();
});

test('troops between own villages: support stands there and can be recalled; every other mission on your own village is refused', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  const home = homeOf(app, p);
  const second = addVillage(app, clock, p, home.x + 10, home.y);
  const dest = app.ctx.store.getVillage(second)!;
  giveTroops(app, p, { pikeman: 10, raider: 5 });

  const { movement } = await sendOk(p, dest, 'support', { pikeman: 10 });
  assert.equal(movement.kind, 'support');
  runTo(app, clock, movement.arriveAt);
  const st = await p.c.state();
  const entry = st.stationed.here.find((s) => s.host.villageId === second);
  assert.ok(entry, 'my troops stand in my second village');
  assert.equal(entry.units.pikeman, 10);
  assert.equal(entry.home.villageId, home.id);
  assert.equal(st.stationed.abroad.length, 1);
  assert.equal(st.villages.find((v) => v.id === second)!.state.troops.pikeman, 0, 'a guest contingent, not the village\'s own troops');

  const back = await p.c.post(`/api/stationed/${entry.id}/recall`, {});
  ok(back, 201);
  runTo(app, clock, (back.json<{ movement: { arriveAt: number } }>()).movement.arriveAt);
  const after = (await p.c.state()).villages.find((v) => v.id === home.id)!;
  assert.equal(after.state.troops.pikeman, 10);
  assert.equal(after.state.away.pikeman, 0);

  for (const mission of ['attack', 'scout', 'occupy'] as const) {
    await sendFails(p, dest, mission, { raider: 1, pathfinder: 0 }, 400, 'invalid_target');
  }
  await sendFails(p, home, 'support', { pikeman: 1 }, 400, 'invalid_target'); // the same village
  await app.close();
});

test('resources between own villages (shipments) and the rankings counting every village', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  const bob = await newPlayer(app, 'bob');
  const home = homeOf(app, p);
  const second = addVillage(app, clock, p, home.x + 10, home.y);
  const dest = app.ctx.store.getVillage(second)!;
  setBuilding(app, p.id, 'market', 1); // shipments need a Market in the sending village
  const before = (await p.c.state()).villages.find((v) => v.id === second)!.state.resources.wood;
  const res = await p.c.post(`/api/villages/${home.id}/ship`, { x: dest.x, y: dest.y, resources: { wood: 100 } });
  ok(res, 201);
  const arriveAt = res.json<{ movement: { arriveAt: number } }>().movement.arriveAt;
  runTo(app, clock, arriveAt);
  const after = (await p.c.state()).villages.find((v) => v.id === second)!.state.resources.wood;
  assert.ok(after >= before + 99, 'the shipment arrived in the second village');

  // Rankings and points add up over all villages.
  const st = await p.c.state();
  const sum = st.villages.reduce((n, v) => n + villagePoints(settleVillage(v.state, st.serverTime, app.ctx.settings)), 0);
  const rank = (await p.c.get('/api/rankings/players')).json<PlayerRankingResponse>();
  assert.equal(rank.me?.villages, 2);
  assert.equal(rank.me?.points, sum);
  assert.ok(sum > villagePoints(createPlayerVillage(clock.now())), 'two villages are worth more than one');
  assert.equal(villagesOf(app, bob).length, 1);
  await app.close();
});

test('everything per village is owner-only: another player cannot build, train, ship or send from my second village', async () => {
  const { app, clock } = await makeApp();
  const alice = await newPlayer(app, 'alice');
  const bob = await newPlayer(app, 'bob');
  const second = addVillage(app, clock, alice, homeOf(app, alice).x + 10, homeOf(app, alice).y);
  errorOf(await bob.c.post(`/api/villages/${second}/build`, { building: 'lumber' }), 403, 'forbidden');
  errorOf(await bob.c.post(`/api/villages/${second}/train`, { unit: 'pikeman', count: 1 }), 403, 'forbidden');
  errorOf(await bob.c.post(`/api/villages/${second}/ship`, { x: 0, y: 0, resources: { wood: 1 } }), 403, 'forbidden');
  errorOf(await bob.c.post(`/api/villages/${second}/send`, { x: 0, y: 0, units: { pikeman: 1 }, mission: 'attack' }), 403, 'forbidden');
  assert.equal((await bob.c.state()).villages.length, 1);
  await app.close();
});
