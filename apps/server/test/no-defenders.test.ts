// No defenders (owner 2026-11-17): map-born abandoned villages have no troops, only their Wall. Villages a player left keep their garrison.
// Schema v23: the migration empties the map-born ones in old worlds (and only those) and fills villages.has_troops, which the map shows as `defended`.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { abandonIdleMs, totalUnits, type MapResponse, type VillageState } from '@clanfire/engine';
import { buildApp } from '../src/app.ts';
import { HOUR, TEST_WORLD, TEST_WORLD_CONFIG, makeApp, ok, register, type Client } from './helpers.ts';

const mapAll = async (c: Client, radius = 12): Promise<MapResponse['villages']> => {
  const span = radius * 2 + 1;
  const res = await c.get(`/api/map?x=${-radius}&y=${-radius}&w=${span}&h=${span}`);
  ok(res);
  return res.json<MapResponse>().villages;
};

test('a new world: abandoned villages have no troops and the map marks none as defended', async () => {
  const { app } = await makeApp();
  const c = await register(app, 'alice');
  const ids = app.ctx.store.abandonedVillageIds();
  assert.ok(ids.length > 0);
  for (const id of ids) assert.equal(totalUnits(app.ctx.store.getVillage(id)!.state.troops), 0);
  const npcs = (await mapAll(c)).filter((v) => v.kind === 'abandoned');
  assert.ok(npcs.length > 0);
  for (const v of npcs) assert.equal(v.defended, undefined);
  await app.close();
});

test('a village a player leaves keeps a garrison and the map says defended; once it is beaten the mark is gone', async () => {
  const { app, clock } = await makeApp();
  const gone = await register(app, 'gone');
  const here = await register(app, 'here');
  const vid = (await gone.village()).id;
  clock.advance(abandonIdleMs(app.ctx.settings) - HOUR);
  ok(await here.get('/api/state'));
  clock.advance(HOUR + 60_000);
  app.ctx.game.runCaretaker(clock.now());
  const v = app.ctx.store.getVillage(vid)!;
  assert.equal(v.ownerId, null);
  assert.ok(totalUnits(v.state.troops) > 0, 'keeps its garrison');
  const mark = async (): Promise<boolean | undefined> => (await mapAll(here)).find((m) => m.id === vid)?.defended;
  assert.equal(await mark(), true);
  assert.equal((await mapAll(here)).filter((m) => m.kind === 'abandoned' && m.defended).length, 1, 'only that one');
  v.state.troops = { ...v.state.troops, pikeman: 0, guard: 0 };
  app.ctx.store.saveVillage(v.id, v.state, v.points);
  assert.equal(await mark(), undefined, 'beaten: no defenders left');
  await app.close();
});

test('migration v23: map-born villages lose their garrison, player-abandoned and owned ones are untouched; a second open changes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-nodef-'));
  try {
    const dbPath = join(dir, 'game.sqlite');
    const { Clock } = await import('./helpers.ts');
    const clock = new Clock();
    const open = () => buildApp({ dbPath, now: clock.now, settings: TEST_WORLD, worldConfig: TEST_WORLD_CONFIG, webDistDir: '/nonexistent' });
    let app = await open();
    await register(app, 'alice');
    const ids = app.ctx.store.abandonedVillageIds();
    assert.ok(ids.length >= 3);
    const left = ids[0]!; // pretend a player left this one: its createdAt is an abandonment time, not an insertion time
    await app.close();

    // Make the file look like v22: an old garrison everywhere, no has_troops column, no flag.
    const raw = new DatabaseSync(dbPath);
    const state = (id: number): VillageState => JSON.parse((raw.prepare('SELECT state_json FROM villages WHERE id = ?').get(id) as { state_json: string }).state_json) as VillageState;
    for (const id of ids) {
      const s = state(id);
      s.troops = { ...s.troops, pikeman: 4, guard: 2 };
      if (id === left) s.npc = { ...s.npc!, createdAt: clock.t + 40 * 24 * HOUR };
      raw.prepare('UPDATE villages SET state_json = ? WHERE id = ?').run(JSON.stringify(s), id);
    }
    const owned = raw.prepare('SELECT id, state_json FROM villages WHERE owner_id IS NOT NULL ORDER BY id').all();
    assert.ok(owned.length >= 1);
    raw.exec('ALTER TABLE villages DROP COLUMN has_troops');
    raw.exec("DELETE FROM meta WHERE key = 'mapborn_garrison_applied'");
    raw.exec('PRAGMA user_version = 22');
    raw.close();

    app = await open();
    const store = app.ctx.store;
    for (const id of ids) assert.equal(totalUnits(store.getVillage(id)!.state.troops), id === left ? 6 : 0, `village ${id}`);
    const flags = store.db.prepare('SELECT id, has_troops FROM villages ORDER BY id').all() as Array<{ id: number; has_troops: number }>;
    for (const f of flags) if (ids.includes(f.id)) assert.equal(f.has_troops, f.id === left ? 1 : 0);
    assert.deepEqual(store.db.prepare('SELECT id, state_json FROM villages WHERE owner_id IS NOT NULL ORDER BY id').all(), owned, 'player villages are byte-identical');
    const snapshot = JSON.stringify(store.db.prepare('SELECT id, state_json, has_troops FROM villages ORDER BY id').all());
    await app.close();

    app = await open();
    assert.equal(JSON.stringify(app.ctx.store.db.prepare('SELECT id, state_json, has_troops FROM villages ORDER BY id').all()), snapshot);
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
