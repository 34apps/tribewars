// Several worlds on one domain (docs/MULTI_WORLD.md): every route answers under /w/<WORLD_ID>/ as well as the old path,
// the session cookie is scoped to the world path, a bad WORLD_ID refuses to start, world info shows nothing private.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import WebSocket from 'ws';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { worldPrefixOf, type MeResponse, type WorldInfoResponse } from '@clanfire/engine';
import { RATE_API_PER_IP } from '../src/app.ts';
import { loadEnv } from '../src/env.ts';
import { makeWorldRewrite, sessionCookiePath } from '../src/world-path.ts';
import { HOST, PASSWORD, makeApp } from './helpers.ts';

const closers: FastifyInstance[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const a of closers.splice(0)) await a.close();
});

async function world(id: string, extra: Parameters<typeof makeApp>[0] = {}): Promise<FastifyInstance> {
  const { app } = await makeApp({ worldId: id, worldName: `World ${id.toUpperCase()}`, ...extra });
  closers.push(app);
  return app;
}

/** Just enough of a browser cookie jar: stores name/value/path, sends a cookie only when the request path is inside its Path. */
class Jar {
  private items: { name: string; value: string; path: string }[] = [];
  store(res: LightMyRequestResponse): void {
    for (const c of res.cookies) {
      const path = c.path ?? '/';
      this.items = this.items.filter((i) => !(i.name === c.name && i.path === path));
      if (c.value) this.items.push({ name: c.name, value: c.value, path });
    }
  }
  /** Longest path first, like a browser. */
  header(url: string): string | undefined {
    const p = url.split('?', 1)[0]!;
    const sent = this.items.filter((i) => p.startsWith(i.path.endsWith('/') ? i.path : `${i.path}/`) || p === i.path).sort((a, b) => b.path.length - a.path.length);
    return sent.length ? sent.map((i) => `${i.name}=${i.value}`).join('; ') : undefined;
  }
  async call(app: FastifyInstance, method: 'GET' | 'POST', url: string, body?: unknown): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { host: HOST };
    if (method !== 'GET') headers.origin = `http://${HOST}`;
    const cookie = this.header(url);
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await app.inject({ method, url, headers, payload: body === undefined ? undefined : JSON.stringify(body) });
    this.store(res);
    return res;
  }
}

const creds = (username: string) => ({ username, password: PASSWORD });
const setCookies = (res: LightMyRequestResponse): string[] => [res.headers['set-cookie'] ?? []].flat().map(String);

test('old /api path and /w/<id>/api path both work (same routes, same data)', async () => {
  const app = await world('w1');
  const jar = new Jar();
  const reg = await jar.call(app, 'POST', '/w/w1/api/auth/register', creds('alice'));
  assert.equal(reg.statusCode, 201, reg.body);
  const viaWorld = await jar.call(app, 'GET', '/w/w1/api/auth/me');
  assert.equal(viaWorld.json<MeResponse>().player?.username, 'alice');
  // The old path is a different cookie path: log in there too, same account and database.
  const old = await jar.call(app, 'POST', '/api/auth/login', creds('alice'));
  assert.equal(old.statusCode, 200, old.body);
  assert.equal((await jar.call(app, 'GET', '/api/auth/me')).json<MeResponse>().player?.username, 'alice');
  for (const url of ['/api/state', '/w/w1/api/state']) assert.equal((await jar.call(app, 'GET', url)).statusCode, 200, url);
  // Query strings survive the prefix.
  const map = await jar.call(app, 'GET', '/w/w1/api/map?x=0&y=0&w=3&h=3');
  assert.equal(map.statusCode, 200, map.body);
  // Unknown API paths are JSON 404s on both.
  for (const url of ['/api/nope', '/w/w1/api/nope']) {
    const res = await app.inject({ method: 'GET', url, headers: { host: HOST } });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json<{ error: string }>().error, 'not_found');
  }
});

test('health, Origin check and rate limits work on both paths', async () => {
  const app = await world('w1');
  for (const url of ['/api/health', '/w/w1/api/health']) {
    const res = await app.inject({ method: 'GET', url, headers: { host: HOST } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });
  }
  // Writes from a foreign Origin are refused under the world path too; same-origin and no-Origin pass the check.
  const post = (url: string, origin?: string) =>
    app.inject({ method: 'POST', url, headers: { host: HOST, ...(origin ? { origin } : {}) }, payload: {} });
  for (const url of ['/api/nope', '/w/w1/api/nope']) {
    assert.equal((await post(url, 'https://evil.example.org')).statusCode, 403, url);
    assert.equal((await post(url, `http://${HOST}`)).statusCode, 404, url);
    assert.equal((await post(url)).statusCode, 404, url);
  }
  // The per-IP API limit counts both paths together; health is exempt on both.
  let limited = 0;
  for (let i = 0; i < RATE_API_PER_IP + 10; i++) {
    const res = await app.inject({ method: 'GET', url: i % 2 ? '/w/w1/api/auth/me' : '/api/auth/me', headers: { host: HOST }, remoteAddress: '10.9.9.9' });
    if (res.statusCode === 429) limited += 1;
  }
  assert.ok(limited > 0, 'the global limit applies on /api and /w/<id>/api');
  for (const url of ['/api/health', '/w/w1/api/health']) {
    assert.equal((await app.inject({ method: 'GET', url, headers: { host: HOST }, remoteAddress: '10.9.9.9' })).statusCode, 200, `${url} is exempt`);
  }
});

test('the session cookie is scoped to the world path; w1\'s cookie is never sent to w2', async () => {
  const w1 = await world('w1');
  const w2 = await world('w2');
  const jar = new Jar();

  const reg = await jar.call(w1, 'POST', '/w/w1/api/auth/register', creds('bob'));
  assert.equal(reg.statusCode, 201, reg.body);
  const session = reg.cookies.find((c) => c.name === 'tw_session' && c.value);
  assert.equal(session?.path, '/w/w1/');
  assert.equal(session?.httpOnly, true);
  assert.equal(String(session?.sameSite).toLowerCase(), 'lax');

  assert.ok(jar.header('/w/w1/api/state'), 'sent to w1');
  assert.equal(jar.header('/w/w2/api/state'), undefined, 'not sent to w2');
  assert.equal(jar.header('/w/w10/api/state'), undefined, 'not sent to a world whose id merely starts with w1');
  assert.equal(jar.header('/w/w1x/'), undefined);
  assert.equal(jar.header('/api/state'), undefined, 'not sent to the old path either');

  // Through the jar, w2 sees a signed-out browser while w1 still knows bob.
  assert.equal((await jar.call(w1, 'GET', '/w/w1/api/auth/me')).json<MeResponse>().player?.username, 'bob');
  assert.equal((await jar.call(w2, 'GET', '/w/w2/api/auth/me')).json<MeResponse>().player, null);
  assert.equal((await jar.call(w2, 'GET', '/w/w2/api/state')).statusCode, 401);

  // Same name in w2 is a different account (own database), with its own cookie path.
  const reg2 = await jar.call(w2, 'POST', '/w/w2/api/auth/register', creds('bob'));
  assert.equal(reg2.statusCode, 201, reg2.body);
  assert.equal(reg2.cookies.find((c) => c.name === 'tw_session' && c.value)?.path, '/w/w2/');
  assert.equal((await jar.call(w2, 'GET', '/w/w2/api/auth/me')).json<MeResponse>().player?.username, 'bob');
  assert.equal((await jar.call(w1, 'GET', '/w/w1/api/auth/me')).json<MeResponse>().player?.username, 'bob');

  // Even if a token were sent to the wrong world's process, it is not a session there.
  const w1Cookie = jar.header('/w/w1/api/state')!;
  const stolen = await w2.inject({ method: 'GET', url: '/w/w2/api/auth/me', headers: { host: HOST, cookie: w1Cookie } });
  assert.equal(stolen.json<MeResponse>().player, null);

  // Logout clears only this world's cookie.
  const out = await jar.call(w1, 'POST', '/w/w1/api/auth/logout', {});
  assert.equal(out.statusCode, 204);
  assert.ok(setCookies(out).some((c) => /^tw_session=;/.test(c) && /Path=\/w\/w1\//i.test(c)));
  assert.equal((await jar.call(w1, 'GET', '/w/w1/api/auth/me')).json<MeResponse>().player, null);
  assert.equal((await jar.call(w2, 'GET', '/w/w2/api/auth/me')).json<MeResponse>().player?.username, 'bob');
});

test('the old /api path keeps Path=/ (dev and tests); logging in under a world path also clears a legacy Path=/ cookie', async () => {
  const app = await world('w1');
  const old = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { host: HOST, origin: `http://${HOST}`, 'content-type': 'application/json' }, payload: JSON.stringify(creds('carol')) });
  assert.equal(old.statusCode, 201);
  assert.equal(old.cookies.find((c) => c.name === 'tw_session' && c.value)?.path, '/');
  assert.equal(setCookies(old).length, 1, 'no extra clearing cookie on the old path');

  const login = await app.inject({ method: 'POST', url: '/w/w1/api/auth/login', headers: { host: HOST, origin: `http://${HOST}`, 'content-type': 'application/json' }, payload: JSON.stringify(creds('carol')) });
  assert.equal(login.statusCode, 200);
  const cookies = setCookies(login);
  assert.ok(cookies.some((c) => /^tw_session=[^;]+/.test(c) && !/^tw_session=;/.test(c) && /Path=\/w\/w1\//i.test(c)));
  assert.ok(cookies.some((c) => /^tw_session=;/.test(c) && /Path=\/(;|$)/i.test(c)), 'legacy cookie is cleared');
});

test('another world\'s path is a 404, never this world (API or page)', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'clanfire-web-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>x</title>');
  const app = await world('w1', { webDistDir: dist });
  for (const url of ['/w/w2/api/health', '/w/w10/api/health', '/w/w2/', '/w/w2/api/auth/me', '/w/w1x/api/health']) {
    const res = await app.inject({ method: 'GET', url, headers: { host: HOST } });
    assert.equal(res.statusCode, 404, url);
  }
  // This world's page paths serve the client (SPA), with and without the trailing slash; assets resolve under the prefix.
  for (const url of ['/', '/w/w1/', '/w/w1', '/w/w1/some/route']) {
    const res = await app.inject({ method: 'GET', url, headers: { host: HOST } });
    assert.equal(res.statusCode, 200, url);
    assert.match(res.body, /<title>x<\/title>/);
  }
  assert.equal((await app.inject({ method: 'GET', url: '/w/w1/index.html', headers: { host: HOST } })).statusCode, 200);
});

test('world info is public and shows only id, name, speed and start date', async () => {
  const app = await world('w7', { worldName: 'Hearth', world: { speed: 3 } });
  const jar = new Jar();
  assert.equal((await jar.call(app, 'POST', '/w/w7/api/auth/register', creds('secretplayer'))).statusCode, 201);
  for (const url of ['/w/w7/api/world/info', '/api/world/info']) {
    const anon = await app.inject({ method: 'GET', url, headers: { host: HOST } }); // no cookie: public
    assert.equal(anon.statusCode, 200, url);
    const info = anon.json<WorldInfoResponse>();
    assert.deepEqual(Object.keys(info).sort(), ['id', 'name', 'speed', 'startedAt']);
    assert.equal(info.id, 'w7');
    assert.equal(info.name, 'Hearth');
    assert.equal(info.speed, 3);
    assert.equal(info.startedAt, new Date(app.ctx.now()).toISOString()); // test clock: world created "now"
    assert.doesNotMatch(anon.body, /secretplayer|sqlite|:memory:|password|seed/i);
    assert.equal(anon.headers['cache-control'], 'no-store');
  }
});

test('world id and name defaults', async () => {
  const { app } = await makeApp();
  closers.push(app);
  assert.equal(app.ctx.worldId, 'w1');
  const info = (await app.inject({ method: 'GET', url: '/w/w1/api/world/info', headers: { host: HOST } })).json<WorldInfoResponse>();
  assert.equal(info.id, 'w1');
  assert.equal(info.name, 'World w1');
  const env = loadEnv({});
  assert.equal(env.worldId, 'w1');
  assert.equal(env.worldName, 'World w1');
  const named = loadEnv({ WORLD_ID: 'Alpha-2', WORLD_NAME: '  Frostmoor ' });
  assert.equal(named.worldId, 'Alpha-2');
  assert.equal(named.worldName, 'Frostmoor');
});

test('a bad WORLD_ID refuses to start (env, app and a real process)', async () => {
  const bad = ['bad id', 'w/1', '../x', 'w1/', 'w_1', 'wé', 'a'.repeat(33), 'w1?x=1', '%2e'];
  await assert.rejects(makeApp({ worldId: 'w1\n' }), /worldId/); // env values are trimmed first; the app option is not
  for (const id of bad) {
    assert.throws(() => loadEnv({ WORLD_ID: id }), /WORLD_ID/, JSON.stringify(id));
    await assert.rejects(makeApp({ worldId: id }), /worldId/, JSON.stringify(id));
  }
  assert.throws(() => loadEnv({ WORLD_NAME: 'x'.repeat(41) }), /WORLD_NAME/);
  assert.throws(() => loadEnv({ WORLD_NAME: 'bad\u0007name' }), /WORLD_NAME/);

  const res = spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, WORLD_ID: 'bad id', DATABASE_PATH: ':memory:', PORT: '0', NODE_ENV: 'development' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.notEqual(res.status, 0, 'process exits with an error');
  assert.match(`${res.stderr}${res.stdout}`, /Invalid WORLD_ID/);
});

test('live socket works under the world path and not under another world\'s', async () => {
  const app = await world('w1');
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  const jar = new Jar();
  assert.equal((await jar.call(app, 'POST', '/w/w1/api/auth/register', creds('dave'))).statusCode, 201);
  const cookie = jar.header('/w/w1/api/live')!;
  const open = (path: string) =>
    new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { origin: `http://127.0.0.1:${port}`, cookie } });
      sockets.push(ws);
      ws.on('message', (d: Buffer) => resolve((JSON.parse(d.toString('utf8')) as { type: string }).type));
      ws.on('unexpected-response', (_r: unknown, res: { statusCode: number; resume(): void }) => {
        res.resume();
        resolve(`http ${res.statusCode}`);
      });
      ws.on('error', () => resolve('error'));
    });
  assert.equal(await open('/w/w1/api/live'), 'hello');
  assert.equal(await open('/api/live'), 'hello');
  assert.equal(await open('/w/w2/api/live'), 'http 404');
});

test('path helpers', () => {
  const rewrite = makeWorldRewrite('w1');
  assert.equal(rewrite('/w/w1/api/x?y=1'), '/api/x?y=1');
  assert.equal(rewrite('/w/w1/'), '/');
  assert.equal(rewrite('/w/w1'), '/');
  assert.equal(rewrite('/w/w1?a=1'), '/?a=1');
  assert.equal(rewrite('/w/w10/api/x'), '/w/w10/api/x');
  assert.equal(rewrite('/api/x'), '/api/x');
  assert.equal(sessionCookiePath('/w/w1/api/auth/login', 'w1'), '/w/w1/');
  assert.equal(sessionCookiePath('/w/w1/api/auth/login?x=1', 'w1'), '/w/w1/');
  assert.equal(sessionCookiePath('/api/auth/login', 'w1'), '/');
  assert.equal(sessionCookiePath('/w/w2/api/auth/login', 'w1'), '/');
  // The client side reads the same prefix from the page URL.
  assert.equal(worldPrefixOf('/w/w1/'), '/w/w1');
  assert.equal(worldPrefixOf('/w/w1'), '/w/w1');
  assert.equal(worldPrefixOf('/w/alpha-2/x'), '/w/alpha-2');
  assert.equal(worldPrefixOf('/'), '');
  assert.equal(worldPrefixOf('/index.html'), '');
  assert.equal(worldPrefixOf('/w/'), '');
  assert.equal(worldPrefixOf('/w/bad_id/'), '');
  assert.equal(worldPrefixOf('/wx/w1/'), '');
});
