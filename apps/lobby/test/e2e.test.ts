// End to end: the real lobby app signs a pass, the real world app (apps/server) accepts it. Existing world players are
// imported first, so their old passwords keep working at the lobby and they land on their own player and villages.
// Server code is imported in tests only.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { EnterWorldResponse, GameStateResponse, LobbyMeResponse, MeResponse } from '@clanfire/engine';
import { buildApp as buildWorld } from '../../server/src/app.ts';
import { importWorld } from '../src/import-world.ts';
import { Client, Clock, HOST, KEY, PUBLIC_KEY, makeApp, ok } from './helpers.ts';
import { buildApp as buildLobby } from '../src/app.ts';

const dirs: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const WORLD_SETTINGS = { seed: 4242, speed: 10, radius: 12, npcDensity: 0.04, npcGrowthHours: 1000 };

async function world(dbPath: string, id: string, now: () => number, lobbyPublicKey?: string): Promise<FastifyInstance> {
  const app = await buildWorld({ dbPath, now, settings: WORLD_SETTINGS, webDistDir: '/nonexistent/web/dist', secureCookies: false, worldId: id, worldName: `World ${id}`, lobbyPublicKey });
  apps.push(app);
  return app;
}

/** A tiny world-side browser: the session cookie of the world path. */
async function post(app: FastifyInstance, url: string, body: unknown, cookie = ''): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = { host: HOST, origin: `http://${HOST}`, 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return app.inject({ method: 'POST', url, headers, payload: JSON.stringify(body) });
}
async function get(app: FastifyInstance, url: string, cookie: string): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'GET', url, headers: { host: HOST, cookie } });
}
const sessionCookie = (res: LightMyRequestResponse): string => {
  // The response also clears a legacy Path=/ cookie (empty value); the one with a value is the session.
  const c = res.cookies.find((x) => x.name === 'tw_session' && x.value !== '');
  assert.ok(c?.value, 'world session cookie set');
  assert.equal(c.path, '/w/w1/', 'scoped to the world path');
  return `tw_session=${c.value}`;
};

test('new account: lobby sign-up, pass, world creates the player; second entry signs in the same player; a pass works once', async () => {
  const clock = new Clock();
  const { app: lobby } = await makeApp({ now: clock.now });
  apps.push(lobby);
  const w1 = await world(':memory:', 'w1', clock.now, PUBLIC_KEY);
  const w2 = await world(':memory:', 'w2', clock.now, PUBLIC_KEY);
  lobby.ctx.store.insertWorld({ id: 'w1', name: 'World w1', status: 'open', path: '/w/w1/', createdAt: 0 });
  lobby.ctx.store.insertWorld({ id: 'w2', name: 'World w2', status: 'open', path: '/w/w2/', createdAt: 0 });

  const c = new Client(lobby);
  ok(await c.post('/lobby/api/auth/register', { username: 'Dana_Lee', password: 'a long enough pass', chieftain: 'ysra' }), 201);
  const me = (await c.get('/lobby/api/auth/me')).json<LobbyMeResponse>();
  assert.equal(me.account?.username, 'Dana_Lee');

  // The world's own sign-up and sign-in are off.
  const direct = await post(w1, '/w/w1/api/auth/login', { username: 'Dana_Lee', password: 'a long enough pass' });
  assert.equal(direct.statusCode, 403, direct.body);
  assert.equal((await post(w1, '/w/w1/api/auth/register', { username: 'Dana_Lee', password: 'a long enough pass' })).statusCode, 403);

  const enter = async (id: string): Promise<EnterWorldResponse> => {
    const res = await c.post(`/lobby/api/worlds/${id}/enter`, {});
    ok(res);
    return res.json<EnterWorldResponse>();
  };

  const first = await enter('w1');
  const entered = await post(w1, '/w/w1/api/auth/enter', { pass: first.pass });
  assert.equal(entered.statusCode, 201, entered.body);
  const cookie = sessionCookie(entered);
  const player = entered.json<MeResponse>().player;
  assert.equal(player?.username, 'Dana_Lee');
  assert.equal(player?.chieftain, 'ysra');
  const state = (await get(w1, '/w/w1/api/state', cookie)).json<GameStateResponse>();
  assert.equal(state.villages.length, 1);

  // Replay of the same pass, and the same pass at another world, are refused.
  assert.equal((await post(w1, '/w/w1/api/auth/enter', { pass: first.pass })).statusCode, 401);
  assert.equal((await post(w2, '/w/w2/api/auth/enter', { pass: first.pass })).statusCode, 401);

  // A fresh pass signs in the same player.
  clock.advance(5_000);
  const second = await enter('w1');
  const again = await post(w1, '/w/w1/api/auth/enter', { pass: second.pass });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(again.json<MeResponse>().player?.id, player?.id);

  // One account, another world: its own player there.
  const other = await post(w2, '/w/w2/api/auth/enter', { pass: (await enter('w2')).pass });
  assert.equal(other.statusCode, 201, other.body);
  assert.equal(other.json<MeResponse>().player?.username, 'Dana_Lee');

  // An expired pass is refused.
  const late = await enter('w1');
  clock.advance(61_000);
  assert.equal((await post(w1, '/w/w1/api/auth/enter', { pass: late.pass })).statusCode, 401);

  // A lobby ban blocks new passes.
  lobby.ctx.store.banAccount(me.account!.id, 'test', clock.now());
  const banned = await c.post('/lobby/api/worlds/w1/enter', {});
  assert.equal(banned.statusCode, 401, 'the ban ended the lobby session');
});

test('existing world: import keeps passwords, player ids and villages; then only the lobby pass gets in', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-e2e-'));
  dirs.push(dir);
  const clock = new Clock();
  const worldPath = join(dir, 'world', 'clanfire.sqlite');
  const lobbyPath = join(dir, 'lobby', 'lobby.sqlite');

  // 1. The world as it is today: no lobby, players register at the world.
  const before = await world(worldPath, 'w1', clock.now);
  const reg = await post(before, '/api/auth/register', { username: 'Old_Hand', password: 'my old password' });
  assert.equal(reg.statusCode, 201, reg.body);
  const oldPlayer = reg.json<MeResponse>().player;
  assert.ok(oldPlayer);
  await before.close();
  apps.splice(apps.indexOf(before), 1);

  // 2. One-time import (both servers stopped).
  const report = importWorld({
    lobbyDbPath: lobbyPath,
    worldDbPath: worldPath,
    backupDirLobby: join(dir, 'lobby-backups'),
    backupDirWorld: join(dir, 'world', 'backups'),
    now: clock.now(),
  });
  assert.equal(report.conflicts.length, 0);

  // 3. Lobby and world start again; the world now only takes passes.
  const lobby = await buildLobby({ dbPath: lobbyPath, signingKey: KEY.privateKey, now: clock.now, secureCookies: false });
  apps.push(lobby);
  lobby.ctx.store.insertWorld({ id: 'w1', name: 'World w1', status: 'open', path: '/w/w1/', createdAt: 0 });
  const w1 = await world(worldPath, 'w1', clock.now, PUBLIC_KEY);

  const c = new Client(lobby);
  ok(await c.post('/lobby/api/auth/login', { username: 'old_hand', password: 'my old password' }));
  const enter = await c.post('/lobby/api/worlds/w1/enter', {});
  ok(enter);
  const entered = await post(w1, '/w/w1/api/auth/enter', { pass: enter.json<EnterWorldResponse>().pass });
  assert.equal(entered.statusCode, 200, entered.body);
  assert.equal(entered.json<MeResponse>().player?.id, oldPlayer.id, 'the same player as before the import');
  const state = (await get(w1, '/w/w1/api/state', sessionCookie(entered))).json<GameStateResponse>();
  assert.equal(state.villages.length, 1, 'the village is still there');

  assert.equal((await post(w1, '/w/w1/api/auth/login', { username: 'Old_Hand', password: 'my old password' })).statusCode, 403, 'the world no longer takes passwords');
});
