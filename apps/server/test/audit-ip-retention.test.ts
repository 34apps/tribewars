// Privacy (owner 2026-11-18): the audit log keeps every entry, but the address (actor_ip) is blanked after MULTI_RETENTION_MS.
// Schema v29: the append-only trigger allows exactly one update, actor_ip -> NULL; the migration swaps it on a v28 database.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { MULTI_RETENTION_MS } from '@clanfire/engine';
import { buildApp } from '../src/app.ts';
import { HOUR, TEST_WORLD, TEST_WORLD_CONFIG, makeApp } from './helpers.ts';

const DAY = 24 * HOUR;
type Row = { id: number; at: number; actor_ip: string | null; action: string; detail: string };

const log = (db: DatabaseSync, at: number, ip: string | null, action: string): number =>
  Number(db.prepare('INSERT INTO audit_log (at, actor_ip, action, detail) VALUES (?, ?, ?, ?)').run(at, ip, action, `detail of ${action}`).lastInsertRowid);
const rows = (db: DatabaseSync): Row[] => db.prepare('SELECT id, at, actor_ip, action, detail FROM audit_log WHERE action LIKE ? ORDER BY id').all('ret_%') as Row[];

test('the caretaker blanks addresses older than 30 days and keeps the entries; younger ones keep theirs', async () => {
  const { app, clock } = await makeApp();
  const db = app.ctx.store.db;
  const old = log(db, clock.t - 1 * DAY, '203.0.113.5', 'ret_old');
  const young = log(db, clock.t + 20 * DAY, '203.0.113.6', 'ret_young');
  const noIp = log(db, clock.t - 1 * DAY, null, 'ret_none');
  const before = rows(db);
  app.ctx.game.runCaretaker(clock.t + MULTI_RETENTION_MS - 1 * DAY + 2 * HOUR); // 'old' is now older than 30 days, 'young' is not
  const after = rows(db);
  assert.equal(after.length, before.length, 'no entry is removed');
  const by = (id: number, list: Row[]): Row => list.find((r) => r.id === id)!;
  assert.equal(by(old, after).actor_ip, null);
  assert.equal(by(young, after).actor_ip, '203.0.113.6');
  assert.equal(by(noIp, after).actor_ip, null);
  for (const r of after) assert.deepEqual({ ...r, actor_ip: 0 }, { ...by(r.id, before), actor_ip: 0 }, 'only the address changed');
  await app.close();
});

test('the audit log stays append-only apart from blanking the address', async () => {
  const { app, clock } = await makeApp();
  const db = app.ctx.store.db;
  const id = log(db, clock.t, '203.0.113.7', 'ret_guard');
  const refused = (sql: string): void => assert.throws(() => db.prepare(sql).run(id), /append-only/, sql);
  refused('DELETE FROM audit_log WHERE id = ?');
  refused("UPDATE audit_log SET actor_ip = '198.51.100.1' WHERE id = ?");
  refused("UPDATE audit_log SET action = 'x' WHERE id = ?");
  refused("UPDATE audit_log SET detail = 'x' WHERE id = ?");
  refused('UPDATE audit_log SET at = at + 1 WHERE id = ?');
  refused('UPDATE audit_log SET id = id + 1000000 WHERE id = ?');
  refused("UPDATE audit_log SET actor_ip = NULL, detail = 'x' WHERE id = ?");
  assert.equal(rows(db).find((r) => r.id === id)!.actor_ip, '203.0.113.7');
  db.prepare('UPDATE audit_log SET actor_ip = NULL WHERE id = ?').run(id);
  assert.equal(rows(db).find((r) => r.id === id)!.actor_ip, null);
  await app.close();
});

test('migration v29: a v28 database gets the new guard, old entries keep their data, a second open changes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-auditip-'));
  try {
    const dbPath = join(dir, 'game.sqlite');
    const { Clock } = await import('./helpers.ts');
    const clock = new Clock();
    const open = () => buildApp({ dbPath, now: clock.now, settings: TEST_WORLD, worldConfig: TEST_WORLD_CONFIG, webDistDir: '/nonexistent' });
    let app = await open();
    await app.close();

    // Make the file look like v28: the old trigger (no update at all) and no flag.
    const raw = new DatabaseSync(dbPath);
    raw.exec('DROP TRIGGER audit_no_update');
    raw.exec("CREATE TRIGGER audit_no_update BEFORE UPDATE OF id, at, actor_ip, action, detail ON audit_log BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END");
    raw.exec("DELETE FROM meta WHERE key = 'audit_ip_guard_applied'");
    const id = log(raw, clock.t - 40 * DAY, '203.0.113.8', 'ret_mig');
    assert.throws(() => raw.prepare('UPDATE audit_log SET actor_ip = NULL WHERE id = ?').run(id), /append-only/, 'v28 forbids it');
    raw.exec('PRAGMA user_version = 28');
    raw.close();

    app = await open();
    const db = app.ctx.store.db;
    assert.deepEqual(rows(db).map((r) => [r.actor_ip, r.detail]), [['203.0.113.8', 'detail of ret_mig']], 'the migration touches no rows');
    assert.throws(() => db.prepare('DELETE FROM audit_log WHERE id = ?').run(id), /append-only/);
    app.ctx.game.runCaretaker(clock.t + 1 * HOUR);
    assert.deepEqual(rows(db).map((r) => [r.actor_ip, r.detail, r.at]), [[null, 'detail of ret_mig', clock.t - 40 * DAY]]);
    const triggers = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'audit_%' ORDER BY name").all();
    await app.close();

    app = await open();
    assert.deepEqual(app.ctx.store.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'audit_%' ORDER BY name").all(), triggers);
    assert.equal(rows(app.ctx.store.db).length, 1);
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
