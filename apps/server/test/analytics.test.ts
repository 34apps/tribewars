// Server-side analytics (docs/ANALYTICS.md) in the world server: what is sent, once-only steps, world_enter once a day, page_open, the opt-out.
// The real ingest is never contacted: the sender gets a fake fetch (and tests that must send nothing also trap the global fetch).

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign as edSign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { ENTRY_PASS_DOMAIN, ENTRY_PASS_TTL_MS, STATS_PAGES } from '@clanfire/engine';
import { AnalyticsSender, iidOf, validateEvent } from '@clanfire/analytics';
import { Client, Clock, HOUR, errorOf, makeApp, ok, trainRaiders, weakestAbandoned } from './helpers.ts';
import { found, join as joinTribe, newPlayer, setHall } from './tribe-helpers.ts';
import { giveTroops, sendOk, unprotect } from './warfare-helpers.ts';

const SALT = 'test-salt-for-analytics';
const closers: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of closers.splice(0)) await a.close();
});

interface Sent {
  iid: string;
  e: string;
  p?: Record<string, string | number>;
  lvl?: number;
}

/** A sender with a fake fetch; `sent()` flushes and returns every event so far, oldest first. */
function recorder(clock: Clock) {
  const batches: Array<Record<string, unknown>> = [];
  const f = (async (_url: string, init: { body: string }) => {
    batches.push(JSON.parse(init.body) as Record<string, unknown>);
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  const sender = new AnalyticsSender({ salt: SALT, app: '0.1.0-dev', fetch: f, now: clock.now, timer: false });
  const sent = async (): Promise<Sent[]> => {
    await sender.flush();
    return batches.flatMap((b) => (b.events as Array<{ e: string; p?: Record<string, string | number>; lvl?: number }>).map((e) => ({ iid: b.iid as string, ...e })));
  };
  const steps = async (): Promise<string[]> => (await sent()).filter((e) => e.e === 'ftue_step').map((e) => String(e.p?.step));
  return { sender, sent, steps, batches };
}

test('off by default: nothing is queued or fetched, and the stats route still answers 204', async () => {
  const real = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (() => {
    fetched++;
    throw new Error('no network in tests');
  }) as unknown as typeof fetch;
  try {
    const { app, clock } = await makeApp();
    closers.push(app);
    assert.equal(app.ctx.analytics?.enabled, false);
    assert.equal(app.ctx.store.onFtue, null);
    const p = await newPlayer(app, 'alice');
    const vid = (await p.c.village()).id;
    ok(await p.c.post(`/api/villages/${vid}/build`, { building: 'lumber' }));
    clock.advance(HOUR);
    await p.c.state();
    ok(await p.c.post('/api/stats/page', { page: 'map' }), 204);
    assert.equal(fetched, 0);
    assert.equal(app.ctx.store.analytics.wasSent(p.id, 'ftue:first_build'), false, 'nothing is remembered while off');
  } finally {
    globalThis.fetch = real;
  }
});

test('ftue steps: each is sent once, from the real action, with the Hall level as lvl and a hashed id', async () => {
  const clock = new Clock();
  const rec = recorder(clock);
  const made = await makeApp({ analytics: rec.sender, now: clock.now });
  closers.push(made.app);
  const { app } = made;
  const alice = await newPlayer(app, 'alice');
  assert.deepEqual(await rec.steps(), ['world_joined']);

  // world_joined carries the Hall level of the best village and an id that is NOT the player id.
  const first = (await rec.sent()).find((e) => e.e === 'ftue_step')!;
  assert.equal(first.iid, iidOf(SALT, `world:w1:${alice.id}`), 'no lobby account: namespaced fallback');
  assert.match(first.iid, /^[0-9a-f]{32}$/);
  assert.equal(first.lvl, (await alice.c.village()).state.buildings.hall);
  for (const e of await rec.sent()) assert.equal(validateEvent(e.e, e.p, e.lvl), null, 'every event passes the wire rules');

  // first_build, then first_build_done once the level is finished (seen at the next state read).
  const vid = (await alice.c.village()).id;
  ok(await alice.c.post(`/api/villages/${vid}/build`, { building: 'lumber' }));
  assert.ok((await rec.steps()).includes('first_build'));
  assert.ok(!(await rec.steps()).includes('first_build_done'));
  clock.advance(2 * HOUR);
  await alice.c.state();
  assert.ok((await rec.steps()).includes('first_build_done'));

  // A second build and a second finished build send nothing new.
  const before = (await rec.steps()).length;
  ok(await alice.c.post(`/api/villages/${vid}/build`, { building: 'farm' }));
  clock.advance(2 * HOUR);
  await alice.c.state();
  assert.equal((await rec.steps()).length, before);

  // first_train (the helper builds the Barracks and trains raiders), first_raid, first_report.
  await trainRaiders(alice.c, clock, 5);
  assert.ok((await rec.steps()).includes('first_train'));
  unprotect(app, alice);
  giveTroops(app, alice, { raider: 10 });
  const target = await weakestAbandoned(alice.c, 12);
  await sendOk(alice, { x: target.x, y: target.y }, 'attack', { raider: 5 });
  assert.ok((await rec.steps()).includes('first_raid'));
  assert.ok(!(await rec.steps()).includes('first_report'));
  clock.advance(3 * HOUR);
  const list = (await alice.c.get('/api/reports')).json<{ reports: Array<{ id: number }> }>().reports;
  assert.ok(list.length > 0);
  assert.ok(!(await rec.steps()).includes('first_report'), 'a report in the list is not an opened one');
  ok(await alice.c.get(`/api/reports/${list[0]!.id}`));
  assert.ok((await rec.steps()).includes('first_report'));
  ok(await alice.c.get(`/api/reports/${list[0]!.id}`));

  // tribe_joined (founding counts) and second_village.
  setHall(app, alice.id, 3);
  await found(alice, 'Alpha Pack', 'ALPHA', 'open');
  assert.ok((await rec.steps()).includes('tribe_joined'));
  assert.ok(!(await rec.steps()).includes('second_village'));
  app.ctx.store.insertVillage(alice.id, 'Second', 11, 11, 0, app.ctx.store.getVillage((await alice.c.village()).id)!.state);
  assert.ok((await rec.steps()).includes('second_village'));
  app.ctx.store.insertVillage(alice.id, 'Third', 11, 10, 0, app.ctx.store.getVillage((await alice.c.village()).id)!.state);

  // Every step exactly once, in the list of the brief.
  const all = await rec.steps();
  assert.deepEqual([...all].sort(), ['first_build', 'first_build_done', 'first_raid', 'first_report', 'first_train', 'second_village', 'tribe_joined', 'world_joined']);
});

test('a second player joining a tribe sends tribe_joined for them; ftue steps are not repeated after a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanflame-analytics-'));
  try {
    const dbPath = join(dir, 'world.sqlite');
    const clock = new Clock();
    const rec1 = recorder(clock);
    const a1 = await makeApp({ analytics: rec1.sender, now: clock.now, dbPath });
    const alice = await newPlayer(a1.app, 'alice');
    const vid = (await alice.c.village()).id;
    ok(await alice.c.post(`/api/villages/${vid}/build`, { building: 'lumber' }));
    assert.deepEqual((await rec1.steps()).sort(), ['first_build', 'world_joined']);
    await a1.app.close();

    // "Restart": a new app on the same file with a fresh sender; the same actions send no ftue step again.
    const rec2 = recorder(clock);
    const a2 = await makeApp({ analytics: rec2.sender, now: clock.now, dbPath });
    closers.push(a2.app);
    const again = new Client(a2.app);
    ok(await again.post('/api/auth/login', { username: 'alice', password: 'correct horse battery' }));
    ok(await again.post(`/api/villages/${vid}/build`, { building: 'farm' }));
    assert.deepEqual(await rec2.steps(), []);

    // A new player on the restarted server is a first for THEM.
    const bob = await newPlayer(a2.app, 'bob');
    assert.deepEqual(await rec2.steps(), ['world_joined']);
    setHall(a2.app, alice.id, 3);
    const t = await found({ ...alice, c: again }, 'Alpha Pack', 'ALPHA', 'open');
    await joinTribe(bob, t.tribe!.id);
    // (alice's first build, started before the restart, finished meanwhile: that first is still due, once.)
    assert.deepEqual((await rec2.steps()).sort(), ['first_build_done', 'tribe_joined', 'tribe_joined', 'world_joined']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('world_enter: at most once per player per UTC day, again the next day, with the world id', async () => {
  const clock = new Clock();
  const rec = recorder(clock);
  const made = await makeApp({ analytics: rec.sender, now: clock.now, worldId: 'w-2' });
  closers.push(made.app);
  const alice = await newPlayer(made.app, 'alice');
  const enters = async () => (await rec.sent()).filter((e) => e.e === 'world_enter');
  assert.equal((await enters()).length, 1, 'registering is the first entry of the day');
  assert.deepEqual((await enters())[0]!.p, { world: 'w_2' });
  for (let i = 0; i < 5; i++) await alice.c.state();
  await alice.c.post('/api/auth/logout');
  ok(await alice.c.post('/api/auth/login', { username: 'alice', password: 'correct horse battery' }));
  assert.equal((await enters()).length, 1, 'same UTC day: still one');
  clock.advance(24 * HOUR);
  await alice.c.state();
  await alice.c.state();
  assert.equal((await enters()).length, 2, 'next UTC day: one more');
  clock.advance(HOUR);
  await alice.c.state();
  assert.equal((await enters()).length, 2);
  const bob = await newPlayer(made.app, 'bob');
  assert.ok(bob.id !== alice.id);
  assert.equal((await enters()).length, 3, 'every player has their own day');
});

test('POST /api/stats/page: signed in only, fixed page list, always 204, one page_open per page (guarded against spam)', async () => {
  const clock = new Clock();
  const rec = recorder(clock);
  const made = await makeApp({ analytics: rec.sender, now: clock.now });
  closers.push(made.app);
  const anon = new Client(made.app, '10.9.9.9');
  errorOf(await anon.post('/api/stats/page', { page: 'map' }), 401, 'unauthorized');
  const alice = await newPlayer(made.app, 'alice');
  errorOf(await alice.c.post('/api/stats/page', { page: 'secret' }), 400, 'invalid_input');
  errorOf(await alice.c.post('/api/stats/page', { page: 'staff' }), 400, 'invalid_input');
  errorOf(await alice.c.post('/api/stats/page', { page: 'map', extra: 1 }), 400, 'invalid_input');
  errorOf(await alice.c.post('/api/stats/page', {}), 400, 'invalid_input');
  const pages = async () => (await rec.sent()).filter((e) => e.e === 'page_open').map((e) => e.p?.page);
  assert.deepEqual(await pages(), []);
  ok(await alice.c.post('/api/stats/page', { page: 'map' }), 204);
  ok(await alice.c.post('/api/stats/page', { page: 'map' }), 204);
  ok(await alice.c.post('/api/stats/page', { page: 'army' }), 204);
  assert.deepEqual(await pages(), ['map', 'army']);
  clock.advance(HOUR);
  ok(await alice.c.post('/api/stats/page', { page: 'map' }), 204);
  assert.deepEqual(await pages(), ['map', 'army', 'map']);
  // Every id of the fixed list passes the wire rules.
  for (const page of STATS_PAGES) assert.equal(validateEvent('page_open', { page }), null, page);
});

test('the page list is the web client\'s real pages', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../web/src/game.ts', import.meta.url), 'utf8');
  const tabs = /export const TABS: readonly NavTab\[\] = \[([^\]]+)\]/.exec(src)![1]!.match(/'([a-z]+)'/g)!.map((s) => s.slice(1, -1));
  const menu = /export const MENU_PAGES: readonly MenuPage\[\] = \[([^\]]+)\]/.exec(src)![1]!.match(/'([a-z]+)'/g)!.map((s) => s.slice(1, -1));
  const real = new Set([...tabs, 'raids', 'auto', ...menu.filter((m) => m !== 'staff')]);
  assert.deepEqual([...real].sort(), [...STATS_PAGES].sort());
});

// ---- the opt-out, through the entry pass --------------------------------------------------------------------------------------------

class Signer {
  private readonly pair = generateKeyPairSync('ed25519');
  readonly spki = this.pair.publicKey.export({ type: 'spki', format: 'der' });
  readonly kid = createHash('sha256').update(this.spki).digest('hex').slice(0, 16);
  pass(clock: Clock, over: Record<string, unknown> = {}): string {
    const claims = { v: 1, kid: this.kid, aid: 7, name: 'Hearth_Bob', wid: 'w1', chn: 'ysra', role: null, iat: clock.t, exp: clock.t + ENTRY_PASS_TTL_MS, nonce: randomBytes(16).toString('base64url'), ...over };
    const part = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    return `${part}.${edSign(null, Buffer.from(`${ENTRY_PASS_DOMAIN}\n${part}`, 'utf8'), this.pair.privateKey).toString('base64url')}`;
  }
}

test('opt-out from the entry pass: nothing is sent for that player, and the lobby account id (hashed) is the person id', async () => {
  const s = new Signer();
  const clock = new Clock();
  const rec = recorder(clock);
  const made = await makeApp({ analytics: rec.sender, now: clock.now, lobbyPublicKey: s.spki.toString('base64') });
  closers.push(made.app);
  let n = 0;
  const enter = async (over: Record<string, unknown>) => {
    const c = new Client(made.app, `10.8.0.${++n}`);
    const res = await c.post('/api/auth/enter', { pass: s.pass(clock, over) });
    const set = res.cookies.find((x) => x.name === 'tw_session' && x.value !== '');
    if (set) c.cookie = `tw_session=${set.value}`;
    return { res, c };
  };

  // Account 7 shares (the default: no claim): its events use HMAC(salt, "7").
  const a = await enter({ aid: 7, name: 'Hearth_Bob' });
  ok(a.res, 201);
  const sent = await rec.sent();
  assert.deepEqual(sent.map((e) => e.e).sort(), ['ftue_step', 'world_enter']);
  assert.ok(sent.every((e) => e.iid === iidOf(SALT, '7')));

  // Account 8 opted out (ana 0): nothing at all, not even world_joined or world_enter, and later actions send nothing either.
  const before = (await rec.sent()).length;
  const b = await enter({ aid: 8, name: 'Hearth_Eve', ana: 0 });
  ok(b.res, 201);
  const vid = (await b.c.village()).id;
  ok(await b.c.post(`/api/villages/${vid}/build`, { building: 'lumber' }));
  ok(await b.c.post('/api/stats/page', { page: 'map' }), 204);
  clock.advance(2 * HOUR);
  await b.c.state();
  assert.equal((await rec.sent()).length, before, 'an opted-out player sends nothing');
  const eve = made.app.ctx.store.getPlayerByAccountId(8)!;
  assert.equal(made.app.ctx.store.analytics.isOptedOut(eve.id), true);
  assert.equal(made.app.ctx.store.analytics.wasSent(eve.id, 'ftue:first_build'), false, 'and nothing is remembered as sent');

  // Switching back on in the lobby reaches the world with the next pass: events start (a first_build is a first for them).
  clock.advance(HOUR);
  const b2 = await enter({ aid: 8, name: 'Hearth_Eve', ana: 1 });
  ok(b2.res, 200);
  assert.equal(made.app.ctx.store.analytics.isOptedOut(eve.id), false);
  ok(await b2.c.post('/api/stats/page', { page: 'map' }), 204);
  const later = (await rec.sent()).slice(before);
  assert.ok(later.length > 0 && later.every((e) => e.iid === iidOf(SALT, '8')));

  // ...and off again, from a pass; a pass without the claim leaves the stored switch alone.
  await enter({ aid: 8, name: 'Hearth_Eve', ana: 0 });
  const mid = (await rec.sent()).length;
  const b3 = await enter({ aid: 8, name: 'Hearth_Eve' });
  assert.equal(made.app.ctx.store.analytics.isOptedOut(eve.id), true);
  ok(await b3.c.post('/api/stats/page', { page: 'army' }), 204);
  assert.equal((await rec.sent()).length, mid);
});

test('a pass with a bad `ana` claim is refused like any malformed pass', async () => {
  const s = new Signer();
  const clock = new Clock();
  const { app } = await makeApp({ lobbyPublicKey: s.spki.toString('base64') });
  closers.push(app);
  for (const ana of [2, -1, '1', true, null]) {
    const res = await new Client(app, '10.8.1.1').post('/api/auth/enter', { pass: s.pass(clock, { ana }) });
    errorOf(res, 401, 'unauthorized');
  }
});
