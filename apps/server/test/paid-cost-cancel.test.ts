// Cancel refunds come from the cost stored in the job when it was queued (schema v20). Routes + the once-only migration that stamps old jobs.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { UNITS, buildingCost, type Resources, type VillageState } from '@clanfire/engine';
import { buildApp } from '../src/app.ts';
import { SCHEMA_VERSION } from '../src/db.ts';
import { Client, Clock, PASSWORD, TEST_WORLD, TEST_WORLD_CONFIG, makeApp, ok } from './helpers.ts';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const odd: Resources = { wood: 1000, food: 500, iron: 200, gold: 0 };
const eighty: Resources = { wood: 800, food: 400, iron: 160, gold: 0 };

test('cancel-build, cancel-train and cancel-research refund 80% of the stored cost, not today\'s price', async () => {
  const { app } = await makeApp();
  const c = new Client(app);
  ok(await c.post('/api/auth/register', { username: 'alice', password: PASSWORD }), 201);
  const v = app.ctx.store.getVillage((await c.state()).villages[0]!.id)!;
  v.state.buildings = { ...v.state.buildings, hall: 10, barracks: 5, drillyard: 5, storehouse: 25, farm: 15, longhouse: 15 };
  v.state.resources = { wood: 20_000, food: 20_000, iron: 20_000, gold: 2000 };
  app.ctx.store.saveVillage(v.id, v.state, v.points);
  const base = `/api/villages/${v.id}`;

  ok(await c.post(`${base}/build`, { building: 'lumber' }));
  ok(await c.post(`${base}/train`, { unit: 'pikeman', count: 5 }));
  ok(await c.post(`${base}/research`, { unit: 'guard' }));
  const queued = app.ctx.store.getVillage(v.id)!.state as VillageState;
  assert.ok(queued.buildQueue[0]!.cost && queued.trainQueues.barracks[0]!.unitCost && queued.researchQueue![0]!.cost, 'all three stamped');

  // A price change while queued: tamper the stored costs.
  queued.buildQueue[0]!.cost = odd;
  queued.trainQueues.barracks[0]!.unitCost = { wood: 100, food: 100, iron: 100, gold: 0 };
  queued.researchQueue![0]!.cost = odd;
  app.ctx.store.saveVillage(v.id, queued, v.points);

  const b = await c.post(`${base}/cancel-build`, { index: 0 });
  ok(b);
  assert.deepEqual(b.json<{ refund: Resources }>().refund, eighty);
  const t = await c.post(`${base}/cancel-train`, { building: 'barracks', index: 0 });
  ok(t);
  assert.deepEqual(t.json<{ refund: Resources }>().refund, { wood: 400, food: 400, iron: 400, gold: 0 });
  const r = await c.post(`${base}/cancel-research`, { index: 0 });
  ok(r);
  assert.deepEqual(r.json<{ refund: Resources }>().refund, eighty);
  await app.close();
});

test('migration v20: queued jobs without a paid cost get today\'s price once; stamped jobs are left alone; second open changes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-paidcost-'));
  try {
    const dbPath = join(dir, 'game.sqlite');
    const clock = new Clock();
    const open = () => buildApp({ dbPath, now: clock.now, settings: TEST_WORLD, worldConfig: TEST_WORLD_CONFIG, webDistDir: '/nonexistent' });
    let app = await open();
    const c = new Client(app);
    ok(await c.post('/api/auth/register', { username: 'alice', password: PASSWORD }), 201);
    const homeId = (await c.state()).villages[0]!.id;
    await app.close();

    const t = clock.now();
    const raw = new DatabaseSync(dbPath);
    const row = raw.prepare('SELECT state_json FROM villages WHERE id = ?').get(homeId) as { state_json: string };
    const old = JSON.parse(row.state_json) as Loose;
    old.lastUpdate = t;
    old.buildQueue = [
      { building: 'lumber', targetLevel: 3, startAt: t, finishAt: t + 10_000_000 },
      { building: 'mine', targetLevel: 2, startAt: t + 10_000_000, finishAt: t + 20_000_000, cost: odd },
    ];
    old.trainQueues.barracks = [{ unit: 'pikeman', count: 4, done: 0, perUnitMs: 60_000_000, startAt: t }];
    old.researchQueue = [{ unit: 'guard', startAt: t, finishAt: t + 30_000_000 }];
    raw.prepare('UPDATE villages SET state_json = ? WHERE id = ?').run(JSON.stringify(old), homeId);
    raw.exec("DELETE FROM meta WHERE key = 'paid_costs_applied'");
    raw.exec('PRAGMA user_version = 19');
    raw.close();

    app = await open();
    assert.ok(SCHEMA_VERSION >= 20);
    const s = app.ctx.store.getVillage(homeId)!.state as VillageState;
    assert.deepEqual(s.buildQueue[0]!.cost, buildingCost('lumber', 3));
    assert.deepEqual(s.buildQueue[1]!.cost, odd, 'already stamped: untouched');
    assert.deepEqual(s.trainQueues.barracks[0]!.unitCost, UNITS.pikeman.cost);
    assert.deepEqual(s.researchQueue![0]!.cost, UNITS.guard.research!.cost);
    const before = JSON.stringify(s);
    await app.close();

    // Second open: nothing changes (flag set); even with the flag cleared the stamped jobs stay as they are.
    app = await open();
    const same = JSON.stringify(app.ctx.store.getVillage(homeId)!.state) === before;
    await app.close();
    assert.ok(same);
    const raw2 = new DatabaseSync(dbPath);
    raw2.exec("DELETE FROM meta WHERE key = 'paid_costs_applied'");
    raw2.close();
    app = await open();
    const same2 = JSON.stringify(app.ctx.store.getVillage(homeId)!.state) === before;
    await app.close();
    assert.ok(same2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
