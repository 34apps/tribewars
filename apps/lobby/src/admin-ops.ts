// The operator commands of the lobby (run on the server machine, never over HTTP). admin.ts is the thin entry point;
// everything lives here so tests can call it. Every change goes to the audit log (actor: none, ip: 'cli').

import { STAFF_ROLES, WORLD_STATUSES, isStaffRole, isWorldStatus } from '@clanfire/engine';
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
  '  world-add <id> <name...> [--path=/w/<id>/] [--status=open|full|closed]',
  '  world-status <id> <open|full|closed>',
  '  world-rename <id> <name...>',
  '  world-remove <id>',
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
        for (const w of worlds) out(`${w.id}  ${w.status.padEnd(6)}  ${w.path}  ${w.name}`);
        return 0;
      }
      case 'world-add': {
        const [rawId, ...nameParts] = positional;
        if (!rawId) throw new CliError('Usage: world-add <id> <name...> [--path=/w/<id>/] [--status=open|full|closed]');
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

const ADMIN_COMMANDS: ReadonlySet<string> = new Set(['worlds', 'world-add', 'world-status', 'world-rename', 'world-remove', 'shared-ips', 'ban', 'unban', 'grant', 'revoke']);
