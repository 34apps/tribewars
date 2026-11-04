import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/env.ts';
import { HOST, makeApp } from './helpers.ts';

test('SANDBOX_USERS default: dev name outside production, empty in production, explicit wins', () => {
  assert.deepEqual(loadEnv({}).sandboxUsers, ['metinaltinbas']);
  assert.deepEqual(loadEnv({ NODE_ENV: 'production' }).sandboxUsers, []);
  assert.deepEqual(loadEnv({ NODE_ENV: 'production', SANDBOX_USERS: 'Alice, bob' }).sandboxUsers, ['alice', 'bob']);
  assert.deepEqual(loadEnv({ SANDBOX_USERS: '' }).sandboxUsers, []);
});

test('ALLOWED_ORIGINS parsing', () => {
  assert.deepEqual(loadEnv({}).allowedOrigins, []);
  assert.deepEqual(loadEnv({ ALLOWED_ORIGINS: 'https://Play.Clanfire.com/, http://localhost:5173 ,https://play.clanfire.com' }).allowedOrigins, [
    'https://play.clanfire.com',
    'http://localhost:5173',
  ]);
  for (const bad of ['play.clanfire.com', 'ftp://x.com', 'https://x.com/path', 'https://x.com/?q=1', 'not a url']) {
    assert.throws(() => loadEnv({ ALLOWED_ORIGINS: bad }), /ALLOWED_ORIGINS/, bad);
  }
});

test('TRUST_PROXY parsing', () => {
  assert.equal(loadEnv({}).trustProxy, false);
  for (const v of ['0', 'false', 'no']) assert.equal(loadEnv({ TRUST_PROXY: v }).trustProxy, false);
  for (const v of ['1', 'true', 'YES']) assert.equal(loadEnv({ TRUST_PROXY: v }).trustProxy, true);
  assert.equal(loadEnv({ TRUST_PROXY: '2' }).trustProxy, 2);
  assert.equal(loadEnv({ TRUST_PROXY: '10.0.0.0/8, 192.168.1.5' }).trustProxy, '10.0.0.0/8,192.168.1.5');
  assert.equal(loadEnv({ TRUST_PROXY: '::1' }).trustProxy, '::1');
  for (const bad of ['maybe', '-3', '1.5x', 'abc.def', '10.0.0.1,']) assert.throws(() => loadEnv({ TRUST_PROXY: bad }), /TRUST_PROXY/, bad);
});

test('Origin check: allow-listed foreign Origin passes, unlisted gets 403, same-host and missing Origin still pass', async () => {
  const { app } = await makeApp({ allowedOrigins: ['https://play.example.com'] });
  const post = (origin: string | undefined) =>
    app.inject({ method: 'POST', url: '/api/nope', headers: { host: 'internal.alb', ...(origin ? { origin } : {}) }, payload: {} });
  assert.equal((await post('https://play.example.com')).statusCode, 404); // passed the Origin check
  assert.equal((await post('https://PLAY.example.com')).statusCode, 404);
  assert.equal((await post('https://evil.example.org')).statusCode, 403);
  assert.equal((await post('http://play.example.com')).statusCode, 403); // scheme differs
  assert.equal((await post(undefined)).statusCode, 404);
  const same = await app.inject({ method: 'POST', url: '/api/nope', headers: { host: HOST, origin: `https://${HOST}` }, payload: {} });
  assert.equal(same.statusCode, 404);
});

test('health answers 200 {ok:true} and 503 when the database fails', async () => {
  const { app } = await makeApp();
  const r = await app.inject({ method: 'GET', url: '/api/health', headers: { host: HOST } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { ok: true });
  app.ctx.store.getMeta = () => {
    throw new Error('db down');
  };
  const bad = await app.inject({ method: 'GET', url: '/api/health', headers: { host: HOST } });
  assert.equal(bad.statusCode, 503);
  assert.deepEqual(bad.json(), { ok: false });
});

// ---- deploy files (compose, Caddyfile, env examples, scripts): text checks, nothing here can run Docker ----
const repoFile = (rel: string): string => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8');
/** The body of a top-level compose block with the given 2-space-indented key (a service or an x- anchor). */
const composeBlock = (compose: string, key: string): string => {
  // x- anchors sit at column 0 (their keys are indented 2); services sit at column 2 (their keys are indented 4).
  const indent = key.startsWith('x-') ? 0 : 2;
  const m = new RegExp(`^ {${indent}}${key}:[^\\n]*\\n([\\s\\S]*?)(?=^ {0,${indent}}\\S|(?![\\s\\S]))`, 'm').exec(compose);
  assert.ok(m, `compose block ${key} not found`);
  return m[1] ?? '';
};
const codeLines = (script: string): string => script.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

test('compose: the lobby service is hardened, has no published port, its own env file and a /data volume', () => {
  const compose = repoFile('deploy/docker-compose.yml');
  const lobby = composeBlock(compose, 'lobby');
  assert.doesNotMatch(lobby, /^\s*ports:/m, 'the lobby must not publish a port');
  assert.match(lobby, /image: clanfire-lobby:latest/);
  assert.match(lobby, /dockerfile: Dockerfile\.lobby/);
  assert.match(lobby, /^\s*env_file: lobby\.env\b/m);
  assert.doesNotMatch(lobby, /game\.env/);
  assert.match(lobby, /-\s*\$\{DATA_LOBBY:-\/srv\/clanfire\/lobby\}:\/data\s*$/m);
  assert.match(lobby, /mem_limit: /);
  // read_only, cap_drop, no-new-privileges come from the shared anchor the lobby merges in
  assert.match(lobby, /<<: \*hardened/);
  const hardened = composeBlock(compose, 'x-hardened');
  assert.match(hardened, /^\s*read_only: true/m);
  assert.match(hardened, /cap_drop:\s*\n\s*- ALL/);
  assert.match(hardened, /no-new-privileges:true/);
  assert.match(hardened, /init: true/);
  assert.match(hardened, /stop_grace_period: 30s/);
  // worlds keep the same hardening and their own image
  const game = composeBlock(compose, 'x-game');
  assert.match(game, /<<: \*hardened/);
  assert.match(game, /image: clanfire-game:latest/);
  assert.match(composeBlock(compose, 'game-w1'), /env_file: game\.env/);
  assert.doesNotMatch(composeBlock(compose, 'game-w1'), /lobby\.env/, 'a world never gets the lobby env file (signing key)');
  assert.match(composeBlock(compose, 'caddy'), /depends_on:[\s\S]*- lobby/);
});

test('Caddyfile: /lobby/* goes to lobby:3001, before the catch-all, behind the origin check', () => {
  const caddy = repoFile('deploy/Caddyfile');
  const lobbyAt = caddy.search(/^\thandle \/lobby\/\* \{\s*\n\s*reverse_proxy lobby:3001\s*\n\s*\}/m);
  assert.ok(lobbyAt >= 0, 'handle /lobby/* { reverse_proxy lobby:3001 } missing');
  const catchAllAt = caddy.search(/^\thandle \{/m);
  assert.ok(catchAllAt > lobbyAt, 'the catch-all handle must come after the lobby handle');
  assert.ok(caddy.indexOf('handle /w/w1/*') > lobbyAt, 'the lobby handle comes before the world handles');
  const directAt = caddy.search(/^\thandle @direct \{/m);
  assert.ok(directAt >= 0 && directAt < lobbyAt, 'the X-Origin-Verify refusal must come first');
});

test('env examples: LOBBY_PUBLIC_KEY in game.env.example, an EMPTY LOBBY_SIGNING_KEY in lobby.env.example, real files git-ignored', () => {
  assert.match(repoFile('deploy/game.env.example'), /LOBBY_PUBLIC_KEY/);
  assert.doesNotMatch(repoFile('deploy/game.env.example'), /^\s*LOBBY_SIGNING_KEY/m, 'a world must never be given the signing key');
  const lobbyEnv = repoFile('deploy/lobby.env.example');
  assert.match(lobbyEnv, /^LOBBY_SIGNING_KEY=$/m, 'no real key in the example: the value must be empty');
  assert.doesNotMatch(lobbyEnv, /MC4CAQAw|[A-Za-z0-9+/]{40,}/, 'no key-like string in the example');
  const ignore = repoFile('.gitignore').split('\n');
  for (const f of ['deploy/lobby.env', 'deploy/game.env', 'deploy/.env']) assert.ok(ignore.includes(f), `${f} must be git-ignored`);
});

test('deploy scripts know the lobby target (own image, database file, S3 prefix) and `all`', () => {
  const lib = repoFile('deploy/lib.sh');
  assert.match(lib, /SERVICE="lobby"/);
  assert.match(lib, /IMAGE="clanfire-lobby"/);
  assert.match(lib, /DB_FILE="lobby\.sqlite"/);
  assert.match(lib, /BACKUP_GLOB="clanfire-lobby-"/);
  assert.match(lib, /list_targets\(\)/);
  for (const f of ['update.sh', 'backup.sh', 'restore.sh', 'rollback.sh']) {
    const script = repoFile(`deploy/${f}`);
    assert.match(script, /lobby/, `${f} mentions the lobby`);
    assert.match(script, /^set -euo pipefail$/m, `${f} keeps strict mode`);
  }
  for (const f of ['update.sh', 'backup.sh']) assert.match(repoFile(`deploy/${f}`), /= all \]/, `${f} handles all`);
  // the lobby has its own image tag and database file: no hard-coded game names left in the scripts
  for (const f of ['update.sh', 'rollback.sh']) assert.doesNotMatch(codeLines(repoFile(`deploy/${f}`)), /clanfire-game/, f);
  const restore = codeLines(repoFile('deploy/restore.sh'));
  assert.doesNotMatch(restore, /clanfire\.sqlite/);
  assert.match(restore, /DB_FILE/);
});

test('trustProxy hop count reaches Fastify (client IP is read that many hops from the right)', async () => {
  const { app } = await makeApp({ trustProxy: 2 });
  app.get('/api/ip', async (req) => ({ ip: req.ip }));
  const r = await app.inject({ method: 'GET', url: '/api/ip', headers: { host: HOST, 'x-forwarded-for': '9.9.9.9, 1.2.3.4, 5.6.7.8' } });
  assert.equal(r.json<{ ip: string }>().ip, '1.2.3.4');
});
