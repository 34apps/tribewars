import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION, openDatabase } from '../src/db.ts';
import { Store } from '../src/store.ts';

/** A lobby database as v2 wrote it: the worlds table only knows open | full | closed. */
const V2_WORLDS = `
CREATE TABLE worlds (
  id         TEXT    PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 32),
  name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  status     TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'full', 'closed')),
  path       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT INTO worlds VALUES ('w1', 'First', 'open', '/w/w1/', 100, 10), ('w2', 'Second', 'closed', '/w/w2/', 200, 20);
PRAGMA user_version = 2;
`;

test('db: an old (v2) lobby database upgrades in place and then accepts the finished status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-lobby-db-'));
  try {
    const file = join(dir, 'lobby.sqlite');
    const old = new DatabaseSync(file);
    old.exec(V2_WORLDS);
    assert.throws(() => old.exec("INSERT INTO worlds VALUES ('x', 'X', 'finished', '/w/x/', 1, 1)"), /CHECK/);
    old.close();

    const db = openDatabase(file);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, SCHEMA_VERSION);
    const store = new Store(db);
    assert.deepEqual(
      store.listWorlds().map((w) => [w.id, w.name, w.status, w.path, w.createdAt, w.sortOrder]),
      [
        ['w1', 'First', 'open', '/w/w1/', 100, 10],
        ['w2', 'Second', 'closed', '/w/w2/', 200, 20],
      ],
      'existing rows are kept',
    );
    store.setWorldStatus('w1', 'finished');
    assert.equal(store.getWorld('w1')?.status, 'finished');
    store.insertWorld({ id: 'w3', name: 'Third', status: 'finished', path: '/w/w3/', createdAt: 300 });
    assert.equal(store.getWorld('w3')?.sortOrder, 30);
    assert.throws(() => db.exec("UPDATE worlds SET status = 'weird' WHERE id = 'w1'"), /CHECK/, 'the CHECK still guards the column');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'worlds_new'").get()?.n, 0, 'no temporary table is left behind');
    db.close();

    // Opening again is a no-op and loses nothing.
    const again = openDatabase(file);
    assert.equal(new Store(again).listWorlds().length, 3);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('db: a new database has the finished status from the start', () => {
  const store = new Store(openDatabase(':memory:'));
  store.insertWorld({ id: 'w1', name: 'One', status: 'finished', path: '/w/w1/', createdAt: 0 });
  assert.equal(store.getWorld('w1')?.status, 'finished');
});

test('db v6: a v5 lobby database gets the new audit guard; addresses older than 30 days are blanked and IP rows purged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-lobby-ip-'));
  try {
    const file = join(dir, 'lobby.sqlite');
    const first = openDatabase(file);
    first.exec('DROP TRIGGER audit_no_update');
    first.exec("CREATE TRIGGER audit_no_update BEFORE UPDATE OF id, at, actor_ip, action, detail ON audit_log BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END");
    first.exec('PRAGMA user_version = 5');
    first.close();

    const db = openDatabase(file);
    const DAY = 24 * 3_600_000;
    const now = 100 * DAY;
    const ins = db.prepare('INSERT INTO audit_log (at, actor_ip, action, detail) VALUES (?, ?, ?, ?)');
    ins.run(now - 40 * DAY, '203.0.113.1', 'old', 'd');
    ins.run(now - 5 * DAY, '203.0.113.2', 'young', 'd');
    db.exec("INSERT INTO accounts (username, username_lower, password_hash, chieftain, created_at) VALUES ('A', 'a', 'x', 'Chief', 1)");
    const store = new Store(db);
    store.recordIp(1, '203.0.113.1', now - 40 * DAY);
    store.recordIp(1, '203.0.113.2', now - 5 * DAY); // purges nothing yet that matters; the first call already ran the purge at its own time
    store.purgeConnectionData(now - 30 * DAY);
    const log = (db.prepare('SELECT action, actor_ip, detail FROM audit_log ORDER BY id').all() as object[]).map((r) => ({ ...r }));
    assert.deepEqual(log, [
      { action: 'old', actor_ip: null, detail: 'd' },
      { action: 'young', actor_ip: '203.0.113.2', detail: 'd' },
    ]);
    assert.deepEqual((db.prepare('SELECT ip FROM account_ips').all() as { ip: string }[]).map((r) => r.ip), ['203.0.113.2']);
    assert.throws(() => db.exec('DELETE FROM audit_log'), /append-only/);
    assert.throws(() => db.exec("UPDATE audit_log SET actor_ip = '198.51.100.1'"), /append-only/);
    assert.throws(() => db.exec("UPDATE audit_log SET action = 'x'"), /append-only/);
    db.close();
    openDatabase(file).close(); // a second open is safe
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
