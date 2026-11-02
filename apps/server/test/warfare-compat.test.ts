// Data saved before Pathfinders, scouting and support existed must keep working (GAME_DESIGN.md section 12, "Saved data").

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { UNIT_IDS, type VillageState } from '@clanfire/engine';
import { buildApp } from '../src/app.ts';
import { applySchema } from '../src/db.ts';
import { Client, HOUR, PASSWORD, TEST_WORLD, battleOf, ok, register, weakestAbandoned } from './helpers.ts';
import { giveTroops, latestReport, movementsOf, reports, sendFails, sendOk, stateOf, units, village, world, type App, type P } from './warfare-helpers.ts';

/** The five-unit maps of the first release. */
const OLD_UNITS = { pikeman: 0, guard: 0, raider: 0, outrider: 0, knight: 0 };
const oldUnits = (partial: Partial<typeof OLD_UNITS>): typeof OLD_UNITS => ({ ...OLD_UNITS, ...partial });

/** Rewrite the player's village state in the database the way an old release saved it (no `pathfinder` anywhere). */
function saveOldVillage(app: App, p: P, troops: Partial<typeof OLD_UNITS>, away: Partial<typeof OLD_UNITS> = {}): void {
  const v = app.ctx.store.villagesOfPlayer(p.id)[0];
  assert.ok(v);
  const old = JSON.parse(JSON.stringify(v.state)) as VillageState;
  old.troops = oldUnits(troops) as VillageState['troops'];
  old.away = oldUnits(away) as VillageState['away'];
  const json = JSON.stringify(old);
  assert.equal(json.includes('pathfinder'), false);
  app.ctx.store.db.prepare('UPDATE villages SET state_json = ? WHERE id = ?').run(json, v.id);
}

const finite = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n);

test('a village saved without the pathfinder key loads, settles and fights; nothing turns into NaN', async () => {
  const { app, clock, alice } = await world();
  saveOldVillage(app, alice, { raider: 14, pikeman: 3 });
  const npc = await weakestAbandoned(alice.c, 12);

  const st = await stateOf(alice);
  const v = st.villages[0]?.state;
  assert.ok(v);
  assert.deepEqual(Object.keys(v.troops).sort(), [...UNIT_IDS].sort());
  assert.deepEqual(Object.keys(v.away).sort(), [...UNIT_IDS].sort());
  assert.deepEqual([v.troops.pathfinder, v.away.pathfinder, v.troops.raider], [0, 0, 14]);
  assert.ok(Object.values(v.resources).every(finite));

  // Sending and scouting use the normalised counts: no Pathfinders at home is a clean refusal, not a crash.
  await sendFails(alice, npc, 'scout', { pathfinder: 1 }, 409, 'not_enough_troops');
  const sent = await sendOk(alice, npc, 'attack', { raider: 14 });
  clock.set(sent.movement.arriveAt);
  const ret = (await movementsOf(alice))[0];
  assert.ok(ret);
  clock.set(ret.arriveAt);
  const home = (await village(alice)).state;
  assert.ok(Object.values(home.troops).every(finite) && Object.values(home.away).every(finite));
  assert.deepEqual([home.troops.pathfinder, home.away.pathfinder, home.away.raider], [0, 0, 0]);
  assert.ok(home.troops.raider > 0);
  assert.ok(Object.values(home.resources).every(finite));
  await app.close();
});

test('a movement and a battle on units saved without the pathfinder key work (including the defending village)', async () => {
  const { app, clock, alice, amy, bob } = await world();
  // Bob (neutral to alice) attacks amy with 14 raiders: both villages are in the old format, and the movement row too.
  saveOldVillage(app, bob, {}, { raider: 14 });
  saveOldVillage(app, amy, { pikeman: 6 });
  const bobHome = await village(bob);
  const amyHome = await village(amy);
  const t = clock.now();
  const inserted = app.ctx.store.db
    .prepare("INSERT INTO movements (kind, origin_village_id, target_village_id, units_json, loot_json, depart_at, arrive_at) VALUES ('attack', ?, ?, ?, NULL, ?, ?)")
    .run(bobHome.id, amyHome.id, JSON.stringify(oldUnits({ raider: 14 })), t, t + 1000);
  assert.ok(Number(inserted.lastInsertRowid) > 0);
  clock.advance(HOUR);

  const mine = await latestReport(amy);
  const b = battleOf(mine);
  assert.deepEqual([b.attackerUnits.raider, b.attackerUnits.pathfinder, b.defenderUnits?.pikeman, b.defenderUnits?.pathfinder], [14, 0, 6, 0]);
  assert.deepEqual([b.supportUnits, b.supportLosses], [null, null]);
  assert.ok([b.attackPower, b.defensePower, ...Object.values(b.attackerLosses)].every(finite));
  const after = (await village(amy)).state;
  assert.ok(Object.values(after.troops).every(finite));
  await app.close();
});

test('stationed units saved without the pathfinder key are normalised on load, and defend, scout and recall normally', async () => {
  const { app, clock, alice, amy, bob } = await world();
  saveOldVillage(app, alice, {}, { pikeman: 10 });
  const home = await village(alice);
  const host = await village(amy);
  app.ctx.store.db
    .prepare('INSERT INTO stationed (owner_player_id, home_village_id, host_village_id, units_json, arrived_at) VALUES (?, ?, ?, ?, ?)')
    .run(alice.id, home.id, host.id, JSON.stringify(oldUnits({ pikeman: 10 })), clock.now());

  const here = (await stateOf(amy)).stationed.here;
  assert.equal(here.length, 1);
  assert.deepEqual(Object.keys(here[0]?.units ?? {}).sort(), [...UNIT_IDS].sort());
  assert.deepEqual([here[0]?.units.pikeman, here[0]?.units.pathfinder], [10, 0]);

  // It defends: a scout from bob sees it in the intel with a clean 0 Pathfinders.
  giveTroops(app, bob, { pathfinder: 2 });
  const { movement } = await sendOk(bob, amy, 'scout', { pathfinder: 2 });
  clock.set(movement.arriveAt);
  const intel = (await latestReport(bob)).scout?.intel;
  assert.deepEqual([intel?.troops.pikeman, intel?.troops.pathfinder], [10, 0]);

  // And it can be recalled (partially): the stored row is rewritten in the new format.
  const res = await alice.c.post(`/api/stationed/${here[0]?.id}/recall`, { units: { pikeman: 4 } });
  ok(res, 201);
  const row = app.ctx.store.db.prepare('SELECT units_json FROM stationed').get() as { units_json: string };
  assert.equal(JSON.parse(row.units_json).pathfinder, 0);
  assert.equal(JSON.parse(row.units_json).pikeman, 6);
  await app.close();
});

test('reports saved before scouting (no type, no support figures, five-unit maps) read as battles with every field present', async () => {
  const { app, clock, alice } = await world();
  const ref = { villageId: 1, name: 'A', x: 0, y: 0, ownerName: null };
  const legacy = {
    outcome: 'battle',
    attacker: ref,
    defender: ref,
    attackerWon: true,
    luck: 0.01,
    attackPower: 10,
    defensePower: 5,
    attackerUnits: oldUnits({ raider: 3 }),
    attackerLosses: oldUnits({ raider: 1 }),
    defenderUnits: oldUnits({ pikeman: 2 }),
    defenderLosses: oldUnits({ pikeman: 2 }),
    wallLevel: 0,
    loot: { wood: 1, food: 2, iron: 3, gold: 4 },
  };
  const insert = app.ctx.store.db.prepare('INSERT INTO reports (player_id, side, won, title, created_at, read, battle_json) VALUES (?, ?, ?, ?, ?, 0, ?)');
  const won = Number(insert.run(alice.id, 'attack', 1, 'Raid', clock.now(), JSON.stringify(legacy)).lastInsertRowid);
  // A hidden-defence report (attacker wiped out) keeps its nulls.
  const hidden = { ...legacy, attackerWon: false, defenderUnits: null, defenderLosses: null, wallLevel: null };
  const lost = Number(insert.run(alice.id, 'attack', 0, 'Lost raid', clock.now() + 1, JSON.stringify(hidden)).lastInsertRowid);

  const list = await reports(alice);
  assert.deepEqual(list.map((r) => [r.id, r.type, r.side, r.outcome]), [[lost, 'battle', 'attack', 'battle'], [won, 'battle', 'attack', 'battle']]);

  const dto = (await alice.c.get(`/api/reports/${won}`)).json<Awaited<ReturnType<typeof latestReport>>>();
  assert.deepEqual([dto.type, dto.scout, dto.support], ['battle', null, null]);
  const b = battleOf(dto);
  assert.deepEqual(Object.keys(b.attackerUnits).sort(), [...UNIT_IDS].sort());
  assert.deepEqual(b.attackerUnits, units({ raider: 3 }));
  assert.deepEqual(b.defenderLosses, units({ pikeman: 2 }));
  assert.deepEqual([b.supportUnits, b.supportLosses], [null, null]);
  assert.deepEqual(b.loot, { wood: 1, food: 2, iron: 3, gold: 4 });

  const hiddenBattle = battleOf((await alice.c.get(`/api/reports/${lost}`)).json());
  assert.deepEqual([hiddenBattle.defenderUnits, hiddenBattle.defenderLosses, hiddenBattle.wallLevel], [null, null, null]);
  assert.deepEqual(hiddenBattle.attackerLosses, units({ raider: 1 }));
  await app.close();
});

test('a database from before scouting and support is upgraded in place: tables rebuilt with ids and rows kept, then the new kinds work', async () => {
  const dir = mkdtempSync(pathJoin(tmpdir(), 'tw-warfare-'));
  const path = pathJoin(dir, 'game.sqlite');
  const settings = { dbPath: path, now: () => Date.UTC(2026, 5, 1, 12, 0, 0), settings: TEST_WORLD, webDistDir: '/nonexistent', secureCookies: false } as const;
  try {
    let app = await buildApp(settings);
    const c = await register(app, 'veteran');
    const playerId = (await c.state()).player.id;
    const homeId = (await c.village()).id;
    const npc = await weakestAbandoned(c, 12);
    await app.close();

    // Make it look like an older database: the old CHECK constraints, no stationed table, and some history.
    const db = new DatabaseSync(path);
    db.exec(`
      DROP TABLE movements; DROP TABLE reports; DROP TABLE stationed;
      CREATE TABLE movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('attack', 'return')),
        origin_village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
        target_village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
        units_json TEXT NOT NULL, loot_json TEXT, depart_at INTEGER NOT NULL, arrive_at INTEGER NOT NULL
      );
      CREATE INDEX idx_movements_arrive ON movements(arrive_at, id);
      CREATE TABLE reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        side TEXT NOT NULL CHECK (side IN ('attack', 'defense')),
        won INTEGER NOT NULL, title TEXT NOT NULL, created_at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0, battle_json TEXT NOT NULL
      );
      CREATE INDEX idx_reports_player ON reports(player_id, created_at);
    `);
    const t = Date.UTC(2026, 5, 1, 12, 0, 0);
    const mv = db.prepare("INSERT INTO movements (kind, origin_village_id, target_village_id, units_json, loot_json, depart_at, arrive_at) VALUES ('attack', ?, ?, ?, NULL, ?, ?)");
    for (let i = 0; i < 3; i++) mv.run(homeId, npc.id, JSON.stringify(oldUnits({ raider: 1 })), t, t + 5000 + i);
    db.exec('DELETE FROM movements WHERE id IN (2, 3)'); // the sequence stays at 3
    const ref = { villageId: 1, name: 'A', x: 0, y: 0, ownerName: null };
    const oldBattle = { attacker: ref, defender: ref, attackerWon: true, luck: 0, attackPower: 1, defensePower: 1, attackerUnits: oldUnits({}), attackerLosses: oldUnits({}), defenderUnits: null, defenderLosses: null, wallLevel: null, loot: { wood: 0, food: 0, iron: 0, gold: 0 } };
    db.prepare("INSERT INTO reports (player_id, side, won, title, created_at, read, battle_json) VALUES (?, 'attack', 1, 'Old raid', ?, 0, ?)").run(playerId, t - 1000, JSON.stringify(oldBattle));
    db.close();

    app = await buildApp(settings);
    await register(app, 'veteran2', '10.5.5.5'); // the upgraded database accepts new players
    const db2 = new DatabaseSync(path);
    const sql = (name: string): string => (db2.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name) as { sql: string }).sql;
    assert.match(sql('movements'), /'scout'/);
    assert.match(sql('movements'), /'support'/);
    assert.match(sql('reports'), /'support'/);
    assert.ok(db2.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_movements_arrive'").get(), 'indexes are back');
    assert.ok(db2.prepare("SELECT 1 FROM sqlite_master WHERE name = 'stationed'").get());
    assert.equal((db2.prepare('SELECT COUNT(*) AS n FROM movements').get() as { n: number }).n, 1, 'the surviving movement was copied');
    db2.close();

    // The old movement and report survived the copy, the old player logs in and reads the old report as a battle.
    const store = app.ctx.store;
    assert.equal(store.getMovement(1)?.kind, 'attack');
    const veteran = new Client(app, '10.6.6.6');
    ok(await veteran.post('/api/auth/login', { username: 'veteran', password: PASSWORD }));
    const list = (await veteran.get('/api/reports')).json<{ reports: Array<{ type: string; title: string }> }>().reports;
    assert.deepEqual(list.map((r) => [r.type, r.title]), [['battle', 'Old raid']]);

    // New kinds are accepted, and ids continue after the old sequence instead of reusing 2 and 3.
    const newId = store.insertMovement({ kind: 'scout', originVillageId: homeId, targetVillageId: npc.id, units: units({ pathfinder: 1 }), loot: null, departAt: t, arriveAt: t + 10 });
    assert.ok(newId > 3, `new movement id ${newId} continues the old sequence`);
    store.insertMovement({ kind: 'support', originVillageId: homeId, targetVillageId: npc.id, units: units({ pikeman: 1 }), loot: null, departAt: t, arriveAt: t + 10 });
    store.insertReport({ playerId, side: 'support', won: false, title: 'x', createdAt: t, type: 'support', support: { reason: 'relation_changed', home: ref, host: ref, units: units({}) } });
    await app.close();

    // Opening an already-upgraded database again changes nothing.
    app = await buildApp(settings);
    assert.ok(app.ctx.store.getMovement(newId));
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applySchema is idempotent and a fresh schema already has the new constraints', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  applySchema(db);
  applySchema(db);
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'movements'").get() as { sql: string }).sql;
  assert.match(sql, /'attack', 'scout', 'support', 'return'/);
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stationed'").all() as unknown[]).length;
  assert.equal(tables, 1);
  const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'stationed'").all() as Array<{ name: string }>).map((r) => r.name);
  assert.ok(idx.includes('idx_stationed_host') && idx.includes('idx_stationed_home'));
  db.close();
});
