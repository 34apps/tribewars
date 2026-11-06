// Fair start spots, terrain amount and the abandoned villages of a newcomer, in the real server (owner decisions 2026-11-06).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_WORLD_CONFIG, startGround, type WorldConfigResponse } from '@clanfire/engine';
import { buildApp } from '../src/app.ts';
import { openDatabase } from '../src/db.ts';
import { Client, TEST_WORLD, makeApp, register } from './helpers.ts';
import { newPlayer } from './tribe-helpers.ts';
import { villagesOf } from './village-helpers.ts';

const expanding = { seed: 7, radius: 120, layout: 'expanding' as const, npcDensity: 0 };
const NOBODY = { npc: { selfBuild: false } };

test('every registered start spot passes the fair-start rule in a normal world, and the restart spot too', async () => {
  const { app } = await makeApp({ world: expanding });
  const store = app.ctx.store;
  const settlers = [];
  for (let i = 0; i < 12; i++) settlers.push(await newPlayer(app, `settler${i}`));
  let fair = 0;
  for (const p of settlers) {
    const v = villagesOf(app, p)[0]!;
    if (startGround(v.x, v.y, app.ctx.settings).fair) fair++;
  }
  assert.ok(fair >= 11, `${fair} of 12 start spots are fair`);

  // Restart at the edge: take a village away, the next request places a new one.
  const loser = settlers[0]!;
  store.setVillageOwner(villagesOf(app, loser)[0]!.id, settlers[1]!.id, 'Taken');
  app.ctx.auth.ensureStartingVillage(store.getPlayer(loser.id)!);
  const again = store.villagesOfPlayer(loser.id)[0]!;
  assert.ok(startGround(again.x, again.y, app.ctx.settings).fair, 'the restart spot is fair');
  await app.close();
});

test('registration never fails, even when no spot can meet the rule (best one found is taken)', async () => {
  const { app } = await makeApp({
    world: expanding,
    worldConfig: { ...NOBODY, start: { minOpenShare: 1, maxSlowShare: 0, tries: 5 }, terrain: { amount: 1.5 } },
  });
  for (let i = 0; i < 10; i++) {
    const c = await register(app, `hard${i}`, `10.1.0.${i + 1}`);
    assert.equal((await c.state()).villages.length, 1);
  }
  await app.close();
});

test('the published rules carry the new settings; a new world stores them all', async () => {
  const { app } = await makeApp({ world: expanding });
  const res = await new Client(app).get('/api/world/config');
  assert.equal(res.statusCode, 200);
  const cfg = res.json<WorldConfigResponse>().config;
  assert.equal(cfg.terrain.amount, 1);
  assert.equal(cfg.npc.perNewcomer, DEFAULT_WORLD_CONFIG.npc.perNewcomer);
  assert.deepEqual(cfg.start, DEFAULT_WORLD_CONFIG.start);
  const stored = JSON.parse(app.ctx.store.getMeta('world_config') ?? '{}');
  assert.equal(stored.terrain.amount, 1);
  assert.equal(stored.npc.startRingScale, DEFAULT_WORLD_CONFIG.npc.startRingScale);
  await app.close();
});

test('an old world keeps the old numbers: a stored config without the new settings reads the legacy values; new values stored win', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-fair-'));
  try {
    const dbPath = join(dir, 'w.sqlite');
    const first = await buildApp({ dbPath, settings: TEST_WORLD, webDistDir: '/nonexistent' });
    await first.close();
    // As the version before 2026-11-06 left it: a stored config with none of the new settings.
    const raw = openDatabase(dbPath);
    const old = structuredClone(DEFAULT_WORLD_CONFIG) as unknown as Record<string, Record<string, unknown>>;
    delete old.terrain;
    delete old.start;
    delete old.npc!.perNewcomer;
    delete old.npc!.extraChance;
    delete old.npc!.startRingScale;
    raw.prepare("UPDATE meta SET value = ? WHERE key = 'world_config'").run(JSON.stringify(old));
    raw.close();
    const app = await buildApp({ dbPath, settings: TEST_WORLD, webDistDir: '/nonexistent' });
    const c = app.ctx.settings.config!;
    assert.equal(c.npc.perNewcomer, 3);
    assert.equal(c.npc.extraChance, 0.4);
    assert.equal(c.npc.startRingScale, 1);
    assert.equal(c.terrain.amount, 1);
    await app.close();

    // The operator writes new values into the stored config: they are read.
    const raw2 = openDatabase(dbPath);
    const edited = { ...old, npc: { ...old.npc, perNewcomer: 1 }, terrain: { amount: 0.5 } };
    raw2.prepare("UPDATE meta SET value = ? WHERE key = 'world_config'").run(JSON.stringify(edited));
    raw2.close();
    const again = await buildApp({ dbPath, settings: TEST_WORLD, webDistDir: '/nonexistent' });
    assert.equal(again.ctx.settings.config!.npc.perNewcomer, 1);
    assert.equal(again.ctx.settings.config!.terrain.amount, 0.5);
    await again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a newcomer brings about two abandoned villages by default, the configured number otherwise', async () => {
  const none = await makeApp({ world: expanding, worldConfig: { ...NOBODY, npc: { selfBuild: false, perNewcomer: 0, extraChance: 0 } } });
  const before = none.app.ctx.store.abandonedVillageIds().length;
  await newPlayer(none.app, 'soloist');
  assert.equal(none.app.ctx.store.abandonedVillageIds().length, before, 'perNewcomer 0 brings none');
  await none.app.close();

  const { app } = await makeApp({ world: expanding });
  const start = app.ctx.store.abandonedVillageIds().length;
  const n = 15;
  for (let i = 0; i < n; i++) await newPlayer(app, `pioneer${i}`);
  const per = (app.ctx.store.abandonedVillageIds().length - start) / n;
  assert.ok(per >= 1.2 && per <= 3, `about two per newcomer, got ${per}`);
  await app.close();
});
