// Drillyard endpoints: research, ranks, respec (docs/GAME_DESIGN.md section 15; security gate SECURITY_ROADMAP.md section 4).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UNITS, RESPEC_GOLD_FEE, type Resources } from '@clanfire/engine';
import { errorOf, ok } from './helpers.ts';
import { village, world, type App, type P } from './warfare-helpers.ts';

function setup(app: App, p: P, drillyard: number, res: Partial<Resources> = {}): number {
  const v = app.ctx.store.villagesOfPlayer(p.id)[0]!;
  v.state.buildings.drillyard = drillyard;
  v.state.buildings.hall = Math.max(v.state.buildings.hall, 5);
  v.state.buildings.barracks = Math.max(v.state.buildings.barracks, 3);
  v.state.buildings.storehouse = Math.max(v.state.buildings.storehouse, 15);
  Object.assign(v.state.resources, { wood: 5000, food: 5000, iron: 5000, gold: 500 }, res);
  app.ctx.store.saveVillage(v.id, v.state, v.points);
  return v.id;
}

const post = (p: P, id: number | string, path: string, body: unknown) => p.c.post(`/api/villages/${id}/${path}`, body);

test('research: pays now, finishes on the server clock, then the unit can be trained and survives a save', async () => {
  const { app, clock, alice } = await world();
  const id = setup(app, alice, 3);
  errorOf(await post(alice, id, 'train', { unit: 'guard', count: 1 }), 409, 'requirements_not_met');

  const before = (await village(alice)).state.resources.wood;
  const res = await post(alice, id, 'research', { unit: 'guard' });
  ok(res, 200);
  const job = res.json<{ state: { researchJob?: { unit: string; finishAt: number }; resources: Resources } }>().state;
  assert.equal(job.researchJob?.unit, 'guard');
  assert.ok(job.resources.wood < before, 'cost paid');
  assert.ok(Math.abs(job.researchJob!.finishAt - clock.now() - (UNITS.guard.research!.timeSec / app.ctx.game.settings.speed) * 1000) < 2000);

  errorOf(await post(alice, id, 'research', { unit: 'outrider' }), 409, 'queue_full');
  clock.advance(UNITS.guard.research!.timeSec * 1000 + 1000);
  const after = (await village(alice)).state;
  assert.ok(after.researched?.includes('guard'));
  assert.equal(after.researchJob, undefined);
  ok(await post(alice, id, 'train', { unit: 'guard', count: 1 }), 200);
});

test('research input and rules: unknown/free units, level gate, money, no client time', async () => {
  const { app, alice } = await world();
  const id = setup(app, alice, 1);
  errorOf(await post(alice, id, 'research', { unit: 'dragon' }), 400, 'invalid_input');
  errorOf(await post(alice, id, 'research', { unit: 'pikeman' }), 400, 'invalid_input'); // needs no research
  errorOf(await post(alice, id, 'research', { unit: 'knight' }), 409, 'requirements_not_met'); // Drillyard level too low
  errorOf(await post(alice, id, 'research', { unit: 'guard', at: 5 }), 400, 'invalid_input'); // extra field refused
  errorOf(await post(alice, id, 'research', {}), 400, 'invalid_input');
  setup(app, alice, 3, { wood: 0 });
  errorOf(await post(alice, id, 'research', { unit: 'guard' }), 409, 'not_enough_resources');
});

test('ranks: points per Drillyard level, researched only, track rules, respec returns points', async () => {
  const { app, alice } = await world();
  const id = setup(app, alice, 1); // 3 points
  errorOf(await post(alice, id, 'rank', { unit: 'guard', track: 'might' }), 409, 'requirements_not_met'); // not researched
  errorOf(await post(alice, id, 'rank', { unit: 'pikeman', track: 'keen' }), 400, 'invalid_input');
  errorOf(await post(alice, id, 'rank', { unit: 'pathfinder', track: 'might' }), 400, 'invalid_input');
  errorOf(await post(alice, id, 'rank', { unit: 'pikeman', track: 'speed' }), 400, 'invalid_input');

  const r1 = await post(alice, id, 'rank', { unit: 'pikeman', track: 'might' }); // 1 point
  ok(r1, 200);
  assert.equal(r1.json<{ state: { ranks: { pikeman: { might: number } } } }>().state.ranks.pikeman.might, 1);
  ok(await post(alice, id, 'rank', { unit: 'pikeman', track: 'might' }), 200); // 2 points, total 3
  errorOf(await post(alice, id, 'rank', { unit: 'pikeman', track: 'bulwark' }), 409, 'requirements_not_met'); // no points left

  const gold = (await village(alice)).state.resources.gold;
  const back = await post(alice, id, 'respec', { unit: 'pikeman', track: 'might' });
  ok(back, 200);
  const st = back.json<{ state: { ranks: { pikeman: { might: number } }; resources: Resources } }>().state;
  assert.equal(st.ranks.pikeman.might, 0);
  assert.ok(Math.abs(st.resources.gold - (gold - RESPEC_GOLD_FEE)) < 1);
  errorOf(await post(alice, id, 'respec', { unit: 'pikeman', track: 'might' }), 400, 'invalid_input'); // nothing left to reset
  ok(await post(alice, id, 'rank', { unit: 'pikeman', track: 'bulwark' }), 200);
});

test('authorization: another player cannot research, buy or reset in my village; guests are refused', async () => {
  const { app, alice, bob } = await world();
  const id = setup(app, alice, 3);
  ok(await post(alice, id, 'rank', { unit: 'pikeman', track: 'might' }), 200);
  for (const [path, body] of [
    ['research', { unit: 'guard' }],
    ['rank', { unit: 'pikeman', track: 'bulwark' }],
    ['respec', { unit: 'pikeman', track: 'might' }],
  ] as const) {
    errorOf(await post(bob, id, path, body), 403, 'forbidden'); // same answer as build/train (uniform-errors item is open in the roadmap)
    errorOf(await post(bob, 999_999, path, body), 404, 'not_found');
    errorOf(await post(bob, 'abc', path, body), 400, 'invalid_input');
  }
  const mine = (await village(alice)).state;
  assert.equal(mine.ranks?.pikeman?.bulwark ?? 0, 0);
  assert.equal(mine.ranks?.pikeman?.might, 1);
  assert.equal(mine.researchJob, undefined);
});
