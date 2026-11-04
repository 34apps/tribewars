// Database backup CLI. Runs as its own process so the lobby's event loop is never blocked:
//   npm run backup -w @clanfire/lobby     (dev)     |     node dist/backup.js     (production)
// VACUUM INTO writes a consistent, compact copy while the lobby keeps running (WAL mode). Needs no signing key.

import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { databasePathOf, loadDotEnv } from './env.ts';
import { stamp, vacuumCopy } from './snapshot.ts';

const BACKUP_NAME = /^clanfire-lobby-\d{8}-\d{6}\.sqlite$/;

/** Copies the database to `<outDir>/clanfire-lobby-YYYYMMDD-HHMMSS.sqlite` (UTC), verifies it, prunes to the newest `keep`. Returns the path. */
export function backupDatabase(dbPath: string, outDir: string, keep: number, now: Date = new Date()): string {
  mkdirSync(outDir, { recursive: true });
  const target = resolve(outDir, `clanfire-lobby-${stamp(now)}.sqlite`);
  const src = new DatabaseSync(dbPath);
  try {
    src.exec('PRAGMA busy_timeout = 10000');
    vacuumCopy(src, target);
  } finally {
    src.close();
  }
  const files = readdirSync(outDir).filter((f) => BACKUP_NAME.test(f)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - Math.max(1, keep)))) rmSync(resolve(outDir, old), { force: true });
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    loadDotEnv();
    const keepRaw = process.env.BACKUP_KEEP?.trim();
    const keep = keepRaw ? Number(keepRaw) : 7;
    if (!Number.isInteger(keep) || keep < 1) throw new Error(`Invalid BACKUP_KEEP="${keepRaw}": expected an integer >= 1.`);
    console.log(backupDatabase(databasePathOf(), process.env.BACKUP_DIR?.trim() || './data/backups', keep));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
