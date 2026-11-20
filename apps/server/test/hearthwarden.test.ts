// The Hearthwarden (2026-11-18): a Stables 4 rider researched at Drillyard 4 that rides to help. Train endpoint, support send, old rows.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UNITS, type Resources } from '@clanfire/engine';
import { errorOf, ok } from './helpers.ts';
import { giveTroops, sendOk, village, world, type App, type P } from './warfare-helpers.ts';

function setup(app: App, p: P, buildings: Record<string, number>, researched: string[] = []): number {
  const v = app.ctx.store.villagesOfPlayer(p.id)[0]!;
  Object.assign(v.state.buildings, { hall: 8, storehouse: 15, farm: 12, barracks: 3 }, buildings);
  const res: Partial<Resources> = { wood: 9000, food: 9000, iron: 9000, gold: 500 };
  Object.assign(v.state.resources, res);
  v.state.researched = researched as never;
  app.ctx.store.saveVillage(v.id, v.state, v.points);
  return v.id;
}
const post = (p: P, id: number, path: string, body: unknown) => p.c.post(`/api/villages/${id}/${path}`, body);

test('train: the Hearthwarden needs Barracks 5 and its research, and queues at the Barracks', async () => {
  const { app, alice } = await world();
  const id = setup(app, alice, { barracks: 4, drillyard: 4 });
  errorOf(await post(alice, id, 'train', { unit: 'hearthwarden', count: 1 }), 409, 'requirements_not_met');
  setup(app, alice, { barracks: 5, drillyard: 4 });
  errorOf(await post(alice, id, 'train', { unit: 'hearthwarden', count: 1 }), 409, 'requirements_not_met'); // not researched yet
  ok(await post(alice, id, 'research', { unit: 'hearthwarden' }), 200);
  setup(app, alice, { barracks: 5, drillyard: 4 }, ['hearthwarden']);
  const r = await post(alice, id, 'train', { unit: 'hearthwarden', count: 2 });
  ok(r, 200);
  const q = r.json<{ state: { trainQueues: { barracks: Array<{ unit: string; count: number }>; stables: unknown[] } } }>().state.trainQueues;
  assert.equal(q.barracks[0]?.unit, 'hearthwarden');
  assert.equal(q.stables.length, 0);
  ok(await post(alice, id, 'cancel-train', { building: 'barracks', index: 0 }), 200);
  assert.equal((await village(alice)).state.trainQueues.barracks.length, 0);
  await app.close();
});

test('support: a Hearthwarden arrives sooner than foot would, stays stationed and is stationed as itself', async () => {
  const { app, alice, amy } = await world();
  giveTroops(app, alice, { hearthwarden: 5, pikeman: 5 });
  const foot = await sendOk(alice, amy, 'support', { pikeman: 5 });
  const rider = await sendOk(alice, amy, 'support', { hearthwarden: 5 });
  assert.equal(rider.movement.units?.hearthwarden, 5);
  const footMs = foot.movement.arriveAt - foot.movement.departAt;
  const riderMs = rider.movement.arriveAt - rider.movement.departAt;
  assert.ok(riderMs < footMs, `rider ${riderMs} < foot ${footMs}`);
  const home = (await village(alice)).state;
  assert.deepEqual([home.troops.hearthwarden, home.away.hearthwarden], [0, 5]);
  assert.ok(UNITS.hearthwarden.speed > UNITS.pikeman.speed);
  await app.close();
});

test('old saved rows without the Hearthwarden read with 0 everywhere', async () => {
  const { app, alice } = await world();
  const v = app.ctx.store.villagesOfPlayer(alice.id)[0]!;
  const raw = JSON.parse(JSON.stringify(v.state)) as Record<string, Record<string, number>>;
  delete raw.troops!.hearthwarden;
  delete raw.away!.hearthwarden;
  app.ctx.store.saveVillage(v.id, raw as never, v.points);
  const s = (await village(alice)).state;
  assert.equal(s.troops.hearthwarden, 0);
  assert.equal(s.away.hearthwarden, 0);
  await app.close();
});
