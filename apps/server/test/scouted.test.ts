// GET /api/scouted/:id: the caller's OWN newest scout report with building levels on a village (Boulder Sling picker).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScoutedResponse } from '@clanfire/engine';
import { Client, errorOf, ok } from './helpers.ts';
import { giveKeen, giveTroops, sendOk, village, world } from './warfare-helpers.ts';

const scouted = async (p: { c: Client }, id: number) => {
  const res = await p.c.get(`/api/scouted/${id}`);
  ok(res);
  return res.json<ScoutedResponse>();
};

test('scouted: own newest report with levels; nobody else sees it; no report or low Keen gives null', async () => {
  const { app, clock, alice, amy, bob } = await world();
  const bobVillage = await village(bob);
  assert.deepEqual(await scouted(alice, bobVillage.id), { buildings: null, scoutedAt: null });

  // Keen 0: the report has no building layer, so there is nothing to show.
  giveTroops(app, alice, { pathfinder: 10 });
  const low = await sendOk(alice, bob, 'scout', { pathfinder: 5 });
  clock.set(low.movement.arriveAt);
  await alice.c.state(); // settles due movements
  assert.deepEqual(await scouted(alice, bobVillage.id), { buildings: null, scoutedAt: null });

  giveKeen(app, alice, 5);
  const high = await sendOk(alice, bob, 'scout', { pathfinder: 5 });
  clock.set(high.movement.arriveAt);
  await alice.c.state(); // settles due movements
  const mine = await scouted(alice, bobVillage.id);
  assert.equal(mine.scoutedAt, high.movement.arriveAt);
  assert.ok(mine.buildings && typeof mine.buildings.wall === 'number');

  // Someone else's (tribe-mate, the target himself) answer is empty: only the caller's own reports count.
  assert.deepEqual(await scouted(amy, bobVillage.id), { buildings: null, scoutedAt: null });
  assert.deepEqual(await scouted(bob, bobVillage.id), { buildings: null, scoutedAt: null });
});

test('scouted: signed out 401, unknown village 404, bad id 400', async () => {
  const { alice } = await world();
  const anon = new Client(alice.c.app, '10.88.0.1');
  errorOf(await anon.get('/api/scouted/1'), 401, 'unauthorized');
  errorOf(await alice.c.get('/api/scouted/987654'), 404, 'not_found');
  errorOf(await alice.c.get('/api/scouted/abc'), 400, 'invalid_input');
  errorOf(await alice.c.get('/api/scouted/-1'), 400, 'invalid_input');
});
