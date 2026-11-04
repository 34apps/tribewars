// Consistent SQLite copies (VACUUM INTO + quick_check), shared by the backup CLI and the one-time import.
// Kept apart from backup.ts because that file runs itself when it is the entry point of a bundle.

import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** UTC timestamp `YYYYMMDD-HHMMSS`. */
export function stamp(now: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(now.getUTCFullYear(), 4)}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
}

/** First free name: `<base>.sqlite`, then `<base>-2.sqlite`, ... (VACUUM INTO refuses to overwrite). */
export function freeTarget(dir: string, base: string): string {
  for (let n = 1; ; n += 1) {
    const candidate = resolve(dir, n === 1 ? `${base}.sqlite` : `${base}-${n}.sqlite`);
    if (!existsSync(candidate)) return candidate;
  }
}

/** Write a consistent, compact copy of the open database to `target` and verify it. Deletes the copy and throws when it is bad. */
export function vacuumCopy(src: DatabaseSync, target: string): void {
  if (existsSync(target)) throw new Error(`Backup target ${target} already exists; not overwriting.`);
  try {
    src.prepare('VACUUM INTO ?').run(target);
  } catch (err) {
    rmSync(target, { force: true });
    throw err;
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
}
