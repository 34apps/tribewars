// Operator tool (run on the server machine, not exposed over HTTP):
//   npm run lobby:admin -- keygen | public-key | worlds | world-add <id> <name...> | world-status <id> <status> | ...
// Status is open | full | closed | finished (finished = the world ended by domination: set it with world-status).
// See ADMIN_USAGE in admin-ops.ts. Reads DATABASE_PATH like the lobby; needs no LOBBY_SIGNING_KEY except for `public-key`.

import type { DatabaseSync } from 'node:sqlite';
import { runAdminAsync } from './admin-ops.ts';
import { openDatabase } from './db.ts';
import { databasePathOf, loadDotEnv } from './env.ts';
import { lobbyHooks } from './hooks-config.ts';
import { StripeGateway } from './shop/gateway.ts';
import { Store } from './store.ts';

loadDotEnv();
const handle: { db: DatabaseSync | null } = { db: null };
const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
const code = await runAdminAsync(process.argv.slice(2), {
  openStore: () => {
    handle.db = openDatabase(databasePathOf());
    return new Store(handle.db);
  },
  env: process.env,
  now: Date.now,
  hooks: lobbyHooks,
  gateway: stripeKey ? new StripeGateway({ secretKey: stripeKey }) : null,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
handle.db?.close();
process.exitCode = code;
