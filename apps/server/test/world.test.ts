import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { loadEnv } from '../src/env.ts';
import { Clock, PASSWORD, TEST_WORLD, Client, errorOf, makeApp, ok } from './helpers.ts';

test('stored world settings win over the environment on restart; data persists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-test-'));
  try {
    const dbPath = join(dir, 'nested', 'game.sqlite'); // the folder is created
    const clock = new Clock();
    const warnings: string[] = [];

    let app = await buildApp({ dbPath, now: clock.now, settings: { ...TEST_WORLD, speed: 5 }, webDistDir: '/nonexistent' });
    assert.equal(app.ctx.settings.speed, 5);
    const c = new Client(app);
    ok(await c.post('/api/auth/register', { username: 'persist', password: PASSWORD }), 201);
    const village = await c.village();
    ok(await c.post(`/api/villages/${village.id}/build`, { building: 'lumber' }));
    const npcCount = (app.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM villages WHERE owner_id IS NULL').get() as { n: number }).n;
    assert.ok(npcCount > 0);
    const jm = app.ctx.store.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    assert.equal(jm.journal_mode, 'wal');
    const fk = app.ctx.store.db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    assert.equal(fk.foreign_keys, 1);
    await app.close();

    // Restart with different environment settings.
    app = await buildApp({ dbPath, now: clock.now, settings: { ...TEST_WORLD, speed: 50, radius: 40 }, webDistDir: '/nonexistent' });
    app.log.warn = ((msg: unknown) => void warnings.push(String(msg))) as typeof app.log.warn;
    assert.equal(app.ctx.settings.speed, 5, 'stored speed wins');
    assert.equal(app.ctx.settings.radius, TEST_WORLD.radius);
    assert.equal((app.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM villages WHERE owner_id IS NULL').get() as { n: number }).n, npcCount, 'world is not regenerated');

    const again = new Client(app);
    ok(await again.post('/api/auth/login', { username: 'persist', password: PASSWORD }));
    const back = await again.village();
    assert.equal(back.id, village.id);
    assert.equal(back.state.buildQueue.length, 1);
    assert.equal((await again.state()).settings.speed, 5);
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('world creation warns when the environment differs from the stored world', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-test-'));
  try {
    const dbPath = join(dir, 'w.sqlite');
    const clock = new Clock();
    const first = await buildApp({ dbPath, now: clock.now, settings: { ...TEST_WORLD }, webDistDir: '/nonexistent' });
    await first.close();

    const { Store } = await import('../src/store.ts');
    const { openDatabase } = await import('../src/db.ts');
    const { initWorld } = await import('../src/world.ts');
    const db = openDatabase(dbPath);
    const warnings: string[] = [];
    const s = initWorld(new Store(db), { speed: 99, radius: TEST_WORLD.radius }, clock.now(), (m) => warnings.push(m));
    db.close();
    assert.equal(s.speed, TEST_WORLD.speed);
    assert.equal(warnings.length, 1, 'only the setting that differs is reported');
    assert.match(warnings[0] ?? '', /speed=99/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('environment parsing', () => {
  const d = loadEnv({});
  assert.deepEqual([d.port, d.host, d.databasePath, d.isProduction, d.trustProxy], [3000, '0.0.0.0', './data/clanfire.sqlite', false, false]);
  assert.deepEqual(d.worldOverrides, {});
  const e = loadEnv({ PORT: '8080', HOST: '127.0.0.1', DATABASE_PATH: '/x/y.sqlite', NODE_ENV: 'production', WORLD_SPEED: '10', WORLD_SEED: '7', WORLD_RADIUS: '40', TRUST_PROXY: '1' });
  assert.deepEqual([e.port, e.host, e.databasePath, e.isProduction, e.trustProxy], [8080, '127.0.0.1', '/x/y.sqlite', true, true]);
  assert.deepEqual(e.worldOverrides, { speed: 10, seed: 7, radius: 40 });
  for (const bad of [{ PORT: 'abc' }, { PORT: '70000' }, { WORLD_SPEED: '0' }, { WORLD_SPEED: 'fast' }, { WORLD_RADIUS: '2' }, { WORLD_RADIUS: '1.5' }, { WORLD_SEED: '1.5' }]) {
    assert.throws(() => loadEnv(bad), /Invalid/, JSON.stringify(bad));
  }
});

test('serves the built web client with an SPA fallback, never for /api', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-web-'));
  try {
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(join(dir, '.secret'), 'nope');
    const { app } = await makeApp({ webDistDir: dir });
    const c = new Client(app);

    const root = await c.get('/');
    ok(root);
    assert.match(String(root.headers['content-type']), /text\/html/);
    assert.match(root.body, /id="root"/);
    assert.equal(root.headers['cache-control'], 'no-cache');

    const spa = await c.get('/village/12?tab=map');
    ok(spa);
    assert.match(spa.body, /id="root"/);
    assert.equal(spa.headers['cache-control'], 'no-cache');
    ok(await c.get('/reports'));

    const js = await c.get('/assets/app-abc123.js');
    ok(js);
    assert.match(String(js.headers['content-type']), /javascript/);
    assert.match(String(js.headers['cache-control']), /immutable/);
    ok(await c.get('/favicon.svg'));

    // Missing files and dotfiles are 404s, not index.html.
    assert.equal((await c.get('/assets/missing.js')).statusCode, 404);
    assert.equal((await c.get('/.secret')).statusCode, 404);
    // Path traversal never leaves the web root: at worst it lands on the SPA shell.
    for (const url of ['/%2e%2e/%2e%2e/etc/passwd', '/assets/%2e%2e/%2e%2e/etc/hostname', '/assets/..%2f..%2f..%2fetc%2fpasswd']) {
      const res = await c.get(url);
      assert.ok(res.body.includes('id="root"') || res.statusCode === 404, `${url} -> ${res.statusCode}`);
      assert.ok(!res.body.includes('root:'), url);
    }

    // The API is never shadowed by the fallback.
    errorOf(await c.get('/api/nope'), 404, 'not_found');
    errorOf(await c.get('/api'), 404, 'not_found');
    errorOf(await c.get('/api/state'), 401, 'unauthorized');
    assert.deepEqual((await c.get('/api/health')).json(), { ok: true });
    // Non-GET to a page is not a page.
    errorOf(await c.post('/village/12', {}), 404, 'not_found');
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
