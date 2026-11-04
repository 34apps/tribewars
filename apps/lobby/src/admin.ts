// Operator tool (run on the server machine, not exposed over HTTP):
//   npm run lobby:admin -- keygen | public-key | worlds | world-add <id> <name...> | world-status <id> <status> | ...
// See ADMIN_USAGE in admin-ops.ts. Reads DATABASE_PATH like the lobby; needs no LOBBY_SIGNING_KEY except for `public-key`.

import type { DatabaseSync } from 'node:sqlite';
import { runAdmin } from './admin-ops.ts';
import { openDatabase } from './db.ts';
import { databasePathOf, loadDotEnv } from './env.ts';
import { Store } from './store.ts';

loadDotEnv();
const handle: { db: DatabaseSync | null } = { db: null };
const code = runAdmin(process.argv.slice(2), {
  openStore: () => {
    handle.db = openDatabase(databasePathOf());
    return new Store(handle.db);
  },
  env: process.env,
  now: Date.now,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
handle.db?.close();
process.exitCode = code;
