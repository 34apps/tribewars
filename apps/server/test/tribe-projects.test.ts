// Tribe projects (GAME_DESIGN 18.5): Tribe Store, store village, funding shipments, projects, Roads / Watchtower / Wards, and the raid
// twist. Everything is set up straight in the database and the test clock jumps; nothing waits on real time.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PROJECT_DAILY_CAP_PER_MEMBER,
  ROADS_SPEED_BONUS,
  TRIBE_STORE_CAP,
  WARD_DEFENCE_BONUS,
  applyRoads,
  emptyResources,
  generateSites,
  projectBuildMs,
  projectCost,
  shipmentTravelMs,
  travelTimeMs,
  type MapResponse,
  type MovementDto,
  type MyTribeResponse,
  type Resources,
  type SendResponse,
  type SendShipmentResponse,
  type TribeAlertsResponse,
  type TribeDto,
  type TribeProjectId,
  type TribeProjectsResponse,
  type Units,
} from '@clanfire/engine';
import { battleOf } from './helpers.ts';
import { errorOf, HOUR, ok } from './helpers.ts';
import { count, setBuilding } from './tribe-helpers.ts';
import { runTo } from './village-helpers.ts';
import { giveTroops, latestReport, movementsOf, sendOk, units, village, world, type App, type P } from './warfare-helpers.ts';

const DAY = 24 * HOUR;
type W = Awaited<ReturnType<typeof world>>;

const res = (n: number): Resources => ({ wood: n, food: n, iron: n, gold: n });

/** Make every account older than PROJECT_MIN_ACCOUNT_DAYS. */
const age = (w: W): void => w.clock.advance(4 * DAY);

function tribeIdOf(app: App, p: P): number {
  const m = app.ctx.store.tribes.membership(p.id);
  assert.ok(m);
  return m.tribeId;
}

/** Put exact stock (and a Market) into a player's village. */
function setStock(app: App, p: P, r: Partial<Resources>): void {
  const store = app.ctx.store;
  const v = store.villagesOfPlayer(p.id)[0];
  assert.ok(v);
  Object.assign(v.state.resources, r);
  if (v.state.buildings.market < 1) v.state.buildings.market = 1;
  store.saveVillage(v.id, v.state, v.points);
}

/** Set the store's contents / levels straight in the database. */
function setStore(app: App, tribeId: number, r: Resources): void {
  app.ctx.store.projects.ensure(tribeId);
  app.ctx.store.projects.setResources(tribeId, r);
}
const setLevel = (app: App, tribeId: number, project: TribeProjectId, level: number): void => {
  app.ctx.store.projects.ensure(tribeId);
  app.ctx.store.projects.setLevel(tribeId, project, level);
};
const storeOf = (app: App, tribeId: number): Resources => app.ctx.store.projects.ensure(tribeId).resources;

const projectsOf = async (p: P): Promise<TribeProjectsResponse> => {
  const r = await p.c.get('/api/tribe/projects');
  ok(r);
  return r.json<TribeProjectsResponse>();
};

async function pickStore(leader: P, target: P): Promise<TribeProjectsResponse> {
  const v = await village(target);
  const r = await leader.c.post('/api/tribe/projects/store-village', { villageId: v.id });
  ok(r);
  return r.json<TribeProjectsResponse>();
}

async function shipToStore(from: P, to: { x: number; y: number }, r: Partial<Resources>, toTribeStore = true) {
  const home = await village(from);
  return from.c.post(`/api/villages/${home.id}/ship`, { x: to.x, y: to.y, resources: r, toTribeStore });
}

/** A world where ALPHA's store village is amy's, everybody is old enough and alice has stock to give. */
async function funded() {
  const w = await world();
  age(w);
  await pickStore(w.alice, w.amy);
  setStock(w.app, w.alice, { wood: 5000, food: 5000, iron: 5000, gold: 5000 });
  const to = await village(w.amy);
  return { ...w, to, tribeId: tribeIdOf(w.app, w.alice) };
}

test('GET /api/tribe/projects: only for members; another tribe never sees yours (IDOR)', async () => {
  const w = await world();
  errorOf(await w.lou.c.get('/api/tribe/projects'), 409, 'not_in_tribe');
  setStore(w.app, tribeIdOf(w.app, w.alice), res(1234));
  const mine = await projectsOf(w.alice);
  assert.deepEqual(mine.store, res(1234));
  assert.equal(mine.storeCap, TRIBE_STORE_CAP);
  assert.equal(mine.canManage, true);
  assert.equal(mine.projects.length, 3);
  assert.deepEqual(mine.projects.find((p) => p.project === 'roads')?.nextCost, projectCost(1));
  assert.equal(mine.projects.find((p) => p.project === 'roads')?.nextBuildMs, projectBuildMs(1, w.app.ctx.settings));
  const theirs = await projectsOf(w.bob); // BRAVO sees BRAVO's own (empty) store
  assert.deepEqual(theirs.store, res(0));
  assert.deepEqual(theirs.ledger, []);
  const amy = await projectsOf(w.amy);
  assert.equal(amy.canManage, false);
  assert.deepEqual(amy.memberVillages, []);
  assert.equal(mine.memberVillages.length, 2);
  assert.equal((await w.alice.c.get('/api/tribe/projects?x=1')).statusCode, 400);
  assert.equal((await w.app.inject({ method: 'GET', url: '/api/tribe/projects', headers: { host: 'clanfire.test' } })).statusCode, 401);
});

test('store village: right needed, member village only, once a week, homeless waiver, input schema', async () => {
  const w = await world();
  const av = await village(w.amy);
  const bv = await village(w.bob);
  errorOf(await w.amy.c.post('/api/tribe/projects/store-village', { villageId: av.id }), 403, 'forbidden');
  errorOf(await w.lou.c.post('/api/tribe/projects/store-village', { villageId: av.id }), 409, 'not_in_tribe');
  errorOf(await w.alice.c.post('/api/tribe/projects/store-village', { villageId: bv.id }), 400, 'invalid_target');
  errorOf(await w.alice.c.post('/api/tribe/projects/store-village', { villageId: 999999 }), 400, 'invalid_target');
  const npc = [...w.app.ctx.store.abandonedVillageIds()][0];
  assert.ok(npc);
  errorOf(await w.alice.c.post('/api/tribe/projects/store-village', { villageId: npc }), 400, 'invalid_target');
  errorOf(await w.alice.c.post('/api/tribe/projects/store-village', { villageId: '5' }), 400, 'invalid_input');
  errorOf(await w.alice.c.post('/api/tribe/projects/store-village', { villageId: av.id, extra: 1 }), 400, 'invalid_input');
  errorOf(await w.alice.c.post('/api/tribe/projects/store-village', {}), 400, 'invalid_input');

  const set = await pickStore(w.alice, w.amy);
  assert.equal(set.storeVillage?.villageId, av.id);
  assert.ok(set.storeVillageChangeableAt !== null && set.storeVillageChangeableAt > w.clock.now());
  const own = await village(w.alice);
  errorOf(await w.alice.c.post('/api/tribe/projects/store-village', { villageId: own.id }), 409, 'requirements_not_met');
  errorOf(await w.alice.c.post('/api/tribe/projects/store-village', { villageId: av.id }), 400, 'invalid_target');
  w.clock.advance(7 * DAY + 1);
  const moved = await w.alice.c.post('/api/tribe/projects/store-village', { villageId: own.id });
  ok(moved);
  assert.equal(moved.json<TribeProjectsResponse>().storeVillage?.villageId, own.id);

  // The owner leaves the tribe: no home any more, and a new one can be set at once (cooldown waived).
  await pickStore(w.alice, w.amy).catch(() => {});
  const ev = (await w.alice.c.get('/api/tribe')).json<MyTribeResponse>().events.map((e) => e.text).join('\n');
  assert.match(ev, /store village/);
  w.clock.advance(7 * DAY + 1);
  await pickStore(w.alice, w.amy);
  ok(await w.amy.c.post('/api/tribe/leave'));
  assert.equal((await projectsOf(w.alice)).storeVillage, null);
  assert.equal((await projectsOf(w.alice)).storeVillageChangeableAt, null);
  ok(await w.alice.c.post('/api/tribe/projects/store-village', { villageId: own.id }));
  assert.equal((await projectsOf(w.alice)).storeVillage?.villageId, own.id);
});

test('funding shipment: credited to the store and the ledger on arrival, never to the village stock; report says so', async () => {
  const w = await funded();
  const before = (await village(w.amy)).state.resources;
  const r = await shipToStore(w.alice, w.to, { wood: 300, gold: 200 });
  ok(r, 201);
  const m = r.json<SendShipmentResponse>().movement;
  assert.equal(m.toTribeStore, true);
  assert.equal((await projectsOf(w.alice)).myDailyLeft, PROJECT_DAILY_CAP_PER_MEMBER - 500);
  assert.deepEqual(storeOf(w.app, w.tribeId), res(0), 'nothing credited before arrival');
  const incoming = (await movementsOf(w.amy))[0];
  assert.equal(incoming?.toTribeStore, true);

  runTo(w.app, w.clock, m.arriveAt);
  assert.deepEqual(storeOf(w.app, w.tribeId), { wood: 300, food: 0, iron: 0, gold: 200 });
  const after = (await village(w.amy)).state.resources;
  assert.ok(after.wood < before.wood + 250, 'the village stock did not get the wood');
  const view = await projectsOf(w.amy);
  assert.equal(view.ledger.length, 1);
  assert.equal(view.ledger[0]?.player.name, 'alice');
  assert.deepEqual(view.ledger[0]?.resources, { wood: 300, food: 0, iron: 0, gold: 200 });
  assert.equal(view.totals[0]?.total, 500);
  assert.equal(view.totals[0]?.last24h, 500);
  const rep = await latestReport(w.alice);
  assert.match(rep.title, /Tribe Store/);
  assert.equal(count(w.app, 'movements'), 0);
  assert.equal((await movementsOf(w.alice)).length, 0);
});

test('funding refusals: not a member, wrong target, young account, daily cap, store cap (road included)', async () => {
  const w = await funded();
  const bv = await village(w.bob);
  setStock(w.app, w.lou, { wood: 500 });
  errorOf(await shipToStore(w.lou, w.to, { wood: 10 }), 409, 'not_in_tribe');
  setStock(w.app, w.bob, { wood: 500 });
  setStock(w.app, w.alice, { wood: 5000, food: 5000, iron: 5000, gold: 5000 });
  errorOf(await shipToStore(w.alice, bv, { wood: 10 }), 400, 'invalid_target');
  errorOf(await shipToStore(w.bob, w.to, { wood: 10 }), 400, 'invalid_target'); // not their tribe's store: BRAVO has no store village
  const lv = await village(w.lou);
  errorOf(await shipToStore(w.alice, lv, { wood: 10 }), 400, 'invalid_target');
  // Daily cap: counted per member over 24 h, inside the send.
  w.app.ctx.store.projects.insertSend(990001, w.tribeId, w.alice.id, w.clock.now(), PROJECT_DAILY_CAP_PER_MEMBER - 15);
  errorOf(await shipToStore(w.alice, w.to, { wood: 16 }), 409, 'requirements_not_met');
  ok(await shipToStore(w.alice, w.to, { wood: 15 }), 201);
  errorOf(await shipToStore(w.alice, w.to, { wood: 1 }), 409, 'requirements_not_met');
  assert.equal((await projectsOf(w.alice)).myDailyLeft, 0);
  w.clock.advance(DAY + 1000); // the window rolls over
  assert.ok((await projectsOf(w.alice)).myDailyLeft > 0);
  // Store cap per resource, counting cargo already on the road.
  setStore(w.app, w.tribeId, { ...res(0), iron: TRIBE_STORE_CAP - 5 });
  errorOf(await shipToStore(w.alice, w.to, { iron: 6 }), 409, 'exceeds_storage');
  ok(await shipToStore(w.alice, w.to, { iron: 5 }), 201);
  errorOf(await shipToStore(w.alice, w.to, { iron: 1 }), 409, 'exceeds_storage');
  // Nothing was taken for the refused ones.
  assert.equal(count(w.app, 'movements', 'to_tribe_store = 1'), 1, 'only the iron shipment is still on the road; the 15 wood one arrived');
});

test('funding: a young account is refused', async () => {
  const w = await world();
  await pickStore(w.alice, w.amy);
  setStock(w.app, w.alice, { wood: 500 });
  const to = await village(w.amy);
  errorOf(await shipToStore(w.alice, to, { wood: 10 }), 403, 'forbidden');
  assert.ok((await projectsOf(w.alice)).myGiveFrom !== null);
  w.clock.advance(4 * DAY);
  assert.equal((await projectsOf(w.alice)).myGiveFrom, null);
  ok(await shipToStore(w.alice, to, { wood: 10 }), 201);
});

test('funding: a cancelled shipment frees the daily cap and the road', async () => {
  const w = await funded();
  const m = (await (await shipToStore(w.alice, w.to, { wood: 100 })).json<SendShipmentResponse>()).movement;
  assert.equal(count(w.app, 'tribe_store_sends'), 1);
  ok(await w.alice.c.post(`/api/movements/${m.id}/cancel`), 201);
  assert.equal(count(w.app, 'tribe_store_sends'), 0);
  assert.equal((await projectsOf(w.alice)).myDailyLeft, PROJECT_DAILY_CAP_PER_MEMBER);
});

test('arrival after the store moved away (no home) turns the cargo back home; nothing is credited', async () => {
  const w = await funded();
  setStock(w.app, w.alice, { wood: 600 });
  const r = (await (await shipToStore(w.alice, w.to, { wood: 400 })).json<SendShipmentResponse>()).movement;
  const woodAfterSend = (await village(w.alice)).state.resources.wood;
  ok(await w.amy.c.post('/api/tribe/leave')); // the store village's owner is gone: no home
  runTo(w.app, w.clock, r.arriveAt);
  assert.deepEqual(storeOf(w.app, w.tribeId), res(0));
  assert.equal((await projectsOf(w.alice)).ledger.length, 0);
  const back = (await movementsOf(w.alice)).find((m) => m.kind === 'return');
  assert.ok(back, 'the cargo walks home');
  assert.equal(back.loot?.wood, 400);
  assert.equal(count(w.app, 'tribe_store_sends'), 0);
  runTo(w.app, w.clock, back.arriveAt);
  assert.ok((await village(w.alice)).state.resources.wood >= woodAfterSend + 350, 'the wood is home again');
});

test('arrival over the store cap: what fits is credited, the excess turns back with the carriers', async () => {
  const w = await funded();
  const r = (await (await shipToStore(w.alice, w.to, { wood: 10 })).json<SendShipmentResponse>()).movement;
  setStore(w.app, w.tribeId, { ...res(0), wood: TRIBE_STORE_CAP - 3 }); // e.g. a project refund filled it meanwhile
  runTo(w.app, w.clock, r.arriveAt);
  assert.equal(storeOf(w.app, w.tribeId).wood, TRIBE_STORE_CAP);
  const back = (await movementsOf(w.alice)).find((m) => m.kind === 'return');
  assert.equal(back?.loot?.wood, 7);
  assert.equal((await projectsOf(w.alice)).ledger[0]?.resources.wood, 3);
});

test('projects: start, one at a time (two at once -> one wins), cancel refund, finish, max level, rights', async () => {
  const w = await world();
  const tribeId = tribeIdOf(w.app, w.alice);
  const speed = w.app.ctx.settings;
  errorOf(await w.alice.c.post('/api/tribe/projects/start', { project: 'roads' }), 409, 'not_enough_resources');
  setStore(w.app, tribeId, res(1_000_000));
  errorOf(await w.amy.c.post('/api/tribe/projects/start', { project: 'roads' }), 403, 'forbidden');
  errorOf(await w.lou.c.post('/api/tribe/projects/start', { project: 'roads' }), 409, 'not_in_tribe');
  errorOf(await w.alice.c.post('/api/tribe/projects/start', { project: 'banner' }), 400, 'invalid_input');
  errorOf(await w.alice.c.post('/api/tribe/projects/start', {}), 400, 'invalid_input');
  errorOf(await w.amy.c.post('/api/tribe/projects/cancel'), 403, 'forbidden');
  errorOf(await w.alice.c.post('/api/tribe/projects/cancel'), 404, 'not_found');

  const [a, b] = await Promise.all([
    w.alice.c.post('/api/tribe/projects/start', { project: 'roads' }),
    w.alice.c.post('/api/tribe/projects/start', { project: 'wards' }),
  ]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409]);
  assert.equal(count(w.app, 'tribe_project_runs'), 1);
  const running = (await projectsOf(w.alice)).running;
  assert.ok(running);
  assert.equal(running.level, 1);
  assert.equal(running.endsAt - running.startedAt, projectBuildMs(1, speed));
  assert.deepEqual(storeOf(w.app, tribeId), res(1_000_000 - 75_000), 'paid once');
  errorOf(await w.alice.c.post('/api/tribe/projects/start', { project: 'watchtower' }), 409, 'queue_full');

  // Cancel: 80 % back.
  const cancelled = await w.alice.c.post('/api/tribe/projects/cancel');
  ok(cancelled);
  assert.equal(cancelled.json<TribeProjectsResponse>().running, null);
  assert.deepEqual(storeOf(w.app, tribeId), res(1_000_000 - 75_000 + 60_000));

  // Start again; the level arrives lazily when its time is up.
  const proj = running.project;
  ok(await w.alice.c.post('/api/tribe/projects/start', { project: proj }), 201);
  const run = (await projectsOf(w.alice)).running;
  assert.ok(run);
  w.clock.set(run.endsAt - 1);
  assert.equal((await projectsOf(w.alice)).projects.find((p) => p.project === proj)?.level, 0);
  w.clock.set(run.endsAt);
  const done = await projectsOf(w.amy);
  assert.equal(done.running, null);
  assert.equal(done.projects.find((p) => p.project === proj)?.level, 1);
  const level2 = done.projects.find((p) => p.project === proj);
  assert.deepEqual(level2?.nextCost, projectCost(2));
  const text = (await w.amy.c.get('/api/tribe')).json<MyTribeResponse>().events.map((e) => e.text).join('\n');
  assert.match(text, /started/);
  assert.match(text, /cancelled/);
  assert.match(text, /finished/);
  assert.equal((await w.alice.c.get('/api/tribe')).json<MyTribeResponse>().tribe?.projectLevels?.[proj], 1);
  assert.equal((await w.bob.c.get(`/api/tribes/${tribeId}`)).json<TribeDto>().projectLevels, undefined, 'other tribes do not see levels');

  // Level 3 is the last.
  setLevel(w.app, tribeId, 'watchtower', 3);
  errorOf(await w.alice.c.post('/api/tribe/projects/start', { project: 'watchtower' }), 409, 'max_level');
});

test('projects: a leader may grant the right; refund is clamped to the cap; the store never goes negative', async () => {
  const w = await world();
  const tribeId = tribeIdOf(w.app, w.alice);
  const g = await w.alice.c.put(`/api/tribe/members/${w.amy.id}/permissions`, { grants: ['projects'] });
  ok(g);
  setStore(w.app, tribeId, res(projectCost(1).wood)); // exactly the price
  ok(await w.amy.c.post('/api/tribe/projects/start', { project: 'roads' }), 201);
  assert.deepEqual(storeOf(w.app, tribeId), res(0));
  errorOf(await w.alice.c.post('/api/tribe/projects/start', { project: 'wards' }), 409, 'queue_full');
  setStore(w.app, tribeId, res(TRIBE_STORE_CAP - 10));
  ok(await w.amy.c.post('/api/tribe/projects/cancel'));
  assert.deepEqual(storeOf(w.app, tribeId), res(TRIBE_STORE_CAP));
  setStore(w.app, tribeId, res(projectCost(1).wood - 1)); // one short
  errorOf(await w.alice.c.post('/api/tribe/projects/start', { project: 'roads' }), 409, 'not_enough_resources');
  assert.deepEqual(storeOf(w.app, tribeId), res(projectCost(1).wood - 1));
});

test('the map marks the store village for everybody, never the amounts; a village that left the tribe is not marked', async () => {
  const w = await funded();
  setStore(w.app, w.tribeId, res(777));
  const s = w.app.ctx.settings;
  const span = s.radius * 2 + 1;
  const mapFor = async (p: P) => (await p.c.get(`/api/map?x=${-s.radius}&y=${-s.radius}&w=${span}&h=${span}`)).json<MapResponse>();
  const m = await mapFor(w.lou);
  const marked = m.villages.filter((v) => v.tribeStore);
  assert.equal(marked.length, 1);
  assert.equal(marked[0]?.ownerName, 'amy');
  assert.ok(!JSON.stringify(m).includes('777'));
  ok(await w.amy.c.post('/api/tribe/leave'));
  assert.equal((await mapFor(w.lou)).villages.filter((v) => v.tribeStore).length, 0);
});

test('disbanding the tribe removes the store, runs, ledger and bookkeeping', async () => {
  const w = await funded();
  setStore(w.app, w.tribeId, res(200_000));
  ok(await w.alice.c.post('/api/tribe/projects/start', { project: 'roads' }), 201);
  const r = await shipToStore(w.alice, w.to, { wood: 5 });
  ok(r, 201);
  w.app.ctx.store.projects.insertLedger(w.tribeId, w.alice.id, 'alice', res(1), w.clock.now());
  ok(await w.amy.c.post('/api/tribe/leave'));
  ok(await w.alice.c.post('/api/tribe/disband'));
  for (const t of ['tribe_stores', 'tribe_project_runs', 'tribe_store_ledger', 'tribe_store_sends']) assert.equal(count(w.app, t, 'tribe_id = ?', w.tribeId), 0, t);
});

// ---- raids -------------------------------------------------------------------------------------------

/** Bob attacks amy's village with `n` raiders and the result is run. Returns the attacker's report. */
async function raidAmy(w: W, n: number) {
  giveTroops(w.app, w.bob, { raider: n });
  const { movement } = await sendOk(w.bob, w.amy, 'attack', { raider: n });
  runTo(w.app, w.clock, movement.arriveAt);
  return battleOf(await latestReport(w.bob));
}

function setAmy(w: W, stock: Resources, vault = 0, troops: Partial<Units> = {}): void {
  const store = w.app.ctx.store;
  const v = store.villagesOfPlayer(w.amy.id)[0];
  assert.ok(v);
  v.state.resources = { ...stock };
  v.state.buildings.vault = vault;
  v.state.troops = units(troops);
  store.saveVillage(v.id, v.state, v.points);
}

test('raid: a won attack on the store village also takes a fifth of the store; split, report, event log, Vault shelters only the stock', async () => {
  const w = await funded();
  setStore(w.app, w.tribeId, res(2000));
  setAmy(w, res(500), 0);
  const rep = await raidAmy(w, 400); // plenty of carry (400 x 30)
  assert.equal(rep.attackerWon, true);
  assert.equal(rep.loot.gold, 900, 'village 500 + a fifth of 2000 = 400 (gold does not grow while they march)');
  for (const r of ['wood', 'food', 'iron'] as const) assert.ok(rep.loot[r] >= 900, r);
  assert.deepEqual(rep.lootFromTribeStore, res(400));
  assert.deepEqual(storeOf(w.app, w.tribeId), res(1600));
  const stock = (await village(w.amy)).state.resources;
  assert.ok(stock.wood < 20, 'the village lost its 500');
  const text = (await w.alice.c.get('/api/tribe')).json<MyTribeResponse>().events.map((e) => e.text).join('\n');
  assert.match(text, /Tribe Store was raided by bob/);
  // The defender (amy) sees the same field.
  assert.deepEqual(battleOf(await latestReport(w.amy)).lootFromTribeStore, res(400));

  // Vault: hides the village stock, not the store.
  w.clock.advance(HOUR);
  setStore(w.app, w.tribeId, res(2000));
  setAmy(w, res(100), 10);
  const rep2 = await raidAmy(w, 400);
  assert.deepEqual(rep2.lootFromTribeStore, res(400));
  assert.equal(rep2.loot.gold, 400, 'the Vault kept the 100 of the village stock');
  assert.ok((await village(w.amy)).state.resources.gold >= 100, 'the sheltered gold is still there');
  assert.deepEqual(storeOf(w.app, w.tribeId), res(1600));
});

test('raid: carry limit splits in proportion; a lost attack or a non-store village takes nothing from the store', async () => {
  const w = await funded();
  setStore(w.app, w.tribeId, res(1000)); // pool 200 per resource
  setAmy(w, res(200), 0);
  const rep = await raidAmy(w, 20); // carry 600: 150 per resource, half and half
  assert.equal(rep.attackerWon, true);
  assert.equal(rep.loot.gold, 150);
  assert.equal(rep.lootFromTribeStore?.gold, 75, 'gold: 200 offered by each side, so half and half');
  for (const r of ['wood', 'food', 'iron', 'gold'] as const) {
    const fromStore: number = rep.lootFromTribeStore?.[r] ?? 0;
    assert.ok(fromStore >= 0 && fromStore <= 200 && fromStore <= rep.loot[r], r);
    assert.equal(storeOf(w.app, w.tribeId)[r], 1000 - fromStore, `${r}: the store lost exactly what the report says`);
  }
  assert.ok(Object.values(storeOf(w.app, w.tribeId)).every((n) => n >= 0));

  // Lost attack: the store is untouched.
  w.clock.advance(HOUR);
  setStore(w.app, w.tribeId, res(1000));
  setAmy(w, res(200), 0, { guard: 500 });
  const lost = await raidAmy(w, 20);
  assert.equal(lost.attackerWon, false);
  assert.deepEqual(storeOf(w.app, w.tribeId), res(1000));

  // Not the store village any more (the owner left the tribe): only the village stock is lootable.
  w.clock.advance(HOUR);
  ok(await w.amy.c.post('/api/tribe/leave'));
  setAmy(w, res(200), 0);
  const plain = await raidAmy(w, 400);
  assert.equal(plain.lootFromTribeStore, undefined);
  assert.deepEqual(storeOf(w.app, w.tribeId), res(1000));
});

// ---- Watchtower -------------------------------------------------------------------------------------

async function alertsFor(w: W, level: number, army: Partial<Units>) {
  const tribeId = tribeIdOf(w.app, w.alice);
  setLevel(w.app, tribeId, 'watchtower', level);
  giveTroops(w.app, w.bob, army);
  await sendOk(w.bob, w.amy, 'attack', army);
  const r = await w.alice.c.get('/api/tribe/alerts');
  ok(r);
  return r.json<TribeAlertsResponse>();
}

test('watchtower: nothing at level 0, a band at 1, the slowest unit at 2, an about-number at 3', async () => {
  const army = { raider: 150, logram: 10 }; // population 150 + 30 = 180 (small); the Log Ram is the slowest
  for (const [level, band, slowest, about] of [
    [0, undefined, undefined, undefined],
    [1, 'small', undefined, undefined],
    [2, 'small', 'logram', undefined],
    [3, 'small', 'logram', 200],
  ] as const) {
    const w = await world();
    const a = await alertsFor(w, level, army);
    assert.equal(a.watchtowerLevel, level);
    assert.equal(a.alerts.length, 1);
    const alert = a.alerts[0];
    assert.equal(alert?.sizeBand, band, `level ${level}`);
    assert.equal(alert?.slowestUnit, slowest, `level ${level}`);
    assert.equal(alert?.sizeAbout, about, `level ${level}`);
    assert.ok(!JSON.stringify(alert).includes('units'), 'never the unit list');
  }
  const big = await alertsFor(await world(), 1, { raider: 1500 });
  assert.equal(big.alerts[0]?.sizeBand, 'large');
});

test('watchtower: Chieftains are never counted or named', async () => {
  const run = async (army: Partial<Units>) => {
    const w = await world();
    w.app.ctx.game.strikePlayers = true;
    return (await alertsFor(w, 3, army)).alerts[0];
  };
  const plain = await run({ raider: 150 });
  const withChief = await run({ raider: 150, chieftain: 1 });
  const shown = (x: typeof plain) => ({ band: x?.sizeBand, slowest: x?.slowestUnit, about: x?.sizeAbout });
  assert.deepEqual(shown(withChief), shown(plain));
  assert.equal(withChief?.sizeAbout, 200);
  assert.ok(!JSON.stringify(withChief).includes('chieftain'));
  const only = await run({ chieftain: 1 });
  assert.equal(only?.sizeBand, 'small');
  assert.equal(only?.slowestUnit, undefined);
  assert.equal(only?.sizeAbout, undefined);
});

// ---- Roads ------------------------------------------------------------------------------------------

const duration = (m: MovementDto): number => m.arriveAt - m.departAt;

test('roads: support and shipments between members are faster, returns too; attacks and non-members are not', async () => {
  const w = await world();
  const tribeId = tribeIdOf(w.app, w.alice);
  const s = w.app.ctx.settings;
  const av = await village(w.alice);
  const mv = await village(w.amy);
  const bv = await village(w.bob);
  const lv = await village(w.lou);
  giveTroops(w.app, w.alice, { pikeman: 40, raider: 20 });
  setStock(w.app, w.alice, { wood: 3000, food: 3000, iron: 3000, gold: 3000 });
  const flat = (to: { x: number; y: number }, army: Partial<Units>) => travelTimeMs(av, to, units(army), s, []);

  for (const level of [0, 1, 3]) {
    setLevel(w.app, tribeId, 'roads', level);
    const bonus = level === 0 ? 0 : ROADS_SPEED_BONUS[level - 1];
    assert.ok(bonus !== undefined);
    const sup = await sendOk(w.alice, w.amy, 'support', { pikeman: 5 });
    assert.equal(duration(sup.movement), applyRoads(flat(mv, { pikeman: 5 }), level), `support at roads ${level}`);
    if (level > 0) assert.equal(duration(sup.movement), Math.ceil(flat(mv, { pikeman: 5 }) * (1 - bonus)));
    const ship = await shipToStore(w.alice, mv, { wood: 10 }, false);
    ok(ship, 201);
    assert.equal(duration(ship.json<SendShipmentResponse>().movement), applyRoads(shipmentTravelMs(av, mv, s), level), `shipment at roads ${level}`);
    // Not between non-members: a shipment to a stranger and an attack on a rival are unchanged.
    const toLou = await shipToStore(w.alice, lv, { wood: 10 }, false);
    ok(toLou, 201);
    assert.equal(duration(toLou.json<SendShipmentResponse>().movement), shipmentTravelMs(av, lv, s));
    const atk = await sendOk(w.alice, w.bob, 'attack', { raider: 5 });
    assert.equal(duration(atk.movement), flat(bv, { raider: 5 }), `attack at roads ${level}`);
    w.clock.advance(HOUR);
    w.app.ctx.game.processDue(w.clock.now());
    w.clock.advance(5 * HOUR);
    w.app.ctx.game.processDue(w.clock.now());
  }

  // The way home of stationed support is faster too (recall).
  const entry = (await w.amy.c.state()).stationed.here.find((x) => x.home.ownerName === 'alice');
  assert.ok(entry, 'support is stationed at amy');
  const back = await w.alice.c.post(`/api/stationed/${entry.id}/recall`, {});
  ok(back, 201);
  const rm = back.json<{ movement: MovementDto }>().movement;
  assert.equal(duration(rm), applyRoads(travelTimeMs(mv, av, units({ pikeman: 15 }), s, []), 3));
});

// ---- Wards ------------------------------------------------------------------------------------------

test('wards: the holding tribe defends a site with a bonus; villages get none', async () => {
  const defence = async (level: number): Promise<{ site: number; village: number }> => {
    const w = await world();
    const site = generateSites(w.app.ctx.settings.seed, w.app.ctx.settings.radius)[0];
    assert.ok(site);
    const tribeId = tribeIdOf(w.app, w.alice);
    setLevel(w.app, tribeId, 'wards', level);
    const store = w.app.ctx.store;
    store.sites.setHolder(1, tribeId);
    store.sites.addGarrison(1, w.amy.id, store.villagesOfPlayer(w.amy.id)[0]!.id, units({ pikeman: 100 }), w.clock.now(), null);
    store.sites.setCalmUntil(1, 0);
    giveTroops(w.app, w.bob, { raider: 10 });
    const m = await sendOk(w.bob, { x: site.x, y: site.y }, 'attack', { raider: 10 });
    runTo(w.app, w.clock, m.movement.arriveAt);
    const siteDefence = battleOf(await latestReport(w.bob)).defensePower;
    setAmy(w, res(0), 0, { pikeman: 100 });
    giveTroops(w.app, w.bob, { raider: 10 });
    const v = await sendOk(w.bob, w.amy, 'attack', { raider: 10 });
    runTo(w.app, w.clock, v.movement.arriveAt);
    return { site: siteDefence, village: battleOf(await latestReport(w.bob)).defensePower };
  };
  const none = await defence(0);
  const warded = await defence(2);
  const bonus = WARD_DEFENCE_BONUS[1];
  assert.ok(bonus !== undefined);
  assert.ok(Math.abs(warded.site / none.site - (1 + bonus)) < 1e-9, `site defence ${none.site} -> ${warded.site}`);
  assert.equal(warded.village, none.village, 'no bonus at villages');
});

test('security: the store never trusts the client: toTribeStore must be a boolean and is ignored for plain shipments', async () => {
  const w = await funded();
  const home = await village(w.alice);
  errorOf(await w.alice.c.post(`/api/villages/${home.id}/ship`, { x: w.to.x, y: w.to.y, resources: { wood: 5 }, toTribeStore: 'yes' }), 400, 'invalid_input');
  const plain = await shipToStore(w.alice, w.to, { wood: 5 }, false);
  ok(plain, 201);
  assert.equal(plain.json<SendShipmentResponse>().movement.toTribeStore, undefined);
  assert.equal(count(w.app, 'tribe_store_sends'), 0);
  void setBuilding;
  void emptyResources;
});
