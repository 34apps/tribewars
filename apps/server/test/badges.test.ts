// Badges (docs/GAME_DESIGN.md 18.1): computed once at the world end into world_end_badges, shown on the end screen, and the
// account summary that comes with a lobby entry pass is stored on the player and shown on the profile.

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign as edSign } from 'node:crypto';
import { test } from 'node:test';
import { BADGE_MIN_DAYS, ENTRY_PASS_DOMAIN, ENTRY_PASS_TTL_MS, type PlayerProfileDto, type WorldEndResponse } from '@clanfire/engine';
import { endWorld } from '../src/domination-service.ts';
import { Client, HOUR, errorOf, makeApp, ok } from './helpers.ts';
import { DAY, domWorld, setPts, touchAll } from './domination-helpers.ts';
import { newPlayer } from './tribe-helpers.ts';

const MIN_MS = (BADGE_MIN_DAYS * DAY) / 10; // world speed 10 in tests: 33.6 hours

type Row = { player_id: number; badge: string; place: number | null };
const rows = (app: { ctx: { store: { db: import('node:sqlite').DatabaseSync } } }): Row[] =>
  app.ctx.store.db.prepare('SELECT player_id, badge, place FROM world_end_badges ORDER BY player_id, rowid').all() as Row[];
const of = (list: Row[], id: number): string[] => list.filter((r) => r.player_id === id).map((r) => (r.place === null ? r.badge : `${r.badge}#${r.place}`));

/** alice+amy (ALPHA, alice wins), bob (BRAVO), lou (no tribe), newbie (no tribe, joined just inside the minimum time). */
async function endedWorld() {
  const w = await domWorld();
  const { app, clock } = w;
  const newbie = await newPlayer(app, 'newbie');
  const end = w.t0 + 2 * DAY;
  clock.set(end);
  const db = app.ctx.store.db;
  setPts(w, { alice: 5000, amy: 4000, bob: 3000, lou: 2000 });
  const nv = app.ctx.store.villagesOfPlayer(newbie.id)[0];
  assert.ok(nv);
  app.ctx.store.setPoints(nv.id, 1000);
  touchAll(app, end);
  db.prepare('UPDATE players SET created_at = ? WHERE id = ?').run(end - MIN_MS + 1, newbie.id); // 1 ms too new
  db.prepare('UPDATE players SET created_at = ? WHERE id = ?').run(end - MIN_MS, w.bob.id); // exactly long enough
  db.prepare('UPDATE tribe_members SET joined_at = ? WHERE player_id = ?').run(end - MIN_MS, w.bob.id);
  db.prepare('UPDATE players SET banned_at = ? WHERE id = ?').run(end - HOUR, w.lou.id);
  app.ctx.store.sandboxUsers = new Set(['amy']);
  const winner = { tribeId: w.alice.tribeId, name: 'Alpha Pack', tag: 'ALPHA' };
  return { ...w, newbie, end, winner };
}

test('end of the world: badges go to eligible players only (banned, test, too new get none)', async () => {
  const w = await endedWorld();
  assert.equal(endWorld(w.app.ctx.store, { at: w.end, kind: 'domination', winner: w.winner, reason: 'x', actorIp: 'server' }), true);
  const list = rows(w.app);
  assert.deepEqual(of(list, w.alice.id), ['champion', 'top10#1', 'veteran']);
  assert.deepEqual(of(list, w.bob.id), ['second_tribe', 'top10#3', 'veteran'], 'exactly 14 days / speed in the world and the tribe is enough');
  assert.deepEqual(of(list, w.amy.id), [], 'test account');
  assert.deepEqual(of(list, w.lou.id), [], 'banned');
  assert.deepEqual(of(list, w.newbie.id), [], '1 ms too new');
  w.app.close();
});

test('manual end without a winner: no tribe badges, top 10 and veteran still given', async () => {
  const w = await endedWorld();
  endWorld(w.app.ctx.store, { at: w.end, kind: 'manual', winner: null, reason: 'x', actorIp: 'cli' });
  assert.deepEqual(of(rows(w.app), w.alice.id), ['top10#1', 'veteran']);
  w.app.close();
});

test('frozen: a second endWorld changes nothing, and the triggers refuse UPDATE and DELETE', async () => {
  const w = await endedWorld();
  const store = w.app.ctx.store;
  endWorld(store, { at: w.end, kind: 'domination', winner: w.winner, reason: 'x', actorIp: 'server' });
  const before = rows(w.app);
  assert.ok(before.length > 0);
  assert.equal(endWorld(store, { at: w.end + DAY, kind: 'manual', winner: null, reason: 'again', actorIp: 'cli' }), false);
  assert.deepEqual(rows(w.app), before);
  assert.throws(() => store.db.prepare("UPDATE world_end_badges SET badge = 'veteran'").run(), /final/);
  assert.throws(() => store.db.prepare('DELETE FROM world_end_badges').run(), /final/);
  assert.deepEqual(rows(w.app), before);
  w.app.close();
});

test('GET /api/world-end: myBadges is only the caller, counts and playerBadges cover the world', async () => {
  const w = await endedWorld();
  endWorld(w.app.ctx.store, { at: w.end, kind: 'domination', winner: w.winner, reason: 'x', actorIp: 'server' });
  const a = (await w.alice.c.get('/api/world-end')).json<WorldEndResponse>().ended;
  const b = (await w.bob.c.get('/api/world-end')).json<WorldEndResponse>().ended;
  assert.ok(a && b);
  assert.deepEqual(a.myBadges.map((x) => x.badge), ['champion', 'top10', 'veteran']);
  assert.deepEqual(b.myBadges.map((x) => x.badge), ['second_tribe', 'top10', 'veteran']);
  assert.deepEqual(a.badgeCounts, { champion: 1, second_tribe: 1, top10: 2, veteran: 2 });
  assert.deepEqual(Object.keys(a.playerBadges).map(Number).sort(), [w.alice.id, w.bob.id].sort());
  assert.deepEqual(a.playerBadges[w.alice.id]?.find((x) => x.badge === 'top10'), { badge: 'top10', place: 1 });
  assert.equal(a.playerBadges[w.amy.id], undefined, 'no badges, no entry');
  const lou = (await w.lou.c.get('/api/world-end')).json<WorldEndResponse>().ended;
  assert.deepEqual(lou?.myBadges ?? [], []);
  // The same data rides along in the domination status.
  const dom = (await w.alice.c.get('/api/domination')).json<{ ended: { myBadges: unknown[] } | null }>();
  assert.equal(dom.ended?.myBadges.length, 3);
  w.app.close();
});

// ---- entry pass with the badge summary ------------------------------------------------------------------------------

async function passWorld() {
  const pair = generateKeyPairSync('ed25519');
  const der = pair.publicKey.export({ type: 'spki', format: 'der' });
  const kid = createHash('sha256').update(der).digest('hex').slice(0, 16);
  const { app, clock } = await makeApp({ lobbyPublicKey: der.toString('base64') });
  let n = 0;
  const pass = (extra: Record<string, unknown>): string => {
    const claims = { v: 1, kid, aid: 1, name: 'badge_bob', wid: 'w1', chn: 'ysra', role: null, iat: clock.t, exp: clock.t + ENTRY_PASS_TTL_MS, nonce: randomBytes(16).toString('base64url'), ...extra };
    const part = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    return `${part}.${edSign(null, Buffer.from(`${ENTRY_PASS_DOMAIN}\n${part}`, 'utf8'), pair.privateKey).toString('base64url')}`;
  };
  const enter = async (p: string) => {
    const c = new Client(app, `10.9.0.${++n}`);
    const res = await c.post('/api/auth/enter', { pass: p });
    const set = res.cookies.find((x) => x.name === 'tw_session' && x.value !== '');
    if (set) c.cookie = `tw_session=${set.value}`;
    return { res, c };
  };
  return { app, clock, pass, enter };
}

const stored = (app: { ctx: { store: { db: import('node:sqlite').DatabaseSync } } }): unknown =>
  (app.ctx.store.db.prepare('SELECT badges_json FROM players WHERE account_id = 1').get() as { badges_json: string | null } | undefined)?.badges_json ?? null;
const GOOD = [
  { badge: 'champion', count: 2, bestPlace: null },
  { badge: 'top10', count: 1, bestPlace: 4 },
];

test('pass with a good bdg: stored on the player and shown on the profile; a pass without bdg keeps it; a new bdg replaces it', async () => {
  const { app, pass, enter } = await passWorld();
  const first = await enter(pass({ bdg: GOOD }));
  ok(first.res, 201);
  assert.deepEqual(JSON.parse(stored(app) as string), GOOD);
  const me = app.ctx.store.getPlayerByAccountId(1);
  assert.ok(me);
  assert.deepEqual((await first.c.get(`/api/players/${me.id}`)).json<PlayerProfileDto>().badges, GOOD);

  ok((await enter(pass({}))).res, 200);
  assert.deepEqual(JSON.parse(stored(app) as string), GOOD, 'no claim leaves it alone');

  const next = [{ badge: 'veteran', count: 3, bestPlace: null }];
  ok((await enter(pass({ bdg: next }))).res, 200);
  assert.deepEqual((await first.c.get(`/api/players/${me.id}`)).json<PlayerProfileDto>().badges, next);
  await app.close();
});

test('pass with a malformed bdg is refused and nothing is stored', async () => {
  const { app, pass, enter } = await passWorld();
  const bad: unknown[] = [
    'champion',
    [{ badge: 'king', count: 1, bestPlace: null }],
    [{ badge: 'champion', count: 0, bestPlace: null }],
    [{ badge: 'champion', count: 1, bestPlace: 1 }],
    [{ badge: 'top10', count: 1, bestPlace: null }],
    [{ badge: 'champion', count: 1, bestPlace: null }, { badge: 'champion', count: 1, bestPlace: null }],
    [{ badge: 'veteran', count: 1, bestPlace: null, extra: 1 }],
    null,
  ];
  for (const bdg of bad) {
    const { res } = await enter(pass({ bdg }));
    errorOf(res, 401, 'unauthorized');
  }
  assert.equal(app.ctx.store.getPlayerByAccountId(1), null, 'no player created');
  assert.equal(app.ctx.store.countEntryNonces(), 0, 'no nonce used up');
  // An existing player keeps the old summary when a bad pass arrives.
  ok((await enter(pass({ bdg: GOOD }))).res, 201);
  errorOf((await enter(pass({ bdg: [{ badge: 'nope' }] }))).res, 401, 'unauthorized');
  assert.deepEqual(JSON.parse(stored(app) as string), GOOD);
  await app.close();
});

test('profile: bad or empty stored badges read as []', async () => {
  const { app, pass, enter } = await passWorld();
  const first = await enter(pass({}));
  ok(first.res, 201);
  const me = app.ctx.store.getPlayerByAccountId(1);
  assert.ok(me);
  const get = async () => (await first.c.get(`/api/players/${me.id}`)).json<PlayerProfileDto>().badges;
  assert.deepEqual(await get(), []);
  for (const junk of ['not json', '{"a":1}', '[{"badge":"x"}]', '']) {
    app.ctx.store.db.prepare('UPDATE players SET badges_json = ? WHERE id = ?').run(junk, me.id);
    assert.deepEqual(await get(), [], junk);
  }
  await app.close();
});
