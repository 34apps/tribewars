// Security phase 1B: password policy, progressive lockout, session hygiene (idle/absolute expiry, rotation, cap,
// "sign out everywhere", Secure cookie in production). See docs/SECURITY_ROADMAP.md.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOBBY_SESSION_COOKIE, type LobbyMeResponse } from '@clanfire/engine';
import {
  LOCKOUT_BASE_MS,
  LOCKOUT_MAX_MS,
  LOGIN_FAILED_MESSAGE,
  PASSWORD_MIN,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SESSION_MAX_PER_ACCOUNT,
  hashPassword,
  lockoutDelayMs,
  passwordProblem,
} from '../src/auth.ts';
import { builtinCommonPasswords } from '../src/common-passwords.ts';
import { parseFlag } from '../src/env.ts';
import { Client, MINUTE, PASSWORD, errorOf, makeApp, ok, register } from './helpers.ts';

const REGISTER = '/lobby/api/auth/register';
const LOGIN = '/lobby/api/auth/login';
const LOGOUT_ALL = '/lobby/api/auth/logout-all';
const CHANGE = '/lobby/api/auth/change-password';
const ME = '/lobby/api/auth/me';
const DAY = 24 * 60 * MINUTE;

const meName = async (c: Client): Promise<string | null> => (await c.get(ME)).json<LobbyMeResponse>().account?.username ?? null;
const message = (res: { json<T>(): T }): string => res.json<{ message: string }>().message;

// ---- 1. password policy --------------------------------------------------------------------------------------------

test('policy: at least 10 characters, with a plain message', async () => {
  const { app } = await makeApp();
  assert.equal(PASSWORD_MIN, 10);
  const res = await new Client(app).post(REGISTER, { username: 'Short_One', password: 'k7#mq2!x9' }); // 9 characters
  errorOf(res, 400, 'invalid_input');
  assert.match(message(res), /at least 10 characters/);
  ok(await new Client(app).post(REGISTER, { username: 'Long_One', password: 'k7#mq2!x9z' }), 201); // exactly 10
});

test('policy: the built-in list has 10,000+ entries and common passwords are refused, whatever the case', async () => {
  const list = builtinCommonPasswords();
  assert.ok(list.length >= 10_000, `list has ${list.length} entries`);
  assert.ok(list.includes('password') && list.includes('qwertyuiop') && list.includes('1234567890'));
  const { app } = await makeApp();
  for (const pw of ['password123', 'Password123', 'QWERTYUIOP', '1234567890', 'iloveyou123', 'letmein123']) {
    const res = await new Client(app).post(REGISTER, { username: 'Common_One', password: pw });
    errorOf(res, 400, 'invalid_input');
    assert.match(message(res), /most common/, pw);
  }
  assert.equal(app.ctx.store.getAccountByLowerName('common_one'), null);
});

test('policy: the username (any case) inside the password is refused', async () => {
  const { app } = await makeApp();
  for (const pw of ['xx-Alicia_77-xx!', 'ALICIA_77 is my name', 'blue-alicia_77']) {
    const res = await new Client(app).post(REGISTER, { username: 'alicia_77', password: pw });
    errorOf(res, 400, 'invalid_input');
    assert.match(message(res), /must not contain your username/, pw);
  }
  ok(await new Client(app).post(REGISTER, { username: 'alicia_77', password: 'a different thing 42' }), 201);
});

test('policy: passwordProblem is null for a good one', () => {
  assert.equal(passwordProblem('correct horse battery', 'Alice'), null);
  assert.equal(passwordProblem('a'.repeat(129), 'Alice') !== null, true);
});

test('policy: an existing short password still signs in when the upgrade switch is off (default)', async () => {
  const { app } = await makeApp();
  app.ctx.store.insertAccount({ username: 'Old_Timer', passwordHash: await hashPassword('short1'), chieftain: 'old-orm', createdAt: 1 });
  const c = new Client(app);
  ok(await c.post(LOGIN, { username: 'old_timer', password: 'short1' }));
  assert.equal(await meName(c), 'Old_Timer');
});

test('policy: with the upgrade switch on, a weak password must be replaced at the next sign-in', async () => {
  const { app } = await makeApp({ requirePasswordUpgrade: true });
  app.ctx.store.insertAccount({ username: 'Old_Timer', passwordHash: await hashPassword('short1'), chieftain: 'old-orm', createdAt: 1 });
  await register(app, 'Strong_One'); // PASSWORD is fine under the policy: signs in as before
  const c = new Client(app);
  const res = await c.post(LOGIN, { username: 'Old_Timer', password: 'short1' });
  errorOf(res, 403, 'password_change_required');
  assert.match(message(res), /Choose a new one/);
  assert.equal(res.cookies.length, 0, 'no session before the password is replaced');
  assert.equal(app.ctx.store.sessionCount(1), 0);

  // A weak or unchanged new password is refused; the wrong current password is a normal sign-in failure.
  errorOf(await c.post(CHANGE, { username: 'Old_Timer', password: 'short1', newPassword: 'short2' }), 400, 'invalid_input');
  errorOf(await c.post(CHANGE, { username: 'Old_Timer', password: 'short1', newPassword: 'password123' }), 400, 'invalid_input');
  errorOf(await c.post(CHANGE, { username: 'Old_Timer', password: 'wrong one here', newPassword: 'a fresh strong one 1' }), 401, 'unauthorized');
  const changed = await c.post(CHANGE, { username: 'Old_Timer', password: 'short1', newPassword: 'a fresh strong one 1' });
  ok(changed);
  assert.equal(await meName(c), 'Old_Timer');
  assert.ok(app.ctx.store.auditRows().some((r) => r.action === 'password_change'));

  // The old password is dead, the new one works and passes the policy.
  errorOf(await new Client(app).post(LOGIN, { username: 'Old_Timer', password: 'short1' }), 401, 'unauthorized');
  ok(await new Client(app).post(LOGIN, { username: 'Old_Timer', password: 'a fresh strong one 1' }));
});

test('change password ends the other sessions of the account', async () => {
  const { app } = await makeApp();
  const a = await register(app, 'Alice');
  const other = new Client(app);
  ok(await other.post(LOGIN, { username: 'Alice', password: PASSWORD }));
  ok(await a.post(CHANGE, { username: 'Alice', password: PASSWORD, newPassword: 'brand new secret 77' }));
  assert.equal(await meName(a), 'Alice');
  assert.equal(await meName(other), null);
  assert.equal(app.ctx.store.sessionCount(1), 1);
});

test('env: PASSWORD_UPGRADE_ON_LOGIN is a strict on/off flag', () => {
  assert.equal(parseFlag(undefined, 'X'), false);
  assert.equal(parseFlag('0', 'X'), false);
  assert.equal(parseFlag('1', 'X'), true);
  assert.equal(parseFlag('true', 'X'), true);
  assert.throws(() => parseFlag('maybe', 'X'), /expected 1 or 0/);
});

// ---- 2. lockout ----------------------------------------------------------------------------------------------------

test('lockout: the delay grows with each failure and is capped', () => {
  assert.deepEqual([1, 2].map(lockoutDelayMs), [0, 0]);
  assert.equal(lockoutDelayMs(3), LOCKOUT_BASE_MS);
  assert.equal(lockoutDelayMs(4), 2 * LOCKOUT_BASE_MS);
  assert.equal(lockoutDelayMs(5), 4 * LOCKOUT_BASE_MS);
  assert.equal(lockoutDelayMs(40), LOCKOUT_MAX_MS);
});

test('lockout: three failures lock the account (from any IP), even the right password is refused until the delay is over', async () => {
  const { app, clock } = await makeApp();
  await register(app, 'Alice');
  for (let i = 0; i < 3; i++) errorOf(await new Client(app).post(LOGIN, { username: 'Alice', password: `wrong password ${i}` }), 401, 'unauthorized');
  const locked = await new Client(app).post(LOGIN, { username: 'alice', password: PASSWORD });
  errorOf(locked, 401, 'unauthorized');
  assert.equal(message(locked), LOGIN_FAILED_MESSAGE);
  assert.equal(locked.cookies.length, 0);

  clock.advance(LOCKOUT_BASE_MS - 1000);
  errorOf(await new Client(app).post(LOGIN, { username: 'Alice', password: PASSWORD }), 401, 'unauthorized');
  clock.advance(2000);
  ok(await new Client(app).post(LOGIN, { username: 'Alice', password: PASSWORD }));
  // Success clears the record: two more failures do not lock again.
  for (let i = 0; i < 2; i++) errorOf(await new Client(app).post(LOGIN, { username: 'Alice', password: 'nope nope nope' }), 401, 'unauthorized');
  ok(await new Client(app).post(LOGIN, { username: 'Alice', password: PASSWORD }));
});

test('lockout: each further failure doubles the delay; attempts during a lock do not extend it', async () => {
  const { app, clock } = await makeApp();
  await register(app, 'Alice');
  const fail = async () => errorOf(await new Client(app).post(LOGIN, { username: 'Alice', password: 'wrong wrong wrong' }), 401, 'unauthorized');
  for (let i = 0; i < 3; i++) await fail();
  assert.equal(app.ctx.store.getLoginFailure('alice')?.lockedUntil, clock.t + LOCKOUT_BASE_MS);
  await fail(); // during the lock: not counted
  assert.equal(app.ctx.store.getLoginFailure('alice')?.fails, 3);
  clock.advance(LOCKOUT_BASE_MS + 1);
  await fail(); // 4th failure
  assert.equal(app.ctx.store.getLoginFailure('alice')?.lockedUntil, clock.t + 2 * LOCKOUT_BASE_MS);
});

test('lockout: failures are forgotten after a day', async () => {
  const { app, clock } = await makeApp();
  await register(app, 'Alice');
  for (let i = 0; i < 4; i++) await new Client(app).post(LOGIN, { username: 'Alice', password: 'wrong wrong wrong' });
  clock.advance(DAY + 1000);
  errorOf(await new Client(app).post(LOGIN, { username: 'Alice', password: 'wrong wrong wrong' }), 401, 'unauthorized');
  assert.equal(app.ctx.store.getLoginFailure('alice')?.fails, 1, 'counting started over');
});

test('lockout: an unknown name looks exactly like a known one (same answer, same bookkeeping)', async () => {
  const { app } = await makeApp();
  await register(app, 'Alice');
  const answers: { status: number; body: unknown }[] = [];
  for (const name of ['Alice', 'Nobody_Here']) {
    for (let i = 0; i < 5; i++) {
      const res = await new Client(app).post(LOGIN, { username: name, password: 'wrong wrong wrong' });
      answers.push({ status: res.statusCode, body: res.json() });
    }
    // The right password for the known name during its lock gives the same answer as a wrong one.
  }
  const first = answers[0];
  for (const a of answers) assert.deepEqual(a, first);
  const known = app.ctx.store.getLoginFailure('alice');
  const unknown = app.ctx.store.getLoginFailure('nobody_here');
  assert.ok(known && unknown);
  assert.equal(known.fails, unknown.fails);
  assert.equal(known.lockedUntil - known.lastFail, unknown.lockedUntil - unknown.lastFail);
  errorOf(await new Client(app).post(LOGIN, { username: 'Alice', password: PASSWORD }), 401, 'unauthorized');
});

// ---- 3. sessions ---------------------------------------------------------------------------------------------------

test('sessions: a new random token on every sign-in, and the cookie the browser held ends', async () => {
  const { app } = await makeApp();
  const c = await register(app, 'Alice');
  const first = c.cookie;
  ok(await c.post(LOGIN, { username: 'Alice', password: PASSWORD }));
  assert.notEqual(c.cookie, first);
  assert.equal(app.ctx.store.sessionCount(1), 1, 'the old token was dropped when the new one was issued');
  const stale = new Client(app);
  stale.cookie = first;
  assert.equal(await meName(stale), null);
  assert.equal(await meName(c), 'Alice');
});

test('sessions: idle expiry is 14 days and slides with use', async () => {
  const { app, clock } = await makeApp();
  const idle = await register(app, 'Idle_One');
  const busy = await register(app, 'Busy_One');
  for (let i = 0; i < 5; i++) {
    clock.advance(10 * DAY);
    assert.equal(await meName(busy), 'Busy_One', `busy alive after ${(i + 1) * 10} days`);
  }
  assert.equal(await meName(idle), null);
  assert.equal(SESSION_IDLE_MS, 14 * DAY);
});

test('sessions: absolute expiry is 60 days, however busy', async () => {
  const { app, clock } = await makeApp();
  const c = await register(app, 'Busy_Two');
  for (let d = 5; d <= 55; d += 5) {
    clock.advance(5 * DAY);
    assert.equal(await meName(c), 'Busy_Two', `alive on day ${d}`);
  }
  clock.advance(6 * DAY); // day 61
  assert.equal(await meName(c), null);
  assert.equal(SESSION_ABSOLUTE_MS, 60 * DAY);
});

test('sessions: at most 10 per account, the oldest is dropped', async () => {
  const { app, clock } = await makeApp();
  const first = await register(app, 'Alice');
  const rest: Client[] = [];
  for (let i = 0; i < SESSION_MAX_PER_ACCOUNT; i++) {
    clock.advance(1000);
    const c = new Client(app);
    ok(await c.post(LOGIN, { username: 'Alice', password: PASSWORD }));
    rest.push(c);
  }
  assert.equal(app.ctx.store.sessionCount(1), SESSION_MAX_PER_ACCOUNT);
  assert.equal(await meName(first), null, 'the oldest session was dropped');
  for (const c of rest) assert.equal(await meName(c), 'Alice');
});

test('sign out everywhere: ends every session of the account, not of others', async () => {
  const { app } = await makeApp();
  const a1 = await register(app, 'Alice');
  const a2 = new Client(app);
  ok(await a2.post(LOGIN, { username: 'Alice', password: PASSWORD }));
  const bob = await register(app, 'Bob');
  errorOf(await new Client(app).post(LOGOUT_ALL), 401, 'unauthorized');

  const res = await a1.post(LOGOUT_ALL);
  assert.equal(res.statusCode, 204);
  assert.equal(res.cookies.find((x) => x.name === LOBBY_SESSION_COOKIE)?.value, '');
  assert.equal(app.ctx.store.sessionCount(1), 0);
  assert.equal(await meName(a2), null);
  assert.equal(await meName(bob), 'Bob');
  assert.ok(app.ctx.store.auditRows().some((r) => r.action === 'logout_all'));
  // The cross-site check still applies to this write.
  errorOf(await bob.post(LOGOUT_ALL, undefined, { origin: 'http://evil.test' }), 403, 'forbidden');
  assert.equal(await meName(bob), 'Bob');
});

test('sign out everywhere also ends world access: a signed-out account cannot get a new entry pass', async () => {
  const { app } = await makeApp();
  app.ctx.store.insertWorld({ id: 'w1', name: 'World 1', status: 'open', path: '/w/w1/', createdAt: 0 });
  const a = await register(app, 'Alice');
  ok(await a.post('/lobby/api/worlds/w1/enter', {}));
  const stale = a.cookie;
  ok(await a.post(LOGOUT_ALL), 204);
  const again = new Client(app);
  again.cookie = stale;
  errorOf(await again.post('/lobby/api/worlds/w1/enter', {}), 401, 'unauthorized');
});

test('cookie: Secure is always on in production, and a lobby that would send it without is refused at start', async () => {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(makeApp({ secureCookies: false }), /must be Secure/);
    const { app } = await makeApp({ secureCookies: undefined });
    const res = await new Client(app).post(REGISTER, { username: 'Prod_One', password: PASSWORD });
    ok(res, 201);
    assert.match(String(res.headers['set-cookie']), /Secure/);
    await app.close();
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
});
