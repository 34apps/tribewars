// Troop roster pass (schema v18, originality piece 5): Knights are Ember Guards 1:1 (home, away, marching), Knight research counts, batches
// queued at the Stables finish there, and new Ember Guards train at the Barracks only. Runs once, inside the schema upgrade, after a backup.

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { UNITS, type OwnVillageDto, type VillageState } from '@clanfire/engine';
import { buildApp } from '../src/app.ts';
import { SCHEMA_VERSION } from '../src/db.ts';
import { Client, Clock, HOUR, PASSWORD, TEST_WORLD, TEST_WORLD_CONFIG, errorOf, ok } from './helpers.ts';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const own = async (c: Client) => (await c.state()).villages[0]!;

test('an old database: Knights stay as Ember Guards, queued Stables batches finish there, Ember Guards train at the Barracks only; once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-roster-'));
  try {
    const dbPath = join(dir, 'game.sqlite');
    const clock = new Clock();
    const open = () => buildApp({ dbPath, now: clock.now, settings: TEST_WORLD, worldConfig: TEST_WORLD_CONFIG, webDistDir: '/nonexistent' });
    let app = await open();
    const c = new Client(app);
    ok(await c.post('/api/auth/register', { username: 'alice', password: PASSWORD }), 201);
    const homeId = (await c.state()).villages[0]!.id;
    const npcId = app.ctx.store.abandonedVillageIds()[0]!;
    await app.close();

    // Make the file look like v17: Knights everywhere, a Knight batch at the Stables, Stables 6 but Barracks 5 (cannot train Ember Guards yet).
    const t = clock.now();
    const raw = new DatabaseSync(dbPath);
    const row = raw.prepare('SELECT state_json FROM villages WHERE id = ?').get(homeId) as { state_json: string };
    const old = JSON.parse(row.state_json) as Loose;
    old.buildings = { ...old.buildings, hall: 10, barracks: 5, stables: 6, drillyard: 6, storehouse: 20, longhouse: 20, farm: 10 };
    old.troops = { ...old.troops, knight: 7 };
    old.away = { ...old.away, knight: 2 };
    old.researched = ['knight'];
    old.resources = { wood: 9000, food: 9000, iron: 9000, gold: 900 };
    old.lastUpdate = t;
    old.buildQueue = [];
    old.trainQueues.stables = [{ unit: 'knight', count: 3, done: 1, perUnitMs: 10_000, startAt: t }];
    raw.prepare('UPDATE villages SET state_json = ? WHERE id = ?').run(JSON.stringify(old), homeId);
    raw.prepare("INSERT INTO movements (kind, origin_village_id, target_village_id, units_json, loot_json, depart_at, arrive_at) VALUES ('attack', ?, ?, ?, NULL, ?, ?)").run(
      homeId,
      npcId,
      JSON.stringify({ knight: 2 }),
      t,
      t + 5 * HOUR,
    );
    raw.exec("DELETE FROM meta WHERE key = 'roster_applied'");
    raw.exec('PRAGMA user_version = 17');
    raw.close();

    app = await open();
    assert.ok(SCHEMA_VERSION >= 18);
    assert.equal(readdirSync(join(dir, 'backups')).filter((f) => f.startsWith(`pre-migrate-v17-v${SCHEMA_VERSION}-`)).length, 1, 'the old file is copied first');
    const s = app.ctx.store.getVillage(homeId)!.state as VillageState;
    assert.equal(s.troops.knight, 7, 'Knights are Ember Guards 1:1');
    assert.equal(s.away.knight, 2);
    assert.ok(s.researched?.includes('knight'), 'Knight research counts as Ember Guard research');
    assert.equal(app.ctx.store.movementsFrom(homeId).find((m) => m.kind === 'attack')?.units.knight, 2);
    assert.deepEqual(s.trainQueues.stables.map((j) => `${j.unit}:${j.count}`), ['knight:3'], 'the queued batch stays at the Stables');

    // The batch finishes there as Ember Guards (2 of its 3 were still to come).
    const c2 = new Client(app);
    ok(await c2.post('/api/auth/login', { username: 'alice', password: PASSWORD }));
    clock.set(t + 3 * 10_000 + 100);
    const done = (await own(c2)).state;
    assert.equal(done.troops.knight, 7 + 2);
    assert.deepEqual(done.trainQueues.stables, []);

    // Barracks 5: the Ember Guard is refused even with a Stables 6, and nothing is queued at the Stables.
    errorOf(await c2.post(`/api/villages/${homeId}/train`, { unit: 'knight', count: 1 }), 409, 'requirements_not_met');
    assert.deepEqual((await own(c2)).state.trainQueues.stables, []);

    // Barracks 8 + Town Hall 8: accepted, and it lands in the Barracks queue with the Ember Guard's own time.
    const v = app.ctx.store.getVillage(homeId)!;
    v.state.buildings.barracks = 8;
    app.ctx.store.saveVillage(v.id, v.state, v.points);
    const res = await c2.post(`/api/villages/${homeId}/train`, { unit: 'knight', count: 2 });
    ok(res);
    const q = res.json<OwnVillageDto>().state.trainQueues;
    assert.deepEqual(q.barracks.map((j) => `${j.unit}:${j.count}`), ['knight:2']);
    assert.deepEqual(q.stables, []);
    assert.ok(Math.abs((q.barracks[0]!.perUnitMs - (UNITS.knight.trainTimeSec * 1000 * 0.94 ** 7) / app.ctx.game.settings.speed) / 1000) < 1);
    await app.close();

    // Opening it again changes nothing and makes no second backup.
    app = await open();
    assert.equal(readdirSync(join(dir, 'backups')).length, 1);
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Elk Rider stays a Stables unit and the Stables list no longer trains the Ember Guard', () => {
  assert.equal(UNITS.outrider.building, 'stables');
  assert.equal(UNITS.knight.building, 'barracks');
  assert.equal(UNITS.outrider.name, 'Elk Rider');
});
