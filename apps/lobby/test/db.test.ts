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
