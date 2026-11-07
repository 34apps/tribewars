// The operator commands of the lobby (run on the server machine, never over HTTP). admin.ts is the thin entry point;
// everything lives here so tests can call it. Every change goes to the audit log (actor: none, ip: 'cli').

import { BADGE_KINDS, BADGE_TOP_PLAYERS, STAFF_ROLES, WORLD_STATUSES, isBadgeKind, isStaffRole, isWorldStatus } from '@clanfire/engine';
import { formatFinishReport, finishWorld } from './finish-world.ts';
import { generateKeyPair, keyIdOf, parseSigningKey, publicKeyBase64 } from './pass.ts';
import type { AccountRow, Store } from './store.ts';
import { checkWorldId, checkWorldName, checkWorldPath, defaultWorldPath } from './worlds.ts';

export interface AdminDeps {
  /** Opens the database; only called by commands that need it (keygen and public-key work without one). */
  openStore: () => Store;
  env: Record<string, string | undefined>;
  now: () => number;
  out: (line: string) => void;
  err: (line: string) => void;
}

export const ADMIN_USAGE = [
  'Usage: admin <command>',
  '  keygen                                   print a new LOBBY_SIGNING_KEY / LOBBY_PUBLIC_KEY pair',
  '  public-key                               print the public key of the LOBBY_SIGNING_KEY in the environment',
  '  worlds                                   list the worlds',
  '  world-add <id> <name...> [--path=/w/<id>/] [--status=open|full|closed|finished]',
  '  world-status <id> <open|full|closed|finished>',
  '  world-rename <id> <name...>',
  '  world-remove <id>',
  '  world-finish <worldId> <world db path>   after a world ended: copy its badges to accounts, add it to the Hall of Fame, set status finished',
  '  badge-grant <username> <worldId> <badge> [place]   badge = champion|second_tribe|third_tribe|top10|veteran (place 1-10 only for top10)',
  '  badge-revoke <username> <worldId> <badge>',
  '  shared-ips                               IPs used by two or more accounts',
  '  ban <username> [reason...]               suspend an account and end its sessions',
  '  unban <username>',
  '  grant <username> <support|moderator|admin>',
  '  revoke <username>',
];

/** A mistake by the operator: printed, exit code 1. */
class CliError extends Error {}

function splitFlags(args: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (const a of args) {
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq < 3) throw new CliError(`Flags look like --name=value, got "${a}".`);
    flags.set(a.slice(2, eq), a.slice(eq + 1));
  }
  return { positional, flags };
}

function mustWorld(store: Store, id: string | undefined) {
  const w = id ? store.getWorld(id) : null;
  if (!w) throw new CliError(`No such world: ${id ?? '(missing)'}`);
  return w;
}

function mustAccount(store: Store, username: string | undefined): AccountRow {
  const a = username ? store.getAccountByLowerName(username.toLowerCase()) : null;
  if (!a) throw new CliError(`No such account: ${username ?? '(missing)'}`);
  return a;
}

/** Runs one command and returns the process exit code (0 = ok). */
export function runAdmin(argv: string[], deps: AdminDeps): number {
  const [cmd, ...args] = argv;
  const { out } = deps;
  try {
    if (cmd === 'keygen') {
      const k = generateKeyPair();
      out(`LOBBY_SIGNING_KEY=${k.privateKeyBase64}`);
      out(`LOBBY_PUBLIC_KEY=${k.publicKeyBase64}`);
      deps.err('Keep LOBBY_SIGNING_KEY secret: it only belongs in the lobby\'s environment. Never commit it, paste it into chat or give it to a world. Worlds get LOBBY_PUBLIC_KEY only.');
      return 0;
    }
    if (cmd === 'public-key') {
      const raw = deps.env.LOBBY_SIGNING_KEY?.trim();
      if (!raw) throw new CliError('LOBBY_SIGNING_KEY is not set.');
      const key = parseSigningKey(raw);
      out(`LOBBY_PUBLIC_KEY=${publicKeyBase64(key)}`);
      deps.err(`key id: ${keyIdOf(key)}`);
      return 0;
    }
    if (!cmd || !ADMIN_COMMANDS.has(cmd)) {
      for (const l of ADMIN_USAGE) deps.err(l);
      return 1;
    }

    const store = deps.openStore();
    const at = deps.now();
    const log = (action: string, target: number | null, detail = ''): void => store.audit({ at, actorId: null, actorIp: 'cli', action, targetAccount: target, detail });
    // Only world-add takes flags; elsewhere every word is text (a ban reason may contain "--").
    const { positional, flags } = cmd === 'world-add' ? splitFlags(args) : { positional: args, flags: new Map<string, string>() };

    switch (cmd) {
      case 'worlds': {
        const worlds = store.listWorlds();
        if (worlds.length === 0) out('No worlds yet. Add one with: world-add <id> <name>');
        for (const w of worlds) out(`${w.id}  ${w.status.padEnd(8)}  ${w.path}  ${w.name}`);
        return 0;
      }
      case 'world-add': {
        const [rawId, ...nameParts] = positional;
        if (!rawId) throw new CliError('Usage: world-add <id> <name...> [--path=/w/<id>/] [--status=open|full|closed|finished]');
        for (const f of flags.keys()) if (f !== 'path' && f !== 'status') throw new CliError(`Unknown flag --${f}.`);
        const id = checkWorldId(rawId);
        const name = checkWorldName(nameParts.join(' '));
        const path = checkWorldPath(flags.get('path') ?? defaultWorldPath(id));
        const status = flags.get('status') ?? 'open';
        if (!isWorldStatus(status)) throw new CliError(`Status must be one of: ${WORLD_STATUSES.join(', ')}`);
        if (store.getWorld(id)) throw new CliError(`World ${id} already exists.`);
        store.insertWorld({ id, name, status, path, createdAt: at });
        log('world_add', null, `${id} ${status} ${path}`);
        out(`Added world ${id} (${name}), ${status}, ${path}`);
        return 0;
      }
      case 'world-status': {
        const w = mustWorld(store, positional[0]);
        const status = positional[1];
        if (!isWorldStatus(status)) throw new CliError(`Status must be one of: ${WORLD_STATUSES.join(', ')}`);
        store.setWorldStatus(w.id, status);
        log('world_status', null, `${w.id} ${w.status} -> ${status}`);
        out(`World ${w.id} is now ${status}.`);
        return 0;
      }
      case 'world-rename': {
        const w = mustWorld(store, positional[0]);
        const name = checkWorldName(positional.slice(1).join(' '));
        store.renameWorld(w.id, name);
        log('world_rename', null, `${w.id} ${name}`);
        out(`World ${w.id} is now called ${name}.`);
        return 0;
      }
      case 'world-remove': {
        const w = mustWorld(store, positional[0]);
        store.removeWorld(w.id);
        log('world_remove', null, w.id);
        out(`Removed world ${w.id} from the list. The world's own data was not touched.`);
        return 0;
      }
      case 'world-finish': {
        const w = mustWorld(store, positional[0]);
        const dbPath = positional[1];
        if (!dbPath) throw new CliError('Usage: world-finish <worldId> <world db path>');
        const report = finishWorld({ store, worldId: w.id, worldDbPath: dbPath, backupDir: deps.env.BACKUP_DIR?.trim() || './data/backups', now: at });
        for (const l of formatFinishReport(w.id, report)) out(l);
        return 0;
      }
      case 'badge-grant': {
        const a = mustAccount(store, positional[0]);
        const w = mustWorld(store, positional[1]);
        const badge = positional[2];
        if (!isBadgeKind(badge)) throw new CliError(`Badge must be one of: ${BADGE_KINDS.join(', ')}`);
        let place: number | null = null;
        if (badge === 'top10') {
          place = positional[3] !== undefined && /^\d{1,2}$/.test(positional[3]) ? Number(positional[3]) : NaN;
          if (!Number.isInteger(place) || place < 1 || place > BADGE_TOP_PLAYERS) throw new CliError(`top10 needs a place from 1 to ${BADGE_TOP_PLAYERS}.`);
        } else if (positional.length > 3) throw new CliError('Only top10 takes a place.');
        const endedAt = store.listHallOfFame(1000).find((h) => h.worldId === w.id)?.endedAt ?? at;
        const added = store.tx(() => {
          const ok = store.insertAccountBadge(a.id, w.id, badge, place, endedAt);
          if (ok) log('badge_grant', a.id, `${w.id} ${badge}${place === null ? '' : ` #${place}`}`);
          return ok;
        });
        if (!added) throw new CliError(`${a.username} already has ${badge} from ${w.id}. Revoke it first to change it.`);
        out(`${a.username} got ${badge}${place === null ? '' : ` #${place}`} from ${w.id}.`);
        return 0;
      }
      case 'badge-revoke': {
        const a = mustAccount(store, positional[0]);
        const worldId = positional[1] ?? '';
        const badge = positional[2];
        if (!isBadgeKind(badge)) throw new CliError(`Badge must be one of: ${BADGE_KINDS.join(', ')}`);
        const removed = store.tx(() => {
          const ok = store.deleteAccountBadge(a.id, worldId, badge);
          if (ok) log('badge_revoke', a.id, `${worldId} ${badge}`);
          return ok;
        });
        if (!removed) throw new CliError(`${a.username} has no ${badge} from ${worldId}.`);
        out(`Removed ${badge} of ${worldId} from ${a.username}.`);
        return 0;
      }
      case 'shared-ips': {
        const groups = store.sharedIpGroups();
        if (groups.length === 0) out('No IP is shared by two or more accounts.');
        for (const g of groups) out(`${g.ip}: ${g.accounts.map((a) => `${a.username}${a.bannedAt ? ' (banned)' : ''}`).join(', ')}`);
        return 0;
      }
      case 'ban': {
        const a = mustAccount(store, positional[0]);
        const reason = positional.slice(1).join(' ').slice(0, 200) || 'multi-account';
        store.tx(() => {
          store.banAccount(a.id, reason, at);
          log('ban', a.id, reason);
        });
        out(`Banned ${a.username}.`);
        return 0;
      }
      case 'unban': {
        const a = mustAccount(store, positional[0]);
        store.tx(() => {
          store.unbanAccount(a.id);
          log('unban', a.id);
        });
        out(`Unbanned ${a.username}.`);
        return 0;
      }
      case 'grant': {
        const a = mustAccount(store, positional[0]);
        const role = positional[1];
        if (!isStaffRole(role)) throw new CliError(`Role must be one of: ${STAFF_ROLES.join(', ')}`);
        store.tx(() => {
          store.setStaffRole(a.id, role);
          log('role_grant', a.id, role);
        });
        out(`${a.username} is now ${role}.`);
        return 0;
      }
      case 'revoke': {
        const a = mustAccount(store, positional[0]);
        store.tx(() => {
          store.setStaffRole(a.id, null);
          log('role_revoke', a.id, a.staffRole ?? '');
        });
        out(`${a.username} is no longer staff.`);
        return 0;
      }
    }
    return 1;
  } catch (err) {
    deps.err(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const ADMIN_COMMANDS: ReadonlySet<string> = new Set(['worlds', 'world-add', 'world-status', 'world-rename', 'world-remove', 'world-finish', 'badge-grant', 'badge-revoke', 'shared-ips', 'ban', 'unban', 'grant', 'revoke']);
