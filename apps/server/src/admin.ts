// Operator tool (run on the server machine, not exposed over HTTP):
//   npm run admin -w @clanfire/server -- shared-ips                         (accounts sharing an IP, then the groups by IP + device with a risk line)
//   npm run admin -w @clanfire/server -- multi <username>                    (one player's links: IPs, devices, groups, what happened between the members)
//   npm run admin -w @clanfire/server -- ban <username> [reason...]
//   npm run admin -w @clanfire/server -- unban <username>
//   npm run admin -w @clanfire/server -- grant <username> <support|moderator|admin>
//   npm run admin -w @clanfire/server -- revoke <username>
//   npm run admin -w @clanfire/server -- mute <username> <minutes> [reason...]
//   npm run admin -w @clanfire/server -- unmute <username>
//   npm run admin -w @clanfire/server -- domination                          (status of the win condition)
//   npm run admin -w @clanfire/server -- domination-set <key> <value>        (minAgeDays, minActivePlayers, minPeakShare, winShare, streakDays, activeDays)
//   npm run admin -w @clanfire/server -- world-end [tribeTag|-] [reason...]  (end the world by hand; optional winner)
//   npm run admin -w @clanfire/server -- world-extend <days>                 (postpone domination by adding days to minAgeDays)
//   npm run admin -w @clanfire/server -- config                              (list every per-world setting and whether the world is open)
//   npm run admin -w @clanfire/server -- config-set <path> <value>           (e.g. conquest.holdHours 4; after opening only tribe.maxMembers, features.scavenging, features.paidSpeedups, domination.*)
//   npm run admin -w @clanfire/server -- extra <username> raidlists on|off   (paid extra: raid lists; switches one bit of players.premium, keeps the others;
//                                                                            works only where the world setting features.raidLists is on;
//                                                                            `premium` = 5 build slots + auto mode, needs features.premium; `off` also stops auto mode)
//   npm run admin -w @clanfire/server -- delete-player <username>           (support: delete the player's account in this world, like the player's own deletion: villages abandoned,
//                                                                            tribe left, private data erased, name shown as "Deleted player <id>"; audited, cannot be undone;
//                                                                            in a lobby world delete the lobby account too, or the player can come back as a new player)
//   npm run admin -w @clanfire/server -- world-open                          (mark the world open by hand; it also opens with the first player)
// Reads DATABASE_PATH like the server. Banning ends the account's sessions and blocks sign-in.
// Staff roles can only be granted here, never over HTTP. Every change is written to the audit log (actor: the CLI).
// The domination and world-end commands live in domination-admin.ts, the config commands in world-config-admin.ts; a running server
// picks their changes up without a restart (the config on its next request or 1 s tick).
// This is the WORLD's operator tool: it works on the database named by DATABASE_PATH (one world). `npm run lobby:admin` is the
// lobby's own CLI with a separate database (accounts, world list) and cannot reach any world database, so per-world settings are changed here.

import { EXTRA_PREMIUM_TOOLS, EXTRA_RAID_LISTS, EXTRA_WIDE_OVERVIEW, MUTE_MAX_MINUTES, STAFF_ROLES, hasPremiumToolsExtra, hasRaidListsExtra, hasWideOverviewExtra, isStaffRole } from '@clanfire/engine';
import { loadDotEnv, loadEnv } from './env.ts';
import { openDatabase } from './db.ts';
import { AccountDataService } from './account-data-service.ts';
import { DOMINATION_USAGE, isDominationCommand, runDominationCommand } from './domination-admin.ts';
import { GameService } from './game.ts';
import { MultiService } from './multi-service.ts';
import { TribeService } from './tribe-service.ts';
import { initWorld } from './world.ts';
import { Store } from './store.ts';
import { WORLD_CONFIG_USAGE, isWorldConfigCommand, runWorldConfigCommand } from './world-config-admin.ts';

loadDotEnv();
const env = loadEnv();
const [cmd, name, ...rest] = process.argv.slice(2);
const db = openDatabase(env.databasePath);
const store = new Store(db);
const multi = new MultiService(store);

function player(username: string | undefined) {
  const p = username ? store.getPlayerByLowerName(username.toLowerCase()) : null;
  if (!p) {
    console.error(`No such player: ${username ?? '(missing)'}`);
    process.exit(1);
  }
  return p;
}

const log = (action: string, targetPlayer: number, detail = ''): void => store.audit({ at: Date.now(), actorId: null, actorIp: 'cli', action, targetPlayer, detail });

const stamp = (t: number): string => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
function printGroup(g: ReturnType<MultiService['groups']>['groups'][number]): void {
  console.log(`[${g.risk.level.toUpperCase()}${g.reviewed ? ', reviewed' : ''}] ${g.members.map((m) => `${m.username}${m.householdShared ? ' (household declared)' : ''}${m.bannedAt ? ' (banned)' : ''}`).join(', ')}`);
  console.log(`  ${g.risk.text}`);
  for (const l of g.links) console.log(`  ${l.label}: ${l.seen.map((r) => `${g.members.find((m) => m.id === r.playerId)?.username ?? r.playerId} ${stamp(r.firstSeen)}..${stamp(r.lastSeen)}`).join(' | ')}`);
}

if (cmd === 'shared-ips') {
  const groups = store.sharedIpGroups();
  if (groups.length === 0) console.log('No IP is shared by two or more accounts.');
  for (const g of groups) {
    console.log(`${g.ip}: ${g.players.map((p) => `${p.username}${p.householdShared ? ' (reported household)' : ''}${p.bannedAt ? ' (banned)' : ''}`).join(', ')}`);
  }
  // Groups by IP and by device (last 30 days), with the risk line the staff page shows.
  const all = multi.groups(Date.now(), true).groups;
  console.log(all.length === 0 ? '\nNo group by IP or device in the last 30 days.' : '\nGroups (IP and device, last 30 days):');
  for (const g of all) printGroup(g);
} else if (cmd === 'multi') {
  const p = player(name);
  console.log(`${p.username}: ${p.householdShared ? 'declared a shared household' : 'no household declared'}${p.bannedAt ? ', banned' : ''}`);
  for (const ip of store.staff.ipsOf(p.id)) console.log(`  IP ${ip.ip}: first ${stamp(ip.firstSeen)}, last ${stamp(ip.lastSeen)}`);
  for (const d of store.multi.devicesOf(p.id)) console.log(`  device ${d.hash.slice(0, 8)}: first ${stamp(d.firstSeen)}, last ${stamp(d.lastSeen)}`);
  const groups = multi.groupsOf(p.id, Date.now());
  if (groups.length === 0) console.log('  Not in any group.');
  for (const g of groups) printGroup(g);
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
} else if (cmd === 'extra') {
  // Paid extras are bits of players.premium. When a shop exists the lobby should carry the extra in the signed entry pass; until then the operator sets it here.
  const p = player(name);
  const [extra, state] = rest;
  if ((extra !== 'raidlists' && extra !== 'overview' && extra !== 'premium') || (state !== 'on' && state !== 'off')) {
    console.error('Usage: extra <username> raidlists|overview|premium on|off');
    process.exitCode = 1;
  } else {
    store.setPremiumBit(p.id, extra === 'overview' ? EXTRA_WIDE_OVERVIEW : extra === 'premium' ? EXTRA_PREMIUM_TOOLS : EXTRA_RAID_LISTS, state === 'on');
    log('extra_set', p.id, `${extra} ${state}`);
    const now = store.getPlayer(p.id);
    if (extra === 'premium' && state === 'off') {
      // The tools end: auto mode stops in every village of the player (settings kept; queued jobs carry on).
      const n = store.switchAutoOff(p.id);
      if (n > 0) console.log(`Auto mode switched off in ${n} village(s).`);
    }
    console.log(
      `${p.username}: ${
        extra === 'overview'
          ? `wide overview ${hasWideOverviewExtra(now?.premium ?? 0) ? 'on' : 'off'}`
          : extra === 'premium'
            ? `premium tools ${hasPremiumToolsExtra(now?.premium ?? 0) ? 'on' : 'off'}`
            : `raid lists ${hasRaidListsExtra(now?.premium ?? 0) ? 'on' : 'off'}`
      }.`,
    );
  }
} else if (cmd === 'delete-player') {
  // Same code path as the player's own deletion. The services are built here (no HTTP); a running server sees the result on its next request.
  const p = player(name);
  const settings = initWorld(store, {}, Date.now(), (msg) => console.warn(msg));
  const game = new GameService(store, settings, undefined, Date.now);
  const accounts = new AccountDataService(store, game, new TribeService(store, settings), env.worldId, Date.now);
  if (accounts.deletePlayer(p.id, Date.now(), { via: 'cli', actorId: null, actorIp: 'cli' })) console.log(`Deleted the account of player ${p.id} in this world (villages abandoned, private data erased).`);
  else console.log(`Player ${p.id} was already deleted.`);
} else if (cmd === 'unmute') {
  const p = player(name);
  store.staff.clearMute(p.id);
  log('unmute', p.id);
  console.log(`Unmuted ${p.username}.`);
} else if (isDominationCommand(cmd)) {
  store.sandboxUsers = new Set(env.sandboxUsers.map((u) => u.toLowerCase())); // test accounts do not count as active players
  const result = runDominationCommand(store, cmd, [name, ...rest].filter((w): w is string => w !== undefined), Date.now());
  for (const line of result.lines) (result.ok ? console.log : console.error)(line);
  if (!result.ok) process.exitCode = 1;
} else if (isWorldConfigCommand(cmd)) {
  const result = runWorldConfigCommand(store, cmd, [name, ...rest].filter((w): w is string => w !== undefined), Date.now());
  for (const line of result.lines) (result.ok ? console.log : console.error)(line);
  if (!result.ok) process.exitCode = 1;
} else {
  console.error(
    `Usage: admin shared-ips | multi <username> | ban <username> [reason] | unban <username> | grant <username> <role> | revoke <username> | mute <username> <minutes> [reason] | unmute <username> | extra <username> raidlists|overview|premium on|off | delete-player <username> | ${DOMINATION_USAGE} | ${WORLD_CONFIG_USAGE}`,
  );
  process.exitCode = 1;
}
db.close();
