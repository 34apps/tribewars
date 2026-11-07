import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { HallOfFameResponse, LobbyMeResponse } from '@clanfire/engine';
import { HALL_OF_FAME_MAX_WORLDS } from '@clanfire/engine';
import { runAdmin } from '../src/admin-ops.ts';
import { openDatabase } from '../src/db.ts';
import { Store } from '../src/store.ts';
import { PUBLIC_KEY, PASSWORD, addWorld, errorOf, makeApp, ok, register, nextIp, Client } from './helpers.ts';
import { verifyPass } from '../src/pass.ts';

const END = Date.UTC(2026, 10, 1);

interface WorldSpec {
  ended?: boolean;
  badgeTable?: boolean;
  /** players: id -> account id or null */
  players?: [number, number | null][];
  badges?: [number, string, number | null][];
  kind?: string;
}

/** A minimal world database with the columns world-finish reads (same names as apps/server/src/db.ts). */
function makeWorldDb(dir: string, name: string, spec: WorldSpec = {}): string {
  const file = join(dir, name);
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE players (id INTEGER PRIMARY KEY, username TEXT, account_id INTEGER);
    CREATE TABLE world_end (id INTEGER PRIMARY KEY CHECK (id = 1), ended_at INTEGER NOT NULL, kind TEXT NOT NULL, winner_tribe_id INTEGER, winner_name TEXT, winner_tag TEXT, reason TEXT NOT NULL DEFAULT '', final_json TEXT NOT NULL);`);
  if (spec.badgeTable !== false) db.exec('CREATE TABLE world_end_badges (player_id INTEGER NOT NULL, badge TEXT NOT NULL, place INTEGER, PRIMARY KEY(player_id, badge));');
  for (const [id, acc] of spec.players ?? []) db.prepare('INSERT INTO players (id, username, account_id) VALUES (?, ?, ?)').run(id, `p${id}`, acc);
  if (spec.ended !== false) {
    const final = {
      tribes: [1, 2, 3, 4].map((r) => ({ rank: r, tribeId: r, name: `Tribe ${r}`, tag: `T${r}`, points: 1000 - r, members: 3, villages: 5 })),
      players: [1, 2, 3, 4, 5].map((r) => ({ rank: r, playerId: r, name: `P${r}`, points: 500 - r, villages: 2, tribeTag: r === 2 ? null : 'T1' })),
    };
    db.prepare('INSERT INTO world_end VALUES (1, ?, ?, 1, ?, ?, ?, ?)').run(END, spec.kind ?? 'domination', 'Tribe 1', 'T1', '', JSON.stringify(final));
  }
  for (const [p, b, place] of spec.badges ?? []) db.prepare('INSERT INTO world_end_badges VALUES (?, ?, ?)').run(p, b, place);
  db.close();
  return file;
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-badges-'));
  const store = new Store(openDatabase(':memory:'));
  store.insertWorld({ id: 'w1', name: 'Clanfire One', status: 'open', path: '/w/w1/', createdAt: 0 });
  const acc = (name: string): number => store.insertAccount({ username: name, passwordHash: 'x', chieftain: 'old-orm', createdAt: 1 });
  const out: string[] = [];
  const err: string[] = [];
  let t = 5_000_000_000_000;
  const run = (...argv: string[]): number => runAdmin(argv, { openStore: () => store, env: { BACKUP_DIR: join(dir, 'bk') }, now: () => (t += 1), out: (l) => out.push(l), err: (l) => err.push(l) });
  return { dir, store, acc, run, out, err, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('world-finish: copies badges of accounts, writes the Hall of Fame, sets finished, audits, skips players without account', () => {
  const s = setup();
  try {
    const a = s.acc('anna');
    const b = s.acc('bob');
    const file = makeWorldDb(s.dir, 'w1.sqlite', {
      players: [[1, a], [2, b], [3, null]],
      badges: [[1, 'champion', null], [1, 'top10', 1], [1, 'veteran', null], [2, 'top10', 2], [3, 'veteran', null]],
    });
    assert.equal(s.run('world-finish', 'w1', file), 0, s.err.join('|'));
    assert.match(s.out.join('\n'), /4 badge/);
    assert.match(s.out.join('\n'), /1 badge\(s\) of players without a lobby account/);
    assert.deepEqual(s.store.accountBadges(a).map((x) => [x.badge, x.place, x.worldName, x.endedAt]), [
      ['champion', null, 'Clanfire One', END],
      ['top10', 1, 'Clanfire One', END],
      ['veteran', null, 'Clanfire One', END],
    ]);
    assert.equal(s.store.accountBadges(b).length, 1);
    assert.equal(s.store.getWorld('w1')?.status, 'finished');
    const hall = s.store.listHallOfFame(10);
    assert.equal(hall.length, 1);
    assert.equal(hall[0]?.winnerTag, 'T1');
    const top = JSON.parse(hall[0]?.topJson ?? '{}') as { tribes: unknown[]; players: unknown[] };
    assert.equal(top.tribes.length, 3);
    assert.equal(top.players.length, 3);
    assert.ok(s.store.auditRows().some((r) => r.action === 'world_finish'));
  } finally {
    s.done();
  }
});

test('world-finish: a world that has not ended is refused and nothing changes', () => {
  const s = setup();
  try {
    const file = makeWorldDb(s.dir, 'w1.sqlite', { ended: false });
    assert.equal(s.run('world-finish', 'w1', file), 1);
    assert.match(s.err.join('\n'), /world has not ended/);
    assert.equal(s.store.listHallOfFame(10).length, 0);
    assert.equal(s.store.getWorld('w1')?.status, 'open');
    // unknown world, missing file
    assert.equal(s.run('world-finish', 'nope', file), 1);
    assert.equal(s.run('world-finish', 'w1', join(s.dir, 'missing.sqlite')), 1);
  } finally {
    s.done();
  }
});

test('world-finish: running twice gives no duplicates', () => {
  const s = setup();
  try {
    const a = s.acc('anna');
    const file = makeWorldDb(s.dir, 'w1.sqlite', { players: [[1, a]], badges: [[1, 'veteran', null]] });
    assert.equal(s.run('world-finish', 'w1', file), 0);
    s.out.length = 0;
    assert.equal(s.run('world-finish', 'w1', file), 0);
    assert.match(s.out.join('\n'), /already recorded/);
    assert.equal(s.store.accountBadges(a).length, 1);
    assert.equal(s.store.listHallOfFame(10).length, 1);
  } finally {
    s.done();
  }
});

test('world-finish: invalid badge rows are skipped, an old world without the badge table still gets its Hall of Fame row', () => {
  const s = setup();
  try {
    const a = s.acc('anna');
    const file = makeWorldDb(s.dir, 'w1.sqlite', { players: [[1, a]], badges: [[1, 'veteran', null], [1, 'top10', 11], [1, 'bogus', null], [1, 'champion', 3]] });
    assert.equal(s.run('world-finish', 'w1', file), 0);
    assert.match(s.out.join('\n'), /3 badge row\(s\) that failed validation/);
    assert.deepEqual(s.store.accountBadges(a).map((x) => x.badge), ['veteran']);

    s.store.insertWorld({ id: 'w0', name: 'Old', status: 'open', path: '/w/w0/', createdAt: 0 });
    const old = makeWorldDb(s.dir, 'w0.sqlite', { badgeTable: false });
    s.out.length = 0;
    assert.equal(s.run('world-finish', 'w0', old), 0);
    assert.match(s.out.join('\n'), /no world_end_badges table/);
    assert.equal(s.store.listHallOfFame(10).length, 2);
  } finally {
    s.done();
  }
});

test('badge-grant and badge-revoke validate, change and audit', () => {
  const s = setup();
  try {
    const a = s.acc('anna');
    assert.equal(s.run('badge-grant', 'anna', 'w1', 'veteran'), 0, s.err.join('|'));
    assert.equal(s.run('badge-grant', 'anna', 'w1', 'veteran'), 1); // already there
    assert.equal(s.run('badge-grant', 'anna', 'w1', 'top10', '4'), 0);
    assert.equal(s.run('badge-grant', 'anna', 'w1', 'top10'), 1); // place needed
    assert.equal(s.run('badge-grant', 'anna', 'w2', 'champion'), 1); // unknown world
    assert.equal(s.run('badge-grant', 'nobody', 'w1', 'champion'), 1);
    assert.equal(s.run('badge-grant', 'anna', 'w1', 'king'), 1);
    assert.equal(s.run('badge-grant', 'anna', 'w1', 'champion', '3'), 1); // place only for top10
    for (const bad of ['0', '11', '-1', 'x', '1.5']) assert.equal(s.run('badge-grant', 'anna', 'w1', 'top10', bad), 1, bad);
    assert.deepEqual(s.store.accountBadges(a).map((x) => [x.badge, x.place]), [['top10', 4], ['veteran', null]]);
    assert.equal(s.run('badge-revoke', 'anna', 'w1', 'top10'), 0);
    assert.equal(s.run('badge-revoke', 'anna', 'w1', 'top10'), 1);
    assert.deepEqual(s.store.accountBadges(a).map((x) => x.badge), ['veteran']);
    const actions = s.store.auditRows().map((r) => r.action);
    assert.ok(actions.includes('badge_grant') && actions.includes('badge_revoke'));
    assert.equal(s.run('help-me'), 1);
    assert.ok(s.err.some((l) => l.includes('world-finish')));
  } finally {
    s.done();
  }
});

test('hall-of-fame route: 401 signed out, shape, newest first, capped', async () => {
  const { app } = await makeApp();
  try {
    const anon = new Client(app);
    errorOf(await anon.get('/lobby/api/hall-of-fame'), 401, 'unauthorized');
    const c = await register(app, 'Anna');
    const empty = await c.get('/lobby/api/hall-of-fame');
    ok(empty);
    assert.deepEqual(empty.json<HallOfFameResponse>(), { worlds: [] });

    const top = JSON.stringify({
      tribes: [{ rank: 1, name: 'Red', tag: 'RD', points: 10 }],
      players: [{ rank: 1, name: 'Anna', points: 5, tribeTag: 'RD' }],
    });
    const n = HALL_OF_FAME_MAX_WORLDS + 5;
    for (let i = 0; i < n; i += 1) {
      app.ctx.store.insertHallOfFame({ worldId: `h${i}`, worldName: `World ${i}`, endedAt: 1000 + i, kind: 'domination', winnerName: 'Red', winnerTag: 'RD', topJson: top });
    }
    app.ctx.store.insertHallOfFame({ worldId: 'hm', worldName: 'Manual', endedAt: 1, kind: 'manual', winnerName: null, winnerTag: null, topJson: top });
    const res = await c.get('/lobby/api/hall-of-fame');
    ok(res);
    const body = res.json<HallOfFameResponse>();
    assert.equal(body.worlds.length, HALL_OF_FAME_MAX_WORLDS);
    assert.equal(body.worlds[0]?.worldId, `h${n - 1}`);
    assert.ok(body.worlds[0] && body.worlds[0].endedAt > (body.worlds[1]?.endedAt ?? 0));
    assert.deepEqual(body.worlds[0]?.winner, { name: 'Red', tag: 'RD' });
    assert.deepEqual(body.worlds[0]?.topTribes, [{ rank: 1, name: 'Red', tag: 'RD', points: 10 }]);
    assert.deepEqual(body.worlds[0]?.topPlayers, [{ rank: 1, name: 'Anna', points: 5, tribeTag: 'RD' }]);
  } finally {
    await app.close();
  }
});

test('me carries badges (newest first) and the entry pass carries bdg = the summary', async () => {
  const { app, clock } = await makeApp();
  try {
    addWorld(app, 'w1', 'First');
    addWorld(app, 'w2', 'Second');
    const c = await register(app, 'Anna');
    const me0 = (await c.get('/lobby/api/auth/me')).json<LobbyMeResponse>();
    assert.deepEqual(me0.account?.badges, []);
    const id = me0.account?.id ?? 0;
    const st = app.ctx.store;
    st.insertAccountBadge(id, 'w1', 'veteran', null, 100);
    st.insertAccountBadge(id, 'w1', 'top10', 7, 100);
    st.insertAccountBadge(id, 'w2', 'top10', 2, 200);
    st.insertHallOfFame({ worldId: 'w2', worldName: 'Second (Hall)', endedAt: 200, kind: 'domination', winnerName: null, winnerTag: null, topJson: '{}' });
    const me = (await c.get('/lobby/api/auth/me')).json<LobbyMeResponse>();
    assert.deepEqual(me.account?.badges.map((b) => [b.worldId, b.worldName, b.badge, b.place]), [
      ['w2', 'Second (Hall)', 'top10', 2],
      ['w1', 'First', 'top10', 7],
      ['w1', 'First', 'veteran', null],
    ]);
    clock.advance(1);
    const res = await c.post('/lobby/api/worlds/w1/enter');
    ok(res);
    const claims = verifyPass(res.json<{ pass: string }>().pass, [PUBLIC_KEY], clock.now());
    assert.deepEqual(claims.bdg, [
      { badge: 'top10', count: 2, bestPlace: 2 },
      { badge: 'veteran', count: 1, bestPlace: null },
    ]);
    // An account without badges still sends an (empty) summary.
    const d = await register(app, 'Dora', nextIp());
    const claims2 = verifyPass((await d.post('/lobby/api/worlds/w1/enter')).json<{ pass: string }>().pass, [PUBLIC_KEY], clock.now());
    assert.deepEqual(claims2.bdg, []);
    void PASSWORD;
  } finally {
    await app.close();
  }
});

test('db: v3 database upgrades to v4 with the badge tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-lobby-v4-'));
  try {
    const file = join(dir, 'l.sqlite');
    const db = openDatabase(file);
    db.exec('DROP TABLE account_badges; DROP TABLE hall_of_fame; PRAGMA user_version = 3');
    db.close();
    const again = openDatabase(file);
    assert.equal((again.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 4);
    assert.equal((again.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('account_badges','hall_of_fame')").get() as { n: number }).n, 2);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
