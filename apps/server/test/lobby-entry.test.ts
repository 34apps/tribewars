// Entry passes from the lobby (docs/MULTI_WORLD.md): a world with LOBBY_PUBLIC_KEY accepts only signed, single-use,
// short-lived passes for itself, links players by lobby account id (never by name) and has no register/login of its own.
// The signer below follows the contract at the end of packages/engine/src/api.ts; it does not import the lobby app.

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign as edSign, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import {
  ENTRY_PASS_CLOCK_SKEW_MS,
  ENTRY_PASS_DOMAIN,
  ENTRY_PASS_MAX_LIFETIME_MS,
  ENTRY_PASS_TTL_MS,
  type MeResponse,
  type WorldInfoResponse,
} from '@clanfire/engine';
import { LOBBY_PASSWORD_HASH, verifyPassword } from '../src/auth.ts';
import { openDatabase } from '../src/db.ts';
import { loadEnv } from '../src/env.ts';
import { parsePublicKeys } from '../src/entry-pass.ts';
import { Client, Clock, HOST, PASSWORD, errorOf, makeApp, ok } from './helpers.ts';

const closers: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of closers.splice(0)) await a.close();
});

// ---- a tiny signer -------------------------------------------------------------------------------------------------

class Signer {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  readonly spkiB64: string;
  readonly kid: string;
  constructor() {
    const pair = generateKeyPairSync('ed25519');
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
    const der = pair.publicKey.export({ type: 'spki', format: 'der' });
    this.spkiB64 = der.toString('base64');
    this.kid = createHash('sha256').update(der).digest('hex').slice(0, 16);
  }
  signPart(payloadPart: string, domain: string = ENTRY_PASS_DOMAIN): string {
    return edSign(null, Buffer.from(`${domain}\n${payloadPart}`, 'utf8'), this.privateKey).toString('base64url');
  }
  /** A pass over exactly this payload text. */
  passOfText(text: string): string {
    const part = Buffer.from(text, 'utf8').toString('base64url');
    return `${part}.${this.signPart(part)}`;
  }
  pass(claims: Record<string, unknown>): string {
    return this.passOfText(JSON.stringify(claims));
  }
}

const freshNonce = (): string => randomBytes(16).toString('base64url');

/** Valid claims for world w1 at the test clock; `over` replaces fields (undefined removes one). */
function claims(s: Signer, clock: Clock, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { v: 1, kid: s.kid, aid: 1, name: 'alice', wid: 'w1', chn: 'ysra', role: null, iat: clock.t, exp: clock.t + ENTRY_PASS_TTL_MS, nonce: freshNonce(), ...over };
}

async function lobbyApp(signers: Signer[], over: Parameters<typeof makeApp>[0] = {}) {
  const made = await makeApp({ lobbyPublicKey: signers.map((s) => s.spkiB64).join(','), ...over });
  closers.push(made.app);
  return made;
}

let ipCounter = 0;
/** POST a pass from a fresh IP (the per-IP limit for this route is 10 a minute). */
async function enter(app: FastifyInstance, pass: unknown, url = '/api/auth/enter', client?: Client): Promise<{ res: LightMyRequestResponse; c: Client }> {
  const n = ipCounter++;
  const c = client ?? new Client(app, `10.7.${(n >> 8) & 255}.${n & 255}`);
  const res = await c.post(url, { pass });
  // Under /w/<id>/ the response also clears the legacy Path=/ cookie (first in the list); the client helper only reads the first.
  const set = res.cookies.find((x) => x.name === 'tw_session' && x.value !== '');
  if (set) c.cookie = `tw_session=${set.value}`;
  return { res, c };
}

const count = (app: FastifyInstance, table: string): number => Number((app.ctx.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
const rowOf = (app: FastifyInstance, accountId: number) => app.ctx.store.getPlayerByAccountId(accountId);
const NOT_VALID = 'This entry pass is not valid.';

// ---- happy path ----------------------------------------------------------------------------------------------------

test('first entry creates the player from the pass, the second signs the same player in', async () => {
  const s = new Signer();
  const { app, clock } = await lobbyApp([s]);
  const first = await enter(app, s.pass(claims(s, clock, { aid: 7, name: 'Hearth_Bob', chn: 'hild' })), '/w/w1/api/auth/enter');
  ok(first.res, 201);
  const cookie = first.res.cookies.find((c) => c.name === 'tw_session' && c.value !== '');
  assert.ok(cookie, 'session cookie set');
  assert.equal(cookie.path, '/w/w1/');
  assert.equal(cookie.httpOnly, true);
  const me = first.res.json<MeResponse>().player;
  assert.ok(me);
  assert.equal(me.username, 'Hearth_Bob');
  assert.equal(me.chieftain, 'hild');
  assert.ok(me.protectedUntil > clock.t);
  const st = await first.c.state();
  assert.equal(st.villages.length, 1);
  assert.equal(st.villages[0]?.name, "Hearth_Bob's village");
  const row = rowOf(app, 7);
  assert.ok(row);
  assert.equal(row.id, me.id);
  assert.equal(row.accountId, 7);
  assert.equal(row.passwordHash, LOBBY_PASSWORD_HASH);

  // The session works for the whole API.
  const again = await first.c.get('/w/w1/api/auth/me');
  assert.equal(again.json<MeResponse>().player?.id, me.id);

  // Second entry: a new pass (new nonce), same account: 200, same player, still one village and one player.
  clock.advance(5000);
  const second = await enter(app, s.pass(claims(s, clock, { aid: 7, name: 'Hearth_Bob', chn: 'hild' })), '/w/w1/api/auth/enter');
  ok(second.res, 200);
  assert.equal(second.res.json<MeResponse>().player?.id, me.id);
  assert.equal(count(app, 'players'), 1);
  assert.equal((await second.c.state()).villages.length, 1);
  assert.ok(second.res.cookies.some((c) => c.name === 'tw_session' && c.value !== ''));

  const actions = (app.ctx.store.db.prepare("SELECT action FROM audit_log WHERE action IN ('register', 'enter') ORDER BY id").all() as { action: string }[]).map((r) => r.action);
  assert.deepEqual(actions, ['register', 'enter']);
});

test('the old /api path keeps a Path=/ cookie; another world id works under its own prefix', async () => {
  const s = new Signer();
  const { app, clock } = await lobbyApp([s]);
  const { res } = await enter(app, s.pass(claims(s, clock)));
  ok(res, 201);
  assert.equal(res.cookies.find((c) => c.name === 'tw_session' && c.value !== '')?.path, '/');

  const w2 = await lobbyApp([s], { worldId: 'w2' });
  const own = await enter(w2.app, s.pass(claims(s, w2.clock, { wid: 'w2', aid: 3, name: 'Wanda' })), '/w/w2/api/auth/enter');
  ok(own.res, 201);
  assert.equal(own.res.cookies.find((c) => c.name === 'tw_session' && c.value !== '')?.path, '/w/w2/');
});

test('a player is found by account id, not by the name in the pass', async () => {
  const s = new Signer();
  const { app, clock } = await lobbyApp([s]);
  ok((await enter(app, s.pass(claims(s, clock, { aid: 9, name: 'dave' })))).res, 201);
  const renamed = await enter(app, s.pass(claims(s, clock, { aid: 9, name: 'someone_else' })));
  ok(renamed.res, 200);
  assert.equal(renamed.res.json<MeResponse>().player?.username, 'dave');
  assert.equal(count(app, 'players'), 1);
});

test('chieftain falls back to the default when the pass names an unknown one', async () => {
  const s = new Signer();
  const { app, clock } = await lobbyApp([s]);
  const { res } = await enter(app, s.pass(claims(s, clock, { chn: 'not-a-chieftain' })));
  ok(res, 201);
  assert.equal(res.json<MeResponse>().player?.chieftain, 'old-orm');
});

test('the staff role is copied from the pass at every entry, also when it is removed', async () => {
  const s = new Signer();
  const { app, clock } = await lobbyApp([s]);
  const first = await enter(app, s.pass(claims(s, clock, { role: 'moderator' })));
  ok(first.res, 201);
  assert.equal(first.res.json<MeResponse>().player?.staffRole, 'moderator');
  assert.equal(rowOf(app, 1)?.staffRole, 'moderator');

  const up = await enter(app, s.pass(claims(s, clock, { role: 'admin' })));
  ok(up.res, 200);
  assert.equal(up.res.json<MeResponse>().player?.staffRole, 'admin');

  const down = await enter(app, s.pass(claims(s, clock, { role: null })));
  ok(down.res, 200);
  assert.equal(down.res.json<MeResponse>().player?.staffRole, null);
  assert.equal(rowOf(app, 1)?.staffRole, null);
});

// ---- time, world and replay ----------------------------------------------------------------------------------------

test('expired and not-yet-valid passes and passes with the wrong lifetime are refused', async () => {
  const s = new Signer();
  const { app, clock } = await lobbyApp([s]);
  const t = clock.t;
  const expired = await enter(app, s.pass(claims(s, clock, { iat: t - 61_000, exp: t - 1000 })));
  errorOf(expired.res, 401, 'unauthorized');
  assert.equal(expired.res.json<{ message: string }>().message, 'This entry pass has expired.');
  errorOf((await enter(app, s.pass(claims(s, clock, { iat: t - 60_000, exp: t })))).res, 401, 'unauthorized'); // exactly now: expired

  const future = await enter(app, s.pass(claims(s, clock, { iat: t + ENTRY_PASS_CLOCK_SKEW_MS + 1000, exp: t + ENTRY_PASS_CLOCK_SKEW_MS + 61_000 })));
  errorOf(future.res, 401, 'unauthorized');
  assert.equal(future.res.json<{ message: string }>().message, NOT_VALID);

  const tooLong = await enter(app, s.pass(claims(s, clock, { iat: t, exp: t + ENTRY_PASS_MAX_LIFETIME_MS + 1 })));
  errorOf(tooLong.res, 401, 'unauthorized');
  assert.equal(tooLong.res.json<{ message: string }>().message, NOT_VALID);
  errorOf((await enter(app, s.pass(claims(s, clock, { iat: t, exp: t })))).res, 401, 'unauthorized'); // exp not after iat
  errorOf((await enter(app, s.pass(claims(s, clock, { iat: t + 1000, exp: t + 500 })))).res, 401, 'unauthorized');
  assert.equal(count(app, 'players'), 0);
  assert.equal(count(app, 'used_pass_nonces'), 0);

  // The edges that are fine: small clock skew into the future, the longest allowed lifetime.
  ok((await enter(app, s.pass(claims(s, clock, { aid: 2, name: 'skew', iat: t + 5000, exp: t + 65_000 })))).res, 201);
  ok((await enter(app, s.pass(claims(s, clock, { aid: 3, name: 'longest', iat: t, exp: t + ENTRY_PASS_MAX_LIFETIME_MS })))).res, 201);
});

test('a pass for another world is refused', async () => {
  const s = new Signer();
  const { app, clock } = await lobbyApp([s]); // this world is w1
  const { res } = await enter(app, s.pass(claims(s, clock, { wid: 'w2' })));
  errorOf(res, 401, 'unauthorized');
  assert.equal(res.json<{ message: string }>().message, NOT_VALID);
  assert.equal(count(app, 'players'), 0);
  // The same goes the other way round.
  const w2 = await lobbyApp([s], { worldId: 'w2' });
  errorOf((await enter(w2.app, s.pass(claims(s, w2.clock, { wid: 'w1' })), '/w/w2/api/auth/enter')).res, 401, 'unauthorized');
});

test('a pass works once; the nonce is remembered through its validity window and forgotten afterwards', async () => {
  const s = new Signer();
  const { app, clock } = await lobbyApp([s]);
  const pass = s.pass(claims(s, clock));
  ok((await enter(app, pass)).res, 201);
  const replay = await enter(app, pass);
  errorOf(replay.res, 401, 'unauthorized');
  assert.equal(replay.res.json<{ message: string }>().message, 'This entry pass was already used.');
  assert.equal(replay.res.cookies.length, 0);
  clock.advance(30_000); // still inside the pass's validity
  errorOf((await enter(app, pass)).res, 401, 'unauthorized');
  assert.equal(count(app, 'players'), 1);
  assert.equal(app.ctx.store.countEntryNonces(), 1);

  // A second pass, then a long wait: both rows go with the next entry.
  ok((await enter(app, s.pass(claims(s, clock)))).res, 200);
  assert.equal(app.ctx.store.countEntryNonces(), 2);
  clock.advance(ENTRY_PASS_TTL_MS + ENTRY_PASS_CLOCK_SKEW_MS); // far past the first pass's exp + margin
  ok((await enter(app, s.pass(claims(s, clock)))).res, 200);
  assert.equal(app.ctx.store.countEntryNonces(), 1);
  // The old pass is dead anyway (expired) even though its nonce is gone.
  errorOf((await enter(app, pass)).res, 401, 'unauthorized');
});

test('a used nonce survives a restart on the same database file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-lobby-'));
  try {
    const dbPath = join(dir, 'world.sqlite');
    const s = new Signer();
    const first = await lobbyApp([s], { dbPath });
    const pass = s.pass(claims(s, first.clock));
    ok((await enter(first.app, pass)).res, 201);
    await first.app.close();
    closers.splice(closers.indexOf(first.app), 1);

    const second = await lobbyApp([s], { dbPath });
    errorOf((await enter(second.app, pass)).res, 401, 'unauthorized');
    assert.equal(count(second.app, 'players'), 1);
    ok((await enter(second.app, s.pass(claims(s, second.clock)))).res, 200); // a fresh pass still signs the player in
  } finally {
    for (const a of closers.splice(0)) await a.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- signatures and keys -------------------------------------------------------------------------------------------

test('bad signatures are refused with one generic message', async () => {
  const s = new Signer();
  const other = new Signer();
  const { app, clock } = await lobbyApp([s]);
  const good = s.pass(claims(s, clock));
  const [payload, sig] = good.split('.') as [string, string];
  const flipped = `${payload}.${(sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)}`;
  // The last character carries 4 unused bits: changing only those decodes to the same bytes, but the encoding is not canonical.
  const lastFlipped = `${payload}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`;
  const forged = other.passOfText(JSON.stringify({ ...claims(s, clock), aid: 99 })); // claims the right kid, signed by the wrong key
  const noDomain = (() => {
    const part = Buffer.from(JSON.stringify(claims(s, clock)), 'utf8').toString('base64url');
    return `${part}.${edSign(null, Buffer.from(part, 'utf8'), s.privateKey).toString('base64url')}`;
  })();
  const otherDomain = (() => {
    const part = Buffer.from(JSON.stringify(claims(s, clock)), 'utf8').toString('base64url');
    return `${part}.${s.signPart(part, 'clanfire-entry-pass-v2')}`;
  })();
  const tamperedPart = (over: Record<string, unknown>): string => `${Buffer.from(JSON.stringify({ ...claims(s, clock), ...over }), 'utf8').toString('base64url')}.${sig}`;
  const cases: Record<string, string> = {
    flipped,
    lastFlipped,
    forged,
    noDomain,
    otherDomain,
    'tampered aid': tamperedPart({ aid: 2 }),
    'tampered role': tamperedPart({ role: 'admin' }),
    'tampered exp': tamperedPart({ exp: clock.t + 100_000 }),
    'signature of another pass': `${tamperedPart({}).split('.')[0]}.${other.pass(claims(other, clock)).split('.')[1]}`,
  };
  for (const [name, pass] of Object.entries(cases)) {
    const { res } = await enter(app, pass);
    errorOf(res, 401, 'unauthorized');
    assert.equal(res.json<{ message: string }>().message, NOT_VALID, name);
    assert.equal(res.cookies.length, 0, name);
  }
  assert.equal(count(app, 'players'), 0);
  assert.equal(count(app, 'used_pass_nonces'), 0);
  ok((await enter(app, good)).res, 201); // and the untouched pass is fine
});

test('an unknown key id is refused', async () => {
  const s = new Signer();
  const stranger = new Signer();
  const { app, clock } = await lobbyApp([s]);
  const unknownKid = await enter(app, s.pass(claims(s, clock, { kid: 'deadbeefdeadbeef' })));
  errorOf(unknownKid.res, 401, 'unauthorized');
  assert.equal(unknownKid.res.json<{ message: string }>().message, NOT_VALID);
  errorOf((await enter(app, stranger.pass(claims(stranger, clock)))).res, 401, 'unauthorized'); // a key this world was never given
  errorOf((await enter(app, s.pass(claims(s, clock, { kid: stranger.kid })))).res, 401, 'unauthorized'); // kid of a key we do not trust
  errorOf((await enter(app, s.pass(claims(s, clock, { kid: undefined })))).res, 401, 'unauthorized');
  assert.equal(count(app, 'players'), 0);
});

test('two configured keys (rotation) both work, a third does not', async () => {
  const a = new Signer();
  const b = new Signer();
  const c = new Signer();
  const { app, clock } = await lobbyApp([a, b]);
  ok((await enter(app, a.pass(claims(a, clock, { aid: 1, name: 'from_a' })))).res, 201);
  ok((await enter(app, b.pass(claims(b, clock, { aid: 2, name: 'from_b' })))).res, 201);
  errorOf((await enter(app, c.pass(claims(c, clock, { aid: 3, name: 'from_c' })))).res, 401, 'unauthorized');
  assert.equal(count(app, 'players'), 2);
});

// ---- malformed passes and bodies -----------------------------------------------------------------------------------

test('malformed passes are refused before they can do anything', async () => {
  const s = new Signer();
  const { app, clock } = await lobbyApp([s]);
  const good = s.pass(claims(s, clock));
  const [payload, sig] = good.split('.') as [string, string];
  const shape: Record<string, string> = {
    empty: '',
    'no dot': payload,
    'only dot': '.',
    'empty signature': `${payload}.`,
    'empty payload': `.${sig}`,
    'three parts': `${good}.${sig}`,
    'short signature': `${payload}.${sig.slice(0, 40)}`,
    'long signature': `${payload}.${sig}AAAA`,
    'padding in payload': `${payload}==.${sig}`,
    'plus and slash': `${payload.slice(0, 10)}+/${payload.slice(12)}.${sig}`,
    'leading space': ` ${good}`,
    'trailing space': `${good} `,
    'trailing newline': `${good}\n`,
    'inner space': `${payload.slice(0, 8)} ${payload.slice(8)}.${sig}`,
    'not base64': '!!!!.????',
    'payload not json': s.passOfText('not json at all'),
    'payload null': s.passOfText('null'),
    'payload array': s.passOfText('[]'),
    'payload string': s.passOfText('"x"'),
    'payload number': s.passOfText('7'),
  };
  for (const [name, pass] of Object.entries(shape)) {
    const { res } = await enter(app, pass);
    errorOf(res, 401, 'unauthorized');
    assert.equal(res.json<{ message: string }>().message, NOT_VALID, name);
  }

  // Correctly signed, but a claim has the wrong type or shape.
  const wrong: Record<string, Record<string, unknown>> = {
    'v string': { v: '1' },
    'v 2': { v: 2 },
    'v missing': { v: undefined },
    'aid string': { aid: '1' },
    'aid 0': { aid: 0 },
    'aid negative': { aid: -4 },
    'aid fraction': { aid: 1.5 },
    'aid unsafe': { aid: 2 ** 60 },
    'aid null': { aid: null },
    'name short': { name: 'ab' },
    'name long': { name: 'a'.repeat(21) },
    'name space': { name: 'bad name' },
    'name number': { name: 42 },
    'name dash': { name: 'bad-name' },
    'wid slash': { wid: 'w1/../w2' },
    'wid number': { wid: 1 },
    'chn number': { chn: 123 },
    'chn long': { chn: 'x'.repeat(65) },
    'chn missing': { chn: undefined },
    'role unknown': { role: 'owner' },
    'role case': { role: 'Admin' },
    'role missing': { role: undefined },
    'role number': { role: 1 },
    'iat string': { iat: String(clock.t) },
    'iat fraction': { iat: clock.t + 0.5 },
    'exp string': { exp: String(clock.t + ENTRY_PASS_TTL_MS) },
    'exp fraction': { exp: clock.t + ENTRY_PASS_TTL_MS + 0.5 },
    'exp missing': { exp: undefined },
    'nonce short': { nonce: 'short' },
    'nonce long': { nonce: 'a'.repeat(65) },
    'nonce chars': { nonce: '!'.repeat(20) },
    'nonce number': { nonce: 1234567890123456 },
    'kid number': { kid: 1 },
  };
  for (const [name, over] of Object.entries(wrong)) {
    const { res } = await enter(app, s.pass(claims(s, clock, over)));
    errorOf(res, 401, 'unauthorized');
    assert.equal(res.json<{ message: string }>().message, NOT_VALID, name);
  }
  assert.equal(count(app, 'players'), 0);
  assert.equal(count(app, 'used_pass_nonces'), 0);
});

test('the body is validated: a pass over 2 KB, a missing or non-string pass and extra fields are 400', async () => {
  const s = new Signer();
  const { app, clock } = await lobbyApp([s]);
  const c = (): Client => new Client(app, `10.9.0.${ipCounter++ & 255}`);
  errorOf(await c().post('/api/auth/enter', { pass: 'x'.repeat(2049) }), 400, 'invalid_input');
  errorOf(await c().post('/api/auth/enter', {}), 400, 'invalid_input');
  errorOf(await c().post('/api/auth/enter', { pass: 5 }), 400, 'invalid_input');
  errorOf(await c().post('/api/auth/enter', { pass: s.pass(claims(s, clock)), extra: 1 }), 400, 'invalid_input');
  // Exactly at the cap it reaches verification (and fails there).
  errorOf(await c().post('/api/auth/enter', { pass: 'x'.repeat(2048) }), 401, 'unauthorized');
  assert.equal(count(app, 'players'), 0);
});

test('entering is rate limited per IP', async () => {
  const s = new Signer();
  const { app } = await lobbyApp([s]);
  const c = new Client(app, '10.8.0.1');
  for (let i = 0; i < 10; i++) errorOf(await c.post('/api/auth/enter', { pass: 'garbage' }), 401, 'unauthorized');
  const limited = await c.post('/api/auth/enter', { pass: 'garbage' });
  errorOf(limited, 429, 'rate_limited');
  assert.equal(limited.headers['retry-after'], '60');
});

// ---- the world's own register and login ----------------------------------------------------------------------------

test('without LOBBY_PUBLIC_KEY the enter route is a 404 and register/login keep working', async () => {
  const { app } = await makeApp();
  closers.push(app);
  const s = new Signer();
  errorOf((await enter(app, s.pass(claims(s, new Clock())))).res, 404, 'not_found');
  errorOf((await enter(app, 'x', '/w/w1/api/auth/enter')).res, 404, 'not_found');
  const c = new Client(app);
  ok(await c.post('/api/auth/register', { username: 'plain_user', password: PASSWORD }), 201);
  const again = new Client(app);
  ok(await again.post('/api/auth/login', { username: 'plain_user', password: PASSWORD }));
  assert.equal(((await again.get('/api/world/info')).json<WorldInfoResponse>()).lobby, false);
});

test('with LOBBY_PUBLIC_KEY register and login answer 403 and create nothing; logout and me still work', async () => {
  const s = new Signer();
  const { app, clock } = await lobbyApp([s]);
  const c = new Client(app);
  for (const url of ['/api/auth/register', '/w/w1/api/auth/register']) {
    const res = await c.post(url, { username: 'newcomer', password: PASSWORD });
    errorOf(res, 403, 'forbidden');
    assert.equal(res.json<{ message: string }>().message, 'Sign in through the lobby.');
    assert.equal(res.cookies.length, 0);
  }
  // Even an invalid body gets the same answer: no password work, no validation detail.
  errorOf(await c.post('/api/auth/register', {}), 403, 'forbidden');
  errorOf(await c.post('/api/auth/login', { username: 'newcomer', password: PASSWORD }), 403, 'forbidden');
  errorOf(await c.post('/w/w1/api/auth/login', {}), 403, 'forbidden');
  assert.equal(count(app, 'players'), 0);

  // Many attempts never turn into a 429 for the closed routes (no counters involved).
  for (let i = 0; i < 15; i++) errorOf(await c.post('/api/auth/register', { username: 'newcomer', password: PASSWORD }), 403, 'forbidden');

  const entered = await enter(app, s.pass(claims(s, clock)));
  ok(entered.res, 201);
  const me = await entered.c.get('/api/auth/me');
  ok(me);
  assert.equal(me.json<MeResponse>().player?.username, 'alice');
  const out = await entered.c.post('/api/auth/logout');
  assert.equal(out.statusCode, 204);
  assert.equal((await entered.c.get('/api/auth/me')).json<MeResponse>().player, null);
  // The player cannot come back through the old login, whatever password is tried.
  errorOf(await new Client(app).post('/api/auth/login', { username: 'alice', password: PASSWORD }), 403, 'forbidden');
});

test('a lobby-created player cannot sign in with any password if the world has no lobby configured', async () => {
  assert.equal(await verifyPassword(LOBBY_PASSWORD_HASH, LOBBY_PASSWORD_HASH), false);
  assert.equal(await verifyPassword('', LOBBY_PASSWORD_HASH), false);
  assert.equal(await verifyPassword(PASSWORD, LOBBY_PASSWORD_HASH), false);
  assert.equal(await verifyPassword('scrypt$$', LOBBY_PASSWORD_HASH), false);

  const { app, clock } = await makeApp();
  closers.push(app);
  app.ctx.store.insertPlayer('Erin_Lobby', LOBBY_PASSWORD_HASH, clock.t, 0, 'old-orm', 11);
  for (const password of [PASSWORD, LOBBY_PASSWORD_HASH, '!', 'scrypt$aa$bb', 'x']) {
    errorOf(await new Client(app).post('/api/auth/login', { username: 'Erin_Lobby', password }), 401, 'unauthorized');
  }
});

// ---- never link by name; bans ---------------------------------------------------------------------------------------

test('a world player with the same name but no (or another) lobby account is never linked or signed in', async () => {
  const s = new Signer();
  const { app, clock } = await lobbyApp([s]);
  const store = app.ctx.store;
  const carol = store.insertPlayer('Carol', 'scrypt$00$00', clock.t, 0);
  const dave = store.insertPlayer('Dave', LOBBY_PASSWORD_HASH, clock.t, 0, 'old-orm', 50);

  const unlinked = await enter(app, s.pass(claims(s, clock, { aid: 5, name: 'carol' })));
  errorOf(unlinked.res, 409, 'username_taken');
  assert.match(unlinked.res.json<{ message: string }>().message, /lobby import/);
  assert.equal(unlinked.res.cookies.length, 0);
  assert.equal(store.getPlayer(carol)?.accountId, null);
  assert.equal(rowOf(app, 5), null);

  const otherAccount = await enter(app, s.pass(claims(s, clock, { aid: 6, name: 'DAVE' })));
  errorOf(otherAccount.res, 409, 'username_taken');
  assert.equal(otherAccount.res.cookies.length, 0);
  assert.equal(store.getPlayer(dave)?.accountId, 50);
  assert.equal(rowOf(app, 6), null);

  assert.equal(count(app, 'players'), 2);
  assert.equal(count(app, 'sessions'), 0);
  const audited = app.ctx.store.db.prepare("SELECT target_player AS t FROM audit_log WHERE action = 'enter_blocked_unlinked_name' ORDER BY id").all() as { t: number }[];
  assert.deepEqual(
    audited.map((r) => r.t),
    [carol, dave],
  );
  // The linked owner of the name (account 50) can still enter.
  ok((await enter(app, s.pass(claims(s, clock, { aid: 50, name: 'Dave' })))).res, 200);
});

test('a banned world player is refused and gets no session', async () => {
  const s = new Signer();
  const { app, clock } = await lobbyApp([s]);
  const first = await enter(app, s.pass(claims(s, clock, { aid: 4, name: 'Bad_Actor' })));
  ok(first.res, 201);
  const id = first.res.json<MeResponse>().player!.id;
  app.ctx.store.db.prepare('UPDATE players SET banned_at = ?, ban_reason = ? WHERE id = ?').run(clock.t, 'test', id);

  const sessionsBefore = count(app, 'sessions');
  const blocked = await enter(app, s.pass(claims(s, clock, { aid: 4, name: 'Bad_Actor', role: 'admin' })));
  errorOf(blocked.res, 403, 'forbidden');
  assert.equal(blocked.res.json<{ message: string }>().message, 'This account has been suspended.');
  assert.equal(blocked.res.cookies.length, 0);
  assert.equal(count(app, 'sessions'), sessionsBefore);
  assert.equal(rowOf(app, 4)?.staffRole, null, 'a banned player gets no role from the pass');
  const audit = app.ctx.store.db.prepare("SELECT target_player AS t FROM audit_log WHERE action = 'login_blocked_banned'").all() as { t: number }[];
  assert.deepEqual(
    audit.map((r) => r.t),
    [id],
  );
  // Their old session is dead too (existing behaviour), and the ban did not create a second player.
  assert.equal((await first.c.get('/api/auth/me')).json<MeResponse>().player, null);
  assert.equal(count(app, 'players'), 1);
});

// ---- world info, environment, schema -------------------------------------------------------------------------------

test('world info says whether the world is lobby-only', async () => {
  const s = new Signer();
  const on = await lobbyApp([s]);
  const off = await makeApp();
  closers.push(off.app);
  for (const url of ['/api/world/info', '/w/w1/api/world/info']) {
    const a = (await on.app.inject({ method: 'GET', url, headers: { host: HOST } })).json<WorldInfoResponse>();
    assert.equal(a.lobby, true);
    assert.ok(!JSON.stringify(a).includes(s.spkiB64.slice(0, 20)));
    const b = (await off.app.inject({ method: 'GET', url, headers: { host: HOST } })).json<WorldInfoResponse>();
    assert.equal(b.lobby, false);
  }
});

test('LOBBY_PUBLIC_KEY parsing: off when empty, a comma list or PEM when set, fail fast on anything else', async () => {
  const a = new Signer();
  const b = new Signer();
  assert.equal(loadEnv({}).lobbyPublicKeys, null);
  assert.equal(loadEnv({ LOBBY_PUBLIC_KEY: '' }).lobbyPublicKeys, null);
  assert.equal(loadEnv({ LOBBY_PUBLIC_KEY: '   ' }).lobbyPublicKeys, null);
  assert.equal(loadEnv({ LOBBY_PUBLIC_KEY: a.spkiB64 }).lobbyPublicKeys, a.spkiB64);
  const two = `${a.spkiB64}, ${b.spkiB64}`;
  assert.equal(loadEnv({ LOBBY_PUBLIC_KEY: two }).lobbyPublicKeys, two);
  assert.deepEqual(
    parsePublicKeys(two).map((k) => k.kid),
    [a.kid, b.kid],
  );
  assert.deepEqual(parsePublicKeys(`${a.spkiB64},${a.spkiB64},`).map((k) => k.kid), [a.kid], 'duplicates and empty entries are dropped');
  assert.deepEqual(parsePublicKeys(''), []);

  const pem = a.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  assert.equal(parsePublicKeys(pem)[0]?.kid, a.kid);
  assert.equal(parsePublicKeys(pem.trim().replace(/\n/g, '\\n'))[0]?.kid, a.kid, 'literal \\n from an env file');
  assert.deepEqual(
    parsePublicKeys(`${pem.trim()},${b.spkiB64}`).map((k) => k.kid),
    [a.kid, b.kid],
  );

  const x25519 = generateKeyPairSync('x25519');
  const privatePem = a.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const privateB64 = a.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  const bad = [
    'garbage-key-value',
    ',',
    'AAAA',
    privateB64, // a private key must never be accepted
    privatePem,
    x25519.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), // wrong key type
    `${a.spkiB64},not-a-key`,
    `-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----`,
  ];
  for (const raw of bad) {
    assert.throws(
      () => loadEnv({ LOBBY_PUBLIC_KEY: raw }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /LOBBY_PUBLIC_KEY/);
        for (const piece of [privateB64.slice(8, 28), a.spkiB64.slice(8, 28), 'garbage-key-value', 'not-a-key']) {
          if (raw.includes(piece)) assert.ok(!err.message.includes(piece), `message must not echo key material (${piece})`);
        }
        return true;
      },
      raw.slice(0, 20),
    );
  }
  await assert.rejects(makeApp({ lobbyPublicKey: 'garbage-key-value' }), /LOBBY_PUBLIC_KEY/);
  await assert.rejects(makeApp({ lobbyPublicKey: ',' }), /LOBBY_PUBLIC_KEY/);
});

test('schema: account_id is unique when set, repeatable when empty, and an old database gets column and index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-lobby-schema-'));
  try {
    const dbPath = join(dir, 'old.sqlite');
    let db = openDatabase(dbPath);
    const add = (name: string, account: number | null): void => {
      db.prepare('INSERT INTO players (username, username_lower, password_hash, created_at, account_id) VALUES (?, ?, ?, 1, ?)').run(name, name.toLowerCase(), 'x', account);
    };
    add('one', null);
    add('two', null);
    add('three', 5);
    assert.throws(() => add('four', 5), /UNIQUE constraint failed: players\.account_id/);
    const idx = db.prepare("SELECT name, \"unique\" AS u FROM pragma_index_list('players') WHERE name = 'idx_players_account'").get() as { name: string; u: number } | undefined;
    assert.equal(idx?.u, 1);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE name IN ('used_pass_nonces', 'idx_used_pass_nonces_expires') ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    assert.deepEqual(names, ['idx_used_pass_nonces_expires', 'used_pass_nonces']);

    // Make it look like a database from before the lobby, then open it again.
    db.exec('DROP INDEX idx_players_account');
    db.exec('ALTER TABLE players DROP COLUMN account_id');
    db.exec('DROP TABLE used_pass_nonces');
    db.exec('PRAGMA user_version = 1');
    db.close();
    db = openDatabase(dbPath);
    const cols = db.prepare('PRAGMA table_info(players)').all() as { name: string }[];
    assert.ok(cols.some((c) => c.name === 'account_id'));
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n, 3);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('idx_players_account', 'used_pass_nonces')").get() as { n: number }).n,
      2,
    );
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
