import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { backupDatabase } from '../src/backup.ts';

const dir = mkdtempSync(join(tmpdir(), 'clanfire-backup-'));
after(() => rmSync(dir, { recursive: true, force: true }));

describe('backupDatabase', () => {
  it('writes a readable copy with the data and prunes to the newest N', () => {
    const dbPath = join(dir, 'game.sqlite');
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1), (2), (3);');
    const out = join(dir, 'backups');
    writeFileSync(join(dir, 'unrelated.txt'), 'x');

    const paths: string[] = [];
    for (let i = 0; i < 4; i++) paths.push(backupDatabase(dbPath, out, 2, new Date(Date.UTC(2026, 10, 4, 3, 0, i))));
    db.close();

    assert.match(paths[0]!, /clanfire-20261104-030000\.sqlite$/);
    const left = readdirSync(out).sort();
    assert.deepEqual(left, ['clanfire-20261104-030002.sqlite', 'clanfire-20261104-030003.sqlite']);
    assert.ok(existsSync(paths[3]!));
    const copy = new DatabaseSync(paths[3]!, { readOnly: true });
    assert.equal((copy.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }).c, 3);
    copy.close();
  });
});
