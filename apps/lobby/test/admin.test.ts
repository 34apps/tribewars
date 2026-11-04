import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { openDatabase } from '../src/db.ts';
import { runAdmin } from '../src/admin-ops.ts';
import { loadEnv, databasePathOf, parseAllowedOrigins, parseTrustProxy } from '../src/env.ts';
import { generateKeyPair, keyIdOf, parseSigningKey, publicKeyBase64, signPass, verifyPass } from '../src/pass.ts';
import { Store } from '../src/store.ts';
import { checkWorldId, checkWorldName, checkWorldPath, rewriteLobbyUrl } from '../src/worlds.ts';
import { PASSWORD, makeApp, register } from './helpers.ts';

function cli(store: Store, env: Record<string, string | undefined> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  let t = 1_000;
  const run = (...argv: string[]): number => runAdmin(argv, { openStore: () => store, env, now: () => (t += 1), out: (l) => out.push(l), err: (l) => err.push(l) });
  return { run, out, err };
}

const memoryStore = (): Store => new Store(openDatabase(':memory:'));

test('world path validation: only absolute paths on this site', () => {
  for (const good of ['/w/w1/', '/w/w-2/', '/a/', '/play.v1/world_2~x/']) assert.equal(checkWorldPath(good), good);
  const bad = [
    '//evil.com',
    '//evil.com/',
    '/\\evil.com/',
    'javascript:x',
    'javascript:alert(1)/',
    'https://evil.com/',
    'http://evil.com/w/',
    '/a/../b',
    '/a/../b/',
    '/../',
    '/./',
    '/..',
    '/a//b/',
    '/w/w1', // no trailing slash
    'w/w1/',
    '/',
    '',
    '/w/w 1/',
    '/w/w1/?x=1',
    '/w/w1/#x',
    '/w/%2e%2e/',
    '/w/w1/\n',
    `/${'a'.repeat(100)}/`,
    '/w/@evil.com/',
    '/w/w1:80/',
  ];
  for (const path of bad) assert.throws(() => checkWorldPath(path), /Invalid world path/, JSON.stringify(path));
  assert.equal(checkWorldPath(`/${'a'.repeat(98)}/`).length, 100);
});

test('world id and name validation', () => {
  assert.equal(checkWorldId('w1'), 'w1');
  assert.equal(checkWorldId('a-b-9'), 'a-b-9');
  for (const id of ['', 'w 1', 'w_1', 'w/1', 'x'.repeat(33), '../x', 'ä']) assert.throws(() => checkWorldId(id), /Invalid world id/);
  assert.equal(checkWorldName('  Old Hill  '), 'Old Hill');
  for (const name of ['', '   ', 'x'.repeat(41), 'bad\nname', 'bell\u0007']) assert.throws(() => checkWorldName(name), /Invalid world name/);
});

test('URL rewrite strips only a whole /lobby segment', () => {
  assert.equal(rewriteLobbyUrl('/lobby/api/health'), '/api/health');
  assert.equal(rewriteLobbyUrl('/lobby/api/x?y=1'), '/api/x?y=1');
  assert.equal(rewriteLobbyUrl('/lobby'), '/');
  assert.equal(rewriteLobbyUrl('/lobby/'), '/');
  assert.equal(rewriteLobbyUrl('/lobby?x'), '/?x');
  assert.equal(rewriteLobbyUrl('/api/health'), '/api/health');
  assert.equal(rewriteLobbyUrl('/lobbyist/api'), '/lobbyist/api');
});

test('admin: world-add, worlds, world-status, world-rename, world-remove', () => {
  const store = memoryStore();
  const { run, out, err } = cli(store);
  assert.equal(run('worlds'), 0);
  assert.match(out.at(-1) ?? '', /No worlds yet/);

  assert.equal(run('world-add', 'w1', 'First', 'World'), 0, err.join('\n'));
  assert.equal(run('world-add', 'w2', 'Second', '--path=/play/w2/', '--status=full'), 0, err.join('\n'));
  const w1 = store.getWorld('w1');
  assert.deepEqual({ ...w1, createdAt: 0 }, { id: 'w1', name: 'First World', status: 'open', path: '/w/w1/', createdAt: 0, sortOrder: 10 });
  assert.ok((w1?.createdAt ?? 0) > 1_000);
  assert.deepEqual(store.listWorlds().map((w) => [w.id, w.status, w.path, w.sortOrder]), [
    ['w1', 'open', '/w/w1/', 10],
    ['w2', 'full', '/play/w2/', 20],
  ]);

  out.length = 0;
  assert.equal(run('worlds'), 0);
  assert.equal(out.length, 2);
  assert.match(out[1] ?? '', /w2 +full +\/play\/w2\/ +Second/);

  assert.equal(run('world-status', 'w1', 'closed'), 0);
  assert.equal(store.getWorld('w1')?.status, 'closed');
  assert.equal(run('world-rename', 'w1', 'Renamed', 'World'), 0);
  assert.equal(store.getWorld('w1')?.name, 'Renamed World');
  assert.equal(run('world-remove', 'w2'), 0);
  assert.equal(store.getWorld('w2'), null);

  const actions = store.auditRows().map((r) => [r.action, r.actorId, r.actorIp]);
  assert.deepEqual(actions.reverse(), [
    ['world_add', null, 'cli'],
    ['world_add', null, 'cli'],
    ['world_status', null, 'cli'],
    ['world_rename', null, 'cli'],
    ['world_remove', null, 'cli'],
  ]);
});

test('admin: world-add refuses bad input and changes nothing', () => {
  const store = memoryStore();
  const { run, err } = cli(store);
  const cases: string[][] = [
    ['world-add'],
    ['world-add', 'w1'], // no name
    ['world-add', 'w 1', 'Name'],
    ['world-add', 'w1', 'x'.repeat(41)],
    ['world-add', 'w1', 'Name', '--path=//evil.com'],
    ['world-add', 'w1', 'Name', '--path=javascript:x'],
    ['world-add', 'w1', 'Name', '--path=/a/../b/'],
    ['world-add', 'w1', 'Name', '--status=weird'],
    ['world-add', 'w1', 'Name', '--color=red'],
    ['world-add', 'w1', 'Name', '--path'],
  ];
  for (const argv of cases) assert.equal(run(...argv), 1, argv.join(' '));
  assert.ok(err.length >= cases.length);
  assert.equal(store.countWorlds(), 0);
  assert.equal(run('world-add', 'w1', 'Name'), 0);
  assert.equal(run('world-add', 'w1', 'Again'), 1); // duplicate
  assert.equal(run('world-status', 'w1', 'weird'), 1);
  assert.equal(run('world-status', 'nope', 'open'), 1);
  assert.equal(run('world-rename', 'nope', 'X'), 1);
  assert.equal(run('world-remove', 'nope'), 1);
  assert.equal(run('frobnicate'), 1);
  assert.equal(run(), 1);
});

test('admin: ban, unban, grant, revoke, shared-ips', async () => {
  const { app } = await makeApp();
  await register(app, 'Alice', '192.0.2.1');
  await register(app, 'Bob', '192.0.2.1');
  const store = app.ctx.store;
  const { run, out, err } = cli(store);

  assert.equal(run('shared-ips'), 0);
  assert.match(out.at(-1) ?? '', /192\.0\.2\.1: Alice, Bob/);

  assert.equal(store.sessionCount(1), 1);
  assert.equal(run('ban', 'alice'), 0, err.join('\n'));
  assert.equal(store.getAccount(1)?.banReason, 'multi-account');
  assert.ok(store.getAccount(1)?.bannedAt);
  assert.equal(store.sessionCount(1), 0, 'ban ends the sessions');
  assert.equal(run('shared-ips'), 0);
  assert.match(out.at(-1) ?? '', /Alice \(banned\), Bob/);
  assert.equal(run('unban', 'ALICE'), 0);
  assert.equal(store.getAccount(1)?.bannedAt, null);

  assert.equal(run('grant', 'bob', 'moderator'), 0);
  assert.equal(store.getAccount(2)?.staffRole, 'moderator');
  assert.equal(run('grant', 'bob', 'god'), 1);
  assert.equal(run('grant', 'bob'), 1);
  assert.equal(store.getAccount(2)?.staffRole, 'moderator');
  assert.equal(run('revoke', 'bob'), 0);
  assert.equal(store.getAccount(2)?.staffRole, null);
  assert.equal(run('ban', 'nobody'), 1);
  assert.equal(run('ban'), 1);

  const actions = store.auditRows(20).map((r) => r.action).reverse();
  for (const a of ['ban', 'unban', 'role_grant', 'role_revoke']) assert.ok(actions.includes(a), a);
  assert.ok(store.auditRows(20).filter((r) => ['ban', 'unban', 'role_grant', 'role_revoke'].includes(r.action)).every((r) => r.actorId === null && r.actorIp === 'cli'));
});

test('admin: keygen prints a usable LOBBY_SIGNING_KEY and its public key', () => {
  const { run, out, err } = cli(memoryStore());
  // Needs neither a database nor an environment key.
  const noDb = out.length;
  const code = runAdmin(['keygen'], {
    openStore: () => {
      throw new Error('keygen must not open the database');
    },
    env: {},
    now: Date.now,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  assert.equal(code, 0);
  assert.equal(out.length - noDb, 2);
  const [priv, pub] = out.slice(noDb) as [string, string];
  assert.match(priv, /^LOBBY_SIGNING_KEY=[A-Za-z0-9+/]+=*$/);
  assert.match(pub, /^LOBBY_PUBLIC_KEY=[A-Za-z0-9+/]+=*$/);
  assert.ok(err.some((l) => /never|secret/i.test(l)), 'warns about the private key on stderr');
  assert.ok(!err.some((l) => l.includes(priv.split('=')[1] as string)), 'stderr does not repeat the key');

  // The printed pair works: the env loads it, the public key matches, a pass signed with it verifies with the public key.
  const signingValue = priv.slice('LOBBY_SIGNING_KEY='.length);
  const publicValue = pub.slice('LOBBY_PUBLIC_KEY='.length);
  const env = loadEnv({ LOBBY_SIGNING_KEY: signingValue });
  assert.equal(publicKeyBase64(env.signingKey), publicValue);
  const { pass } = signPass({ aid: 1, name: 'Alice', wid: 'w1', chn: 'old-orm', role: null }, env.signingKey, 5_000);
  assert.equal(verifyPass(pass, [publicValue], 5_001).name, 'Alice');

  // public-key derives the same value from the environment.
  const second = cli(memoryStore(), { LOBBY_SIGNING_KEY: signingValue });
  assert.equal(second.run('public-key'), 0);
  assert.equal(second.out[0], pub);
  assert.equal(cli(memoryStore(), {}).run('public-key'), 1);
  assert.equal(cli(memoryStore(), { LOBBY_SIGNING_KEY: 'garbage' }).run('public-key'), 1);
  void run;
});

test('keys: parse base64 DER and PEM, reject everything else without echoing it', () => {
  const k = generateKeyPair();
  assert.equal(keyIdOf(parseSigningKey(k.privateKeyBase64)), keyIdOf(k.privateKey));
  const pem = k.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  assert.equal(keyIdOf(parseSigningKey(pem)), keyIdOf(k.privateKey));
  assert.equal(keyIdOf(parseSigningKey(pem.trim().replace(/\n/g, '\\n'))), keyIdOf(k.privateKey), 'PEM with literal \\n from an env file');
  assert.equal(keyIdOf(parseSigningKey(`  ${k.privateKeyBase64}\n`)), keyIdOf(k.privateKey));
  assert.match(keyIdOf(k.privateKey), /^[0-9a-f]{16}$/);

  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  const x25519 = generateKeyPairSync('x25519').privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  const publicOnly = k.publicKeyBase64;
  const secretish = 'hunter2-this-is-not-a-key-but-looks-secret-0123456789';
  for (const raw of [rsa, x25519, publicOnly, secretish, 'AAAA', '!!!', '-----BEGIN PRIVATE KEY-----\nbm9wZQ==\n-----END PRIVATE KEY-----']) {
    assert.throws(
      () => parseSigningKey(raw),
      (err: Error) => /LOBBY_SIGNING_KEY is not a valid Ed25519 private key/.test(err.message) && !err.message.includes(raw.slice(0, 20)),
    );
  }
});

test('startup: a missing or garbage LOBBY_SIGNING_KEY is refused, and the error never contains the key', () => {
  for (const missing of [undefined, '', '   ']) {
    assert.throws(() => loadEnv({ LOBBY_SIGNING_KEY: missing }), /LOBBY_SIGNING_KEY is required/);
  }
  const secretish = 'garbage-SECRET-value-that-must-not-leak-1234567890';
  assert.throws(
    () => loadEnv({ LOBBY_SIGNING_KEY: secretish }),
    (err: Error) => /not a valid Ed25519 private key/.test(err.message) && !err.message.includes('SECRET') && !err.message.includes(secretish),
  );
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  assert.throws(
    () => loadEnv({ LOBBY_SIGNING_KEY: rsa }),
    (err: Error) => /not a valid Ed25519 private key/.test(err.message) && !err.message.includes(rsa.slice(10, 40)),
  );
});

test('env: defaults and validation', () => {
  const key = generateKeyPair().privateKeyBase64;
  const d = loadEnv({ LOBBY_SIGNING_KEY: key });
  assert.equal(d.port, 3001);
  assert.equal(d.host, '0.0.0.0');
  assert.equal(d.databasePath, './data/lobby.sqlite');
  assert.equal(d.nodeEnv, 'development');
  assert.equal(d.isProduction, false);
  assert.equal(d.maxAccountsPerIp, 0);
  assert.equal(d.trustProxy, false);
  assert.deepEqual(d.allowedOrigins, []);
  const p = loadEnv({ LOBBY_SIGNING_KEY: key, NODE_ENV: 'production', PORT: '8080', HOST: '127.0.0.1', DATABASE_PATH: '/data/x.sqlite', TRUST_PROXY: '1', ALLOWED_ORIGINS: 'https://Play.Example.com, http://localhost:5173', MAX_ACCOUNTS_PER_IP: '5' });
  assert.equal(p.isProduction, true);
  assert.equal(p.maxAccountsPerIp, 5);
  assert.equal(p.trustProxy, true);
  assert.equal(p.port, 8080);
  assert.deepEqual(p.allowedOrigins, ['https://play.example.com', 'http://localhost:5173']);
  assert.equal(loadEnv({ LOBBY_SIGNING_KEY: key, NODE_ENV: 'production' }).maxAccountsPerIp, 3);
  assert.equal(loadEnv({ LOBBY_SIGNING_KEY: key, NODE_ENV: 'production', MAX_ACCOUNTS_PER_IP: '0' }).maxAccountsPerIp, 0);
  for (const bad of [{ PORT: 'abc' }, { PORT: '70000' }, { MAX_ACCOUNTS_PER_IP: '-1' }, { MAX_ACCOUNTS_PER_IP: '1.5' }, { TRUST_PROXY: 'maybe' }, { ALLOWED_ORIGINS: 'ftp://x.test' }, { ALLOWED_ORIGINS: 'https://x.test/path' }]) {
    assert.throws(() => loadEnv({ LOBBY_SIGNING_KEY: key, ...bad }), /Invalid/);
  }
  assert.equal(databasePathOf({}), './data/lobby.sqlite');
  assert.equal(databasePathOf({ DATABASE_PATH: ' /tmp/l.sqlite ' }), '/tmp/l.sqlite');
  assert.equal(parseTrustProxy('2'), 2);
  assert.equal(parseTrustProxy('10.0.0.0/8, 127.0.0.1'), '10.0.0.0/8,127.0.0.1');
  assert.deepEqual(parseAllowedOrigins(''), []);
});

test('a lobby app starts with an empty world list and passwords are shared in format with the worlds', async () => {
  const { app } = await makeApp();
  assert.equal(app.ctx.store.countWorlds(), 0);
  await register(app, 'Alice');
  const hash = app.ctx.store.getAccount(1)?.passwordHash ?? '';
  const [scheme, salt, key] = hash.split('$') as [string, string, string];
  assert.equal(scheme, 'scrypt');
  assert.equal(Buffer.from(salt, 'hex').length, 16);
  assert.equal(Buffer.from(key, 'hex').length, 64);
  assert.ok(PASSWORD.length >= 8);
});
