// Drillyard endpoints: research, ranks, respec (docs/GAME_DESIGN.md section 15; security gate SECURITY_ROADMAP.md section 4).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DRILLYARD_POINTS_PER_LEVEL, RANK_POINTS, UNITS, pointsSpent, pointsTotal, rankPointsUpTo, type Resources } from '@clanfire/engine';
import { buildApp } from '../src/app.ts';
import { Client, Clock, TEST_WORLD, TEST_WORLD_CONFIG, errorOf, ok, register } from './helpers.ts';
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
  const job = res.json<{ state: { researchQueue?: { unit: string; finishAt: number }[]; resources: Resources } }>().state;
  assert.equal(job.researchQueue?.[0]?.unit, 'guard');
  assert.ok(job.resources.wood < before, 'cost paid');
  assert.ok(Math.abs(job.researchQueue![0]!.finishAt - clock.now() - (UNITS.guard.research!.timeSec / app.ctx.game.settings.speed) * 1000) < 2000);

  // Free players queue two researches; the third is refused.
  ok(await post(alice, id, 'research', { unit: 'outrider' }), 200);
  errorOf(await post(alice, id, 'research', { unit: 'knight' }), 409, 'queue_full');
  clock.advance((UNITS.guard.research!.timeSec / app.ctx.game.settings.speed) * 1000 + 1000);
  const after = (await village(alice)).state;
  assert.ok(after.researched?.includes('guard'));
  assert.equal(after.researchQueue?.[0]?.unit, 'outrider', 'the waiting research started by itself');
  clock.advance(UNITS.outrider.research!.timeSec * 1000);
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
  const id = setup(app, alice, 1);
  const pool = pointsTotal(app.ctx.store.getVillage(id)!.state);
  assert.equal(pool, DRILLYARD_POINTS_PER_LEVEL, 'one Drillyard level gives its points (and no Hall bonus at Hall 5)');
  errorOf(await post(alice, id, 'rank', { unit: 'guard', track: 'bulwark' }), 409, 'requirements_not_met'); // not researched
  errorOf(await post(alice, id, 'rank', { unit: 'pikeman', track: 'keen' }), 400, 'invalid_input');
  errorOf(await post(alice, id, 'rank', { unit: 'pikeman', track: 'might' }), 400, 'invalid_input'); // a defender has no Might
  errorOf(await post(alice, id, 'rank', { unit: 'guard', track: 'might' }), 400, 'invalid_input');
  errorOf(await post(alice, id, 'rank', { unit: 'raider', track: 'bulwark' }), 400, 'invalid_input'); // an attacker has no Bulwark
  errorOf(await post(alice, id, 'rank', { unit: 'pathfinder', track: 'might' }), 400, 'invalid_input');
  errorOf(await post(alice, id, 'rank', { unit: 'pikeman', track: 'speed' }), 400, 'invalid_input');

  // Buy Pikeman Bulwark ranks until the next one no longer fits the pool.
  let spent = 0;
  let bought = 0;
  while (spent + RANK_POINTS[bought]! <= pool) {
    const r = await post(alice, id, 'rank', { unit: 'pikeman', track: 'bulwark' });
    ok(r, 200);
    spent += RANK_POINTS[bought]!;
    bought++;
    assert.equal(r.json<{ state: { ranks: { pikeman: { bulwark: number } } } }>().state.ranks.pikeman.bulwark, bought);
  }
  assert.ok(bought >= 1);
  assert.equal(pointsSpent(app.ctx.store.getVillage(id)!.state), spent);
  assert.ok(pool - spent < RANK_POINTS[0]!, 'not even a first rank of another track fits now');
  errorOf(await post(alice, id, 'rank', { unit: 'raider', track: 'might' }), 409, 'requirements_not_met'); // no points left

  const gold = (await village(alice)).state.resources.gold;
  const back = await post(alice, id, 'respec', { unit: 'pikeman', track: 'bulwark' });
  ok(back, 200);
  const st = back.json<{ state: { ranks: { pikeman: { bulwark: number } }; resources: Resources } }>().state;
  assert.equal(st.ranks.pikeman.bulwark, 0);
  assert.ok(Math.abs(st.resources.gold - gold) < 1);
  assert.equal(pointsSpent(app.ctx.store.getVillage(id)!.state), 0, 'every point came back');
  errorOf(await post(alice, id, 'respec', { unit: 'pikeman', track: 'bulwark' }), 400, 'invalid_input'); // nothing left to reset
  ok(await post(alice, id, 'rank', { unit: 'raider', track: 'might' }), 200);
});

test('authorization: another player cannot research, buy or reset in my village; guests are refused', async () => {
  const { app, alice, bob } = await world();
  const id = setup(app, alice, 3);
  ok(await post(alice, id, 'rank', { unit: 'pikeman', track: 'bulwark' }), 200);
  for (const [path, body] of [
    ['research', { unit: 'guard' }],
    ['rank', { unit: 'raider', track: 'might' }],
    ['respec', { unit: 'pikeman', track: 'bulwark' }],
  ] as const) {
    errorOf(await post(bob, id, path, body), 403, 'forbidden'); // same answer as build/train (uniform-errors item is open in the roadmap)
    errorOf(await post(bob, 999_999, path, body), 404, 'not_found');
    errorOf(await post(bob, 'abc', path, body), 400, 'invalid_input');
  }
  const mine = (await village(alice)).state;
  assert.equal(mine.ranks?.raider?.might ?? 0, 0);
  assert.equal(mine.ranks?.pikeman?.bulwark, 1);
  assert.equal(mine.researchQueue, undefined);
});

test('research: the same unit cannot be queued twice', async () => {
  const { app, alice } = await world();
  const id = setup(app, alice, 3);
  ok(await post(alice, id, 'research', { unit: 'guard' }), 200);
  const dup = await post(alice, id, 'research', { unit: 'guard' });
  assert.ok(dup.statusCode >= 400 && dup.statusCode < 500, dup.body);
  assert.equal((await village(alice)).state.researchQueue?.length, 1);
});

test('cancel-research: the running one refunds 80% and the next starts; a queued one can be cancelled', async () => {
  const { app, clock, alice } = await world();
  const id = setup(app, alice, 3);
  ok(await post(alice, id, 'research', { unit: 'guard' }), 200);
  ok(await post(alice, id, 'research', { unit: 'outrider' }), 200);
  const paid = (await village(alice)).state.resources;

  clock.advance(1000);
  ok(await post(alice, id, 'cancel-research', { index: 0 }), 200);
  const st = (await village(alice)).state;
  assert.equal(st.researchQueue?.length, 1);
  assert.equal(st.researchQueue![0]!.unit, 'outrider', 'the next research started');
  assert.ok(!st.researched?.includes('guard'));
  const cost = UNITS.guard.research!.cost;
  assert.ok(st.resources.wood - paid.wood >= Math.floor(cost.wood * 0.8) - 1, 'about 80% of the wood came back');
  assert.ok(st.resources.wood - paid.wood < cost.wood, 'not the full cost');

  // Queue another, then cancel the waiting one (index 1); the running one stays.
  ok(await post(alice, id, 'research', { unit: 'guard' }), 200);
  ok(await post(alice, id, 'cancel-research', { index: 1 }), 200);
  const s2 = (await village(alice)).state;
  assert.equal(s2.researchQueue?.length, 1);
  assert.equal(s2.researchQueue![0]!.unit, 'outrider');
  ok(await post(alice, id, 'cancel-research', { index: 0 }), 200);
  assert.equal((await village(alice)).state.researchQueue, undefined);
});

test('cancel-research: bad or out-of-range index, other players and guests are refused', async () => {
  const { app, alice, bob } = await world();
  const id = setup(app, alice, 3);
  errorOf(await post(alice, id, 'cancel-research', { index: 0 }), 400, 'invalid_input'); // empty queue
  ok(await post(alice, id, 'research', { unit: 'guard' }), 200);
  errorOf(await post(alice, id, 'cancel-research', { index: 1 }), 400, 'invalid_input');
  errorOf(await post(alice, id, 'cancel-research', { index: -1 }), 400, 'invalid_input');
  errorOf(await post(alice, id, 'cancel-research', { index: 1.5 }), 400, 'invalid_input');
  errorOf(await post(alice, id, 'cancel-research', { index: 99 }), 400, 'invalid_input');
  errorOf(await post(alice, id, 'cancel-research', { index: '0' }), 400, 'invalid_input');
  errorOf(await post(alice, id, 'cancel-research', {}), 400, 'invalid_input');
  errorOf(await post(bob, id, 'cancel-research', { index: 0 }), 403, 'forbidden');
  errorOf(await post(bob, 999_999, 'cancel-research', { index: 0 }), 404, 'not_found');
  const guest = new Client(app, '10.9.0.1');
  const g = await guest.post(`/api/villages/${id}/cancel-research`, { index: 0 });
  assert.equal(g.statusCode, 401, g.body);
  assert.equal((await village(alice)).state.researchQueue?.length, 1);
});

test('ranks: the Chieftain cannot be ranked, the Firecart only in Breach', async () => {
  const { app, alice } = await world();
  const id = setup(app, alice, 10);
  const v = app.ctx.store.getVillage(id)!;
  v.state.researched = [...(v.state.researched ?? []), 'chieftain', 'firecart'];
  app.ctx.store.saveVillage(id, v.state, v.points);
  for (const track of ['might', 'bulwark', 'keen', 'breach']) errorOf(await post(alice, id, 'rank', { unit: 'chieftain', track }), 400, 'invalid_input');
  for (const track of ['might', 'bulwark', 'keen']) errorOf(await post(alice, id, 'rank', { unit: 'firecart', track }), 400, 'invalid_input');
  ok(await post(alice, id, 'rank', { unit: 'firecart', track: 'breach' }), 200);
});

test('migration v26: removes Chieftain/Firecart ranks everywhere, frees the points, twice changes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-ranks-'));
  try {
    const dbPath = join(dir, 'game.sqlite');
    const clock = new Clock();
    const open = () => buildApp({ dbPath, now: clock.now, settings: TEST_WORLD, worldConfig: TEST_WORLD_CONFIG, webDistDir: '/nonexistent' });
    let app = await open();
    await register(app, 'alice');
    const vid = app.ctx.store.abandonedVillageIds()[0]!; // any village row works for the state check
    const mine = app.ctx.store.getVillage(vid)!;
    mine.state.buildings.drillyard = 10;
    mine.state.ranks = { pikeman: { might: 0, bulwark: 2, keen: 0 }, chieftain: { might: 3, bulwark: 0, keen: 0 }, firecart: { might: 0, bulwark: 2, keen: 0 } };
    app.ctx.store.saveVillage(vid, mine.state, mine.points);
    await app.close();

    const raw = new DatabaseSync(dbPath);
    raw.exec("DELETE FROM meta WHERE key = 'useless_ranks_applied'");
    raw.exec('PRAGMA user_version = 25');
    raw.close();

    app = await open();
    const st = app.ctx.store.getVillage(vid)!.state;
    assert.deepEqual(st.ranks, { pikeman: { might: 0, bulwark: 2, keen: 0, breach: 0 } }); // a loaded village always has all four tracks
    assert.equal(pointsSpent(st), rankPointsUpTo(2), 'the points of the removed Chieftain and Firecart ranks are free again');
    const snap = JSON.stringify(app.ctx.store.db.prepare('SELECT id, state_json FROM villages ORDER BY id').all());
    await app.close();
    app = await open();
    assert.equal(JSON.stringify(app.ctx.store.db.prepare('SELECT id, state_json FROM villages ORDER BY id').all()), snap);
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
