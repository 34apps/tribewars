// Saved troop groups: create / list / update / delete, the cap, input checks, ownership and the cross-site guard.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TROOP_GROUP_MAX, type TroopGroupResponse, type TroopGroupsResponse } from '@clanfire/engine';
import { Client, HOST, MINUTE, errorOf, makeApp, ok, register } from './helpers.ts';

const list = async (c: Client): Promise<TroopGroupsResponse> => (await c.get('/api/troop-groups')).json<TroopGroupsResponse>();

async function two() {
  const { app, clock } = await makeApp();
  const alice = await register(app, 'alice', '10.0.0.1');
  const bob = await register(app, 'bob', '10.0.0.2');
  return { app, clock, alice, bob };
}

test('create, list, update and delete a group', async () => {
  const { alice } = await two();
  assert.deepEqual(await list(alice), { groups: [] });
  const res = await alice.post('/api/troop-groups', { name: '  Raid party ', units: { raider: 40, guard: 0, pikeman: 5 } });
  ok(res, 201);
  const g = res.json<TroopGroupResponse>().group;
  assert.equal(g.name, 'Raid party');
  assert.deepEqual(g.units, { pikeman: 5, raider: 40 });
  assert.deepEqual((await list(alice)).groups, [g]);

  const up = await alice.post(`/api/troop-groups/${g.id}`, { name: 'Decoys', units: { raider: 1 } });
  ok(up);
  assert.deepEqual(up.json<TroopGroupResponse>().group, { id: g.id, name: 'Decoys', units: { raider: 1 } });
  assert.equal((await list(alice)).groups.length, 1);

  ok(await alice.post(`/api/troop-groups/${g.id}/delete`, {}), 204);
  assert.deepEqual(await list(alice), { groups: [] });
  errorOf(await alice.post(`/api/troop-groups/${g.id}/delete`, {}), 404, 'not_found');
});

test('the 13th group is refused with group_limit; deleting one makes room', async () => {
  const { alice } = await two();
  for (let i = 0; i < TROOP_GROUP_MAX; i++) ok(await alice.post('/api/troop-groups', { name: `g${i}`, units: { raider: i + 1 } }), 201);
  errorOf(await alice.post('/api/troop-groups', { name: 'one too many', units: { raider: 1 } }), 409, 'group_limit');
  const groups = (await list(alice)).groups;
  assert.equal(groups.length, TROOP_GROUP_MAX);
  ok(await alice.post(`/api/troop-groups/${groups[0]!.id}/delete`, {}), 204);
  ok(await alice.post('/api/troop-groups', { name: 'fits now', units: { raider: 1 } }), 201);
});

test('bad names and unit maps are invalid_input and nothing is saved', async () => {
  const { alice, clock } = await two();
  const bad: unknown[] = [
    {},
    { name: 'a' },
    { units: { raider: 1 } },
    { name: '', units: { raider: 1 } },
    { name: '   ', units: { raider: 1 } },
    { name: 'x'.repeat(25), units: { raider: 1 } },
    { name: 'a\nb', units: { raider: 1 } },
    { name: 5, units: { raider: 1 } },
    { name: 'ok', units: {} },
    { name: 'ok', units: { raider: 0 } },
    { name: 'ok', units: { raider: 1.5 } },
    { name: 'ok', units: { raider: -2 } },
    { name: 'ok', units: { raider: '3' } },
    { name: 'ok', units: { raider: 1_000_001 } },
    { name: 'ok', units: { dragon: 3 } },
    { name: 'ok', units: [1] },
    { name: 'ok', units: 'raider' },
    { name: 'ok', units: { raider: 1 }, extra: true },
  ];
  for (const body of bad) errorOf(await alice.post('/api/troop-groups', body), 400, 'invalid_input');
  assert.deepEqual(await list(alice), { groups: [] });
  clock.advance(MINUTE + 1); // a fresh rate-limit window for the second round
  const g = (await alice.post('/api/troop-groups', { name: 'ok', units: { raider: 2 } })).json<TroopGroupResponse>().group;
  for (const body of bad) errorOf(await alice.post(`/api/troop-groups/${g.id}`, body), 400, 'invalid_input');
  errorOf(await alice.post(`/api/troop-groups/${g.id}`, 'nope'), 400, 'invalid_input');
  assert.deepEqual((await list(alice)).groups, [g]);
  for (const id of ['abc', '1.5', '-1', '1e3']) errorOf(await alice.post(`/api/troop-groups/${id}/delete`, {}), 400, 'invalid_input');
  errorOf(await alice.post(`/api/troop-groups/${g.id}/delete`, { extra: 1 }), 400, 'invalid_input');
  assert.equal((await list(alice)).groups.length, 1);
});

test("another player's group id on update or delete is 404 and changes nothing; lists are private and the cap is per player", async () => {
  const { alice, bob } = await two();
  const g = (await alice.post('/api/troop-groups', { name: 'Alice only', units: { raider: 9 } })).json<TroopGroupResponse>().group;
  errorOf(await bob.post(`/api/troop-groups/${g.id}`, { name: 'Hijack', units: { guard: 1 } }), 404, 'not_found');
  errorOf(await bob.post(`/api/troop-groups/${g.id}/delete`, {}), 404, 'not_found');
  errorOf(await bob.post('/api/troop-groups/999999', { name: 'x', units: { guard: 1 } }), 404, 'not_found');
  assert.deepEqual((await list(alice)).groups, [g]);
  assert.deepEqual(await list(bob), { groups: [] });
  for (let i = 0; i < TROOP_GROUP_MAX; i++) ok(await bob.post('/api/troop-groups', { name: `b${i}`, units: { guard: 1 } }), 201);
  assert.equal((await list(alice)).groups.length, 1);
  ok(await alice.post('/api/troop-groups', { name: 'second', units: { guard: 1 } }), 201);
});

test('signed out: every route is 401', async () => {
  const { app } = await two();
  const anon = new Client(app, '10.0.0.7');
  errorOf(await anon.get('/api/troop-groups'), 401, 'unauthorized');
  errorOf(await anon.post('/api/troop-groups', { name: 'a', units: { raider: 1 } }), 401, 'unauthorized');
  errorOf(await anon.post('/api/troop-groups/1', { name: 'a', units: { raider: 1 } }), 401, 'unauthorized');
  errorOf(await anon.post('/api/troop-groups/1/delete', {}), 401, 'unauthorized');
});

test('a cross-site Origin is refused like every other POST', async () => {
  const { alice } = await two();
  const evil = { origin: 'http://evil.example' };
  errorOf(await alice.post('/api/troop-groups', { name: 'a', units: { raider: 1 } }, evil), 403, 'forbidden');
  assert.deepEqual(await list(alice), { groups: [] });
  const g = (await alice.post('/api/troop-groups', { name: 'a', units: { raider: 1 } })).json<TroopGroupResponse>().group;
  errorOf(await alice.post(`/api/troop-groups/${g.id}`, { name: 'b', units: { raider: 2 } }, evil), 403, 'forbidden');
  errorOf(await alice.post(`/api/troop-groups/${g.id}/delete`, {}, evil), 403, 'forbidden');
  assert.deepEqual((await list(alice)).groups, [g]);
  assert.equal(HOST, 'clanfire.test');
});
