// Schema v34: villages taken by a Strike-and-Hold before the rule "occupiers stay as support" (docs/GAME_DESIGN.md 18.2) get their moved-in army turned
// into stationed support from the village that sent it, once, only where the reports tell the origin reliably.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { buildApp } from '../src/app.ts';
import { Client, Clock, PASSWORD, TEST_WORLD, TEST_WORLD_CONFIG, ok } from './helpers.ts';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A world with one player (home village) and one taken village that holds the army that took it, plus the three reports of the old rule. */
async function oldWorld(dir: string, opts: { originStillTheirs: boolean }) {
  const dbPath = join(dir, 'game.sqlite');
  const clock = new Clock();
  const open = () => buildApp({ dbPath, now: clock.now, settings: TEST_WORLD, worldConfig: TEST_WORLD_CONFIG, webDistDir: '/nonexistent' });
  const app = await open();
  const c = new Client(app);
  ok(await c.post('/api/auth/register', { username: 'alice', password: PASSWORD }), 201);
  const homeId = (await c.state()).villages[0]!.id;
  const takenId = app.ctx.store.abandonedVillageIds()[0]!;
  await app.close();

  const raw = new DatabaseSync(dbPath);
  const playerId = (raw.prepare('SELECT id FROM players LIMIT 1').get() as { id: number }).id;
  const t = clock.now();
  const village = (id: number): Loose => JSON.parse((raw.prepare('SELECT state_json FROM villages WHERE id = ?').get(id) as { state_json: string }).state_json);
  const taken = village(takenId);
  taken.troops.raider = 540;
  taken.troops.pikeman = 30; // trained there later: not part of the army
  delete taken.npc;
  raw.prepare('UPDATE villages SET owner_id = ?, state_json = ?, name = ? WHERE id = ?').run(playerId, JSON.stringify(taken), "alice's village 2", takenId);
  const home = village(homeId);
  home.ranks = { raider: { might: 2, bulwark: 0, keen: 0 } };
  raw.prepare('UPDATE villages SET state_json = ? WHERE id = ?').run(JSON.stringify(home), homeId);
  if (!opts.originStillTheirs) raw.prepare('UPDATE villages SET owner_id = NULL WHERE id = ?').run(homeId);

  const ref = (id: number) => ({ villageId: id, name: 'x', x: 0, y: 0, ownerName: 'alice' });
  const ins = raw.prepare("INSERT INTO reports (player_id, side, won, title, created_at, read, battle_json) VALUES (?, 'attack', 1, ?, ?, 0, ?)");
  ins.run(playerId, 'Raid', t, JSON.stringify({ type: 'battle', outcome: 'battle', attacker: ref(homeId), defender: ref(takenId), attackerWon: true, attackerUnits: { raider: 600, chieftain: 2 }, attackerLosses: { raider: 50 } }));
  ins.run(playerId, 'Hearth out', t, JSON.stringify({ type: 'village', kind: 'struck', village: ref(takenId), holdEndsAt: t + 1000 }));
  ins.run(playerId, 'Village taken', t + 1000, JSON.stringify({ type: 'village', kind: 'taken', village: ref(takenId), overflow: { raider: 20, chieftain: 1 } }));
  raw.prepare("DELETE FROM meta WHERE key = 'takeover_support_applied'").run();
  raw.close();
  return { dbPath, open, homeId, takenId, playerId };
}

const read = (dbPath: string, homeId: number, takenId: number) => {
  const raw = new DatabaseSync(dbPath);
  const st = (id: number): Loose => JSON.parse((raw.prepare('SELECT state_json FROM villages WHERE id = ?').get(id) as { state_json: string }).state_json);
  const rows = raw.prepare('SELECT * FROM stationed').all() as Loose[];
  const out = { taken: st(takenId), home: st(homeId), rows };
  raw.close();
  return out;
};

test('taken village: the moved-in army becomes support from the origin village, once; later troops stay', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-takeover-'));
  try {
    const w = await oldWorld(dir, { originStillTheirs: true });
    await (await w.open()).close();
    const a = read(w.dbPath, w.homeId, w.takenId);
    assert.equal(a.rows.length, 1);
    const row = a.rows[0]!;
    assert.deepEqual([row.owner_player_id, row.home_village_id, row.host_village_id], [w.playerId, w.homeId, w.takenId]);
    assert.equal(JSON.parse(row.units_json).raider, 530, '600 - 50 lost - 20 sent home');
    assert.equal(JSON.parse(row.ranks_json).raider.might, 2, 'the origin village ranks are stamped');
    assert.equal(a.taken.troops.raider, 10, 'only the army moved out of the village');
    assert.equal(a.taken.troops.pikeman, 30, 'troops that were not part of the army stay');
    assert.equal(a.home.away.raider, 530, 'counted in the home village again');
    // Second start: nothing changes.
    await (await w.open()).close();
    const b = read(w.dbPath, w.homeId, w.takenId);
    assert.deepEqual(b, a);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('taken village whose origin is no longer the same player\'s: skipped, nothing changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-takeover-'));
  try {
    const w = await oldWorld(dir, { originStillTheirs: false });
    await (await w.open()).close();
    const a = read(w.dbPath, w.homeId, w.takenId);
    assert.equal(a.rows.length, 0);
    assert.equal(a.taken.troops.raider, 540);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no reports of a takeover: a village with its own troops is left alone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-takeover-'));
  try {
    const w = await oldWorld(dir, { originStillTheirs: true });
    const raw = new DatabaseSync(w.dbPath);
    raw.prepare("DELETE FROM reports WHERE title = 'Hearth out'").run();
    raw.close();
    await (await w.open()).close();
    const a = read(w.dbPath, w.homeId, w.takenId);
    assert.equal(a.rows.length, 0);
    assert.equal(a.taken.troops.raider, 540);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
