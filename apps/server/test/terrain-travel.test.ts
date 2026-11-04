// Terrain on the road (docs/GAME_DESIGN.md 18.4a): travel time is computed on the server from the world seed, is the same
// stretch back, and nothing the client sends can change it. Security gate: SECURITY_ROADMAP.md section 2 (server clock only).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flatTravelTimeMs, travelPreview, travelTimeMs, type SendResponse, type Units } from '@clanfire/engine';
import { errorOf, makeApp, ok } from './helpers.ts';
import { newPlayer } from './tribe-helpers.ts';
import { giveTroops, movementsOf, units, village } from './warfare-helpers.ts';

/** A world (own seed) where the new player has an abandoned village within reach whose road crosses slow ground. */
async function roughRoad() {
  for (let seed = 4242; seed < 4242 + 80; seed++) {
    const { app, clock } = await makeApp({ world: { seed } });
    const p = await newPlayer(app, 'alice');
    const home = await village(p);
    const army = units({ raider: 5 });
    for (const id of app.ctx.store.abandonedVillageIds()) {
      const target = app.ctx.store.getVillage(id);
      if (!target) continue;
      const pre = travelPreview(home, target, army, app.ctx.settings);
      const back = travelPreview(target, home, army, app.ctx.settings);
      if (pre.ms > pre.flatMs * 1.06 && back.ms === pre.ms) return { app, clock, p, home, target };
    }
    await app.close();
  }
  throw new Error('no rough road found in 80 test worlds');
}

test('the server times a march by the terrain on the way: the preview, the movement and the road home agree', async () => {
  const { app, clock, p, home, target } = await roughRoad();
  giveTroops(app, p, { raider: 400, outrider: 5 });
  const settings = app.ctx.settings;

  const res = await p.c.post(`/api/villages/${home.id}/send`, { x: target.x, y: target.y, units: { raider: 400 }, mission: 'attack' });
  ok(res, 201);
  const { movement } = res.json<SendResponse>();
  const flat = flatTravelTimeMs(home, target, units({ raider: 400 }), settings);
  assert.equal(movement.arriveAt - movement.departAt, travelTimeMs(home, target, movement.units as Units, settings));
  assert.ok(movement.arriveAt - movement.departAt > flat, 'slow ground makes the trip longer than on flat ground');

  // Other unit families walk the same road at their own pace (mounted lose more than foot).
  const horse = await p.c.post(`/api/villages/${home.id}/send`, { x: target.x, y: target.y, units: { outrider: 5 }, mission: 'attack' });
  ok(horse, 201);
  const h = horse.json<SendResponse>().movement;
  assert.equal(h.arriveAt - h.departAt, travelTimeMs(home, target, units({ outrider: 5 }), settings));
  assert.ok((h.arriveAt - h.departAt) / flatTravelTimeMs(home, target, units({ outrider: 5 }), settings) > (movement.arriveAt - movement.departAt) / flat);

  // The way home takes as long as the way out (same stretch, same total), for the survivors of the raid.
  clock.set(movement.arriveAt);
  const back = (await movementsOf(p)).find((m) => m.kind === 'return' && m.origin.villageId !== home.id);
  assert.ok(back, 'the survivors march home');
  assert.equal(back.arriveAt - back.departAt, travelTimeMs(target, home, back.units ?? units({}), settings));
  await app.close();
});

test('nothing the client sends changes a travel time or the terrain', async () => {
  const { app, clock, p, home, target } = await roughRoad();
  giveTroops(app, p, { raider: 50 });
  const body = { x: target.x, y: target.y, units: { raider: 10 }, mission: 'attack' };
  const url = `/api/villages/${home.id}/send`;
  const before = (await movementsOf(p)).length;

  // Times, terrain, seeds and arrival times are not part of the contract: refused outright.
  for (const extra of [{ arriveAt: clock.now() + 1 }, { terrain: 'grass' }, { seed: 1 }, { speed: 1000 }, { departAt: 0 }, { travelMs: 1 }, { route: [] }, { settings: { seed: 1 } }]) {
    errorOf(await p.c.post(url, { ...body, ...extra }), 400, 'invalid_input');
  }
  // The test-mode own-time fields only work for accounts on the sandbox list.
  errorOf(await p.c.post(url, { ...body, travelSeconds: 1 }), 403, 'forbidden');
  errorOf(await p.c.post(url, { ...body, returnSeconds: 1 }), 403, 'forbidden');
  assert.equal((await movementsOf(p)).length, before, 'refused sends create nothing');
  assert.equal((await village(p)).state.troops.raider, 50, 'and keep the troops home');

  // The same order, sent as it should be, is timed by the engine from the server's own settings, whatever headers say.
  const res = await p.c.post(url, body);
  ok(res, 201);
  const { movement } = res.json<SendResponse>();
  assert.equal(movement.departAt, clock.now());
  assert.equal(movement.arriveAt - movement.departAt, travelTimeMs(home, target, units({ raider: 10 }), app.ctx.settings));
  await app.close();
});

test('a sandbox account may choose test times, and only those; terrain still decides every normal trip', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['sandy'] });
  const sandy = await newPlayer(app, 'sandy');
  giveTroops(app, sandy, { raider: 20 });
  const home = await village(sandy);
  const target = app.ctx.store.getVillage(app.ctx.store.abandonedVillageIds()[0] as number);
  assert.ok(target);
  const custom = await sandy.c.post(`/api/villages/${home.id}/send`, { x: target.x, y: target.y, units: { raider: 5 }, mission: 'attack', travelSeconds: 7 });
  ok(custom, 201);
  const c = custom.json<SendResponse>().movement;
  assert.equal(c.arriveAt - c.departAt, 7000);
  const normal = await sandy.c.post(`/api/villages/${home.id}/send`, { x: target.x, y: target.y, units: { raider: 5 }, mission: 'attack' });
  ok(normal, 201);
  const n = normal.json<SendResponse>().movement;
  assert.equal(n.arriveAt - n.departAt, travelTimeMs(home, target, units({ raider: 5 }), app.ctx.settings));
  assert.equal(n.departAt, clock.now());
  await app.close();
});
