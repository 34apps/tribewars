// Operator tool (run on the server machine, not exposed over HTTP):
//   npm run admin -w @clanfire/server -- shared-ips
//   npm run admin -w @clanfire/server -- ban <username> [reason...]
//   npm run admin -w @clanfire/server -- unban <username>
// Reads DATABASE_PATH like the server. Banning ends the account's sessions and blocks sign-in.

import { loadDotEnv, loadEnv } from './env.ts';
import { openDatabase } from './db.ts';
import { Store } from './store.ts';

loadDotEnv();
const env = loadEnv();
const [cmd, name, ...rest] = process.argv.slice(2);
const db = openDatabase(env.databasePath);
const store = new Store(db);

function player(username: string | undefined) {
  const p = username ? store.getPlayerByLowerName(username.toLowerCase()) : null;
  if (!p) {
    console.error(`No such player: ${username ?? '(missing)'}`);
    process.exit(1);
  }
  return p;
}

if (cmd === 'shared-ips') {
  const groups = store.sharedIpGroups();
  if (groups.length === 0) console.log('No IP is shared by two or more accounts.');
  for (const g of groups) {
    console.log(`${g.ip}: ${g.players.map((p) => `${p.username}${p.householdShared ? ' (reported household)' : ''}${p.bannedAt ? ' (banned)' : ''}`).join(', ')}`);
  }
} else if (cmd === 'ban') {
  const p = player(name);
  store.banPlayer(p.id, rest.join(' ') || 'multi-account', Date.now());
  console.log(`Banned ${p.username}.`);
} else if (cmd === 'unban') {
  const p = player(name);
  store.unbanPlayer(p.id);
  console.log(`Unbanned ${p.username}.`);
} else {
  console.error('Usage: admin shared-ips | ban <username> [reason] | unban <username>');
  process.exitCode = 1;
}
db.close();
