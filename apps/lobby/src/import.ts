// One-time import of an existing world's accounts into the lobby:
//   npm run lobby:import -- <path to the world's .sqlite> [--world-name-ignored]
// Backs up both databases first, then links every world player to a lobby account (see import-world.ts).
// Reads DATABASE_PATH (the lobby database) and BACKUP_DIR like the lobby; needs no LOBBY_SIGNING_KEY.
// Exit codes: 0 done, 1 error (nothing changed), 2 done but some names conflict (listed in the report).

import { dirname, resolve } from 'node:path';
import { databasePathOf, loadDotEnv } from './env.ts';
import { formatReport, importWorld } from './import-world.ts';

try {
  loadDotEnv();
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a.startsWith('--') && a !== '--world-name-ignored');
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length !== 1 || unknown.length > 0) {
    throw new Error('Usage: lobby:import <path to the world .sqlite file>');
  }
  const worldDbPath = resolve(files[0] as string);
  const report = importWorld({
    lobbyDbPath: databasePathOf(),
    worldDbPath,
    backupDirLobby: process.env.BACKUP_DIR?.trim() || './data/backups',
    backupDirWorld: resolve(dirname(worldDbPath), 'backups'),
    now: Date.now(),
  });
  for (const line of formatReport(report)) console.log(line);
  process.exitCode = report.conflicts.length > 0 ? 2 : 0;
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
