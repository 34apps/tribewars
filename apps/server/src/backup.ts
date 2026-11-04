// Database backup CLI. Runs as its own process so the game's event loop is never blocked:
//   npm run backup -w @clanfire/server     (dev)     |     node dist/backup.js     (production)
// VACUUM INTO writes a consistent, compact copy while the game keeps running (WAL mode).

import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadDotEnv, loadEnv } from './env.ts';

const BACKUP_NAME = /^clanfire-\d{8}-\d{6}\.sqlite$/;

function stamp(now: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(now.getUTCFullYear(), 4)}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
}

/** Copies the database to `<outDir>/clanfire-YYYYMMDD-HHMMSS.sqlite` (UTC), verifies it, prunes to the newest `keep`. Returns the path. */
export function backupDatabase(dbPath: string, outDir: string, keep: number, now: Date = new Date()): string {
  mkdirSync(outDir, { recursive: true });
  const target = resolve(outDir, `clanfire-${stamp(now)}.sqlite`);
  const src = new DatabaseSync(dbPath);
  try {
    src.exec('PRAGMA busy_timeout = 10000');
    src.prepare('VACUUM INTO ?').run(target);
  } catch (err) {
    rmSync(target, { force: true });
    throw err;
  } finally {
    src.close();
  }
  const copy = new DatabaseSync(target, { readOnly: true });
  let result: unknown;
  try {
    result = (copy.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined)?.quick_check;
  } finally {
    copy.close();
  }
  if (result !== 'ok') {
    rmSync(target, { force: true });
    throw new Error(`Backup failed its integrity check (${String(result)}); copy deleted.`);
  }
  const files = readdirSync(outDir).filter((f) => BACKUP_NAME.test(f)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - Math.max(1, keep)))) rmSync(resolve(outDir, old), { force: true });
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    loadDotEnv();
    const env = loadEnv();
    const keepRaw = process.env.BACKUP_KEEP?.trim();
    const keep = keepRaw ? Number(keepRaw) : 7;
    if (!Number.isInteger(keep) || keep < 1) throw new Error(`Invalid BACKUP_KEEP="${keepRaw}": expected an integer >= 1.`);
    console.log(backupDatabase(env.databasePath, process.env.BACKUP_DIR?.trim() || './data/backups', keep));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
