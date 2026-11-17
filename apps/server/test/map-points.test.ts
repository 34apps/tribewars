// Map scaling (schema v21): the map reads stored points of abandoned villages and villages.protected_until instead of parsing JSON per call.
// The caretaker keeps abandoned villages' stored state fresh, at most hourly, bounded, and always the same result as the lazy settle.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { NPC_REFRESH_BATCH, normalizeVillage, settleVillage, villagePoints, worldRules, type MapResponse, type VillageState } from '@clanfire/engine';
import { buildApp } from '../src/app.ts';
import { DUE_BUDGET } from '../src/game.ts';
import { HOUR, MINUTE, TEST_WORLD, TEST_WORLD_CONFIG, makeApp, ok, register, type Client } from './helpers.ts';
import { newPlayer, type App } from './tribe-helpers.ts';
import { unprotect } from './warfare-helpers.ts';

const SELF_BUILD = { npc: { selfBuild: true } };
const REFRESH = HOUR / 10; // one hour of game time at speed 10

const mapAll = async (c: Client, radius = 12): Promise<MapResponse['villages']> => {
  const span = radius * 2 + 1;
  const res = await c.get(`/api/map?x=${-radius}&y=${-radius}&w=${span}&h=${span}`);
  ok(res);
  return res.json<MapResponse>().villages;
};

/** Same village up to float rounding of the stock (a stepped settle adds the same hours in pieces). */
function assertSameVillage(a: VillageState, b: VillageState, msg: string): void {
  for (const r of Object.keys(a.resources) as Array<keyof VillageState['resources']>) assert.ok(Math.abs(a.resources[r] - b.resources[r]) < 1e-6, `${msg}: ${r}`);
  assert.deepEqual({ ...a, resources: b.resources }, b, msg);
}

const npcIds = (app: App): number[] => app.ctx.store.abandonedVillageIds();
const stampOf = (app: App, id: number): number | null => (app.ctx.store.db.prepare('SELECT npc_refresh_at AS t FROM villages WHERE id = ?').get(id) as { t: number | null }).t;
const stored = (app: App, id: number) => app.ctx.store.getVillage(id)!;

test('protected flag: beginner protection, a village\'s own protection (copy in the column) and the end of protection', async () => {
  const { app, clock } = await makeApp();
  const store = app.ctx.store;
  const viewer = await newPlayer(app, 'viewer');
  const rookie = await newPlayer(app, 'rookie'); // still under beginner protection
  const founder = await newPlayer(app, 'founder');
  unprotect(app, viewer, founder);
  const flag = async (ownerId: number): Promise<boolean> => (await mapAll(viewer.c)).find((v) => v.kind === 'player' && store.getVillage(v.id)!.ownerId === ownerId)!.protected;

  assert.equal(await flag(rookie.id), true, 'beginner protection shows');
  assert.equal(await flag(founder.id), false);

  const home = store.villagesOfPlayer(founder.id)[0]!;
  const until = clock.t + HOUR;
  store.saveVillage(home.id, { ...home.state, protectedUntil: until }, home.points);
  const col = (): number => (store.db.prepare('SELECT protected_until AS p FROM villages WHERE id = ?').get(home.id) as { p: number }).p;
  assert.equal(col(), until, 'saveVillage keeps the column in step');
  assert.equal(await flag(founder.id), true, 'the village\'s own protection shows');

  clock.advance(HOUR + 1);
  assert.equal(await flag(founder.id), false, 'and ends');

  const { protectedUntil: _gone, ...rest } = store.getVillage(home.id)!.state;
  store.saveVillage(home.id, rest as VillageState, home.points);
  assert.equal(col(), 0, 'a state without protectedUntil stores 0');
  const id2 = store.insertVillage(founder.id, 'Second', 11, 11, 5, { ...home.state, protectedUntil: until });
  assert.equal((store.db.prepare('SELECT protected_until AS p FROM villages WHERE id = ?').get(id2) as { p: number }).p, until, 'insertVillage too');
  await app.close();
});

test('the map shows stored points of abandoned villages; the caretaker refreshes them to exactly the lazy settle, at most once per interval', async () => {
  const { app, clock } = await makeApp({ worldConfig: SELF_BUILD });
  const c = await register(app, 'watcher');
  const ids = npcIds(app);
  assert.ok(ids.length > 3);
  const before = new Map(ids.map((id) => [id, stored(app, id)]));

  clock.advance(12 * HOUR);
  const t = clock.t;
  const stale = (await mapAll(c)).filter((v) => v.kind === 'abandoned');
  for (const v of stale) assert.equal(v.points, before.get(v.id)!.points, 'before any pass the map shows the stored points');

  const n = app.ctx.game.refreshAbandonedVillages(t);
  assert.equal(n, ids.length, 'every abandoned village was due (never refreshed)');
  let grew = 0;
  for (const id of ids) {
    const want = settleVillage(before.get(id)!.state, t, app.ctx.settings);
    const got = stored(app, id);
    assertSameVillage(got.state, normalizeVillage(want), 'saved state equals the lazy settle');
    assert.equal(got.points, villagePoints(want));
    assert.equal(stampOf(app, id), t);
    if (got.points > before.get(id)!.points) grew++;
  }
  assert.ok(grew > 0, 'some villages grew');
  for (const v of (await mapAll(c)).filter((x) => x.kind === 'abandoned')) assert.equal(v.points, stored(app, v.id).points, 'the map shows the refreshed points');

  clock.advance(REFRESH - MINUTE);
  assert.equal(app.ctx.game.refreshAbandonedVillages(clock.t), 0, 'nothing is refreshed twice within the interval');
  clock.advance(2 * MINUTE);
  assert.equal(app.ctx.game.refreshAbandonedVillages(clock.t), ids.length, 'due again after the interval');
  await app.close();
});

test('refresh is bounded by the batch size, oldest first; the caretaker pass runs it', async () => {
  const { app, clock } = await makeApp({ worldConfig: SELF_BUILD });
  await register(app, 'watcher');
  const ids = npcIds(app);
  assert.ok(ids.length > 7);
  clock.advance(HOUR);
  assert.equal(app.ctx.game.refreshAbandonedVillages(clock.t, 3), 3);
  assert.equal(ids.filter((id) => stampOf(app, id) !== null).length, 3);
  clock.advance(MINUTE);
  assert.equal(app.ctx.game.refreshAbandonedVillages(clock.t, 3), 3);
  const done = ids.filter((id) => stampOf(app, id) !== null);
  assert.equal(done.length, 6, 'the second call took the next oldest, not the same three');
  assert.equal(new Set(done.map((id) => stampOf(app, id))).size, 2);
  assert.ok(app.ctx.game.refreshAbandonedVillages(clock.t, 0, 20) === 0, 'a batch of 0 does nothing');

  assert.ok(NPC_REFRESH_BATCH >= ids.length);
  clock.advance(MINUTE);
  app.ctx.game.runCaretaker(clock.t);
  assert.ok(ids.every((id) => stampOf(app, id) !== null), 'the periodic pass refreshes the rest');
  await app.close();
});

test('the time budget stops a pass after at least one village', async () => {
  const { app, clock } = await makeApp({ worldConfig: SELF_BUILD });
  await register(app, 'watcher');
  clock.advance(HOUR);
  assert.equal(app.ctx.game.refreshAbandonedVillages(clock.t, 400, 0), 1, 'a zero budget still makes progress, one village per pass');
  await app.close();
});

test('skipped while a movement backlog is unresolved, with the rule off, and in a finished world', async () => {
  const { app, clock } = await makeApp({ worldConfig: SELF_BUILD });
  const c = await register(app, 'watcher');
  const home = await c.village();
  const target = npcIds(app)[0]!;
  const insert = app.ctx.store.db.prepare(
    "INSERT INTO movements (kind, origin_village_id, target_village_id, units_json, loot_json, depart_at, arrive_at) VALUES ('attack', ?, ?, ?, NULL, ?, ?)",
  );
  const t0 = clock.t;
  for (let i = 0; i < DUE_BUDGET.maxCount + 5; i++) insert.run(home.id, target, JSON.stringify({ raider: 1 }), t0, t0 + 1000 + i);
  clock.advance(HOUR);
  // More due arrivals than one pass may resolve: the pass sees the backlog and refreshes nothing.
  app.ctx.game.runCaretaker(clock.t);
  assert.equal(app.ctx.game.dueBacklog, true);
  assert.ok(npcIds(app).every((id) => stampOf(app, id) === null), 'nothing was settled past unresolved arrivals');
  await app.close();

  const off = await makeApp(); // test world: selfBuild off
  await register(off.app, 'watcher');
  off.clock.advance(24 * HOUR);
  assert.equal(worldRules(off.app.ctx.settings).npc.selfBuild, false);
  assert.equal(off.app.ctx.game.refreshAbandonedVillages(off.clock.t), 0);
  off.app.ctx.game.runCaretaker(off.clock.t);
  assert.ok(npcIds(off.app).every((id) => stampOf(off.app, id) === null));
  await off.app.close();
});

test('settling in hourly steps gives the same village as one settle (the refresh changes nothing but when the work is done)', async () => {
  const { app, clock } = await makeApp({ worldConfig: SELF_BUILD });
  await register(app, 'watcher');
  const s = app.ctx.settings;
  for (const id of npcIds(app).slice(0, 6)) {
    const start = stored(app, id).state;
    for (const days of [1, 5, 20]) {
      const end = clock.t + days * 24 * HOUR;
      let stepped = start;
      for (let at = clock.t + REFRESH; at < end; at += REFRESH) stepped = settleVillage(stepped, at, s);
      stepped = settleVillage(stepped, end, s);
      assertSameVillage(normalizeVillage(stepped), normalizeVillage(settleVillage(start, end, s)), `village ${id} after ${days} days`);
    }
  }
  await app.close();
});

test('migration v21: protected_until is copied from the saved state once; a second open changes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-protuntil-'));
  try {
    const dbPath = join(dir, 'game.sqlite');
    const { Clock } = await import('./helpers.ts');
    const clock = new Clock();
    const open = () => buildApp({ dbPath, now: clock.now, settings: TEST_WORLD, worldConfig: TEST_WORLD_CONFIG, webDistDir: '/nonexistent' });
    let app = await open();
    await register(app, 'alice');
    const [withIt, without] = [app.ctx.store.abandonedVillageIds()[0]!, app.ctx.store.abandonedVillageIds()[1]!];
    const until = clock.t + 5 * HOUR;
    await app.close();

    // Make the file look like v20: no column, state_json carries protectedUntil on one village only.
    const raw = new DatabaseSync(dbPath);
    for (const [id, pu] of [[withIt, until], [without, undefined]] as const) {
      const state = JSON.parse((raw.prepare('SELECT state_json FROM villages WHERE id = ?').get(id) as { state_json: string }).state_json) as Record<string, unknown>;
      if (pu === undefined) delete state.protectedUntil;
      else state.protectedUntil = pu;
      raw.prepare('UPDATE villages SET state_json = ? WHERE id = ?').run(JSON.stringify(state), id);
    }
    raw.exec('DROP INDEX IF EXISTS idx_villages_npc_refresh');
    raw.exec('ALTER TABLE villages DROP COLUMN protected_until');
    raw.exec('ALTER TABLE villages DROP COLUMN npc_refresh_at');
    raw.exec("DELETE FROM meta WHERE key = 'protected_until_applied'");
    raw.exec('PRAGMA user_version = 20');
    raw.close();

    app = await open();
    const col = (id: number): number => (app.ctx.store.db.prepare('SELECT protected_until AS p FROM villages WHERE id = ?').get(id) as { p: number }).p;
    assert.equal(col(withIt), until);
    assert.equal(col(without), 0);
    const snapshot = JSON.stringify(app.ctx.store.db.prepare('SELECT id, protected_until, npc_refresh_at FROM villages ORDER BY id').all());
    await app.close();

    app = await open(); // flag set: nothing changes
    assert.equal(JSON.stringify(app.ctx.store.db.prepare('SELECT id, protected_until, npc_refresh_at FROM villages ORDER BY id').all()), snapshot);
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
