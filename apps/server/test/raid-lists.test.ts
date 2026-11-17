// Raid lists, a paid extra: world switch + entitlement gate, CRUD and caps, input checks, ownership (404 everywhere), and "send all" going
// through the normal send (same movements and timing, every refusal reported per row, the per-account send limit charged per row).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EXTRA_RAID_LISTS,
  MAX_MARCHES_IN_FLIGHT,
  RAID_LIST_MAX_LISTS,
  RAID_LIST_MAX_ROWS,
  RAID_LIST_SEND_CAP,
  emptyUnits,
  travelTimeMs,
  type MapResponse,
  type RaidListDto,
  type RaidListResponse,
  type RaidListSendResponse,
  type RaidListsResponse,
} from '@clanfire/engine';
import { endWorld } from '../src/domination-service.ts';
import { Client, MINUTE, errorOf, makeApp, ok } from './helpers.ts';
import { newPlayer } from './tribe-helpers.ts';
import { giveTroops, sendOk, unprotect, type App, type P } from './warfare-helpers.ts';

const ON = { npc: { selfBuild: false }, features: { raidLists: true } };

interface Spot {
  id: number;
  x: number;
  y: number;
}

/** Abandoned villages of the test world, nearest to the origin first. */
async function abandoned(c: Client, radius: number): Promise<Spot[]> {
  const span = radius * 2 + 1;
  const res = await c.get(`/api/map?x=${-radius}&y=${-radius}&w=${span}&h=${span}`);
  ok(res);
  return res
    .json<MapResponse>()
    .villages.filter((v) => v.kind === 'abandoned')
    .map((v) => ({ id: v.id, x: v.x, y: v.y }))
    .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
}

const entitle = (app: App, ...ps: P[]): void => {
  for (const p of ps) app.ctx.store.setPremiumBit(p.id, EXTRA_RAID_LISTS, true);
};

/** World with the switch on, alice and bob (unprotected), alice entitled, a big map with many abandoned villages. */
async function setup(over: { entitleBob?: boolean; switchOn?: boolean } = {}) {
  const { app, clock } = await makeApp({ worldConfig: { npc: { selfBuild: false }, features: { raidLists: over.switchOn ?? true } }, world: { radius: 20, npcDensity: 0.1 } });
  const alice = await newPlayer(app, 'alice');
  const bob = await newPlayer(app, 'bob');
  unprotect(app, alice, bob);
  entitle(app, alice);
  if (over.entitleBob) entitle(app, bob);
  const spots = await abandoned(alice.c, 20);
  assert.ok(spots.length >= 40, 'enough abandoned villages');
  const home = await alice.c.village();
  return { app, clock, alice, bob, spots, home };
}

const lists = async (p: P): Promise<RaidListsResponse> => {
  const res = await p.c.get('/api/raid-lists');
  ok(res);
  return res.json<RaidListsResponse>();
};
const mkList = async (p: P, name = 'Farms'): Promise<RaidListDto> => {
  const res = await p.c.post('/api/raid-lists', { name });
  ok(res, 201);
  return res.json<RaidListResponse>().list;
};
const addRow = (p: P, listId: number, s: Spot, fromVillageId: number, u: object = { raider: 3 }) => p.c.post(`/api/raid-lists/${listId}/rows`, { x: s.x, y: s.y, fromVillageId, units: u });
const press = async (p: P, listId: number, body: object = {}): Promise<RaidListSendResponse> => {
  const res = await p.c.post(`/api/raid-lists/${listId}/send`, body);
  ok(res);
  return res.json<RaidListSendResponse>();
};

test('switch off: reads say so, every write and the send answer 403', async () => {
  const { app, alice, home, spots } = await setup({ switchOn: false });
  assert.deepEqual(await lists(alice), { enabled: false, entitled: true, limits: { lists: RAID_LIST_MAX_LISTS, rows: RAID_LIST_MAX_ROWS, sendCap: RAID_LIST_SEND_CAP }, lists: [] });
  for (const [url, body] of [
    ['/api/raid-lists', { name: 'x' }],
    ['/api/raid-lists/1', { name: 'x' }],
    ['/api/raid-lists/1/delete', {}],
    ['/api/raid-lists/1/rows', { x: spots[0]!.x, y: spots[0]!.y, fromVillageId: home.id, units: { raider: 1 } }],
    ['/api/raid-lists/1/rows/1', { units: { raider: 1 } }],
    ['/api/raid-lists/1/rows/1/delete', {}],
    ['/api/raid-lists/1/send', {}],
  ] as const) {
    const res = await alice.c.post(url, body);
    errorOf(res, 403, 'forbidden');
    assert.match(res.json<{ message: string }>().message, /not switched on/);
  }
  await app.close();
});

test('switch on but no extra: reads say entitled false with no lists, writes answer 403', async () => {
  const { app, bob } = await setup();
  const r = await lists(bob);
  assert.deepEqual([r.enabled, r.entitled, r.lists], [true, false, []]);
  const res = await bob.c.post('/api/raid-lists', { name: 'x' });
  errorOf(res, 403, 'forbidden');
  assert.match(res.json<{ message: string }>().message, /paid extra/);
  errorOf(await bob.c.post('/api/raid-lists/1/send', {}), 403, 'forbidden');
  // The extra is read on every request: switching it on at runtime works at once, switching it off hides the lists again (they are kept).
  entitle(app, bob);
  ok(await bob.c.post('/api/raid-lists', { name: 'now' }), 201);
  app.ctx.store.setPremiumBit(bob.id, EXTRA_RAID_LISTS, false);
  assert.deepEqual((await lists(bob)).lists, []);
  errorOf(await bob.c.post('/api/raid-lists', { name: 'again' }), 403, 'forbidden');
  entitle(app, bob);
  assert.equal((await lists(bob)).lists.length, 1);
  await app.close();
});

test('the premium bits are independent: switching the raid-list bit keeps the others', async () => {
  const { app, alice } = await setup();
  const store = app.ctx.store;
  store.setPremiumBit(alice.id, 4, true);
  store.setPremiumBit(alice.id, EXTRA_RAID_LISTS, false);
  assert.equal(store.getPlayer(alice.id)?.premium, 4);
  store.setPremiumBit(alice.id, EXTRA_RAID_LISTS, true);
  assert.equal(store.getPlayer(alice.id)?.premium, 5);
  await app.close();
});

test('signed out: 401 on every route', async () => {
  const { app } = await setup();
  const anon = new Client(app, '10.5.5.5');
  errorOf(await anon.get('/api/raid-lists'), 401, 'unauthorized');
  for (const url of ['/api/raid-lists', '/api/raid-lists/1', '/api/raid-lists/1/delete', '/api/raid-lists/1/rows', '/api/raid-lists/1/rows/1', '/api/raid-lists/1/rows/1/delete', '/api/raid-lists/1/send']) {
    errorOf(await anon.post(url, {}), 401, 'unauthorized');
  }
  await app.close();
});

test('create, rename, add / update / delete rows, delete the list; rows carry distance, travel time and the target', async () => {
  const { app, clock, alice, home, spots } = await setup();
  const list = await mkList(alice, '  Farms ');
  assert.equal(list.name, 'Farms');
  assert.deepEqual(list.rows, []);
  const renamed = await alice.c.post(`/api/raid-lists/${list.id}`, { name: 'Close farms' });
  ok(renamed);
  assert.equal(renamed.json<RaidListResponse>().list.name, 'Close farms');

  const s = spots[0]!;
  const added = await addRow(alice, list.id, s, home.id, { raider: 3, guard: 0, pikeman: 2 });
  ok(added, 201);
  const row = added.json<RaidListResponse>().list.rows[0]!;
  assert.deepEqual([row.villageId, row.x, row.y, row.abandoned, row.fromVillageId, row.last], [s.id, s.x, s.y, true, home.id, null]);
  assert.deepEqual(row.units, { pikeman: 2, raider: 3 });
  assert.equal(row.distance, Math.round(Math.hypot(s.x - home.x, s.y - home.y) * 10) / 10);
  const expectedMs = travelTimeMs(home, s, { ...emptyUnits(), raider: 3, pikeman: 2 }, app.ctx.settings);
  assert.equal(row.travelSeconds, Math.ceil(expectedMs / 1000));
  assert.equal(typeof row.name, 'string');

  const up = await alice.c.post(`/api/raid-lists/${list.id}/rows/${row.id}`, { units: { raider: 1 } });
  ok(up);
  const upRow = up.json<RaidListResponse>().list.rows[0]!;
  assert.deepEqual(upRow.units, { raider: 1 });
  assert.equal(upRow.fromVillageId, home.id);
  assert.ok(upRow.travelSeconds <= row.travelSeconds, 'raiders alone are not slower than with pikemen');

  assert.equal((await lists(alice)).lists[0]?.rows.length, 1);
  const second = await addRow(alice, list.id, spots[1]!, home.id);
  assert.equal(second.json<RaidListResponse>().list.rows.length, 2);
  const del = await alice.c.post(`/api/raid-lists/${list.id}/rows/${row.id}/delete`, {});
  ok(del);
  assert.deepEqual(del.json<RaidListResponse>().list.rows.map((r) => r.villageId), [spots[1]!.id]);
  errorOf(await alice.c.post(`/api/raid-lists/${list.id}/rows/${row.id}/delete`, {}), 404, 'not_found');

  clock.advance(MINUTE + 1);
  ok(await alice.c.post(`/api/raid-lists/${list.id}/delete`, {}), 204);
  assert.deepEqual((await lists(alice)).lists, []);
  assert.equal(Number(app.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM raid_list_rows').get()?.n), 0, 'rows go with the list');
  errorOf(await alice.c.post(`/api/raid-lists/${list.id}/delete`, {}), 404, 'not_found');
  await app.close();
});

test('caps: 5 lists and 30 villages per list answer 409 raid_list_limit; deleting makes room', async () => {
  const { app, clock, alice, home, spots } = await setup();
  const made: RaidListDto[] = [];
  for (let i = 0; i < RAID_LIST_MAX_LISTS; i++) made.push(await mkList(alice, `L${i}`));
  errorOf(await alice.c.post('/api/raid-lists', { name: 'too many' }), 409, 'raid_list_limit');
  ok(await alice.c.post(`/api/raid-lists/${made[0]!.id}/delete`, {}), 204);
  const fresh = await mkList(alice, 'fits now');
  clock.advance(MINUTE + 1);
  for (let i = 0; i < RAID_LIST_MAX_ROWS; i++) {
    if (i === 20) clock.advance(MINUTE + 1); // the route's own limit is 30 calls a minute
    ok(await addRow(alice, fresh.id, spots[i]!, home.id, { raider: 1 }), 201);
  }
  errorOf(await addRow(alice, fresh.id, spots[RAID_LIST_MAX_ROWS]!, home.id, { raider: 1 }), 409, 'raid_list_limit');
  assert.equal((await lists(alice)).lists.find((l) => l.id === fresh.id)?.rows.length, RAID_LIST_MAX_ROWS);
  // another list of the same player has its own room
  ok(await addRow(alice, made[1]!.id, spots[RAID_LIST_MAX_ROWS]!, home.id, { raider: 1 }), 201);
  await app.close();
});

test('bad input is refused and nothing is saved', async () => {
  const { app, clock, alice, bob, home, spots } = await setup();
  const list = await mkList(alice);
  const bobHome = await bob.c.village();
  const s = spots[0]!;
  const badName: unknown[] = [{}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(31) }, { name: 'a\nb' }, { name: 5 }, { name: 'ok', extra: 1 }];
  for (const body of badName) {
    errorOf(await alice.c.post('/api/raid-lists', body), 400, 'invalid_input');
    errorOf(await alice.c.post(`/api/raid-lists/${list.id}`, body), 400, 'invalid_input');
  }
  clock.advance(MINUTE + 1);
  const row = (units: unknown, extra: object = {}) => ({ x: s.x, y: s.y, fromVillageId: home.id, units, ...extra });
  const badRows: unknown[] = [
    row({}),
    row({ raider: 0 }),
    row({ dragon: 3 }),
    row({ raider: -1 }),
    row({ raider: 1.5 }),
    row({ raider: '3' }),
    row({ raider: 1_000_001 }),
    row({ chieftain: 1 }),
    row({ raider: 2, chieftain: 1 }),
    row([1]),
    row('raider'),
    row({ raider: 1 }, { extra: true }),
    { x: s.x, y: s.y, units: { raider: 1 } },
    { x: s.x, fromVillageId: home.id, units: { raider: 1 } },
    { x: 'a', y: s.y, fromVillageId: home.id, units: { raider: 1 } },
    { x: s.x, y: s.y, fromVillageId: 0, units: { raider: 1 } },
  ];
  for (const body of badRows) errorOf(await alice.c.post(`/api/raid-lists/${list.id}/rows`, body), 400, 'invalid_input');
  clock.advance(MINUTE + 1);
  // targets: nothing there, a player's village, own village
  errorOf(await alice.c.post(`/api/raid-lists/${list.id}/rows`, row({ raider: 1 }, { x: 500, y: 500 })), 400, 'invalid_target');
  errorOf(await alice.c.post(`/api/raid-lists/${list.id}/rows`, row({ raider: 1 }, { x: bobHome.x, y: bobHome.y })), 400, 'invalid_target');
  errorOf(await alice.c.post(`/api/raid-lists/${list.id}/rows`, row({ raider: 1 }, { x: home.x, y: home.y })), 400, 'invalid_target');
  // from village: not mine / unknown
  errorOf(await alice.c.post(`/api/raid-lists/${list.id}/rows`, row({ raider: 1 }, { fromVillageId: bobHome.id })), 403, 'forbidden');
  errorOf(await alice.c.post(`/api/raid-lists/${list.id}/rows`, row({ raider: 1 }, { fromVillageId: 999_999 })), 404, 'not_found');
  clock.advance(MINUTE + 1);
  assert.equal((await lists(alice)).lists[0]?.rows.length, 0);
  // duplicate
  ok(await addRow(alice, list.id, s, home.id), 201);
  errorOf(await addRow(alice, list.id, s, home.id), 400, 'invalid_input');
  const rowId = (await lists(alice)).lists[0]!.rows[0]!.id;
  // updates: nothing to change, bad units, foreign from village
  for (const body of [{}, { units: {} }, { units: { chieftain: 1 } }, { units: { raider: 1 }, x: 1 }, { fromVillageId: bobHome.id }]) {
    const res = await alice.c.post(`/api/raid-lists/${list.id}/rows/${rowId}`, body);
    assert.ok([400, 403].includes(res.statusCode), res.body);
  }
  errorOf(await alice.c.post(`/api/raid-lists/${list.id}/rows/${rowId}`, { fromVillageId: bobHome.id }), 403, 'forbidden');
  assert.deepEqual((await lists(alice)).lists[0]?.rows[0]?.units, { raider: 3 });
  // ids in the path, bodies of deletes, send body
  for (const id of ['abc', '1.5', '-1', '1e3']) errorOf(await alice.c.post(`/api/raid-lists/${id}/delete`, {}), 400, 'invalid_input');
  errorOf(await alice.c.post(`/api/raid-lists/${list.id}/delete`, { extra: 1 }), 400, 'invalid_input');
  clock.advance(MINUTE + 1);
  for (const body of [{ rowIds: 'x' }, { rowIds: [0] }, { rowIds: [1.5] }, { rowIds: ['1'] }, { rowIds: Array.from({ length: RAID_LIST_MAX_ROWS + 1 }, (_, i) => i + 1) }, { other: 1 }]) {
    errorOf(await alice.c.post(`/api/raid-lists/${list.id}/send`, body), 400, 'invalid_input');
  }
  await app.close();
});

test("another player's lists and rows answer 404 on every route and nothing changes", async () => {
  const { app, clock, alice, bob, home, spots } = await setup({ entitleBob: true });
  const list = await mkList(alice);
  ok(await addRow(alice, list.id, spots[0]!, home.id), 201);
  const rowId = (await lists(alice)).lists[0]!.rows[0]!.id;
  const bobHome = await bob.c.village();
  giveTroops(app, bob, { raider: 20 });
  const bobList = await mkList(bob, 'Bobs');

  assert.deepEqual((await lists(bob)).lists.map((l) => l.id), [bobList.id], 'bob sees only his own list');
  errorOf(await bob.c.post(`/api/raid-lists/${list.id}`, { name: 'mine now' }), 404, 'not_found');
  errorOf(await bob.c.post(`/api/raid-lists/${list.id}/delete`, {}), 404, 'not_found');
  errorOf(await addRow(bob, list.id, spots[1]!, bobHome.id), 404, 'not_found');
  errorOf(await bob.c.post(`/api/raid-lists/${list.id}/rows/${rowId}`, { units: { raider: 9 } }), 404, 'not_found');
  errorOf(await bob.c.post(`/api/raid-lists/${list.id}/rows/${rowId}/delete`, {}), 404, 'not_found');
  errorOf(await bob.c.post(`/api/raid-lists/${list.id}/send`, {}), 404, 'not_found');
  // alice's row id through bob's own list is a missing row too
  errorOf(await bob.c.post(`/api/raid-lists/${bobList.id}/rows/${rowId}`, { units: { raider: 9 } }), 404, 'not_found');
  errorOf(await bob.c.post(`/api/raid-lists/${bobList.id}/rows/${rowId}/delete`, {}), 404, 'not_found');
  errorOf(await bob.c.post(`/api/raid-lists/${bobList.id}/send`, { rowIds: [rowId] }), 404, 'not_found');
  clock.advance(MINUTE + 1);
  // and a nonexistent list looks the same
  errorOf(await bob.c.post('/api/raid-lists/999999/send', {}), 404, 'not_found');

  const mine = (await lists(alice)).lists[0]!;
  assert.deepEqual([mine.name, mine.rows.length, mine.rows[0]?.units], ['Farms', 1, { raider: 3 }]);
  assert.deepEqual(app.ctx.store.villagesOfPlayer(bob.id)[0]?.state.troops.raider, 20, 'nothing of bob was sent');
  assert.equal(app.ctx.store.marchesInFlight(bob.id, 100), 0);
  await app.close();
});

test('send all: ordinary attacks on the server clock, in list order, same timing as a manual send', async () => {
  const { app, clock, alice, home, spots } = await setup();
  giveTroops(app, alice, { raider: 40 });
  const list = await mkList(alice);
  for (const s of spots.slice(0, 3)) ok(await addRow(alice, list.id, s, home.id, { raider: 4 }), 201);

  const sentAt = clock.now();
  const out = await press(alice, list.id);
  assert.deepEqual([out.sent, out.skipped, out.results.length], [3, 0, 3]);
  const expected = (s: Spot): number => sentAt + travelTimeMs(home, s, { ...emptyUnits(), raider: 4 }, app.ctx.settings);
  const state = await alice.c.state();
  assert.equal(state.movements.length, 3);
  const rows = (await lists(alice)).lists[0]!.rows;
  out.results.forEach((r, i) => {
    assert.equal(r.ok, true);
    assert.equal(r.rowId, rows[i]!.id, 'list order');
    assert.equal(r.arriveAt, expected(spots[i]!), 'arrival = server clock + engine travel time');
    const m = state.movements.find((x) => x.id === r.movementId);
    assert.ok(m);
    assert.deepEqual([m.kind, m.direction, m.departAt, m.arriveAt, m.target.villageId, m.origin.villageId, m.units?.raider], ['attack', 'outgoing', sentAt, expected(spots[i]!), spots[i]!.id, home.id, 4]);
  });
  assert.equal(state.villages[0]?.state.troops.raider, 40 - 12);
  assert.equal(state.villages[0]?.state.away.raider, 12);

  // The same troops through the normal route take exactly as long (a manual send to a fourth village).
  const manual = await sendOk(alice, spots[3]!, 'attack', { raider: 4 });
  assert.equal(manual.movement.arriveAt - manual.movement.departAt, expected(spots[3]!) - sentAt);
  assert.equal(manual.movement.kind, 'attack');

  // A subset of rows: only the ticked ones, even in a different order of ids.
  clock.advance(MINUTE + 1);
  const only = await press(alice, list.id, { rowIds: [rows[2]!.id] });
  assert.deepEqual(only.results.map((r) => r.rowId), [rows[2]!.id]);
  // Arrival: the troops fight and come home like any raid; the row then shows the caller's own last report.
  clock.set(Math.max(...out.results.map((r) => r.arriveAt ?? 0)) + 1);
  await alice.c.state();
  const after = (await lists(alice)).lists[0]!.rows;
  assert.ok(after[0]?.last, 'last report on the first village');
  assert.equal(typeof after[0]?.last?.won, 'boolean');
  assert.ok((after[0]?.last?.loot ?? 0) > 0);
  assert.equal(after[0]?.last?.at, out.results[0]!.arriveAt);
  await app.close();
});

test("'last' is the caller's own newest report only", async () => {
  const { app, clock, alice, bob, home, spots } = await setup({ entitleBob: true });
  giveTroops(app, alice, { raider: 10 });
  giveTroops(app, bob, { raider: 10 });
  const bobHome = await bob.c.village();
  const aList = await mkList(alice);
  const bList = await mkList(bob);
  ok(await addRow(alice, aList.id, spots[0]!, home.id, { raider: 5 }), 201);
  ok(await addRow(bob, bList.id, spots[0]!, bobHome.id, { raider: 5 }), 201);
  // Only bob raids; alice has never been there.
  const run = await press(bob, bList.id);
  clock.set(run.results[0]!.arriveAt! + 1);
  await bob.c.state();
  assert.ok((await lists(bob)).lists[0]?.rows[0]?.last);
  assert.equal((await lists(alice)).lists[0]?.rows[0]?.last, null);
  await app.close();
});

test('skipped rows are reported one by one with the reason and the normal message', async () => {
  const { app, clock, alice, bob, home, spots } = await setup();
  giveTroops(app, alice, { raider: 10 });
  const list = await mkList(alice);
  const wanted = [
    { s: spots[0]!, u: { raider: 4 } }, // sent
    { s: spots[1]!, u: { raider: 50 } }, // not enough troops
    { s: spots[2]!, u: { raider: 4 } }, // protected
    { s: spots[3]!, u: { raider: 4 } }, // taken by a player meanwhile
    { s: spots[4]!, u: { raider: 4 } }, // sent
  ];
  for (const w of wanted) ok(await addRow(alice, list.id, w.s, home.id, w.u), 201);
  const store = app.ctx.store;
  const guarded = store.getVillage(spots[2]!.id)!;
  guarded.state.protectedUntil = clock.now() + 3_600_000;
  store.saveVillage(guarded.id, guarded.state, guarded.points);
  store.db.prepare('UPDATE villages SET owner_id = ? WHERE id = ?').run(bob.id, spots[3]!.id); // an abandoned village that a player has since taken

  const out = await press(alice, list.id);
  assert.deepEqual(out.results.map((r) => r.reason ?? 'sent'), ['sent', 'not_enough_troops', 'target_protected', 'not_abandoned', 'sent']);
  assert.deepEqual([out.sent, out.skipped], [2, 3]);
  for (const r of out.results.filter((x) => !x.ok)) assert.equal(typeof r.message, 'string');
  assert.equal(out.results[3]?.ok, false);
  // The player's village was never attacked and nothing of it moved.
  assert.equal((await alice.c.state()).movements.filter((m) => m.target.villageId === spots[3]!.id).length, 0);
  // The list shows the village as taken.
  const rows = (await lists(alice)).lists[0]!.rows;
  assert.equal(rows.find((r) => r.villageId === spots[3]!.id)?.abandoned, false);
  await app.close();
});

test('a row whose sending village is no longer the caller\'s is skipped as village_gone', async () => {
  const { app, alice, bob, home, spots } = await setup();
  giveTroops(app, alice, { raider: 10 });
  const list = await mkList(alice);
  ok(await addRow(alice, list.id, spots[0]!, home.id), 201);
  app.ctx.store.db.prepare('UPDATE villages SET owner_id = ? WHERE id = ?').run(bob.id, home.id);
  const out = await press(alice, list.id);
  assert.deepEqual(out.results.map((r) => [r.ok, r.reason]), [[false, 'village_gone']]);
  await app.close();
});

test('one press tries at most RAID_LIST_SEND_CAP rows; the rest wait as press_cap and the next press takes them', async () => {
  const { app, clock, alice, home, spots } = await setup();
  giveTroops(app, alice, { raider: 100 });
  const list = await mkList(alice);
  const n = RAID_LIST_SEND_CAP + 5;
  for (let i = 0; i < n; i++) ok(await addRow(alice, list.id, spots[i]!, home.id, { raider: 1 }), 201);
  clock.advance(MINUTE + 1);
  const first = await press(alice, list.id);
  assert.deepEqual([first.sent, first.skipped], [RAID_LIST_SEND_CAP, 5]);
  assert.deepEqual(first.results.slice(RAID_LIST_SEND_CAP).map((r) => r.reason), Array(5).fill('press_cap'));
  clock.advance(MINUTE + 1);
  const rest = (await lists(alice)).lists[0]!.rows.slice(RAID_LIST_SEND_CAP).map((r) => r.id);
  const second = await press(alice, list.id, { rowIds: rest });
  assert.deepEqual([second.sent, second.skipped], [5, 0]);
  assert.equal((await alice.c.state()).movements.length, n);
  await app.close();
});

test('the march cap of the normal send applies per row', async () => {
  const { app, clock, alice, home, spots } = await setup();
  giveTroops(app, alice, { raider: 20 });
  const list = await mkList(alice);
  for (const s of spots.slice(0, 3)) ok(await addRow(alice, list.id, s, home.id, { raider: 1 }), 201);
  const ins = app.ctx.store.db.prepare('INSERT INTO movements (kind, origin_village_id, target_village_id, units_json, loot_json, depart_at, arrive_at) VALUES (?, ?, ?, ?, NULL, ?, ?)');
  for (let i = 0; i < MAX_MARCHES_IN_FLIGHT - 2; i++) ins.run('attack', home.id, spots[10]!.id, JSON.stringify(emptyUnits()), 0, clock.now() + 24 * 3_600_000);
  const out = await press(alice, list.id);
  assert.deepEqual(out.results.map((r) => r.reason ?? 'sent'), ['sent', 'sent', 'march_limit']);
  assert.equal(app.ctx.store.marchesInFlight(alice.id, 10_000), MAX_MARCHES_IN_FLIGHT);
  await app.close();
});

test('every row tried is charged to the per-account send limit: a press cannot beat manual sends', async () => {
  const { app, clock, alice, home, spots } = await setup();
  giveTroops(app, alice, { raider: 50 });
  const list = await mkList(alice);
  for (const s of spots.slice(0, 6)) ok(await addRow(alice, list.id, s, home.id, { raider: 1 }), 201);
  clock.advance(MINUTE + 1);
  // 58 manual sends (refused for bad bodies: the limit counts them all) leave room for 2 rows of the press.
  const manual = `/api/villages/${home.id}/send`;
  for (let i = 0; i < 58; i++) assert.notEqual((await alice.c.post(manual, {})).statusCode, 429);
  const out = await press(alice, list.id);
  assert.deepEqual(out.results.map((r) => r.reason ?? 'sent'), ['sent', 'sent', 'rate_limited', 'rate_limited', 'rate_limited', 'rate_limited']);
  assert.equal(out.results.at(-1)?.ok, false);
  // The bucket is used up for manual sends too, until the minute is over.
  errorOf(await alice.c.post(manual, {}), 429, 'rate_limited');
  clock.advance(MINUTE + 1);
  const again = await press(alice, list.id, { rowIds: out.results.slice(2).map((r) => r.rowId) });
  assert.equal(again.sent, 4);
  await app.close();
});

test('the route has its own bucket: 30 calls a minute', async () => {
  const { app, alice } = await setup();
  for (let i = 0; i < 30; i++) ok(await alice.c.get('/api/raid-lists'));
  errorOf(await alice.c.get('/api/raid-lists'), 429, 'rate_limited');
  await app.close();
});

test('cross-site writes are refused like every other write', async () => {
  const { app, alice } = await setup();
  const res = await alice.c.post('/api/raid-lists', { name: 'x' }, { origin: 'http://evil.example' });
  errorOf(res, 403, 'forbidden');
  await app.close();
});

test('a world that has ended refuses raid-list writes and the send, but still shows the lists', async () => {
  const { app, clock, alice, home, spots } = await setup();
  giveTroops(app, alice, { raider: 5 });
  const list = await mkList(alice);
  ok(await addRow(alice, list.id, spots[0]!, home.id), 201);
  assert.equal(endWorld(app.ctx.store, { at: clock.now(), kind: 'manual', winner: null, reason: 'test', actorIp: 'cli' }), true);
  errorOf(await alice.c.post(`/api/raid-lists/${list.id}/send`, {}), 403, 'forbidden');
  errorOf(await alice.c.post('/api/raid-lists', { name: 'late' }), 403, 'forbidden');
  assert.equal((await lists(alice)).lists[0]?.rows.length, 1);
  await app.close();
});
