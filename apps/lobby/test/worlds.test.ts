import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENTRY_PASS_TTL_MS, LOBBY_SESSION_COOKIE, type EnterWorldResponse, type LobbyWorldsResponse } from '@clanfire/engine';
import { runAdmin } from '../src/admin-ops.ts';
import { RATE_ENTER_PER_ACCOUNT } from '../src/app.ts';
import { generateKeyPair, publicKeyBase64, verifyPass } from '../src/pass.ts';
import { Client, KEY, MINUTE, PUBLIC_KEY, addWorld, errorOf, makeApp, ok, register } from './helpers.ts';

const WORLDS = '/lobby/api/worlds';
const enter = (id: string) => `/lobby/api/worlds/${id}/enter`;

test('worlds: needs sign-in, then lists in sort order with status and path', async () => {
  const { app } = await makeApp();
  addWorld(app, 'w2', 'Second world');
  addWorld(app, 'w1', 'First world', 'full');
  addWorld(app, 'old', 'Closed world', 'closed', '/w/old/');
  errorOf(await new Client(app).get(WORLDS), 401, 'unauthorized');

  const c = await register(app, 'Alice');
  const res = await c.get(WORLDS);
  ok(res);
  // insertion order = sort order (each new world goes last)
  assert.deepEqual(res.json<LobbyWorldsResponse>(), {
    worlds: [
      { id: 'w2', name: 'Second world', status: 'open', path: '/w/w2/' },
      { id: 'w1', name: 'First world', status: 'full', path: '/w/w1/' },
      { id: 'old', name: 'Closed world', status: 'closed', path: '/w/old/' },
    ],
  });
});

test('worlds: a finished world is listed with its status', async () => {
  const { app } = await makeApp();
  addWorld(app, 'w1', 'Running');
  addWorld(app, 'w0', 'Ended', 'finished');
  const c = await register(app, 'Alice');
  assert.deepEqual((await c.get(WORLDS)).json<LobbyWorldsResponse>().worlds.map((w) => [w.id, w.status]), [
    ['w1', 'open'],
    ['w0', 'finished'],
  ]);
});

test('enter: a finished world still gives a pass (read-only world, the results can be looked at)', async () => {
  const { app, clock } = await makeApp();
  addWorld(app, 'w0', 'Ended', 'finished');
  const c = await register(app, 'Alice');
  const res = await c.post(enter('w0'), {});
  ok(res);
  const entry = res.json<EnterWorldResponse>();
  assert.equal(entry.path, '/w/w0/');
  assert.equal(verifyPass(entry.pass, [PUBLIC_KEY], clock.now()).wid, 'w0');
});

test('worlds: sort_order wins, ties are broken by id; an empty list is fine', async () => {
  const { app } = await makeApp();
  const c = await register(app, 'Alice');
  assert.deepEqual((await c.get(WORLDS)).json(), { worlds: [] });
  addWorld(app, 'b');
  addWorld(app, 'a');
  addWorld(app, 'c');
  app.ctx.store.db.exec("UPDATE worlds SET sort_order = 5 WHERE id IN ('b', 'c')");
  const ids = (await c.get(WORLDS)).json<LobbyWorldsResponse>().worlds.map((w) => w.id);
  assert.deepEqual(ids, ['b', 'c', 'a']);
});

test('enter: needs sign-in, a valid id, an existing world and an empty body', async () => {
  const { app } = await makeApp();
  addWorld(app, 'w1');
  errorOf(await new Client(app).post(enter('w1'), {}), 401, 'unauthorized');

  const c = await register(app, 'Alice');
  errorOf(await c.post(enter('nope'), {}), 404, 'not_found');
  errorOf(await c.post(enter('w2'), {}), 404, 'not_found');
  errorOf(await c.post(enter('w1%2F..'), {}), 400, 'invalid_input');
  errorOf(await c.post(enter('x'.repeat(33)), {}), 400, 'invalid_input');
  errorOf(await c.post(enter('w1'), { world: 'w2' }), 400, 'invalid_input');
  errorOf(await c.post(enter('w1'), [1]), 400, 'invalid_input');
  ok(await c.post(enter('w1'))); // an empty body is fine
  ok(await c.post(enter('w1'), {}));
});

test('enter: a closed world refuses with 403 and issues no pass', async () => {
  const { app } = await makeApp();
  addWorld(app, 'shut', 'Shut', 'closed');
  const c = await register(app, 'Alice');
  const res = await c.post(enter('shut'), {});
  errorOf(res, 403, 'forbidden');
  assert.equal(res.json<{ message: string }>().message, 'This world is closed.');
  assert.ok(!('pass' in res.json()));
});

test('enter: open and full worlds give a pass that verifies with the public key', async () => {
  const { app, clock } = await makeApp();
  addWorld(app, 'w1', 'One', 'open');
  addWorld(app, 'w2', 'Two', 'full', '/w/two-path/');
  const c = await register(app, 'Alice');

  const a = await c.post(enter('w1'), {});
  ok(a);
  const first = a.json<EnterWorldResponse>();
  assert.equal(first.path, '/w/w1/');
  assert.equal(first.expiresAt, clock.now() + ENTRY_PASS_TTL_MS);
  const claims = verifyPass(first.pass, [PUBLIC_KEY], clock.now());
  assert.equal(claims.v, 1);
  assert.equal(claims.wid, 'w1');
  assert.equal(claims.aid, 1);
  assert.equal(claims.name, 'Alice');
  assert.equal(claims.chn, 'old-orm');
  assert.equal(claims.role, null);
  assert.equal(claims.iat, clock.now());
  assert.equal(claims.exp - claims.iat, 60_000);
  assert.equal(claims.exp, first.expiresAt);
  assert.match(claims.nonce, /^[A-Za-z0-9_-]{22,}$/);
  assert.match(claims.kid, /^[0-9a-f]{16}$/);

  // A full world still issues a pass: the world decides about newcomers.
  const b = await c.post(enter('w2'), {});
  ok(b);
  assert.equal(b.json<EnterWorldResponse>().path, '/w/two-path/');
  assert.equal(verifyPass(b.json<EnterWorldResponse>().pass, [PUBLIC_KEY], clock.now()).wid, 'w2');

  // A fresh nonce every time.
  clock.advance(1000);
  const again = verifyPass((await c.post(enter('w1'), {})).json<EnterWorldResponse>().pass, [PUBLIC_KEY], clock.now());
  assert.notEqual(again.nonce, claims.nonce);
  assert.equal(again.iat, clock.now());

  // Enter is audited with the world id, and the pass itself is not stored anywhere.
  const rows = app.ctx.store.auditRows().filter((r) => r.action === 'enter');
  assert.equal(rows.length, 3);
  assert.equal(rows[2]?.detail, 'w1');
  assert.ok(!JSON.stringify(app.ctx.store.auditRows()).includes(first.pass));
});

test('enter: the pass carries the account chieftain and staff role', async () => {
  const { app, clock } = await makeApp();
  addWorld(app, 'w1');
  const c = await register(app, 'Staffer');
  app.ctx.store.setStaffRole(1, 'moderator');
  app.ctx.store.db.exec("UPDATE accounts SET chieftain = 'ysra' WHERE id = 1");
  const claims = verifyPass((await c.post(enter('w1'), {})).json<EnterWorldResponse>().pass, [PUBLIC_KEY], clock.now());
  assert.equal(claims.role, 'moderator');
  assert.equal(claims.chn, 'ysra');
});

test('pass: expiry, tampering, wrong key, wrong domain are all refused by the test verifier', async () => {
  const { app, clock } = await makeApp();
  addWorld(app, 'w1');
  const c = await register(app, 'Alice');
  const { pass } = (await c.post(enter('w1'), {})).json<EnterWorldResponse>();
  assert.ok(verifyPass(pass, [PUBLIC_KEY], clock.now()));
  assert.throws(() => verifyPass(pass, [PUBLIC_KEY], clock.now() + ENTRY_PASS_TTL_MS), /expired/);
  assert.throws(() => verifyPass(pass, [publicKeyBase64(generateKeyPair().privateKey)], clock.now()), /unknown key id/);

  const [payload, sig] = pass.split('.') as [string, string];
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  const tampered = Buffer.from(JSON.stringify({ ...claims, wid: 'w2' })).toString('base64url');
  assert.throws(() => verifyPass(`${tampered}.${sig}`, [PUBLIC_KEY], clock.now()), /bad signature/);
  const longLived = Buffer.from(JSON.stringify({ ...claims, exp: (claims.iat as number) + 10 * MINUTE })).toString('base64url');
  assert.throws(() => verifyPass(`${longLived}.${sig}`, [PUBLIC_KEY], clock.now()), /bad signature/);
  assert.throws(() => verifyPass('garbage', [PUBLIC_KEY], clock.now()), /malformed/);
  assert.throws(() => verifyPass(`${payload}.`, [PUBLIC_KEY], clock.now()), /malformed/);
  // The signature is over the domain + payload, not the payload alone.
  const { createPrivateKey, sign } = await import('node:crypto');
  const privateKey = createPrivateKey({ key: Buffer.from(KEY.privateKeyBase64, 'base64'), format: 'der', type: 'pkcs8' });
  const bare = sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url');
  assert.throws(() => verifyPass(`${payload}.${bare}`, [PUBLIC_KEY], clock.now()), /bad signature/);
});

test('enter: a banned account gets 403 and no pass; the admin ban ends sessions', async () => {
  const { app, clock } = await makeApp();
  addWorld(app, 'w1');
  const c = await register(app, 'Alice');
  const d = await register(app, 'Bob');

  // Banned while a session is still around (for example edited straight in the database): refused with 403.
  app.ctx.store.db.exec('UPDATE accounts SET banned_at = 1 WHERE id = 1');
  const res = await c.post(enter('w1'), {});
  errorOf(res, 403, 'forbidden');
  assert.ok(!('pass' in res.json()));
  // ... and that session is gone afterwards.
  assert.equal(app.ctx.store.sessionCount(1), 0);
  errorOf(await c.post(enter('w1'), {}), 401, 'unauthorized');
  // The world list is closed to a banned account in the same way.
  const e = await register(app, 'Carol');
  app.ctx.store.db.exec('UPDATE accounts SET banned_at = 1 WHERE id = 3');
  errorOf(await e.get(WORLDS), 403, 'forbidden');

  // The admin ban ends the sessions at once.
  ok(await d.post(enter('w1'), {}));
  const out: string[] = [];
  const code = runAdmin(['ban', 'bob', 'cheating', 'a', 'lot'], { openStore: () => app.ctx.store, env: {}, now: clock.now, out: (l) => out.push(l), err: (l) => out.push(l) });
  assert.equal(code, 0, out.join('\n'));
  assert.equal(app.ctx.store.sessionCount(2), 0);
  errorOf(await d.post(enter('w1'), {}), 401, 'unauthorized');
  assert.deepEqual((await d.get('/lobby/api/auth/me')).json(), { account: null });
  assert.equal(app.ctx.store.getAccount(2)?.banReason, 'cheating a lot');
});

test('enter: rate limited per account', async () => {
  const { app } = await makeApp();
  addWorld(app, 'w1');
  const c = await register(app, 'Alice');
  for (let i = 0; i < RATE_ENTER_PER_ACCOUNT; i++) ok(await c.post(enter('w1'), {}));
  const res = await c.post(enter('w1'), {});
  errorOf(res, 429, 'rate_limited');
  assert.equal(res.headers['retry-after'], '60');
  // Another account from another IP is not affected.
  const other = await register(app, 'Bob');
  ok(await other.post(enter('w1'), {}));
});

test('enter: a cross-site POST is refused before anything else', async () => {
  const { app } = await makeApp();
  addWorld(app, 'w1');
  const c = await register(app, 'Alice');
  errorOf(await c.post(enter('w1'), {}, { origin: 'https://evil.example' }), 403, 'forbidden');
  assert.equal(app.ctx.store.auditRows().filter((r) => r.action === 'enter').length, 0);
});

test('the lobby cookie never authenticates under another name', async () => {
  const { app } = await makeApp();
  addWorld(app, 'w1');
  const c = await register(app, 'Alice');
  const token = c.cookie.split('=')[1] ?? '';
  const other = new Client(app);
  other.cookie = `tw_session=${token}`;
  errorOf(await other.get(WORLDS), 401, 'unauthorized');
  other.cookie = `${LOBBY_SESSION_COOKIE}=${token}`;
  ok(await other.get(WORLDS));
});
