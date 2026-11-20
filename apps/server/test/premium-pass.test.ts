// Premium bought with Flames in the lobby reaches the world through the entry pass claim `prm` (players.premium_until).
// Active = all three paid extras (premium tools, wide overview, raid lists) until the server clock passes it.

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign as edSign, type KeyObject } from 'node:crypto';
import { afterEach, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENTRY_PASS_DOMAIN, ENTRY_PASS_TTL_MS, PREMIUM_BUILD_QUEUE, type AutoOverviewResponse, type MeResponse, type RaidListsResponse } from '@clanfire/engine';
import { openDatabase } from '../src/db.ts';
import { effectivePremium } from '../src/entitlement.ts';
import { Client, HOUR, makeApp } from './helpers.ts';

const DAY = 24 * HOUR;

const closers: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of closers.splice(0)) await a.close();
});

class Signer {
  readonly privateKey: KeyObject;
  readonly spkiB64: string;
  readonly kid: string;
  constructor() {
    const pair = generateKeyPairSync('ed25519');
    this.privateKey = pair.privateKey;
    const der = pair.publicKey.export({ type: 'spki', format: 'der' });
    this.spkiB64 = der.toString('base64');
    this.kid = createHash('sha256').update(der).digest('hex').slice(0, 16);
  }
  pass(c: Record<string, unknown>): string {
    const part = Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
    return `${part}.${edSign(null, Buffer.from(`${ENTRY_PASS_DOMAIN}\n${part}`, 'utf8'), this.privateKey).toString('base64url')}`;
  }
}

async function setup() {
  const s = new Signer();
  const made = await makeApp({ lobbyPublicKey: s.spkiB64, worldConfig: { npc: { selfBuild: false }, features: { premium: true, raidLists: true } } });
  closers.push(made.app);
  let n = 0;
  /** Enter with a fresh pass (claims `over`, undefined removes a field); returns the response and a client holding the session. */
  const enter = async (over: Record<string, unknown> = {}, client?: Client) => {
    const i = n++;
    const c = client ?? new Client(made.app, `10.9.${(i >> 8) & 255}.${i & 255}`);
    const t = made.clock.t;
    const claims: Record<string, unknown> = { v: 1, kid: s.kid, aid: 1, name: 'alice', wid: 'w1', chn: 'ysra', role: null, iat: t, exp: t + ENTRY_PASS_TTL_MS, nonce: randomBytes(16).toString('base64url'), ...over };
    for (const k of Object.keys(claims)) if (claims[k] === undefined) delete claims[k];
    const res = await c.post('/api/auth/enter', { pass: s.pass(claims) });
    const set = res.cookies.find((x) => x.name === 'tw_session' && x.value !== '');
    if (set) c.cookie = `tw_session=${set.value}`;
    return { res, c };
  };
  const me = async (c: Client) => (await c.get('/api/auth/me')).json<MeResponse>().player!;
  const row = () => made.app.ctx.store.getPlayerByAccountId(1)!;
  return { ...made, enter, me, row };
}

test('effectivePremium: Flames Premium adds all three bits while active, operator bits stay', () => {
  assert.equal(effectivePremium({ premium: 0, premiumUntil: 0 }, 100), 0);
  assert.equal(effectivePremium({ premium: 0, premiumUntil: 100 }, 100), 0, 'ends exactly at the moment');
  assert.equal(effectivePremium({ premium: 0, premiumUntil: 101 }, 100), 7);
  assert.equal(effectivePremium({ premium: 4, premiumUntil: 0 }, 100), 4);
});

test('a pass with prm in the future gives premium tools, wide overview and raid lists; it ends at the next request after prm', async () => {
  const { enter, me, row, clock, app } = await setup();
  const until = clock.t + 2 * HOUR;
  const { res, c } = await enter({ prm: until });
  assert.equal(res.statusCode, 201);
  assert.equal(row().premiumUntil, until);
  const p = await me(c);
  assert.equal(p.premiumTools, true);
  assert.equal(p.wideOverview, true);
  assert.equal(p.premiumUntil, until);
  assert.equal(p.buildQueueLimit, PREMIUM_BUILD_QUEUE);
  assert.equal((await c.get('/api/map/overview')).statusCode, 200);
  assert.equal((await c.get('/api/auto')).json<AutoOverviewResponse>().entitled, true);
  const lists = (await c.get('/api/raid-lists')).json<RaidListsResponse>();
  assert.deepEqual([lists.enabled, lists.entitled], [true, true]);
  const audit = app.ctx.store.db.prepare("SELECT detail FROM audit_log WHERE action = 'premium_sync'").all() as { detail: string }[];
  assert.deepEqual(audit.map((a) => a.detail), [`0 -> ${until}`]);

  clock.advance(2 * HOUR + 1000);
  const after = await me(c);
  assert.equal(after.premiumTools, undefined);
  assert.equal(after.wideOverview, undefined);
  assert.notEqual(after.buildQueueLimit, PREMIUM_BUILD_QUEUE);
  assert.equal((await c.get('/api/map/overview')).statusCode, 403);
  assert.equal((await c.get('/api/auto')).json<AutoOverviewResponse>().entitled, false);
  assert.equal((await c.get('/api/raid-lists')).json<RaidListsResponse>().entitled, false);
  assert.equal((await c.post('/api/raid-lists', { name: 'x' })).statusCode, 403);
});

test('auto mode stops by itself when the Flames Premium runs out', async () => {
  const { enter, row, clock, app } = await setup();
  const { c } = await enter({ prm: clock.t + 2 * HOUR });
  const v = app.ctx.store.villagesOfPlayer(row().id)[0]!;
  const on = await c.post(`/api/villages/${v.id}/auto`, { on: true });
  assert.equal(on.statusCode, 200);
  assert.equal((await c.get('/api/auto')).json<AutoOverviewResponse>().villages[0]!.on, true);
  clock.advance(2 * HOUR + 1000);
  assert.equal((await c.get('/api/auto')).json<AutoOverviewResponse>().villages[0]!.on, false);
});

test('prm 0 on re-entry clears it; a pass without prm leaves it alone', async () => {
  const { enter, me, row, clock } = await setup();
  const until = clock.t + DAY;
  const { c } = await enter({ prm: until });
  clock.advance(1000);
  await enter({}, c);
  assert.equal(row().premiumUntil, until, 'no claim: unchanged');
  assert.equal((await me(c)).premiumTools, true);
  clock.advance(1000);
  await enter({ prm: 0 }, c);
  assert.equal(row().premiumUntil, 0);
  const p = await me(c);
  assert.equal(p.premiumTools, undefined);
  assert.equal(p.premiumUntil, undefined);
});

test('a malformed prm refuses the pass', async () => {
  const { enter, clock } = await setup();
  for (const prm of [-1, 1.5, '5', null, 2 ** 60, true]) {
    const { res } = await enter({ prm });
    assert.equal(res.statusCode, 401, `prm ${String(prm)}`);
    assert.equal(res.json<{ message: string }>().message, 'This entry pass is not valid.');
  }
  assert.equal((await enter({ prm: clock.t + DAY })).res.statusCode, 201);
});

test('a world without the switches gives nothing even with Premium from Flames', async () => {
  const s = new Signer();
  const made = await makeApp({ lobbyPublicKey: s.spkiB64, worldConfig: { npc: { selfBuild: false }, features: { premium: false, raidLists: false } } });
  closers.push(made.app);
  const t = made.clock.t;
  const c = new Client(made.app, '10.8.0.1');
  const res = await c.post('/api/auth/enter', { pass: s.pass({ v: 1, kid: s.kid, aid: 1, name: 'alice', wid: 'w1', chn: 'ysra', role: null, iat: t, exp: t + ENTRY_PASS_TTL_MS, nonce: randomBytes(16).toString('base64url'), prm: t + DAY }) });
  c.cookie = `tw_session=${res.cookies.find((x) => x.name === 'tw_session' && x.value !== '')!.value}`;
  const p = (await c.get('/api/auth/me')).json<MeResponse>().player!;
  assert.equal(p.premiumTools, undefined);
  const lists = (await c.get('/api/raid-lists')).json<RaidListsResponse>();
  assert.deepEqual([lists.enabled, lists.lists.length], [false, 0]);
});

test('migration adds players.premium_until to an old database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'premium-mig-'));
  try {
    const file = join(dir, 'w.sqlite');
    const first = openDatabase(file);
    first.exec('ALTER TABLE players DROP COLUMN premium_until');
    first.exec('PRAGMA user_version = 36');
    first.close();
    const db = openDatabase(file);
    const cols = (db.prepare('PRAGMA table_info(players)').all() as { name: string }[]).map((c) => c.name);
    assert.ok(cols.includes('premium_until'));
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
