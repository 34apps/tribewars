import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, PASSWORD, errorOf, makeApp, ok, register } from './helpers.ts';
import { giveTroops, send, sendOk, unprotect } from './warfare-helpers.ts';

test('guard on: a second account from the same IP is refused; another IP is fine', async () => {
  const { app } = await makeApp({ maxAccountsPerIp: 1 });
  await register(app, 'first_one', '10.0.0.1');
  const c = new Client(app, '10.0.0.1');
  const res = await c.post('/api/auth/register', { username: 'second_one', password: PASSWORD });
  errorOf(res, 403, 'forbidden');
  await register(app, 'third_one', '10.0.0.2');
});

test('guard off (default): same IP may register many accounts, but shared IPs are detected', async () => {
  const { app } = await makeApp();
  await register(app, 'twin_a', '10.0.0.3');
  await register(app, 'twin_b', '10.0.0.3');
  await register(app, 'loner', '10.0.0.4');
  const groups = app.ctx.store.sharedIpGroups();
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.ip, '10.0.0.3');
  assert.deepEqual(groups[0]?.players.map((p) => p.username), ['twin_a', 'twin_b']);
});

test('login records a new IP for the account', async () => {
  const { app } = await makeApp();
  await register(app, 'roamer', '10.0.0.5');
  await register(app, 'other', '10.0.0.6');
  ok(await new Client(app, '10.0.0.6').post('/api/auth/login', { username: 'roamer', password: PASSWORD }));
  assert.equal(app.ctx.store.sharedIpGroups()[0]?.ip, '10.0.0.6');
});

test('household: accounts on one connection cannot attack, scout or support each other', async () => {
  const { app } = await makeApp();
  const mk = async (name: string, ip: string) => {
    const c = await register(app, name, ip);
    return { c, name, id: (await c.state()).player.id };
  };
  const a = await mk('house_a', '10.0.1.1');
  const b = await mk('house_b', '10.0.1.1');
  const other = await mk('outsider', '10.0.1.2');
  unprotect(app, a, b, other);
  giveTroops(app, a, { raider: 20, pathfinder: 5 });
  for (const mission of ['attack', 'scout', 'support'] as const) {
    const res = await send(a, b, mission, mission === 'scout' ? { pathfinder: 1 } : { raider: 1 });
    assert.equal(res.statusCode, 400, res.body);
    assert.match(res.body, /share a connection/);
  }
  // Someone on a different connection is still a legal target.
  await sendOk(a, other, 'attack', { raider: 1 });
});

test('household: a signed-in player can report a shared household from settings', async () => {
  const { app } = await makeApp();
  const c = await register(app, 'reporter', '10.0.1.3');
  type Me = { player: { householdShared: boolean } };
  assert.equal((await c.get('/api/auth/me')).json<Me>().player.householdShared, false);
  const res = await c.post('/api/me/household', { shared: true });
  ok(res);
  assert.equal(res.json<Me>().player.householdShared, true);
  errorOf(await new Client(app, '10.0.1.4').post('/api/me/household', { shared: true }), 401, 'unauthorized');
});

test('ban: kills live sessions, blocks sign-in, frees the IP slot; unban restores', async () => {
  const { app, clock } = await makeApp({ maxAccountsPerIp: 1 });
  const bad = await register(app, 'cheater', '10.0.0.7');
  const p = app.ctx.store.getPlayerByLowerName('cheater');
  assert.ok(p);
  app.ctx.store.banPlayer(p.id, 'multi-account', clock.now());

  assert.equal((await bad.get('/api/state')).statusCode, 401);
  const login = await new Client(app, '10.0.0.8').post('/api/auth/login', { username: 'cheater', password: PASSWORD });
  assert.equal(login.statusCode, 403);
  // A wrong password still looks like any other failed sign-in (no ban leak).
  const wrong = await new Client(app, '10.0.0.8').post('/api/auth/login', { username: 'cheater', password: 'nope-nope-nope' });
  assert.equal(wrong.statusCode, 401);
  // The banned account no longer holds the IP.
  await register(app, 'fresh_one', '10.0.0.7');

  app.ctx.store.unbanPlayer(p.id);
  ok(await new Client(app, '10.0.0.8').post('/api/auth/login', { username: 'cheater', password: PASSWORD }));
});
