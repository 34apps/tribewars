// Account deletion, and export. Fast: injected clock and fake fetch, no real waiting.

import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { test } from 'node:test';
import {
  ACCOUNT_DELETE_CONFIRM,
  DELETED_PLAYER_NAME,
  LOBBY_COMMAND_DOMAIN,
  LOBBY_COMMAND_TTL_MS,
  LOBBY_SESSION_COOKIE,
  type AccountDeletionInfoDto,
  type AccountExportDto,
  type LobbyCommandClaims,
} from '@clanfire/engine';
import { runAdmin } from '../src/admin-ops.ts';
import { noopHooks, type AccountDataHooks } from '../src/account-hooks.ts';
import { parseWorldApiUrl } from '../src/env.ts';
import { RETRY_MAX_MS, retryDelayMs } from '../src/world-commands.ts';
import { Client, HOST, KEY, PASSWORD, PUBLIC_KEY, addWorld, errorOf, makeApp, ok, register } from './helpers.ts';

const DAY = 24 * 3600_000;
const WORLD_API = 'http://game-{id}:3000/w/{id}/api';

interface Sent {
  url: string;
  claims: LobbyCommandClaims;
  signatureOk: boolean;
}

/** A fake fetch that records signed commands and answers per world with `answer`. */
function fakeWorlds(answer: (sent: Sent) => { status: number; body?: unknown } | 'throw') {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const { command } = JSON.parse(String(init?.body)) as { command: string };
    const [payload, sig] = command.split('.') as [string, string];
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LobbyCommandClaims;
    const pub = createPublicKey({ key: Buffer.from(PUBLIC_KEY, 'base64'), format: 'der', type: 'spki' });
    const signatureOk = verify(null, Buffer.from(`${LOBBY_COMMAND_DOMAIN}\n${payload}`, 'utf8'), pub, Buffer.from(sig, 'base64url'));
    const s: Sent = { url: String(url), claims, signatureOk };
    sent.push(s);
    const a = answer(s);
    if (a === 'throw') throw new Error('connection refused');
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { sent, fetchImpl };
}

const del = (c: Client, body: unknown = { password: PASSWORD, confirm: ACCOUNT_DELETE_CONFIRM }, headers?: Record<string, string>) => c.post('/lobby/api/account/delete', body, headers);

async function setup(over: Parameters<typeof makeApp>[0] = {}) {
  const t = await makeApp(over);
  return t;
}

function rows(app: Awaited<ReturnType<typeof makeApp>>['app'], sql: string, ...p: (string | number)[]) {
  return (app.ctx.store.db.prepare(sql).all(...p) as Record<string, unknown>[]).map((r) => ({ ...r }));
}

test('delete: refusals (signed out, cross-site, missing confirm, unknown keys, wrong password + lockout)', async () => {
  const { app } = await setup();
  const anon = new Client(app);
  errorOf(await del(anon), 401, 'unauthorized');
  errorOf(await anon.get('/lobby/api/account/deletion-info'), 401, 'unauthorized');
  errorOf(await anon.get('/lobby/api/account/export'), 401, 'unauthorized');

  const c = await register(app, 'Alice');
  errorOf(await del(c, undefined, { origin: 'http://evil.test' }), 403, 'forbidden');
  errorOf(await del(c, { password: PASSWORD }), 400, 'invalid_input');
  errorOf(await del(c, { password: PASSWORD, confirm: 'delete' }), 400, 'invalid_input');
  errorOf(await del(c, { password: PASSWORD, confirm: 'DELETE', extra: 1 }), 400, 'invalid_input');
  errorOf(await del(c, { password: 'wrong wrong wrong', confirm: 'DELETE' }), 401, 'unauthorized');
  assert.equal(app.ctx.store.getLoginFailure('alice')?.fails, 1);
  // Still alive.
  const me = await c.get('/lobby/api/auth/me');
  assert.equal(me.json<{ account: unknown }>().account !== null, true);
  assert.equal(app.ctx.store.getAccountByLowerName('alice')?.deletedAt, null);
});

test('delete: account becomes a tombstone, everything personal goes', async () => {
  const { app, clock } = await setup();
  addWorld(app, 'w1');
  const c = await register(app, 'Alice');
  ok(await c.post('/lobby/api/worlds/w1/enter'));
  const id = app.ctx.store.getAccountByLowerName('alice')!.id;
  app.ctx.store.insertAccountBadge(id, 'w0', 'veteran', null, 5);
  app.ctx.store.insertHallOfFame({
    worldId: 'w0',
    worldName: 'Old',
    endedAt: 5,
    kind: 'domination',
    winnerName: 'Alice',
    winnerTag: 'TAG',
    topJson: JSON.stringify({ tribes: [], players: [{ rank: 1, name: 'Alice', points: 9, tribeTag: 'TAG' }, { rank: 2, name: 'Alicia', points: 8, tribeTag: null }] }),
  });
  assert.ok(rows(app, 'SELECT * FROM account_ips WHERE account_id = ?', id).length > 0);

  clock.advance(1000);
  const res = await del(c);
  ok(res, 204);
  assert.ok(res.cookies.some((k) => k.name === LOBBY_SESSION_COOKIE && k.value === ''), 'cookie cleared');

  const row = app.ctx.store.getAccount(id)!;
  assert.equal(row.deletedAt, clock.t);
  assert.equal(row.username, `deleted-${id}`);
  assert.equal(row.staffRole, null);
  assert.equal(row.bannedAt, null);
  assert.equal(app.ctx.store.sessionCount(id), 0);
  for (const t of ['account_ips', 'account_badges', 'account_worlds']) assert.equal(rows(app, `SELECT * FROM ${t} WHERE account_id = ?`, id).length, 0, t);

  // cannot sign in (old name, tombstone name), cannot use the old cookie
  const again = new Client(app);
  errorOf(await again.post('/lobby/api/auth/login', { username: 'Alice', password: PASSWORD }), 401, 'unauthorized');
  errorOf(await again.post('/lobby/api/auth/login', { username: `deleted-${id}`, password: PASSWORD }), 401, 'unauthorized');
  errorOf(await c.get('/lobby/api/worlds'), 401, 'unauthorized');

  // Hall of Fame: exact name replaced, the similar name untouched
  const hof = app.ctx.store.listHallOfFame(5)[0]!;
  assert.equal(hof.winnerName, DELETED_PLAYER_NAME);
  const players = (JSON.parse(hof.topJson) as { players: { name: string }[] }).players.map((p) => p.name);
  assert.deepEqual(players, [DELETED_PLAYER_NAME, 'Alicia']);

  // audit: no name, target = id
  const a = app.ctx.store.auditRows(20).find((r) => r.action === 'account_deleted')!;
  assert.equal(a.targetAccount, id);
  assert.equal(JSON.stringify(a).includes('Alice'), false);

  // the queue got the world
  assert.deepEqual(rows(app, 'SELECT world_id, attempts, done_at FROM account_deletions WHERE account_id = ?', id), [{ world_id: 'w1', attempts: 0, done_at: null }]);

  // the old name can be registered again
  const fresh = new Client(app);
  ok(await fresh.post('/lobby/api/auth/register', { username: 'Alice', password: PASSWORD }), 201);
  assert.notEqual(app.ctx.store.getAccountByLowerName('alice')!.id, id);
});

test('delete: a banned account keeps its name and ban, loses password and sessions; name stays taken', async () => {
  const { app } = await setup();
  const c = await register(app, 'Mallory');
  const id = app.ctx.store.getAccountByLowerName('mallory')!.id;
  app.ctx.store.banAccount(id, 'cheating', 1234);
  app.ctx.accountData.deleteAccount(id, { kind: 'operator' });
  const row = app.ctx.store.getAccount(id)!;
  assert.equal(row.username, 'Mallory');
  assert.equal(row.bannedAt, 1234);
  assert.equal(row.banReason, 'cheating');
  assert.notEqual(row.deletedAt, null);
  assert.equal(row.passwordHash, '!');
  assert.equal(app.ctx.store.sessionCount(id), 0);
  errorOf(await new Client(app).post('/lobby/api/auth/register', { username: 'Mallory', password: PASSWORD }), 409, 'username_taken');
  errorOf(await new Client(app).post('/lobby/api/auth/login', { username: 'Mallory', password: PASSWORD }), 401, 'unauthorized');
  void c;
});

test('deletion-info and the hooks (called inside the transaction)', async () => {
  const calls: string[] = [];
  const hooks: AccountDataHooks = {
    ...noopHooks,
    deletionInfo: () => ({ flames: 120 }),
    onAccountDeleted: (db, accountId) => {
      calls.push(`deleted:${accountId}`);
      // inside the transaction: the tombstone is already written, a rollback would undo it
      assert.equal((db.prepare('SELECT deleted_at FROM accounts WHERE id = ?').get(accountId) as { deleted_at: number | null }).deleted_at !== null, true);
    },
    exportSections: () => ({ purchases: [{ id: 7 }] }),
  };
  const { app } = await setup({ hooks });
  addWorld(app, 'w1', 'First');
  addWorld(app, 'w2', 'Second');
  const c = await register(app, 'Bob');
  ok(await c.post('/lobby/api/worlds/w2/enter'));
  const info = (await c.get('/lobby/api/account/deletion-info')).json<AccountDeletionInfoDto>();
  assert.deepEqual(info, { worlds: [{ id: 'w2', name: 'Second' }], flames: 120 });
  const exp = (await c.get('/lobby/api/account/export')).json<AccountExportDto>();
  assert.deepEqual(exp.extra, { purchases: [{ id: 7 }] });
  ok(await del(c), 204);
  const id = app.ctx.store.getAccount(1)!.id;
  assert.deepEqual(calls, [`deleted:${id}`]);

  // default hooks: no shop
  const plain = await setup();
  const p = await register(plain.app, 'Carl');
  assert.deepEqual((await p.get('/lobby/api/account/deletion-info')).json(), { worlds: [], flames: null });
});

test('a failing hook rolls the deletion back', async () => {
  const { app } = await setup({
    hooks: {
      ...noopHooks,
      onAccountDeleted: () => {
        throw new Error('shop down');
      },
    },
  });
  const c = await register(app, 'Dora');
  const res = await del(c);
  assert.equal(res.statusCode, 500);
  assert.equal(app.ctx.store.getAccountByLowerName('dora')?.deletedAt, null);
  assert.equal(app.ctx.store.sessionCount(app.ctx.store.getAccountByLowerName('dora')!.id), 1);
});

test('dispatcher: signed command, backoff on failure, done on success, no resend when done', async () => {
  let w2 = 'fail' as 'fail' | 'throw' | 'ok';
  const f = fakeWorlds((s) => (s.claims.wid === 'w1' ? { status: 200, body: { done: true } } : w2 === 'throw' ? 'throw' : w2 === 'fail' ? { status: 500 } : { status: 200, body: { done: true } }));
  const { app, clock } = await setup({ worldApiUrl: WORLD_API, fetchImpl: f.fetchImpl });
  addWorld(app, 'w1');
  addWorld(app, 'w2');
  const c = await register(app, 'Erin');
  ok(await c.post('/lobby/api/worlds/w1/enter'));
  ok(await c.post('/lobby/api/worlds/w2/enter'));
  const id = app.ctx.store.getAccountByLowerName('erin')!.id;
  ok(await del(c), 204);
  await app.ctx.dispatcher.runPending();

  const first = f.sent.filter((s) => s.claims.wid === 'w2');
  assert.equal(first.length, 1);
  const s = f.sent.find((x) => x.claims.wid === 'w1')!;
  assert.equal(s.url, 'http://game-w1:3000/w/w1/api/lobby/account/delete');
  assert.equal(s.signatureOk, true);
  assert.equal(s.claims.typ, 'account_delete');
  assert.equal(s.claims.aid, id);
  assert.equal(s.claims.exp - s.claims.iat, LOBBY_COMMAND_TTL_MS);
  assert.ok(s.claims.nonce.length >= 22);
  const state = () => Object.fromEntries(rows(app, 'SELECT world_id, attempts, next_try_at, done_at FROM account_deletions WHERE account_id = ?', id).map((r) => [r.world_id, r]));
  assert.notEqual(state().w1!.done_at, null);
  assert.equal(state().w2!.attempts, 1);
  assert.equal(state().w2!.next_try_at, clock.t + 60_000);

  clock.advance(59_000);
  await app.ctx.dispatcher.runPending();
  assert.equal(f.sent.filter((x) => x.claims.wid === 'w2').length, 1, 'not due yet');
  clock.advance(1_000);
  w2 = 'throw';
  await app.ctx.dispatcher.runPending();
  assert.equal(f.sent.filter((x) => x.claims.wid === 'w2').length, 2);
  assert.equal(state().w2!.attempts, 2);
  assert.equal(state().w2!.next_try_at, clock.t + 120_000);
  assert.equal(new Set(f.sent.map((x) => x.claims.nonce)).size, f.sent.length, 'nonce never reused');

  clock.advance(120_000);
  w2 = 'ok';
  await app.ctx.dispatcher.runPending();
  assert.notEqual(state().w2!.done_at, null);
  const n = f.sent.length;
  clock.advance(DAY);
  await app.ctx.dispatcher.runPending();
  assert.equal(f.sent.length, n, 'nothing left to send');
  assert.equal(app.ctx.dispatcher.hasPending(), false);

  // backoff curve: 1 min, doubling, capped at 6 h
  assert.deepEqual([1, 2, 3].map(retryDelayMs), [60_000, 120_000, 240_000]);
  assert.equal(retryDelayMs(40), RETRY_MAX_MS);
});

test('dispatcher: without WORLD_API_URL rows wait; a removed world drops its rows; an answer without done:true is a failure', async () => {
  const quiet = await setup();
  addWorld(quiet.app, 'w1');
  const c = await register(quiet.app, 'Finn');
  ok(await c.post('/lobby/api/worlds/w1/enter'));
  ok(await del(c), 204);
  await quiet.app.ctx.dispatcher.runPending();
  assert.equal(quiet.app.ctx.dispatcher.hasPending(), true);
  assert.equal(rows(quiet.app, 'SELECT attempts FROM account_deletions')[0]!.attempts, 0);
  const code = runAdmin(['world-remove', 'w1'], { openStore: () => quiet.app.ctx.store, env: {}, now: () => 5, out: () => {}, err: () => {} });
  assert.equal(code, 0);
  assert.equal(quiet.app.ctx.dispatcher.hasPending(), false);

  const f = fakeWorlds(() => ({ status: 200, body: { done: false } }));
  const t = await setup({ worldApiUrl: WORLD_API, fetchImpl: f.fetchImpl });
  addWorld(t.app, 'w1');
  const g = await register(t.app, 'Gus');
  ok(await g.post('/lobby/api/worlds/w1/enter'));
  ok(await del(g), 204);
  await t.app.ctx.dispatcher.runPending();
  assert.equal(t.app.ctx.dispatcher.hasPending(), true);
  assert.equal(rows(t.app, 'SELECT attempts FROM account_deletions')[0]!.attempts, 1);
});

test('export: sections, world data, unavailable worlds, no secrets, download headers, bucket', async () => {
  const f = fakeWorlds((s) =>
    s.claims.wid === 'w2'
      ? 'throw'
      : { status: 200, body: { format: 'clanflame-world-export-v1', worldId: s.claims.wid, exportedAt: 1, player: null, villages: [], notes: [], troopGroups: [], raidLists: [], mail: [], forumPosts: [], tribeChat: [], reports: [], ips: [], devices: [], supportTickets: [] } },
  );
  const { app } = await setup({ worldApiUrl: WORLD_API, fetchImpl: f.fetchImpl });
  addWorld(app, 'w1');
  addWorld(app, 'w2');
  const c = await register(app, 'Hana', '203.0.113.9');
  const other = await register(app, 'Ivan', '203.0.113.10');
  ok(await c.post('/lobby/api/worlds/w1/enter'));
  ok(await c.post('/lobby/api/worlds/w2/enter'));
  ok(await other.post('/lobby/api/worlds/w1/enter'));
  const hana = app.ctx.store.getAccountByLowerName('hana')!;
  app.ctx.store.insertAccountBadge(hana.id, 'w0', 'veteran', null, 5);

  const res = await c.get('/lobby/api/account/export');
  ok(res);
  assert.equal(res.headers['content-disposition'], 'attachment; filename="clanflame-data-Hana.json"');
  assert.equal(res.headers['cache-control'], 'no-store');
  const dto = res.json<AccountExportDto>();
  assert.equal(dto.format, 'clanflame-account-export-v1');
  assert.equal(dto.account.username, 'Hana');
  assert.equal(dto.account.id, hana.id);
  assert.deepEqual(dto.worlds.map((w) => w.id).sort(), ['w1', 'w2']);
  assert.equal(dto.badges.length, 1);
  assert.deepEqual(dto.ips.map((i) => i.ip), ['203.0.113.9']);
  assert.ok(dto.audit.some((a) => a.action === 'register'));
  assert.deepEqual(dto.worldData.map((w) => w.worldId), ['w1']);
  assert.deepEqual(dto.worldsUnavailable, ['w2']);
  assert.ok(f.sent.every((s) => s.signatureOk && s.claims.typ === 'account_export' && s.claims.aid === hana.id));
  assert.ok(f.sent.some((s) => s.url === 'http://game-w2:3000/w/w2/api/lobby/account/export'));

  // no secrets, nobody else's data
  assert.equal(res.body.includes(hana.passwordHash), false);
  assert.equal(/password|token|scrypt/i.test(res.body), false);
  assert.equal(res.body.includes('Ivan'), false);
  assert.equal(res.body.includes('203.0.113.10'), false);

  ok(await c.get('/lobby/api/account/export')); // 2nd
  errorOf(await c.get('/lobby/api/account/export'), 429, 'rate_limited');
  ok(await other.get('/lobby/api/account/export')); // another account has its own bucket
});

test('export without WORLD_API_URL: every entered world is unavailable, the rest works', async () => {
  const { app } = await setup();
  addWorld(app, 'w1');
  const c = await register(app, 'Jan');
  ok(await c.post('/lobby/api/worlds/w1/enter'));
  const dto = (await c.get('/lobby/api/account/export')).json<AccountExportDto>();
  assert.deepEqual(dto.worldsUnavailable, ['w1']);
  assert.deepEqual(dto.worldData, []);
});

test('CLI: deletions, delete-account', async () => {
  const { app, clock } = await setup();
  addWorld(app, 'w1');
  const c = await register(app, 'Kira');
  ok(await c.post('/lobby/api/worlds/w1/enter'));
  await register(app, 'Liam');
  const out: string[] = [];
  const err: string[] = [];
  const run = (now: number, ...argv: string[]) => runAdmin(argv, { openStore: () => app.ctx.store, env: {}, now: () => now, out: (l) => out.push(l), err: (l) => err.push(l) });

  const late = clock.t + DAY;
  assert.equal(run(late, 'inactive-sweep'), 1);

  out.length = 0;
  assert.equal(run(late, 'deletions'), 0);
  assert.match(out.join('\n'), /No account deletion is waiting/);
  assert.equal(run(late, 'delete-account', 'Kira'), 0);
  const id = Number(/account (\d+)/.exec(out.join('\n'))![1]);
  assert.notEqual(app.ctx.store.getAccount(id)!.deletedAt, null);
  assert.ok(app.ctx.store.auditRows(20).some((a) => a.action === 'account_deleted' && a.actorIp === 'cli' && a.detail === 'by operator'));
  out.length = 0;
  assert.equal(run(late, 'deletions'), 0);
  assert.match(out.join('\n'), new RegExp(`account ${id}  world w1  attempts 0`));
  assert.equal(run(late, 'delete-account', 'Kira'), 1); // name is gone
  assert.equal(run(late, 'delete-account', `deleted-${id}`), 1); // already deleted
  void HOST;
  void KEY;
});

test('WORLD_API_URL parsing', () => {
  assert.equal(parseWorldApiUrl(WORLD_API, true), WORLD_API);
  assert.equal(parseWorldApiUrl('', true), null);
  assert.equal(parseWorldApiUrl(undefined, false), 'http://127.0.0.1:3000/w/{id}/api');
  for (const bad of ['http://x/api', 'ftp://x/{id}', 'http://u:p@x/{id}', 'http://x/{id}?a=1', 'nonsense {id}']) assert.throws(() => parseWorldApiUrl(bad, true), /WORLD_API_URL/, bad);
});

test('queue pruning: finished rows older than 30 days go, newer finished and pending rows stay', async () => {
  const f = fakeWorlds(() => ({ status: 200, body: { done: true } }));
  const { app, clock } = await setup({ worldApiUrl: WORLD_API, fetchImpl: f.fetchImpl });
  addWorld(app, 'w1');
  const c = await register(app, 'Gina');
  ok(await c.post('/lobby/api/worlds/w1/enter'));
  ok(await del(c), 204);
  await app.ctx.dispatcher.runPending();
  assert.equal(rows(app, 'SELECT 1 FROM account_deletions WHERE done_at IS NOT NULL').length, 1);
  app.ctx.store.db.prepare("INSERT INTO account_deletions (account_id, world_id, created_at) VALUES (9001, 'w1', ?)").run(clock.t);
  clock.advance(29 * DAY);
  assert.equal(app.ctx.dispatcher.pruneDone(), 0);
  clock.advance(2 * DAY);
  assert.equal(app.ctx.dispatcher.pruneDone(), 1);
  assert.deepEqual(rows(app, 'SELECT account_id, done_at FROM account_deletions'), [{ account_id: 9001, done_at: null }]);
});
