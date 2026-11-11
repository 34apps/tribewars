// The originality pass migration (schema v17): an old world gets Longhouse = Farm, Firecarts instead of Log Rams and Boulder Slings
// (home, away, marching), refunds for queued siege, and a free Wrightyard. It runs once, inside the schema upgrade, after a backup.

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { popCapForLevel, storageCapForLevel, villagePoints, type GameStateResponse, type VillageState } from '@clanfire/engine';
import { buildApp } from '../src/app.ts';
import { SCHEMA_VERSION } from '../src/db.ts';
import { Client, Clock, HOUR, PASSWORD, TEST_WORLD, TEST_WORLD_CONFIG, ok } from './helpers.ts';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test('an old database: Longhouse = Farm, siege units become Firecarts, queued siege refunded, a free Wrightyard; once only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-originality-'));
  try {
    const dbPath = join(dir, 'game.sqlite');
    const clock = new Clock();
    const open = () => buildApp({ dbPath, now: clock.now, settings: TEST_WORLD, worldConfig: TEST_WORLD_CONFIG, webDistDir: '/nonexistent' });
    let app = await open();
    const c = new Client(app);
    ok(await c.post('/api/auth/register', { username: 'alice', password: PASSWORD }), 201);
    const state = await c.state();
    const homeId = state.villages[0]!.id;
    const npcId = app.ctx.store.abandonedVillageIds()[0]!;
    const abandonedBefore = (app.ctx.store.getVillage(npcId)!.state as VillageState).buildings;
    assert.equal(abandonedBefore.longhouse, abandonedBefore.farm, 'a new abandoned village already has Longhouse = Farm');
    await app.close();

    // Make the file look like the version before: legacy units and queues, Farm room, no Longhouse or Wrightyard, no flag.
    const t = clock.now();
    const raw = new DatabaseSync(dbPath);
    const row = raw.prepare('SELECT state_json FROM villages WHERE id = ?').get(homeId) as { state_json: string };
    const old = JSON.parse(row.state_json) as Loose;
    old.buildings = { ...old.buildings, farm: 9, barracks: 6, storehouse: 10 };
    delete old.buildings.longhouse;
    delete old.buildings.wrightyard;
    delete old.trainQueues.wrightyard;
    old.troops = { ...old.troops, pikeman: 5, logram: 7, boulder: 4 };
    old.away = { ...old.away, logram: 2, boulder: 1 };
    old.resources = { wood: 100, food: 100, iron: 100, gold: 0 };
    old.lastUpdate = t;
    old.buildQueue = [{ building: 'farm', targetLevel: 10, startAt: t, finishAt: t + 5 * HOUR }];
    old.trainQueues.barracks = [
      { unit: 'pikeman', count: 5, done: 0, perUnitMs: 1000, startAt: t },
      { unit: 'logram', count: 10, done: 4, perUnitMs: 5000, startAt: t + 5000 },
      { unit: 'raider', count: 2, done: 0, perUnitMs: 1000, startAt: t + 40_000 },
    ];
    old.researchQueue = [{ unit: 'boulder', startAt: t, finishAt: t + HOUR }];
    raw.prepare('UPDATE villages SET state_json = ?, points = 1 WHERE id = ?').run(JSON.stringify(old), homeId);
    raw.prepare("INSERT INTO movements (kind, origin_village_id, target_village_id, units_json, loot_json, depart_at, arrive_at) VALUES ('attack', ?, ?, ?, NULL, ?, ?)").run(
      homeId,
      npcId,
      JSON.stringify({ raider: 3, logram: 2, boulder: 1 }),
      t,
      t + 5 * HOUR,
    );
    raw.exec("DELETE FROM meta WHERE key = 'originality_applied'");
    raw.exec('PRAGMA user_version = 16');
    raw.close();

    app = await open();
    assert.equal(readdirSync(join(dir, 'backups')).filter((f) => f.startsWith(`pre-migrate-v16-v${SCHEMA_VERSION}-`)).length, 1, 'the old file is copied first');
    assert.ok(SCHEMA_VERSION >= 17);
    const v = app.ctx.store.getVillage(homeId)!;
    const s = v.state as VillageState & Loose;
    assert.equal(s.buildings.longhouse, 9, 'Longhouse = the Farm level');
    assert.equal(s.buildings.farm, 9);
    assert.equal(s.buildQueue[0]?.building, 'farm', 'a queued Farm level still finishes as a Farm');
    assert.equal(s.buildings.wrightyard, 1, 'Barracks 6 gets a free Wrightyard');
    assert.deepEqual(s.trainQueues.wrightyard, []);
    assert.equal(s.troops.firecart, Math.floor((3 * 7 + 2 * 4) / 3), 'home: floor((3 rams + 2 slings) / 3)');
    assert.equal(s.troops.pikeman, 5);
    assert.equal((s.troops as Loose).logram, undefined);
    assert.equal((s.troops as Loose).boulder, undefined);
    // Away = what the marching troops became (3 rams-pop 6 + 1 sling-pop 2 -> 2), so `away` and the movement agree.
    const moves = app.ctx.store.movementsFrom(homeId).filter((m) => m.kind === 'attack');
    assert.equal(moves.length, 1);
    assert.equal(moves[0]!.units.firecart, 2);
    assert.equal(moves[0]!.units.raider, 3);
    assert.equal(s.away.firecart, 2);
    // Queues: the siege batch and the siege research are gone, the others stay; the refund is capped at the Storehouse.
    assert.deepEqual(s.trainQueues.barracks.map((j) => j.unit), ['pikeman', 'raider']);
    assert.equal(s.researchQueue, undefined);
    const cap = storageCapForLevel(10);
    assert.equal(s.resources.wood, Math.min(cap, 100 + 6 * 95 + 700));
    assert.equal(s.resources.iron, Math.min(cap, 100 + 6 * 100 + 900));
    assert.equal(s.resources.gold, 6 * 2 + 40);
    assert.equal(v.points, villagePoints(s), 'village points are recomputed');
    assert.ok(popCapForLevel(9) > 0);

    // The server serves the new shape.
    const c2 = new Client(app);
    ok(await c2.post('/api/auth/login', { username: 'alice', password: PASSWORD }));
    const served: GameStateResponse = await c2.state();
    const own = served.villages.find((x) => x.id === homeId)!.state;
    assert.equal(own.buildings.longhouse, 9);
    assert.equal(own.troops.firecart, 9);
    const before = JSON.stringify(app.ctx.store.getVillage(homeId)?.state);
    await app.close();

    // Opening it again changes nothing (the flag is set), and no second backup is made.
    app = await open();
    assert.equal(JSON.stringify(app.ctx.store.getVillage(homeId)?.state), before);
    assert.equal(readdirSync(join(dir, 'backups')).length, 1);
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
