// Operator tool (run on the server machine, not exposed over HTTP):
//   npm run admin -w @clanfire/server -- shared-ips
//   npm run admin -w @clanfire/server -- ban <username> [reason...]
//   npm run admin -w @clanfire/server -- unban <username>
//   npm run admin -w @clanfire/server -- grant <username> <support|moderator|admin>
//   npm run admin -w @clanfire/server -- revoke <username>
//   npm run admin -w @clanfire/server -- mute <username> <minutes> [reason...]
//   npm run admin -w @clanfire/server -- unmute <username>
// Reads DATABASE_PATH like the server. Banning ends the account's sessions and blocks sign-in.
// Staff roles can only be granted here, never over HTTP. Every change is written to the audit log (actor: the CLI).

import { MUTE_MAX_MINUTES, STAFF_ROLES, isStaffRole } from '@clanfire/engine';
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

const log = (action: string, targetPlayer: number, detail = ''): void => store.audit({ at: Date.now(), actorId: null, actorIp: 'cli', action, targetPlayer, detail });

if (cmd === 'shared-ips') {
  const groups = store.sharedIpGroups();
  if (groups.length === 0) console.log('No IP is shared by two or more accounts.');
  for (const g of groups) {
    console.log(`${g.ip}: ${g.players.map((p) => `${p.username}${p.householdShared ? ' (reported household)' : ''}${p.bannedAt ? ' (banned)' : ''}`).join(', ')}`);
  }
} else if (cmd === 'ban') {
  const p = player(name);
  const reason = rest.join(' ') || 'multi-account';
  store.banPlayer(p.id, reason, Date.now());
  log('ban', p.id, reason);
  console.log(`Banned ${p.username}.`);
} else if (cmd === 'unban') {
  const p = player(name);
  store.unbanPlayer(p.id);
  log('unban', p.id);
  console.log(`Unbanned ${p.username}.`);
} else if (cmd === 'grant') {
  const p = player(name);
  const role = rest[0];
  if (!isStaffRole(role)) {
    console.error(`Role must be one of: ${STAFF_ROLES.join(', ')}`);
    process.exitCode = 1;
  } else {
    store.staff.setStaffRole(p.id, role);
    log('role_grant', p.id, role);
    console.log(`${p.username} is now ${role}.`);
  }
} else if (cmd === 'revoke') {
  const p = player(name);
  store.staff.setStaffRole(p.id, null);
  log('role_revoke', p.id, p.staffRole ?? '');
  console.log(`${p.username} is no longer staff.`);
} else if (cmd === 'mute') {
  const p = player(name);
  const minutes = Number(rest[0]);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MUTE_MAX_MINUTES) {
    console.error(`Minutes must be a whole number from 1 to ${MUTE_MAX_MINUTES}.`);
    process.exitCode = 1;
  } else {
    const reason = rest.slice(1).join(' ') || 'muted by operator';
    store.staff.setMute(p.id, Date.now() + minutes * 60_000, reason);
    log('mute', p.id, `${minutes} min: ${reason}`);
    console.log(`Muted ${p.username} for ${minutes} minutes.`);
  }
} else if (cmd === 'unmute') {
  const p = player(name);
  store.staff.clearMute(p.id);
  log('unmute', p.id);
  console.log(`Unmuted ${p.username}.`);
} else {
  console.error('Usage: admin shared-ips | ban <username> [reason] | unban <username> | grant <username> <role> | revoke <username> | mute <username> <minutes> [reason] | unmute <username>');
  process.exitCode = 1;
}
db.close();
