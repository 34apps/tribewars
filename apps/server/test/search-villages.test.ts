// Command post search: GET /api/search/villages (docs/SECURITY_ROADMAP.md section 4 gate).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MapResponse, MapVillageDto, SearchVillagesResponse } from '@clanfire/engine';
import { Client, errorOf, makeApp, ok } from './helpers.ts';
import { newPlayer, type App, type P } from './tribe-helpers.ts';

const search = (c: Client, q: string, by: string, extra = ''): ReturnType<Client['get']> =>
  c.get(`/api/search/villages?q=${encodeURIComponent(q)}&by=${by}${extra}`);

async function found(c: Client, q: string, by: string, extra = ''): Promise<MapVillageDto[]> {
  const res = await search(c, q, by, extra);
  ok(res);
  return res.json<SearchVillagesResponse>().villages;
}

function rename(app: App, p: P, name: string, index = 0): void {
  app.ctx.store.setVillageName(app.ctx.store.villagesOfPlayer(p.id)[index]!.id, name);
}

async function setup() {
  const { app, clock } = await makeApp();
  const alice = await newPlayer(app, 'Alice');
  const bob = await newPlayer(app, 'Bobby');
  rename(app, alice, 'Ash Hollow');
  rename(app, bob, 'Rock_Fort');
  return { app, clock, alice, bob };
}

test('finds villages by village name and by player name, case-insensitive, contains match', async () => {
  const { alice, bob } = await setup();
  const byName = await found(alice.c, 'fort', 'village');
  assert.deepEqual(byName.map((v) => v.name), ['Rock_Fort']);
  assert.equal(byName[0]!.ownerName, 'Bobby');
  assert.equal(byName[0]!.kind, 'player');
  const byOwner = await found(alice.c, 'OBB', 'player');
  assert.deepEqual(byOwner.map((v) => v.ownerName), ['Bobby']);
  // Own villages are found too (kind own); a player search never returns abandoned villages.
  assert.equal((await found(bob.c, 'ash', 'village'))[0]!.name, 'Ash Hollow');
  assert.equal((await found(alice.c, 'alice', 'player'))[0]!.kind, 'own');
  assert.equal((await found(alice.c, 'Abandoned', 'player')).length, 0);
  assert.ok((await found(alice.c, 'Abandoned', 'village')).every((v) => v.kind === 'abandoned' && v.ownerName === null));
});

test('the result carries only the public map fields: no troops, resources or queues', async () => {
  const { alice } = await setup();
  const [v] = await found(alice.c, 'Rock', 'village');
  assert.ok(v);
  const allowed = new Set(['id', 'name', 'x', 'y', 'kind', 'ownerName', 'points', 'protected', 'hearth', 'tribeTag', 'tribeId', 'ownerChieftain', 'ownerPoints', 'relation']);
  for (const key of Object.keys(v)) assert.ok(allowed.has(key), `unexpected field ${key}`);
  // Same row the map shows for that tile.
  const map = await alice.c.get(`/api/map?x=${v.x}&y=${v.y}&w=1&h=1`);
  assert.deepEqual(map.json<MapResponse>().villages, [v]);
});

test('q too short, too long, missing, blank; bad or missing by: 400 invalid_input', async () => {
  const { alice } = await setup();
  for (const q of ['a', ' a ', '   ', 'x'.repeat(25), 'x'.repeat(500), 'ab\u0000cd', 'ab\ncd']) {
    errorOf(await search(alice.c, q, 'village'), 400, 'invalid_input');
  }
  errorOf(await alice.c.get('/api/search/villages?by=village'), 400, 'invalid_input');
  errorOf(await alice.c.get('/api/search/villages?q=ab'), 400, 'invalid_input');
  errorOf(await search(alice.c, 'ab', 'tribe'), 400, 'invalid_input');
  errorOf(await alice.c.get('/api/search/villages?q=ab&by=village&x=1'), 400, 'invalid_input');
  errorOf(await search(alice.c, 'ab', 'village', '&from=abc'), 400, 'invalid_input');
  // 24 characters is the longest allowed.
  ok(await search(alice.c, 'x'.repeat(24), 'village'));
  ok(await search(alice.c, '  ab  ', 'village'));
});

test('% and _ in q are literal, backslash too', async () => {
  const { app, alice, bob } = await setup();
  assert.equal((await found(alice.c, '%%', 'village')).length, 0);
  assert.equal((await found(alice.c, '__', 'village')).length, 0);
  assert.deepEqual((await found(alice.c, 'k_F', 'village')).map((v) => v.name), ['Rock_Fort']);
  assert.equal((await found(alice.c, 'k.F', 'village')).length, 0);
  assert.equal((await found(alice.c, 'R%t', 'village')).length, 0);
  assert.equal((await found(alice.c, 'Bo%', 'player')).length, 0);
  assert.equal((await found(alice.c, '\\\\', 'village')).length, 0);
  rename(app, bob, "Odd 100% 'x'");
  assert.deepEqual((await found(alice.c, '100%', 'village')).map((v) => v.name), ["Odd 100% 'x'"]);
});

test('from: nearest first for own village, someone else\'s village refused', async () => {
  const { app, alice, bob } = await setup();
  const mine = (await alice.c.village()).id;
  const theirs = (await bob.c.village()).id;
  errorOf(await search(alice.c, 'Rock', 'village', `&from=${theirs}`), 404, 'not_found');
  errorOf(await search(alice.c, 'Rock', 'village', '&from=999999'), 404, 'not_found');
  // Distance order: all abandoned villages sorted by distance from alice's village.
  const near = await found(alice.c, 'village', 'village', `&from=${mine}`);
  const me = app.ctx.store.getVillage(mine)!;
  const d = (v: MapVillageDto): number => (v.x - me.x) ** 2 + (v.y - me.y) ** 2;
  for (let i = 1; i < near.length; i++) assert.ok(d(near[i - 1]!) <= d(near[i]!), 'sorted by distance');
});

test('not signed in: 401', async () => {
  const { app } = await makeApp();
  const anon = new Client(app, '10.1.1.1');
  errorOf(await search(anon, 'ab', 'village'), 401, 'unauthorized');
});

test('at most 10 results; banned players are left out', async () => {
  const { app, alice, bob } = await setup();
  const total = (await alice.c.get('/api/map?x=-12&y=-12&w=25&h=25')).json<MapResponse>().villages.filter((v) => v.kind === 'abandoned').length;
  assert.ok(total > 10, 'test world has more than 10 abandoned villages');
  assert.equal((await found(alice.c, 'Abandoned', 'village')).length, 10);
  app.ctx.store.banPlayer(bob.id, 'test', app.ctx.now());
  assert.equal((await found(alice.c, 'Rock', 'village')).length, 0);
  assert.equal((await found(alice.c, 'Bobby', 'player')).length, 0);
});
