import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHIEFTAINS, DEFAULT_CHIEFTAIN, LOBBY_SESSION_COOKIE, type LobbyMeResponse } from '@clanfire/engine';
import { SESSION_TTL_MS, sha256Hex } from '../src/auth.ts';
import { Client, PASSWORD, errorOf, makeApp, ok, register } from './helpers.ts';

const REGISTER = '/lobby/api/auth/register';
const LOGIN = '/lobby/api/auth/login';
const LOGOUT = '/lobby/api/auth/logout';
const ME = '/lobby/api/auth/me';

test('register: 201, account dto, session cookie with the right attributes', async () => {
  const { app } = await makeApp({ secureCookies: true });
  const c = new Client(app);
  const res = await c.post(REGISTER, { username: 'Alice_1', password: PASSWORD });
  ok(res, 201);
  assert.deepEqual(res.json<LobbyMeResponse>(), { account: { id: 1, username: 'Alice_1', chieftain: DEFAULT_CHIEFTAIN, staffRole: null } });
  const cookie = res.cookies.find((x) => x.name === LOBBY_SESSION_COOKIE);
  assert.ok(cookie, 'cookie set');
  assert.equal(cookie.path, '/lobby/');
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, 'Lax');
  assert.equal(cookie.secure, true);
  assert.equal(cookie.maxAge, SESSION_TTL_MS / 1000);
  assert.match(cookie.value, /^[A-Za-z0-9_-]{43}$/);
  // The header itself, as a browser sees it.
  const header = String(res.headers['set-cookie']);
  assert.match(header, /Path=\/lobby\//);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Secure/);
});

test('register: not Secure when secureCookies is off', async () => {
  const { app } = await makeApp({ secureCookies: false });
  const res = await new Client(app).post(REGISTER, { username: 'plain_one', password: PASSWORD });
  assert.equal(res.cookies.find((x) => x.name === LOBBY_SESSION_COOKIE)?.secure, undefined);
});

test('register: only the SHA-256 of the token is stored, and the password is a scrypt hash', async () => {
  const { app } = await makeApp();
  const c = new Client(app);
  ok(await c.post(REGISTER, { username: 'hashed_one', password: PASSWORD }), 201);
  const token = c.cookie.split('=')[1] ?? '';
  const rows = app.ctx.store.db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.token_hash, sha256Hex(token));
  assert.notEqual(rows[0]?.token_hash, token);
  const account = app.ctx.store.getAccount(1);
  assert.match(account?.passwordHash ?? '', /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.ok(!JSON.stringify(app.ctx.store.auditRows()).includes(token), 'no token in the audit log');
});

test('register: chieftain optional and validated', async () => {
  const { app } = await makeApp();
  const chosen = CHIEFTAINS[1].id;
  const b = await new Client(app).post(REGISTER, { username: 'chosen_one', password: PASSWORD, chieftain: chosen });
  ok(b, 201);
  assert.equal(b.json<LobbyMeResponse>().account?.chieftain, chosen);
  for (const bad of ['nobody', '', 7, null, 'x'.repeat(100)]) {
    errorOf(await new Client(app).post(REGISTER, { username: 'bad_one', password: PASSWORD, chieftain: bad }), 400, 'invalid_input');
  }
  // A refused registration creates nothing.
  ok(await new Client(app).post(REGISTER, { username: 'bad_one', password: PASSWORD }), 201);
});

test('register: bad username, bad password, unknown fields and bad bodies are 400', async () => {
  const { app } = await makeApp();
  const c = new Client(app);
  const bad: unknown[] = [
    { username: 'ab', password: PASSWORD },
    { username: 'a'.repeat(21), password: PASSWORD },
    { username: 'has space', password: PASSWORD },
    { username: 'semi;colon', password: PASSWORD },
    { username: 'fine_name', password: 'short' },
    { username: 'fine_name', password: 'x'.repeat(129) },
    { username: 'fine_name' },
    { password: PASSWORD },
    { username: 42, password: PASSWORD },
    { username: 'fine_name', password: PASSWORD, admin: true },
  ];
  for (const body of bad) errorOf(await c.post(REGISTER, body), 400, 'invalid_input');
  assert.equal(c.cookie, '');
  // not JSON at all
  const raw = await app.inject({ method: 'POST', url: REGISTER, headers: { host: 'lobby.test', origin: 'http://lobby.test', 'content-type': 'application/json' }, payload: '{nope' });
  assert.equal(raw.statusCode, 400);
  // a form post is not accepted
  const form = await app.inject({ method: 'POST', url: REGISTER, headers: { host: 'lobby.test', origin: 'http://lobby.test', 'content-type': 'application/x-www-form-urlencoded' }, payload: 'username=abc&password=12345678' });
  assert.equal(form.statusCode, 415);
  // boundary values are fine
  ok(await new Client(app).post(REGISTER, { username: 'abc', password: 'x'.repeat(8) }), 201);
  ok(await new Client(app).post(REGISTER, { username: 'a'.repeat(20), password: 'x'.repeat(128) }), 201);
});

test('register: a duplicate name is 409 username_taken, ignoring case', async () => {
  const { app } = await makeApp();
  await register(app, 'Alice');
  errorOf(await new Client(app).post(REGISTER, { username: 'alice', password: PASSWORD }), 409, 'username_taken');
  errorOf(await new Client(app).post(REGISTER, { username: 'ALICE', password: PASSWORD }), 409, 'username_taken');
});

test('login: ok, case-insensitive, new session', async () => {
  const { app } = await makeApp();
  await register(app, 'Alice');
  const c = new Client(app);
  const res = await c.post(LOGIN, { username: 'aLiCe', password: PASSWORD });
  ok(res);
  assert.equal(res.json<LobbyMeResponse>().account?.username, 'Alice');
  assert.equal(res.cookies.find((x) => x.name === LOBBY_SESSION_COOKIE)?.path, '/lobby/');
  const me = await c.get(ME);
  assert.equal(me.json<LobbyMeResponse>().account?.username, 'Alice');
  assert.ok(app.ctx.store.getAccount(1)?.lastLogin);
});

test('login: wrong password and unknown user give the same 401', async () => {
  const { app } = await makeApp();
  await register(app, 'Alice');
  const wrong = await new Client(app).post(LOGIN, { username: 'Alice', password: 'not the password' });
  const unknown = await new Client(app).post(LOGIN, { username: 'Nobody', password: 'not the password' });
  errorOf(wrong, 401, 'unauthorized');
  errorOf(unknown, 401, 'unauthorized');
  assert.equal(wrong.json<{ message: string }>().message, 'Wrong username or password.');
  assert.deepEqual(wrong.json(), unknown.json());
  assert.equal(wrong.cookies.length, 0);
});

test('login: a banned account is told only after the correct password', async () => {
  const { app } = await makeApp();
  await register(app, 'Alice');
  app.ctx.store.banAccount(1, 'test', 1);
  const right = await new Client(app).post(LOGIN, { username: 'Alice', password: PASSWORD });
  errorOf(right, 403, 'forbidden');
  assert.equal(right.json<{ message: string }>().message, 'This account has been suspended.');
  assert.equal(right.cookies.length, 0);
  // A wrong password looks exactly like an unknown name: a ban never reveals that the name exists.
  const wrong = await new Client(app).post(LOGIN, { username: 'Alice', password: 'not the password' });
  errorOf(wrong, 401, 'unauthorized');
  assert.ok(app.ctx.store.auditRows().some((r) => r.action === 'login_blocked_banned'));
  // Unbanned: signs in again.
  app.ctx.store.unbanAccount(1);
  ok(await new Client(app).post(LOGIN, { username: 'Alice', password: PASSWORD }));
});

test('login: lenient body shape, unknown fields refused', async () => {
  const { app } = await makeApp();
  errorOf(await new Client(app).post(LOGIN, { username: 'x', password: 'y', extra: 1 }), 400, 'invalid_input');
  errorOf(await new Client(app).post(LOGIN, { username: '', password: 'y' }), 400, 'invalid_input');
  errorOf(await new Client(app).post(LOGIN, { username: 'x', password: 'y'.repeat(200) }), 400, 'invalid_input');
  errorOf(await new Client(app).post(LOGIN, { username: 'x', password: 'y' }), 401, 'unauthorized'); // short passwords are just wrong
});

test('logout: 204, cookie cleared with the same path, session gone', async () => {
  const { app } = await makeApp();
  const c = await register(app, 'Alice');
  const token = c.cookie.split('=')[1] ?? '';
  const stale = c.cookie;
  const res = await c.post(LOGOUT);
  assert.equal(res.statusCode, 204);
  const cleared = res.cookies.find((x) => x.name === LOBBY_SESSION_COOKIE);
  assert.ok(cleared);
  assert.equal(cleared.value, '');
  assert.equal(cleared.path, '/lobby/');
  assert.equal(cleared.httpOnly, true);
  assert.equal(cleared.sameSite, 'Lax');
  assert.equal(app.ctx.store.sessionCount(1), 0);
  assert.equal(c.cookie, '');
  // The old cookie value no longer works anywhere.
  assert.equal(app.ctx.auth.lookup(token), null);
  const replay = new Client(app);
  replay.cookie = stale;
  assert.equal((await replay.get(ME)).json<LobbyMeResponse>().account, null);
  // Logging out twice, or without a cookie, is fine.
  assert.equal((await new Client(app).post(LOGOUT)).statusCode, 204);
});

test('me: the account when signed in, null otherwise (also with a forged or expired cookie)', async () => {
  const { app, clock } = await makeApp();
  const anon = await new Client(app).get(ME);
  ok(anon);
  assert.deepEqual(anon.json(), { account: null });
  const forged = new Client(app);
  forged.cookie = `${LOBBY_SESSION_COOKIE}=${'a'.repeat(43)}`;
  assert.deepEqual((await forged.get(ME)).json(), { account: null });
  forged.cookie = `${LOBBY_SESSION_COOKIE}=short`;
  assert.deepEqual((await forged.get(ME)).json(), { account: null });

  const c = await register(app, 'Alice');
  assert.equal((await c.get(ME)).json<LobbyMeResponse>().account?.username, 'Alice');
  clock.advance(SESSION_TTL_MS + 1000);
  assert.deepEqual((await c.get(ME)).json(), { account: null });
});

test('register and login record the IP and write the audit log', async () => {
  const { app } = await makeApp();
  const c = new Client(app, '203.0.113.9');
  ok(await c.post(REGISTER, { username: 'Alice', password: PASSWORD }), 201);
  const c2 = new Client(app, '203.0.113.10');
  ok(await c2.post(LOGIN, { username: 'Alice', password: PASSWORD }));
  const ips = (app.ctx.store.db.prepare('SELECT ip FROM account_ips WHERE account_id = 1 ORDER BY ip').all() as { ip: string }[]).map((r) => r.ip);
  assert.deepEqual(ips, ['203.0.113.10', '203.0.113.9']);
  const actions = app.ctx.store.auditRows().map((r) => r.action);
  assert.deepEqual(actions, ['login', 'register']);
  // The audit log is append-only.
  assert.throws(() => app.ctx.store.db.exec('DELETE FROM audit_log'), /append-only/);
});
