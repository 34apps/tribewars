// Founding a village with a Chieftain (docs/GAME_DESIGN.md 18.2, step 2): the send checks, the arrival, the re-check on arrival,
// the village limit, the protection of the new village and who may touch a found mission.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FOUND_PROTECTION_HOURS,
  FOUND_START_RESOURCES,
  MAX_VILLAGES_PER_PLAYER,
  createNpcVillage,
  createPlayerVillage,
  foundedVillageName,
  type MapResponse,
  type SendResponse,
  type Units,
} from '@clanfire/engine';
import { HOUR, errorOf, makeApp, ok } from './helpers.ts';
import {
  assertLedgerSane,
  freeTileNear,
  homeOf,
  ledger,
  player,
  reserveFor,
  runTo,
  strongHome,
  villageReports,
  villagesOf,
  type P,
} from './village-helpers.ts';

const found = (p: P, vid: number, tile: { x: number; y: number }, units: Partial<Units>, travelSeconds = 60) =>
  p.c.post(`/api/villages/${vid}/send`, { x: tile.x, y: tile.y, units, mission: 'found', travelSeconds });

async function setup(units: Partial<Units> = { pikeman: 40, chieftain: 1 }) {
  const { app, clock } = await makeApp({ sandboxUsers: ['founder'] });
  const p = await player(app, 'founder');
  const homeId = strongHome(app, clock, p, units);
  reserveFor(app, p, 1, 500);
  return { app, clock, p, homeId, tile: freeTileNear(app, p) };
}

test('found: the Chieftain walks to a free tile and a protected village appears; the escort garrisons it, he is used up', async () => {
  const { app, clock, p, homeId, tile } = await setup();
  const store = app.ctx.store;
  const res = await found(p, homeId, tile, { pikeman: 40, chieftain: 1 });
  ok(res, 201);
  const { movement } = res.json<SendResponse>();
  assert.equal(movement.kind, 'found');
  assert.deepEqual([movement.target.villageId, movement.target.name, movement.target.x, movement.target.y], [0, 'New village', tile.x, tile.y]);
  assert.equal(movement.cancellableUntil, null, 'found missions are not cancellable (cancel rules unchanged)');
  assert.equal(homeOf(app, p).state.away.chieftain, 1);

  runTo(app, clock, movement.arriveAt);
  const mine = villagesOf(app, p);
  assert.equal(mine.length, 2);
  const nv = mine[1];
  assert.ok(nv);
  assert.deepEqual([nv.x, nv.y], [tile.x, tile.y]);
  assert.equal(nv.name, foundedVillageName('founder', 2));
  assert.deepEqual(nv.state.resources, FOUND_START_RESOURCES);
  assert.equal(nv.state.protectedUntil, movement.arriveAt + (FOUND_PROTECTION_HOURS * HOUR) / 10);
  assert.equal(nv.state.hearth, undefined);

  // Nobody is lost: the escort that fit is the garrison, the rest walks home; the Chieftain left the home's `away`.
  const walking = store.movementsFrom(homeId).filter((x) => x.kind === 'return').reduce((n, x) => n + x.units.pikeman, 0);
  assert.equal(nv.state.troops.pikeman + walking, 40);
  assert.equal(nv.state.troops.chieftain, 0);
  const home = homeOf(app, p);
  assert.equal(home.state.away.chieftain, 0);
  assert.equal(home.state.away.pikeman, walking);
  const l = ledger(app, p);
  assert.equal(l.reserved, 0, 'his reservation ended');
  assert.equal(l.spent, 500, 'the Renown stays spent');
  assertLedgerSane(app, p);
  const report = (await villageReports(p)).find((r) => r.village.kind === 'founded');
  assert.ok(report);
  assert.equal(report.village.village.name, nv.name);

  // The map shows it as mine and protected; a stranger can neither attack nor scout it for FOUND_PROTECTION_HOURS.
  const bob = await player(app, 'bob');
  const bobHome = strongHome(app, clock, bob, { raider: 50, pathfinder: 5 });
  const map = (await (await p.c.get(`/api/map?x=${tile.x}&y=${tile.y}&w=1&h=1`)).json<MapResponse>()).villages[0];
  assert.equal(map?.kind, 'own');
  assert.equal(map?.protected, true);
  errorOf(await bob.c.post(`/api/villages/${bobHome}/send`, { x: tile.x, y: tile.y, units: { raider: 50 }, mission: 'attack' }), 409, 'target_protected');
  errorOf(await bob.c.post(`/api/villages/${bobHome}/send`, { x: tile.x, y: tile.y, units: { pathfinder: 5 }, mission: 'scout' }), 409, 'target_protected');
  await app.close();
});

test('an attack that is already marching when a village becomes protected is called off on arrival', async () => {
  const { app, clock, p, homeId } = await setup({ raider: 50 });
  const bob = await player(app, 'bob');
  const bobHome = strongHome(app, clock, bob, { raider: 50 });
  const target = homeOf(app, p);
  const res = await bob.c.post(`/api/villages/${bobHome}/send`, { x: target.x, y: target.y, units: { raider: 50 }, mission: 'attack' });
  ok(res, 201);
  const { movement } = res.json<SendResponse>();
  // The target village gets a protection time while the troops march (as a restarted or founded village has).
  target.state.protectedUntil = movement.arriveAt + HOUR;
  app.ctx.store.saveVillage(target.id, target.state, target.points);
  runTo(app, clock, movement.arriveAt);
  const battle = (await bob.c.get('/api/reports')).json<{ reports: Array<{ outcome: string; type: string }> }>().reports[0];
  assert.equal(battle?.outcome, 'called_off');
  assert.equal(homeOf(app, p).id, homeId);
  assert.equal(homeOf(app, p).state.troops.raider, 50, 'no battle happened');
  await app.close();
});

test('found: bad tiles and bad armies are refused and nothing leaves home', async () => {
  const { app, clock, p, homeId, tile } = await setup({ pikeman: 10, chieftain: 2 });
  const home = homeOf(app, p);
  const bad = async (target: { x: number; y: number }, units: Partial<Units>, status: number, code: string) => {
    errorOf(await found(p, homeId, target, units), status, code);
    assert.equal(homeOf(app, p).state.away.chieftain, 0);
  };
  await bad({ x: home.x, y: home.y }, { chieftain: 1 }, 400, 'invalid_target'); // a village stands there
  await bad({ x: home.x + 1, y: home.y }, { chieftain: 1 }, 400, 'invalid_target'); // too close to a village
  await bad({ x: 500, y: 500 }, { chieftain: 1 }, 400, 'invalid_target'); // outside the world
  await bad({ x: -500, y: tile.y }, { chieftain: 1 }, 400, 'invalid_target');
  await bad(tile, { pikeman: 10 }, 400, 'invalid_input'); // no Chieftain
  await bad(tile, { chieftain: 2, pikeman: 10 }, 400, 'invalid_input'); // exactly one carries the ember
  errorOf(await p.c.post(`/api/villages/${homeId}/send`, { x: 1.5, y: 2, units: { chieftain: 1 }, mission: 'found' }), 400, 'invalid_input');
  errorOf(await p.c.post(`/api/villages/${homeId}/send`, { x: tile.x, y: tile.y, units: { chieftain: -1 }, mission: 'found' }), 400, 'invalid_input');
  // More Chieftains than at home.
  const solo = await player(app, 'solo');
  const soloHome = strongHome(app, clock, solo, { pikeman: 5 });
  errorOf(await solo.c.post(`/api/villages/${soloHome}/send`, { x: tile.x, y: tile.y, units: { chieftain: 1 }, mission: 'found' }), 409, 'not_enough_troops');
  await app.close();
});

test('found: if the tile is taken while he walks, he walks home with a report and nothing is lost', async () => {
  const { app, clock, p, homeId, tile } = await setup({ pikeman: 5, chieftain: 1 });
  const store = app.ctx.store;
  const { movement } = (await found(p, homeId, tile, { pikeman: 5, chieftain: 1 })).json<SendResponse>();
  store.insertVillage(null, 'Squatters', tile.x, tile.y, 0, createNpcVillage(1, clock.now()));
  runTo(app, clock, movement.arriveAt);
  assert.equal(villagesOf(app, p).length, 1, 'no village was founded');
  const back = store.movementsFrom(homeId).find((x) => x.kind === 'return');
  assert.ok(back, 'the army walks home');
  assert.equal(back.units.chieftain, 1);
  assert.equal(back.units.pikeman, 5);
  const view = (await p.c.state()).movements.find((x) => x.id === back.id);
  assert.deepEqual([view?.origin.x, view?.origin.y, view?.origin.name], [tile.x, tile.y, 'New village'], 'the walk home starts at the tile');
  const failed = (await villageReports(p)).find((r) => r.village.kind === 'found_failed');
  assert.equal(failed?.village.reason, 'tile_taken');
  runTo(app, clock, back.arriveAt);
  const home = homeOf(app, p);
  assert.equal(home.state.troops.chieftain, 1);
  assert.equal(home.state.away.chieftain, 0);
  assert.equal(ledger(app, p).reserved, 500, 'the Chieftain lives: nothing changed in the ledger');
  await app.close();
});

test('the village limit: refused at send, and re-checked on arrival', async () => {
  const { app, clock, p, homeId, tile } = await setup({ pikeman: 5, chieftain: 1 });
  const store = app.ctx.store;
  const filler = (i: number) => store.insertVillage(p.id, `Filler ${i}`, 1000 + i * 10, 0, 0, createPlayerVillage(clock.now()));
  for (let i = 0; i < MAX_VILLAGES_PER_PLAYER - 2; i++) filler(i); // 1 + 18 = 19 villages: one more fits
  assert.equal(villagesOf(app, p).length, MAX_VILLAGES_PER_PLAYER - 1);
  const { movement } = (await found(p, homeId, tile, { chieftain: 1 })).json<SendResponse>();
  filler(99); // 20 villages by the time he arrives
  runTo(app, clock, movement.arriveAt);
  assert.equal(villagesOf(app, p).length, MAX_VILLAGES_PER_PLAYER, 'no 21st village');
  assert.equal((await villageReports(p)).find((r) => r.village.kind === 'found_failed')?.village.reason, 'village_limit');
  const back = store.movementsFrom(homeId).find((x) => x.kind === 'return');
  assert.equal(back?.units.chieftain, 1);
  runTo(app, clock, back?.arriveAt ?? 0);
  errorOf(await found(p, homeId, tile, { chieftain: 1 }), 400, 'invalid_target');
  await app.close();
});

test('nobody else can act on my found mission, my Chieftain or my village', async () => {
  const { app, clock, p, homeId, tile } = await setup();
  const bob = await player(app, 'bob');
  const { movement } = (await found(p, homeId, tile, { pikeman: 40, chieftain: 1 })).json<SendResponse>();
  assert.equal((await bob.c.state()).movements.length, 0, 'bob does not see it');
  errorOf(await bob.c.post(`/api/movements/${movement.id}/cancel`), 404, 'not_found');
  errorOf(await p.c.post(`/api/movements/${movement.id}/cancel`), 409, 'too_late');
  errorOf(await found(bob, homeId, tile, { chieftain: 1 }), 403, 'forbidden');
  runTo(app, clock, movement.arriveAt);
  assert.equal(villagesOf(app, bob).length, 1);
  assert.equal(villagesOf(app, p).length, 2);
  await app.close();
});
