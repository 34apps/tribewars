// Schema v19: leftovers of the Log Ram / Boulder Sling -> Firecart change that v17 did not reach (old reports, saved troop groups, stamped
// ranks). It must reach worlds that already ran v17/v18, work with new-format rows mixed in, and change nothing the second time.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { buildApp } from '../src/app.ts';
import { Client, Clock, PASSWORD, TEST_WORLD, TEST_WORLD_CONFIG, ok } from './helpers.ts';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test('v18 database with old reports, groups and ranks: converted, new rows untouched, second run changes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-leftovers-'));
  try {
    const dbPath = join(dir, 'game.sqlite');
    const clock = new Clock();
    const open = () => buildApp({ dbPath, now: clock.now, settings: TEST_WORLD, worldConfig: TEST_WORLD_CONFIG, webDistDir: '/nonexistent' });
    let app = await open();
    const c = new Client(app);
    ok(await c.post('/api/auth/register', { username: 'alice', password: PASSWORD }), 201);
    const state = await c.state();
    const homeId = state.villages[0]!.id;
    const npcId = app.ctx.store.abandonedVillageIds()[0]!;
    await app.close();

    const raw = new DatabaseSync(dbPath);
    const playerId = (raw.prepare('SELECT id FROM players LIMIT 1').get() as { id: number }).id;
    const t = clock.now();
    const oldBattle = {
      type: 'battle',
      outcome: 'battle',
      attackerUnits: { raider: 5, logram: 190, boulder: 2 },
      attackerLosses: { raider: 1, logram: 10 },
      defenderUnits: { pikeman: 4, boulder: 3 },
      defenderLosses: { boulder: 1 },
      supportUnits: null,
      supportLosses: null,
      siege: [{ unit: 'logram', building: 'wall', from: 20, to: 17 }],
    };
    const newBattle = { type: 'battle', outcome: 'battle', attackerUnits: { raider: 5, firecart: 7 }, attackerLosses: {}, defenderUnits: null, defenderLosses: null, siege: [{ unit: 'firecart', building: 'wall', from: 5, to: 4 }] };
    const ins = raw.prepare("INSERT INTO reports (player_id, side, won, title, created_at, read, battle_json) VALUES (?, 'attack', 1, 'x', ?, 0, ?)");
    const oldId = Number(ins.run(playerId, t, JSON.stringify(oldBattle)).lastInsertRowid);
    const newId = Number(ins.run(playerId, t, JSON.stringify(newBattle)).lastInsertRowid);
    const scoutId = Number(ins.run(playerId, t, JSON.stringify({ type: 'scout', intel: { troops: { logram: 3, pikeman: 1 } } })).lastInsertRowid);
    const grp = raw.prepare('INSERT INTO troop_groups (player_id, name, units, created_at) VALUES (?, ?, ?, ?)');
    const g1 = Number(grp.run(playerId, 'mixed', JSON.stringify({ raider: 3, logram: 3, boulder: 3 }), t).lastInsertRowid);
    const g2 = Number(grp.run(playerId, 'only slings', JSON.stringify({ boulder: 1 }), t).lastInsertRowid); // 2 pop -> 0 Firecarts: empty, dropped
    const g3 = Number(grp.run(playerId, 'new', JSON.stringify({ raider: 2, firecart: 1 }), t).lastInsertRowid);
    raw.prepare("INSERT INTO movements (kind, origin_village_id, target_village_id, units_json, loot_json, depart_at, arrive_at, ranks_json) VALUES ('attack', ?, ?, ?, NULL, ?, ?, ?)").run(
      homeId,
      npcId,
      JSON.stringify({ raider: 3, firecart: 2 }),
      t,
      t + 1000,
      JSON.stringify({ logram: { attack: 2, defense: 1 }, boulder: { attack: 3, defense: 0 }, raider: { attack: 1, defense: 1 } }),
    );
    raw.prepare('INSERT INTO stationed (owner_player_id, home_village_id, host_village_id, units_json, arrived_at, ranks_json) VALUES (?, ?, ?, ?, ?, ?)').run(
      playerId,
      homeId,
      npcId,
      JSON.stringify({ firecart: 1 }),
      t,
      JSON.stringify({ boulder: { attack: 2, defense: 2 } }),
    );
    raw.exec("DELETE FROM meta WHERE key = 'siege_leftovers_applied'");
    raw.exec('PRAGMA user_version = 18');
    raw.close();

    app = await open();
    const check = (): { reports: Loose[]; groups: Loose[]; ranks: Array<string | null> } => {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const out = {
        reports: (db.prepare('SELECT id, battle_json FROM reports ORDER BY id').all() as Loose[]).map((r) => ({ id: r.id, ...JSON.parse(r.battle_json) })),
        groups: db.prepare('SELECT id, name, units FROM troop_groups ORDER BY id').all() as Loose[],
        ranks: [...db.prepare('SELECT ranks_json FROM movements').all(), ...db.prepare('SELECT ranks_json FROM stationed').all()].map((r) => (r as Loose).ranks_json as string | null),
      };
      db.close();
      return out;
    };
    const after = check();
    const byId = (id: number): Loose => after.reports.find((r) => r.id === id)!;
    assert.deepEqual(byId(oldId).attackerUnits, { raider: 5, firecart: Math.floor((3 * 190 + 2 * 2) / 3) });
    assert.deepEqual(byId(oldId).attackerLosses, { raider: 1, firecart: 10 });
    assert.deepEqual(byId(oldId).defenderUnits, { pikeman: 4, firecart: 2 });
    assert.deepEqual(byId(oldId).siege, [{ unit: 'firecart', building: 'wall', from: 20, to: 17 }]);
    assert.deepEqual(byId(newId), { id: newId, ...newBattle }, 'a new-format report is untouched');
    assert.deepEqual(byId(scoutId).intel.troops, { pikeman: 1, firecart: 3 });
    assert.deepEqual(JSON.parse(after.groups.find((g) => g.id === g1)!.units), { raider: 3, firecart: 5 });
    assert.equal(after.groups.find((g) => g.id === g2), undefined, 'a group that ends up empty is dropped');
    assert.deepEqual(JSON.parse(after.groups.find((g) => g.id === g3)!.units), { raider: 2, firecart: 1 });
    assert.deepEqual(JSON.parse(after.ranks[0]!), { firecart: { attack: 3, defense: 1 }, raider: { attack: 1, defense: 1 } }, 'higher of the two per track');
    assert.deepEqual(JSON.parse(after.ranks[1]!), { firecart: { attack: 2, defense: 2 } });
    // The read path serves the converted report to the client.
    const api = new Client(app);
    ok(await api.post('/api/auth/login', { username: 'alice', password: PASSWORD }));
    const served = await api.get(`/api/reports/${oldId}`);
    assert.equal(served.statusCode, 200, served.body);
    assert.equal(served.body.includes('logram'), false);
    await app.close();

    // A second start changes nothing.
    app = await open();
    assert.deepEqual(check(), after);
    await app.close();
    // Even with the flag removed (a re-run), nothing old is left to change.
    const again = new DatabaseSync(dbPath);
    again.exec("DELETE FROM meta WHERE key = 'siege_leftovers_applied'");
    again.close();
    app = await open();
    assert.deepEqual(check(), after);
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the read path tolerates an old report body that was never migrated', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-leftovers-read-'));
  try {
    const dbPath = join(dir, 'game.sqlite');
    const clock = new Clock();
    const open = () => buildApp({ dbPath, now: clock.now, settings: TEST_WORLD, worldConfig: TEST_WORLD_CONFIG, webDistDir: '/nonexistent' });
    let app = await open();
    ok(await new Client(app).post('/api/auth/register', { username: 'bob', password: PASSWORD }), 201);
    await app.close();
    const raw = new DatabaseSync(dbPath);
    const pid = (raw.prepare('SELECT id FROM players LIMIT 1').get() as { id: number }).id;
    const id = Number(
      raw
        .prepare("INSERT INTO reports (player_id, side, won, title, created_at, read, battle_json) VALUES (?, 'attack', 1, 'x', ?, 0, ?)")
        .run(pid, clock.now(), JSON.stringify({ type: 'battle', attackerUnits: { logram: 3 }, attackerLosses: {}, siege: [{ unit: 'boulder', building: 'wall', from: 3, to: 2 }] })).lastInsertRowid,
    );
    raw.close(); // the v19 flag is already set: this row is never rewritten
    app = await open();
    const c = new Client(app);
    ok(await c.post('/api/auth/login', { username: 'bob', password: PASSWORD }));
    const res = await c.get(`/api/reports/${id}`);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.body.includes('logram') || res.body.includes('boulder'), false);
    assert.match(res.body, /"firecart":3/);
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
