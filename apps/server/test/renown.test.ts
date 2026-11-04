// Renown that is not fought for (docs/GAME_DESIGN.md section 18.2): building Renown, the ranking, the profile, old data.

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { BUILDINGS, buildingRenown, type GameStateResponse, type PlayerProfileDto, type RenownRankingResponse, type VillageState } from '@clanfire/engine';
import { buildApp } from '../src/app.ts';
import { SCHEMA_VERSION } from '../src/db.ts';
import { Client, Clock, HOST, HOUR, PASSWORD, TEST_WORLD, makeApp, ok } from './helpers.ts';
import { newLeader, newPlayer } from './tribe-helpers.ts';
import { near, renownOf, setRenown, setVillage } from './renown-helpers.ts';

const sumLevels = (b: 'hall' | 'lumber', from: number, to: number): number => {
  let n = 0;
  for (let l = from + 1; l <= to; l++) n += buildingRenown(b, l);
  return n;
};

// ---- building Renown --------------------------------------------------------------------------------

test('finished building levels pay their Renown once: after a save, a look at the state, a reload and a lower-then-higher level', async () => {
  const { app } = await makeApp();
  const p = await newPlayer(app, 'alice');
  const store = app.ctx.store;
  const start = BUILDINGS.hall.startLevel;
  const expected = sumLevels('hall', start, start + 3);
  assert.ok(expected > 0);
  assert.equal(renownOf(app, p), 0, 'start levels pay nothing');

  setVillage(app, p.id, { levels: { hall: start + 3 }, paid: false }); // saveVillage pays
  near(renownOf(app, p), expected);
  setVillage(app, p.id, {});
  near(renownOf(app, p), expected);

  const st = (await p.c.get('/api/state')).json<GameStateResponse>();
  assert.equal(st.renown.total, Math.floor(expected));
  assert.equal(st.renown.balance, Math.floor(expected));
  near(renownOf(app, p), expected);

  // Stored with the village: a reload (as after a restart) still knows what was paid.
  const v = store.villagesOfPlayer(p.id)[0] as { id: number; state: VillageState };
  assert.equal(v.state.renownPaid?.hall, start + 3);

  // A level that falls (a Wall after a takeover) and is built again pays nothing a second time.
  setVillage(app, p.id, { levels: { hall: start }, paid: false });
  setVillage(app, p.id, { levels: { hall: start + 3 }, paid: false });
  near(renownOf(app, p), expected);
  // New levels above the paid ones pay as usual.
  setVillage(app, p.id, { levels: { hall: start + 4 }, paid: false });
  near(renownOf(app, p), expected + buildingRenown('hall', start + 4));
  await app.close();
});

test('a real build pays when the level finishes and the owner looks, and only once', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  const v0 = await p.c.village();
  const level = v0.state.buildings.lumber;
  ok(await p.c.post(`/api/villages/${v0.id}/build`, { building: 'lumber' }));
  assert.equal(renownOf(app, p), 0, 'a queued level is not finished');
  clock.advance(5 * HOUR);
  const st = await p.c.state();
  assert.equal(st.villages[0]?.state.buildings.lumber, level + 1);
  near(renownOf(app, p), buildingRenown('lumber', level + 1));
  assert.equal(st.renown.total, Math.floor(buildingRenown('lumber', level + 1)));
  await p.c.state();
  near(renownOf(app, p), buildingRenown('lumber', level + 1));
  await app.close();
});

test('a village saved before Renown existed (no renownPaid, no Banner Hall key) loads; its built levels pay once on first look', async () => {
  const { app } = await makeApp();
  const p = await newPlayer(app, 'alice');
  const db = app.ctx.store.db;
  const row = db.prepare('SELECT id, state_json FROM villages WHERE owner_id = ?').get(p.id) as { id: number; state_json: string };
  const old = JSON.parse(row.state_json) as { renownPaid?: unknown; feast?: unknown; buildings: Record<string, number> };
  delete old.renownPaid;
  delete old.feast;
  delete old.buildings.bannerhall;
  const start = BUILDINGS.hall.startLevel;
  old.buildings.hall = start + 2;
  db.prepare('UPDATE villages SET state_json = ? WHERE id = ?').run(JSON.stringify(old), row.id);

  const loaded = app.ctx.store.getVillage(row.id);
  assert.equal(loaded?.state.buildings.bannerhall, 0);
  assert.equal(loaded?.state.renownPaid?.hall, start, 'start levels count as paid, what is above them is not');
  assert.equal(loaded?.state.renownPaid?.bannerhall, 0);
  assert.equal(renownOf(app, p), 0, 'loading pays nothing');

  const expected = sumLevels('hall', start, start + 2);
  assert.equal((await p.c.state()).renown.total, Math.floor(expected));
  near(renownOf(app, p), expected);
  await p.c.state();
  near(renownOf(app, p), expected);
  assert.equal(app.ctx.store.getVillage(row.id)?.state.renownPaid?.hall, start + 2);
  await app.close();
});

test('sandbox accounts earn no Renown from buildings; their levels are marked paid', async () => {
  const { app } = await makeApp({ sandboxUsers: ['sandy'] });
  const sandy = await newPlayer(app, 'sandy');
  const start = BUILDINGS.hall.startLevel;
  setVillage(app, sandy.id, { levels: { hall: start + 4 }, paid: false });
  assert.equal(renownOf(app, sandy), 0);
  assert.equal(app.ctx.store.villagesOfPlayer(sandy.id)[0]?.state.renownPaid?.hall, start + 4);
  ok(await sandy.c.post('/api/sandbox/max'));
  assert.equal(renownOf(app, sandy), 0);
  assert.equal((await sandy.c.state()).renown.total, 0);
  // The same levels on a normal account do pay.
  const norm = await newPlayer(app, 'norma');
  setVillage(app, norm.id, { levels: { hall: start + 4 }, paid: false });
  assert.ok(renownOf(app, norm) > 0);
  await app.close();
});

test('villages without an owner pay nobody, also a released one that still has an ordinary state', async () => {
  const { app } = await makeApp();
  const p = await newPlayer(app, 'alice');
  const store = app.ctx.store;
  const npcId = store.abandonedVillageIds()[0] as number;
  const npc = store.getVillage(npcId);
  assert.ok(npc);
  npc.state.buildings.hall += 3;
  store.saveVillage(npc.id, npc.state, npc.points);
  assert.equal(renownOf(app, p), 0);

  const mine = store.villagesOfPlayer(p.id)[0] as { id: number; state: VillageState; points: number };
  store.releaseVillage(mine.id, 'Abandoned');
  mine.state.buildings.hall += 3;
  store.saveVillage(mine.id, mine.state, mine.points);
  assert.equal(renownOf(app, p), 0);
  await app.close();
});

// ---- ranking and profile ---------------------------------------------------------------------------

async function rankedWorld() {
  const { app, clock } = await makeApp();
  const alice = await newPlayer(app, 'alice');
  const bob = await newPlayer(app, 'bob');
  const carl = await newLeader(app, 'carl', 'Carl Clan', 'CARL', 'open');
  const dave = await newPlayer(app, 'dave');
  setRenown(app, alice.id, 50.7);
  setRenown(app, bob.id, 50.2);
  setRenown(app, carl.id, 120.4);
  // Renown of someone with no village is not listed.
  const ghost = app.ctx.store.insertPlayer('ghost', 'x', 0, 0);
  setRenown(app, ghost, 9999);
  return { app, clock, alice, bob, carl, dave };
}

test('Renown ranking: sign-in needed, best first, equal whole Renown shares the rank, villageless players are left out', async () => {
  const { app, alice, bob } = await rankedWorld();
  const anon = await app.inject({ method: 'GET', url: '/api/rankings/renown', headers: { host: HOST } });
  assert.equal(anon.statusCode, 401);

  const res = await alice.c.get('/api/rankings/renown');
  ok(res);
  const r = res.json<RenownRankingResponse>();
  assert.deepEqual(r.players.map((p) => p.username), ['carl', 'alice', 'bob', 'dave']);
  assert.deepEqual(r.players.map((p) => p.rank), [1, 2, 2, 4]);
  assert.deepEqual(r.players.map((p) => p.renown), [120, 50, 50, 0]);
  assert.equal(r.total, 4);
  assert.equal(r.me?.username, 'alice');
  assert.equal(r.me?.rank, 2);
  assert.deepEqual(r.players[0]?.tribe && r.players[0].tribe.tag, 'CARL');
  assert.equal(r.players[1]?.tribe, null);
  assert.ok(Number.isInteger(r.me?.villageX) && Number.isInteger(r.me?.villageY));
  assert.equal(r.me?.villages, 1);
  assert.equal(JSON.stringify(r).includes('password'), false);
  assert.equal((await bob.c.get('/api/rankings/renown')).json<RenownRankingResponse>().me?.rank, 2);
  await app.close();
});

test('Renown ranking: top 100 only, the caller outside it still gets their own row', async () => {
  const { app, bob } = await rankedWorld();
  const store = app.ctx.store;
  const state = store.villagesOfPlayer(bob.id)[0]?.state as VillageState;
  for (let i = 0; i < 105; i += 1) {
    const pid = store.insertPlayer(`filler${i}`, 'x', 0, 0);
    store.insertVillage(pid, `v${i}`, 500 + i, 500, 1000, state);
    setRenown(app, pid, 1000 + i);
  }
  const r = (await bob.c.get('/api/rankings/renown')).json<RenownRankingResponse>();
  assert.equal(r.players.length, 100);
  assert.equal(r.total, 109);
  assert.equal(r.players[0]?.renown, 1104);
  assert.ok(r.me && !r.players.some((p) => p.playerId === bob.id));
  assert.equal(r.me.rank, 107);
  await app.close();
});

test('the profile carries Renown and the Renown rank, public like points', async () => {
  const { app, alice, bob, carl } = await rankedWorld();
  const mine = (await alice.c.get(`/api/players/${bob.id}`)).json<PlayerProfileDto>();
  assert.equal(mine.renown, 50);
  assert.equal(mine.renownRank, 2);
  const top = (await alice.c.get(`/api/players/${carl.id}`)).json<PlayerProfileDto>();
  assert.deepEqual([top.renown, top.renownRank], [120, 1]);
  assert.equal((await alice.c.get('/api/players/999999')).statusCode, 404);
  await app.close();
});

test('Renown ranking and profile follow Feast and building Renown', async () => {
  const { app, alice, bob } = await rankedWorld();
  const before = (await bob.c.get('/api/rankings/renown')).json<RenownRankingResponse>().me?.renown as number;
  setVillage(app, bob.id, { levels: { hall: BUILDINGS.hall.startLevel + 6 }, paid: false });
  const after = (await bob.c.get('/api/rankings/renown')).json<RenownRankingResponse>().me?.renown as number;
  assert.ok(after > before);
  assert.equal((await alice.c.get(`/api/players/${bob.id}`)).json<PlayerProfileDto>().renown, after);
  await app.close();
});

// ---- schema v3 -> v4 -------------------------------------------------------------------------------

test('a version 3 database is upgraded in place: backup first, Renown columns and table added, old villages still load', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-renown-'));
  try {
    const dbPath = join(dir, 'game.sqlite');
    const clock = new Clock();
    const open = () => buildApp({ dbPath, now: clock.now, settings: TEST_WORLD, webDistDir: '/nonexistent' });
    let app = await open();
    const alice = await newPlayer(app, 'alice');
    const vid = (await alice.c.village()).id;
    await app.close();

    // Make the file look like version 3: no Renown columns or table, a village state without the new keys.
    const raw = new DatabaseSync(dbPath);
    raw.exec('ALTER TABLE players DROP COLUMN renown_total');
    raw.exec('ALTER TABLE players DROP COLUMN renown_spent');
    raw.exec('DROP TABLE renown_pairs');
    const row = raw.prepare('SELECT state_json FROM villages WHERE id = ?').get(vid) as { state_json: string };
    const old = JSON.parse(row.state_json) as { renownPaid?: unknown; buildings: Record<string, number> };
    delete old.renownPaid;
    delete old.buildings.bannerhall;
    raw.prepare('UPDATE villages SET state_json = ? WHERE id = ?').run(JSON.stringify(old), vid);
    raw.exec('PRAGMA user_version = 3');
    raw.close();

    app = await open();
    const backups = readdirSync(join(dir, 'backups')).filter((f) => f.startsWith(`pre-migrate-v3-v${SCHEMA_VERSION}-`));
    assert.equal(backups.length, 1, 'the old file is copied before it is changed');
    const db = app.ctx.store.db;
    const cols = db.prepare('SELECT renown_total AS t, renown_spent AS s FROM players').get() as { t: number; s: number };
    assert.deepEqual([cols.t, cols.s], [0, 0]);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM renown_pairs').get() as { n: number }).n, 0);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, SCHEMA_VERSION);
    assert.equal(SCHEMA_VERSION, 5);

    const c = new Client(app);
    ok(await c.post('/api/auth/login', { username: 'alice', password: PASSWORD }));
    const st = await c.state();
    assert.equal(st.renown.total, 0, 'start levels pay nothing');
    assert.equal(st.villages[0]?.state.buildings.bannerhall, 0);
    assert.deepEqual(st.villages[0]?.feastAllowance, { max: 0, used: 0, left: 0, windowEnd: null });
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
