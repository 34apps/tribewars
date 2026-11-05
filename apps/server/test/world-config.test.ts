// Per-world rules, server side: storage at creation, loading (also old worlds without a stored config), the public endpoint,
// the operator tool (open/closed gate, audit log) and live refresh of a running app. Everything runs on the test clock.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_WORLD_CONFIG,
  DOMINATION_DEFAULTS,
  WORLD_CONFIG_PATHS,
  WORLD_CONFIG_SAFE_AFTER_OPEN,
  getWorldConfigValue,
  isSafeAfterOpen,
  worldConfigFromSettings,
  worldRules,
  type WorldConfig,
  type WorldConfigResponse,
} from '@clanfire/engine';
import { buildApp } from '../src/app.ts';
import { openDatabase } from '../src/db.ts';
import { runDominationCommand } from '../src/domination-admin.ts';
import { readStreak } from '../src/domination-service.ts';
import { loadEnv } from '../src/env.ts';
import { Store } from '../src/store.ts';
import { runWorldConfigCommand } from '../src/world-config-admin.ts';
import { Clock, Client, TEST_WORLD, makeApp, register } from './helpers.ts';

const stored = (store: Store): WorldConfig => JSON.parse(store.getMeta('world_config') ?? 'null') as WorldConfig;
const flatJson = (store: Store): Record<string, unknown> => JSON.parse(store.getMeta('world_settings') ?? '{}') as Record<string, unknown>;
const audit = (store: Store, action: string): Array<{ action: string; actor_ip: string; actor_id: number | null; detail: string }> =>
  store.db.prepare('SELECT action, actor_ip, actor_id, detail FROM audit_log WHERE action = ? ORDER BY id').all(action) as never;
const cli = (store: Store, cmd: 'config' | 'config-set' | 'world-open', args: string[], now = 1_000) => runWorldConfigCommand(store, cmd, args, now);

async function withDir<T>(fn: (dbPath: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-wc-'));
  try {
    return await fn(join(dir, 'w.sqlite'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- (a) storage at creation ------------------------------------------------------------------------------------------

test('a new world stores the default config next to the flat settings, in sync', async () => {
  const clock = new Clock();
  const app = await buildApp({ dbPath: ':memory:', now: clock.now, settings: { seed: 4242, radius: 12 }, webDistDir: '/nonexistent' });
  const store = app.ctx.store;
  assert.deepEqual(stored(store), DEFAULT_WORLD_CONFIG, 'no overrides: the stored config equals the defaults');
  assert.deepEqual(app.ctx.settings.config, DEFAULT_WORLD_CONFIG);
  const flat = flatJson(store);
  assert.equal('config' in flat, false, 'the flat row does not hold the config');
  assert.equal(flat.speed, DEFAULT_WORLD_CONFIG.pace.speed);
  assert.equal(flat.npcDensity, DEFAULT_WORLD_CONFIG.npc.density);
  assert.equal(flat.protectionHours, DEFAULT_WORLD_CONFIG.protection.beginnerHours);
  assert.deepEqual(flat.domination, DEFAULT_WORLD_CONFIG.domination);
  assert.equal(store.isWorldOpen(), false);
  assert.equal(store.worldOpenedAt(), null);
  await app.close();
});

test('settings from the environment (flat) end up in the config too', async () => {
  const { app } = await makeApp();
  const cfg = stored(app.ctx.store);
  assert.equal(cfg.pace.speed, TEST_WORLD.speed);
  assert.equal(cfg.npc.density, TEST_WORLD.npcDensity);
  assert.equal(cfg.npc.selfBuild, false, 'the test helper switches it off');
  assert.deepEqual(cfg.domination, DOMINATION_DEFAULTS);
  await app.close();
});

test('a creation override is stored, read back after reopening, and ignored on an existing world', async () => {
  await withDir(async (dbPath) => {
    const clock = new Clock();
    const override = { conquest: { holdHours: 4 }, pace: { unitSpeed: 2, speed: 5 }, features: { siege: false } };
    const first = await buildApp({ dbPath, now: clock.now, settings: { seed: 4242, radius: 12 }, worldConfig: override, webDistDir: '/nonexistent' });
    assert.equal(first.ctx.settings.config?.conquest.holdHours, 4);
    assert.equal(first.ctx.settings.speed, 5, 'the flat speed follows pace.speed');
    assert.equal(flatJson(first.ctx.store).speed, 5);
    await first.close();

    const second = await buildApp({ dbPath, now: clock.now, settings: { seed: 4242, radius: 12 }, worldConfig: { conquest: { holdHours: 99 } }, webDistDir: '/nonexistent' });
    const rules = worldRules(second.ctx.settings);
    assert.equal(rules.conquest.holdHours, 4, 'the stored value wins over a later override');
    assert.equal(rules.pace.unitSpeed, 2);
    assert.equal(rules.pace.speed, 5);
    assert.equal(rules.features.siege, false);
    assert.equal(rules.protection.foundHours, DEFAULT_WORLD_CONFIG.protection.foundHours, 'untouched settings keep the default');
    assert.equal(second.ctx.settings.speed, 5);
    await second.close();
  });
});

test('an invalid override stops the world from being created, and WORLD_CONFIG is validated at start', async () => {
  const clock = new Clock();
  await assert.rejects(buildApp({ dbPath: ':memory:', now: clock.now, settings: TEST_WORLD, worldConfig: { conquest: { holdHours: -1 } }, webDistDir: '/nonexistent' }), /Invalid world configuration/);
  await assert.rejects(buildApp({ dbPath: ':memory:', now: clock.now, settings: TEST_WORLD, worldConfig: { nope: { x: 1 } }, webDistDir: '/nonexistent' }), /Invalid world configuration/);
  await assert.rejects(buildApp({ dbPath: ':memory:', now: clock.now, settings: TEST_WORLD, worldConfig: [1], webDistDir: '/nonexistent' }), /Invalid world configuration/);

  assert.equal('worldConfig' in loadEnv({}), false);
  assert.equal('worldConfig' in loadEnv({ WORLD_CONFIG: '  ' }), false);
  assert.deepEqual(loadEnv({ WORLD_CONFIG: '{"conquest":{"holdHours":4},"pace":{"unitSpeed":2}}' }).worldConfig, { conquest: { holdHours: 4 }, pace: { unitSpeed: 2 } });
  for (const bad of ['{not json', '[]', '"x"', '{"conquest":{"holdHours":1000}}', '{"conquest":{"holdHours":"4"}}', '{"queues":{"build":1.5}}', '{"nothing":{"here":1}}', '{"conquest":{"nothing":1}}']) {
    assert.throws(() => loadEnv({ WORLD_CONFIG: bad }), /Invalid WORLD_CONFIG/, bad);
  }
});

// ---- (b) an old world without a stored config ---------------------------------------------------------------------------

test('an old world with only world_settings runs on a config derived in memory and nothing is written', async () => {
  await withDir(async (dbPath) => {
    const clock = new Clock();
    const first = await buildApp({ dbPath, now: clock.now, settings: { ...TEST_WORLD, speed: 7 }, webDistDir: '/nonexistent' });
    await first.close();
    // As an old version left it: the flat row only.
    const raw = openDatabase(dbPath);
    raw.prepare("DELETE FROM meta WHERE key = 'world_config'").run();
    raw.close();

    const app = await buildApp({ dbPath, now: clock.now, settings: { ...TEST_WORLD, speed: 7 }, webDistDir: '/nonexistent' });
    const store = app.ctx.store;
    const flat = store.getSettings();
    assert.ok(flat);
    assert.equal(flat.speed, 7);
    assert.deepEqual(app.ctx.settings.config, worldConfigFromSettings(flat));
    assert.equal(app.ctx.settings.config?.pace.speed, 7, 'the stored speed is kept');
    assert.equal(app.ctx.settings.speed, 7);
    assert.equal(store.getMeta('world_config'), null, 'starting wrote nothing');

    // It still plays: register, read the state, read the public config.
    const c = await register(app, 'oldtimer');
    assert.equal((await c.get('/api/state')).statusCode, 200);
    const res = await new Client(app).get('/api/world/config');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json<WorldConfigResponse>().config.pace.speed, 7);
    assert.equal(store.getMeta('world_config'), null, 'serving requests wrote nothing either');
    await app.close();
  });
});

test('config-set on an old world writes a complete config from its flat settings', async () => {
  const { app } = await makeApp();
  const store = app.ctx.store;
  store.db.prepare("DELETE FROM meta WHERE key = 'world_config'").run();
  assert.equal(cli(store, 'config-set', ['conquest.holdHours', '3']).ok, true);
  const cfg = stored(store);
  assert.equal(cfg.conquest.holdHours, 3);
  assert.equal(cfg.pace.speed, TEST_WORLD.speed, 'the flat speed was carried over');
  await app.close();
});

// ---- (c) the public endpoint --------------------------------------------------------------------------------------------

test('GET /api/world/config is public, complete, secret-free and shows when the world opens', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['zed-the-sandbox-user'], worldName: 'Tidewater' });
  const anon = new Client(app, '10.0.0.9');
  for (const url of ['/api/world/config', '/w/w1/api/world/config']) {
    const res = await anon.get(url);
    assert.equal(res.statusCode, 200, url);
    const body = res.json<WorldConfigResponse>();
    assert.deepEqual(Object.keys(body).sort(), ['config', 'editableAfterOpen', 'id', 'map', 'name', 'open', 'openedAt']);
    assert.equal(body.id, 'w1');
    assert.equal(body.name, 'Tidewater');
    assert.equal(body.open, false);
    assert.equal(body.openedAt, null);
    assert.deepEqual(body.map, { radius: TEST_WORLD.radius, layout: 'scattered' });
    assert.equal(body.config.pace.speed, TEST_WORLD.speed);
    assert.deepEqual(body.editableAfterOpen, [...WORLD_CONFIG_PATHS].filter((p) => p.startsWith('domination.') || WORLD_CONFIG_SAFE_AFTER_OPEN.includes(p)));
    assert.ok(body.editableAfterOpen.includes('domination.winShare'));
    assert.ok(body.editableAfterOpen.includes('tribe.maxMembers'));
    assert.equal(body.editableAfterOpen.includes('conquest.holdHours'), false);
    assert.equal(res.headers['cache-control'], 'no-store');
    const text = res.body.toLowerCase();
    for (const word of ['seed', 'lobby', 'key', 'password', 'token', 'sandbox', 'database', 'sqlite', 'zed-the']) assert.equal(text.includes(word), false, `no "${word}" in the public config`);
  }

  await register(app, 'firstone');
  const open = (await anon.get('/api/world/config')).json<WorldConfigResponse>();
  assert.equal(open.open, true, 'the first registration opens the world');
  assert.ok(open.openedAt && Math.abs(Date.parse(open.openedAt) - clock.now()) < 1000, 'openedAt is the time of the first player');
  await app.close();
});

test('the layout of an expanding world is published', async () => {
  const { app } = await makeApp({ world: { layout: 'expanding' } });
  const body = (await new Client(app).get('/api/world/config')).json<WorldConfigResponse>();
  assert.equal(body.map.layout, 'expanding');
  await app.close();
});

// ---- (d) the operator tool ----------------------------------------------------------------------------------------------

test('config lists every setting and says whether the world is open', async () => {
  const { app } = await makeApp();
  const store = app.ctx.store;
  const before = cli(store, 'config', []);
  assert.equal(before.ok, true);
  const text = before.lines.join('\n');
  assert.match(text, /not open yet/);
  for (const path of WORLD_CONFIG_PATHS) assert.ok(text.includes(`${path} = `), `lists ${path}`);
  assert.match(text, /\[conquest\]/);
  assert.match(text, /pace\.speed = 10 x\b/);
  assert.match(text, /tribe\.maxMembers = \d+ count \(can change after opening\)/);
  assert.match(text, /features\.siege = on\n/);
  assert.equal(/conquest\.holdHours = [\d.]+ hours \(can change/.test(text), false);

  assert.equal(cli(store, 'world-open', []).ok, true);
  assert.match(cli(store, 'config', []).lines[0] ?? '', /OPEN/);
  await app.close();
});

test('before the world opens every setting can change; each change is audit-logged and reaches the running app', async () => {
  const { app, clock } = await makeApp();
  const store = app.ctx.store;
  const anon = new Client(app, '10.0.0.8');

  const r = cli(store, 'config-set', ['conquest.holdHours', '4'], clock.now());
  assert.equal(r.ok, true, r.lines.join(' '));
  const rows = audit(store, 'world_config_set');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.actor_ip, 'cli');
  assert.equal(rows[0]?.actor_id, null);
  assert.match(rows[0]?.detail ?? '', /^conquest\.holdHours \d+(\.\d+)? -> 4$/);
  assert.equal(getWorldConfigValue(stored(store), 'conquest.holdHours'), 4);

  // The running app sees it with its next request: public endpoint AND the settings the engine reads.
  assert.equal(worldRules(app.ctx.settings).conquest.holdHours, DEFAULT_WORLD_CONFIG.conquest.holdHours, 'not yet: nobody asked the app');
  const shown = (await anon.get('/api/world/config')).json<WorldConfigResponse>();
  assert.equal(shown.config.conquest.holdHours, 4);
  assert.equal(worldRules(app.ctx.settings).conquest.holdHours, 4);

  // The flat fields follow pace.speed, in the row and in the running settings (same object, changed in place).
  const same = app.ctx.settings;
  assert.equal(cli(store, 'config-set', ['pace.speed', '20']).ok, true);
  assert.equal(flatJson(store).speed, 20);
  await anon.get('/api/world/config');
  assert.equal(app.ctx.settings, same, 'one settings object is kept');
  assert.equal(same.speed, 20);
  assert.equal(same.config?.pace.speed, 20);
  assert.equal(app.ctx.game.settings, same);

  // Unchanged value: says so, writes no audit row.
  const again = cli(store, 'config-set', ['pace.speed', '20']);
  assert.equal(again.ok, true);
  assert.match(again.lines[0] ?? '', /already 20/);
  assert.equal(audit(store, 'world_config_set').length, 2);
  await app.close();
});

test('a switch can be turned on and off', async () => {
  const { app } = await makeApp();
  assert.equal(cli(app.ctx.store, 'config-set', ['features.siege', 'off']).ok, true);
  assert.equal(stored(app.ctx.store).features.siege, false);
  assert.equal(cli(app.ctx.store, 'config-set', ['features.siege', 'maybe']).ok, false);
  await app.close();
});

test('refused input changes nothing and writes no audit row', async () => {
  const { app } = await makeApp();
  const store = app.ctx.store;
  const before = store.getMeta('world_config');
  for (const [path, value] of [
    ['nothing.here', '1'],
    ['conquest.holdHours', '1000'],
    ['conquest.holdHours', '0'],
    ['conquest.holdHours', 'abc'],
    ['conquest.holdHours', ''],
    ['conquest.holdHours', 'NaN'],
    ['queues.build', '2.5'],
    ['features.siege', '7'],
    ['domination.winShare', '5'],
  ] as const) {
    const r = cli(store, 'config-set', [path, value]);
    assert.equal(r.ok, false, `${path} ${value}`);
    assert.ok((r.lines[0] ?? '').length > 5);
  }
  assert.equal(cli(store, 'config-set', []).ok, false);
  assert.equal(cli(store, 'config-set', ['conquest.holdHours']).ok, false);
  assert.equal(store.getMeta('world_config'), before);
  assert.equal(audit(store, 'world_config_set').length, 0);
  await app.close();
});

test('after world-open only the safe settings can change (domination and tribe size), each logged', async () => {
  const { app, clock } = await makeApp();
  const store = app.ctx.store;
  const anon = new Client(app, '10.0.0.7');

  const opened = cli(store, 'world-open', [], clock.now());
  assert.equal(opened.ok, true);
  assert.equal(store.isWorldOpen(), true);
  assert.equal(store.worldOpenedAt(), clock.now());
  assert.equal(audit(store, 'world_open').length, 1);
  assert.match(cli(store, 'world-open', []).lines[0] ?? '', /already/);
  assert.equal(audit(store, 'world_open').length, 1, 'a second world-open changes nothing');

  const speed = getWorldConfigValue(stored(store), 'pace.speed');
  for (const [path, value] of [
    ['conquest.holdHours', '3'],
    ['pace.speed', '30'],
    ['features.siege', 'off'],
    ['protection.beginnerHours', '1'],
  ] as const) {
    const r = cli(store, 'config-set', [path, value]);
    assert.equal(r.ok, false, `${path} is fixed after opening`);
    assert.match(r.lines[0] ?? '', /open/);
  }
  assert.equal(getWorldConfigValue(stored(store), 'pace.speed'), speed);
  assert.equal(audit(store, 'world_config_set').length, 0);

  const members = getWorldConfigValue(stored(store), 'tribe.maxMembers') === 7 ? '8' : '7';
  assert.equal(cli(store, 'config-set', ['tribe.maxMembers', members]).ok, true);
  assert.equal(getWorldConfigValue(stored(store), 'tribe.maxMembers'), Number(members));
  assert.equal(cli(store, 'config-set', ['features.scavenging', 'on']).ok, true);

  // domination.*: same as domination-set (writes world_config AND the mirror, clears the streak).
  store.setMeta('domination_streak', JSON.stringify({ tribeId: 1, startedAt: 5 }));
  assert.deepEqual(readStreak(store), { tribeId: 1, startedAt: 5 });
  const win = cli(store, 'config-set', ['domination.winShare', '0.6'], clock.now());
  assert.equal(win.ok, true, win.lines.join(' '));
  assert.equal(readStreak(store), null, 'the running streak was cleared');
  assert.equal(stored(store).domination.winShare, 0.6);
  assert.equal((flatJson(store).domination as { winShare: number }).winShare, 0.6, 'the flat mirror follows');
  assert.equal(app.ctx.domination.settings().winShare, 0.6);
  assert.equal(audit(store, 'domination_set').length, 1);
  const logged = audit(store, 'world_config_set');
  assert.deepEqual(
    logged.map((x) => x.detail.split(' ')[0]),
    ['tribe.maxMembers', 'features.scavenging', 'domination.winShare'],
  );
  assert.ok(logged.every((x) => x.actor_ip === 'cli'));

  const seen = (await anon.get('/api/world/config')).json<WorldConfigResponse>();
  assert.equal(seen.open, true);
  assert.equal(seen.config.tribe.maxMembers, Number(members));
  assert.equal(seen.config.domination.winShare, 0.6);
  assert.equal(app.ctx.settings.domination?.winShare, 0.6);
  await app.close();
});

test('a world with a player is open without world-open: fixed settings are refused, safe ones allowed', async () => {
  const { app, clock } = await makeApp();
  const store = app.ctx.store;
  assert.equal(store.isWorldOpen(), false);
  await register(app, 'someone');
  assert.equal(store.isWorldOpen(), true);
  assert.equal(store.getMeta('world_opened_at'), null, 'it opened by itself, nothing was written');

  assert.equal(cli(store, 'config-set', ['conquest.holdHours', '3']).ok, false);
  assert.equal(cli(store, 'config-set', ['pace.speed', '30']).ok, false);
  assert.equal(cli(store, 'config-set', ['tribe.maxMembers', '9']).ok, true);
  assert.equal(cli(store, 'config-set', ['domination.winShare', '0.6']).ok, true);
  assert.equal(audit(store, 'world_config_set').length, 2);
  assert.match(cli(store, 'config', []).lines[0] ?? '', /OPEN/);

  // world-open still works (and is dated at the first player, not now)
  const firstPlayerAt = store.worldOpenedAt();
  assert.ok(firstPlayerAt !== null);
  assert.equal(cli(store, 'world-open', [], clock.now() + 999_999).ok, true);
  assert.equal(store.getMeta('world_opened_at'), String(firstPlayerAt));
  await app.close();
});

test('domination-set also updates world_config, and the legacy world_settings.domination stays mirrored', async () => {
  const { app } = await makeApp();
  const store = app.ctx.store;
  const r =runDominationCommand(store, 'domination-set', ['winShare', '0.55'], 1_000);
  assert.equal(r.ok, true, r.lines.join(' '));
  assert.equal(stored(store).domination.winShare, 0.55);
  assert.equal((flatJson(store).domination as { winShare: number }).winShare, 0.55);
  assert.equal(app.ctx.domination.settings().winShare, 0.55);
  assert.equal(stored(store).pace.speed, TEST_WORLD.speed, 'every other setting is untouched');
  assert.deepEqual({ ...stored(store).domination, winShare: DOMINATION_DEFAULTS.winShare }, DOMINATION_DEFAULTS);
  assert.ok(isSafeAfterOpen('domination.winShare'));
  await app.close();
});

// ---- (e) read only over HTTP --------------------------------------------------------------------------------------------

test('world/config only answers GET', async () => {
  const { app } = await makeApp();
  const c = await register(app, 'writer');
  for (const method of ['POST', 'PUT', 'DELETE'] as const) {
    for (const url of ['/api/world/config', '/w/w1/api/world/config']) {
      const res = await c.call(method, url, method === 'DELETE' ? undefined : { conquest: { holdHours: 1 } });
      assert.ok(res.statusCode === 404 || res.statusCode === 405, `${method} ${url} -> ${res.statusCode}`);
    }
  }
  assert.equal(getWorldConfigValue(stored(app.ctx.store), 'conquest.holdHours'), DEFAULT_WORLD_CONFIG.conquest.holdHours);
  await app.close();
});
