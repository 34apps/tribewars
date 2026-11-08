// First steps card: steps become done from real actions, stay done, claim into an owned village (capped, once, atomic), hide flag,
// ownership, input checks, sign-in and the ended world.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIRST_STEPS, storageCap, type FirstStepClaimResponse, type FirstStepId, type FirstStepsDto, type GameStateResponse } from '@clanfire/engine';
import { endWorld } from '../src/domination-service.ts';
import { Client, HOUR, MINUTE, errorOf, makeApp, ok, trainRaiders, weakestAbandoned } from './helpers.ts';
import { found, join, newPlayer, setBuilding, setHall } from './tribe-helpers.ts';
import { giveTroops, reports, sendOk, unprotect } from './warfare-helpers.ts';

const steps = async (c: Client): Promise<FirstStepsDto> => (await c.state()).firstSteps;
const doneIds = async (c: Client): Promise<string[]> => (await steps(c)).steps.filter((s) => s.done).map((s) => s.id);
const claim = (c: Client, id: string, villageId: number) => c.post(`/api/first-steps/${id}/claim`, { villageId });

async function one() {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  const vid = (await p.c.village()).id;
  return { app, clock, p, vid };
}

test('a new player sees all eight steps, none done, in the approved order with the approved rewards', async () => {
  const { p } = await one();
  const s = await steps(p.c);
  assert.deepEqual(s.steps.map((x) => x.id), ['lumber2', 'farm2', 'hall2', 'barracks2', 'raiders5', 'raid', 'report', 'tribe']);
  assert.ok(s.steps.every((x) => !x.done && !x.claimed));
  assert.deepEqual(s.steps.map((x) => x.reward), FIRST_STEPS.map((x) => x.reward));
  assert.equal(s.hidden, false);
  assert.equal(s.allClaimed, false);
});

test('a started upgrade to level 2 counts at once; levels reached before the card existed count too', async () => {
  const { app, p, vid } = await one();
  ok(await p.c.post(`/api/villages/${vid}/build`, { building: 'lumber' }));
  assert.deepEqual(await doneIds(p.c), ['lumber2']); // still under construction
  setBuilding(app, p.id, 'farm', 3); // an "old" player
  assert.deepEqual((await doneIds(p.c)).sort(), ['farm2', 'lumber2']);
});

test('hall, barracks and raiders (counted while still training) become done through the real build and train routes', async () => {
  const { clock, p } = await one();
  const vid = await trainRaiders(p.c, clock, 5);
  const done = await doneIds(p.c);
  for (const id of ['hall2', 'barracks2', 'raiders5']) assert.ok(done.includes(id), id);
  assert.ok(vid > 0);
});

test('raiders in training and away count toward five; the step is sticky when they are lost', async () => {
  const { app, p, vid } = await one();
  setBuilding(app, p.id, 'barracks', 3);
  setBuilding(app, p.id, 'storehouse', 6);
  const v = app.ctx.store.getVillage(vid)!;
  v.state.resources = { wood: 5000, food: 5000, iron: 5000, gold: 0 };
  app.ctx.store.saveVillage(v.id, v.state, v.points);
  assert.ok(!(await doneIds(p.c)).includes('raiders5'));
  ok(await p.c.post(`/api/villages/${vid}/train`, { unit: 'raider', count: 5 }));
  assert.ok((await doneIds(p.c)).includes('raiders5')); // all five still in the queue
  // They all die (queue and troops wiped): the step stays done.
  const w = app.ctx.store.getVillage(vid)!;
  w.state.trainQueues = { barracks: [], stables: [], bannerhall: [] };
  w.state.troops.raider = 0;
  app.ctx.store.saveVillage(w.id, w.state, w.points);
  assert.ok((await doneIds(p.c)).includes('raiders5'));
  assert.equal((await p.c.village()).state.troops.raider, 0);
});

test('raid: an attack on an abandoned village counts; an attack on a player does not', async () => {
  const { app, clock } = await makeApp();
  const alice = await newPlayer(app, 'alice');
  const bob = await newPlayer(app, 'bob');
  unprotect(app, alice, bob);
  giveTroops(app, alice, { raider: 10 });
  const bobHome = await bob.c.village();
  await sendOk(alice, { x: bobHome.x, y: bobHome.y }, 'attack', { raider: 2 });
  assert.ok(!(await doneIds(alice.c)).includes('raid'));
  const target = await weakestAbandoned(alice.c, 12);
  await sendOk(alice, { x: target.x, y: target.y }, 'attack', { raider: 2 });
  assert.ok((await doneIds(alice.c)).includes('raid'));
  clock.advance(5 * HOUR);
  assert.ok((await doneIds(alice.c)).includes('raid')); // still there after the troops are home
});

test('report: opening a battle report completes the step; having one in the list does not', async () => {
  const { app, clock } = await makeApp();
  const alice = await newPlayer(app, 'alice');
  unprotect(app, alice);
  giveTroops(app, alice, { raider: 10 });
  const target = await weakestAbandoned(alice.c, 12);
  await sendOk(alice, { x: target.x, y: target.y }, 'attack', { raider: 5 });
  clock.advance(3 * HOUR);
  const list = await reports(alice);
  assert.ok(list.length > 0);
  assert.ok(!(await doneIds(alice.c)).includes('report'));
  ok(await alice.c.get(`/api/reports/${list[0]!.id}`));
  assert.ok((await doneIds(alice.c)).includes('report'));
});

test('tribe: founding and joining both complete the step', async () => {
  const { app } = await makeApp();
  const lead = await newPlayer(app, 'lead');
  const mate = await newPlayer(app, 'mate');
  setHall(app, lead.id, 3);
  assert.ok(!(await doneIds(lead.c)).includes('tribe'));
  const t = await found(lead, 'Alpha Pack', 'ALPHA', 'open');
  assert.ok((await doneIds(lead.c)).includes('tribe'));
  assert.ok(!(await doneIds(mate.c)).includes('tribe'));
  await join(mate, t.tribe!.id);
  assert.ok((await doneIds(mate.c)).includes('tribe'));
});

test('claim: reward lands in the named village, once, and shows as claimed', async () => {
  const { app, p, vid } = await one();
  ok(await p.c.post(`/api/villages/${vid}/build`, { building: 'lumber' }));
  const v0 = app.ctx.store.getVillage(vid)!;
  v0.state.resources = { wood: 100, food: 100, iron: 100, gold: 0 };
  app.ctx.store.saveVillage(vid, v0.state, v0.points);
  const res = await claim(p.c, 'lumber2', vid);
  ok(res);
  const body = res.json<FirstStepClaimResponse>();
  assert.deepEqual(body.added, { wood: 150, food: 80, iron: 80, gold: 0 });
  assert.equal(body.village.id, vid);
  assert.ok(body.village.state.resources.wood >= 250);
  assert.ok(body.village.state.resources.food >= 180);
  const step = body.firstSteps.steps.find((s) => s.id === 'lumber2')!;
  assert.deepEqual([step.done, step.claimed], [true, true]);
  errorOf(await claim(p.c, 'lumber2', vid), 409, 'step_claimed');
  const after = (await p.c.village()).state.resources;
  assert.ok(after.wood < 250 + 200, 'paid once'); // 100 + 150 + a little production, never 400
});

test('claim: the reward is capped at the storehouse and the overflow is lost', async () => {
  const { app, p, vid } = await one();
  setBuilding(app, p.id, 'lumber', 2);
  const v = app.ctx.store.getVillage(vid)!;
  const cap = storageCap(v.state);
  v.state.resources = { wood: cap - 10, food: cap, iron: cap - 80, gold: 0 };
  app.ctx.store.saveVillage(vid, v.state, v.points);
  const res = await claim(p.c, 'lumber2', vid);
  ok(res);
  const body = res.json<FirstStepClaimResponse>();
  assert.ok(body.added.wood <= 10 && body.added.wood >= 0);
  assert.equal(body.added.food, 0);
  assert.ok(body.added.iron <= 80);
  for (const r of ['wood', 'food', 'iron'] as const) assert.ok(body.village.state.resources[r] <= cap + 1e-6, r);
});

test('claim: a step that is not done is refused (409 step_not_done) and nothing is paid', async () => {
  const { app, p, vid } = await one();
  const before = app.ctx.store.getVillage(vid)!.state.resources;
  errorOf(await claim(p.c, 'raid', vid), 409, 'step_not_done');
  errorOf(await claim(p.c, 'tribe', vid), 409, 'step_not_done');
  assert.deepEqual(app.ctx.store.getVillage(vid)!.state.resources, before);
});

test('claim: unknown ids, bad bodies and extra fields are 400; a missing village is 404', async () => {
  const { p, vid } = await one();
  errorOf(await claim(p.c, 'nope', vid), 400, 'invalid_input');
  errorOf(await p.c.post('/api/first-steps/lumber2/claim', {}), 400, 'invalid_input');
  errorOf(await p.c.post('/api/first-steps/lumber2/claim', { villageId: '1' }), 400, 'invalid_input');
  errorOf(await p.c.post('/api/first-steps/lumber2/claim', { villageId: 1.5 }), 400, 'invalid_input');
  errorOf(await p.c.post('/api/first-steps/lumber2/claim', { villageId: vid, extra: 1 }), 400, 'invalid_input');
  errorOf(await claim(p.c, 'lumber2', 999_999), 404, 'not_found');
});

test('claim: into someone else\'s village is 403 and the step stays unclaimed (IDOR)', async () => {
  const { app } = await makeApp();
  const alice = await newPlayer(app, 'alice');
  const bob = await newPlayer(app, 'bob');
  setBuilding(app, alice.id, 'lumber', 2);
  const bobVillage = (await bob.c.village()).id;
  const bobBefore = app.ctx.store.getVillage(bobVillage)!.state.resources;
  errorOf(await claim(alice.c, 'lumber2', bobVillage), 403, 'forbidden');
  assert.deepEqual(app.ctx.store.getVillage(bobVillage)!.state.resources, bobBefore);
  const s = (await steps(alice.c)).steps.find((x) => x.id === 'lumber2')!;
  assert.deepEqual([s.done, s.claimed], [true, false]);
  ok(await claim(alice.c, 'lumber2', (await alice.c.village()).id)); // the right village still works
});

test('claim: two requests at once pay exactly once', async () => {
  const { app, p, vid } = await one();
  setBuilding(app, p.id, 'lumber', 2);
  const r = await Promise.all([claim(p.c, 'lumber2', vid), claim(p.c, 'lumber2', vid), claim(p.c, 'lumber2', vid)]);
  assert.deepEqual(r.map((x) => x.statusCode).sort(), [200, 409, 409]);
});

test('unauthenticated calls are 401', async () => {
  const { app } = await makeApp();
  const anon = new Client(app, '10.5.5.5');
  errorOf(await claim(anon, 'lumber2', 1), 401, 'unauthorized');
  errorOf(await anon.post('/api/first-steps/hidden', { hidden: true }), 401, 'unauthorized');
});

test('hide flag: round trip, per player, strict body', async () => {
  const { app, p } = await one();
  const other = await newPlayer(app, 'bob');
  const res = await p.c.post('/api/first-steps/hidden', { hidden: true });
  ok(res);
  assert.equal(res.json<FirstStepsDto>().hidden, true);
  assert.equal((await steps(p.c)).hidden, true);
  assert.equal((await steps(other.c)).hidden, false);
  ok(await p.c.post('/api/first-steps/hidden', { hidden: false }));
  assert.equal((await steps(p.c)).hidden, false);
  for (const body of [{}, { hidden: 'yes' }, { hidden: 1 }, { hidden: true, x: 1 }]) errorOf(await p.c.post('/api/first-steps/hidden', body), 400, 'invalid_input');
});

test('allClaimed turns true once every step is claimed (hidden is unaffected)', async () => {
  const { app, clock, p, vid } = await one();
  for (const s of FIRST_STEPS) app.ctx.store.firstSteps.markDone(p.id, s.id as FirstStepId, clock.now());
  for (let i = 0; i < FIRST_STEPS.length; i++) {
    const s = FIRST_STEPS[i]!;
    const res = await claim(p.c, s.id, vid);
    ok(res);
    assert.equal(res.json<FirstStepClaimResponse>().firstSteps.allClaimed, i === FIRST_STEPS.length - 1);
    if (i === 3) clock.advance(MINUTE); // stay inside the per-minute limit of the route
  }
  const s = await steps(p.c);
  assert.equal(s.allClaimed, true);
  assert.equal(s.hidden, false);
});

test('an ended world refuses claim and hide with 403 "This world has ended."; the card can still be read', async () => {
  const { app, clock, p, vid } = await one();
  setBuilding(app, p.id, 'lumber', 2);
  assert.equal(endWorld(app.ctx.store, { at: clock.now(), kind: 'manual', winner: null, reason: 'test', actorIp: 'cli' }), true);
  for (const res of [await claim(p.c, 'lumber2', vid), await p.c.post('/api/first-steps/hidden', { hidden: true })]) {
    errorOf(res, 403, 'forbidden');
    assert.equal(res.json<{ message: string }>().message, 'This world has ended.');
  }
  const st: GameStateResponse = await p.c.state();
  assert.ok(st.firstSteps.steps.find((x) => x.id === 'lumber2')!.done);
});
