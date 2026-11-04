// One-time import of an existing world's players into the lobby (docs/MULTI_WORLD.md, part 2).
//
// Every world player without `players.account_id` gets (or is linked to) a lobby account with the same name and the
// same password hash, and the world's `account_id` column is filled in. Nothing else in the world is touched; password
// hashes are copied, never rewritten or deleted. Safe to run again: players that already have an account_id are skipped,
// and a half-finished run (lobby written, world not) is completed by linking accounts whose hash matches.

import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_CHIEFTAIN, isChieftainId, isStaffRole, type StaffRole } from '@clanfire/engine';
import { openDatabase } from './db.ts';
import { freeTarget, stamp, vacuumCopy } from './snapshot.ts';
import { Store } from './store.ts';

export class ImportError extends Error {}

export interface ImportOptions {
  lobbyDbPath: string;
  worldDbPath: string;
  /** Where the pre-import copy of the lobby database goes (created if needed). */
  backupDirLobby: string;
  /** Where the pre-import copy of the world database goes (created if needed). */
  backupDirWorld: string;
  /** Clock in ms since epoch. */
  now: number;
}

export interface ImportConflict {
  playerId: number;
  username: string;
}

export interface ImportReport {
  /** New lobby accounts made from world players. */
  created: number;
  /** World players linked to a lobby account that already had their name and password. */
  linked: number;
  /** Players that already had an account_id (skipped). */
  alreadyLinked: number;
  /** Same name, different password: another person in another world. Left untouched. */
  conflicts: ImportConflict[];
  playersBefore: number;
  playersAfter: number;
  /** The world database had no players.account_id column and got one. */
  addedColumn: boolean;
  backups: { lobby: string; world: string };
}

interface WorldPlayer {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: number;
  chieftain: string | null;
  bannedAt: number | null;
  banReason: string | null;
  staffRole: string | null;
  accountId: number | null;
}

const SQLITE_MAGIC = 'SQLite format 3\u0000';

function isSqliteFile(path: string): boolean {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(16);
    const n = readSync(fd, buf, 0, 16, 0);
    return n === 16 && buf.toString('latin1') === SQLITE_MAGIC;
  } finally {
    closeSync(fd);
  }
}

function columnsOf(db: DatabaseSync, table: string): Set<string> {
  // `table` is only ever a constant of this file.
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
}

const countPlayers = (db: DatabaseSync): number => Number((db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n);

function readPlayers(db: DatabaseSync, cols: Set<string>): WorldPlayer[] {
  // Optional columns: older databases may lack them. The names below are constants, never input.
  const opt = (c: string): string => (cols.has(c) ? c : `NULL AS ${c}`);
  const rows = db
    .prepare(`SELECT id, username, password_hash, created_at, ${opt('chieftain')}, ${opt('banned_at')}, ${opt('ban_reason')}, ${opt('staff_role')}, ${opt('account_id')} FROM players ORDER BY id`)
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    username: String(r.username),
    passwordHash: String(r.password_hash),
    createdAt: Number(r.created_at),
    chieftain: typeof r.chieftain === 'string' ? r.chieftain : null,
    bannedAt: r.banned_at === null || r.banned_at === undefined ? null : Number(r.banned_at),
    banReason: typeof r.ban_reason === 'string' ? r.ban_reason : null,
    staffRole: typeof r.staff_role === 'string' ? r.staff_role : null,
    accountId: r.account_id === null || r.account_id === undefined ? null : Number(r.account_id),
  }));
}

export function importWorld(o: ImportOptions): ImportReport {
  const worldPath = resolve(o.worldDbPath);
  const lobbyPath = resolve(o.lobbyDbPath);
  if (worldPath === lobbyPath) throw new ImportError('The world database and the lobby database are the same file.');
  // (a) refuse anything that is not an existing SQLite file
  if (!existsSync(worldPath) || !statSync(worldPath).isFile()) throw new ImportError(`World database not found: ${worldPath}`);
  if (!isSqliteFile(worldPath)) throw new ImportError(`${worldPath} is not a SQLite database.`);

  const date = new Date(o.now);
  const world = new DatabaseSync(worldPath);
  let lobby: DatabaseSync | null = null;
  try {
    world.exec('PRAGMA busy_timeout = 10000');
    const cols = columnsOf(world, 'players');
    for (const c of ['id', 'username', 'password_hash', 'created_at']) {
      if (!cols.has(c)) throw new ImportError(`${worldPath} is not a Clanfire world database (players.${c} is missing).`);
    }

    // (b) back up BOTH databases and verify the copies before anything is written
    mkdirSync(resolve(o.backupDirWorld), { recursive: true });
    mkdirSync(resolve(o.backupDirLobby), { recursive: true });
    const worldName = basename(worldPath).replace(/\.sqlite$/, '');
    const worldBackup = freeTarget(o.backupDirWorld, `pre-import-${stamp(date)}-${worldName}`);
    vacuumCopy(world, worldBackup);
    const lobbyBackupBase = `pre-import-${stamp(date)}-${basename(lobbyPath).replace(/\.sqlite$/, '')}`;
    let lobbyBackup: string | null = null;
    if (existsSync(lobbyPath)) {
      const raw = new DatabaseSync(lobbyPath);
      try {
        raw.exec('PRAGMA busy_timeout = 10000');
        lobbyBackup = freeTarget(o.backupDirLobby, lobbyBackupBase);
        vacuumCopy(raw, lobbyBackup);
      } finally {
        raw.close();
      }
    }
    lobby = openDatabase(lobbyPath); // creates the schema when the lobby database is new
    if (!lobbyBackup) {
      lobbyBackup = freeTarget(o.backupDirLobby, lobbyBackupBase);
      vacuumCopy(lobby, lobbyBackup);
    }
    const store = new Store(lobby);

    const playersBefore = countPlayers(world);
    const players = readPlayers(world, cols);
    const used = new Set<number>(players.flatMap((p) => (p.accountId === null ? [] : [p.accountId])));
    const alreadyLinked = players.filter((p) => p.accountId !== null).length;
    const todo = players.filter((p) => p.accountId === null);

    // (d) lobby writes, one transaction
    const pending: { playerId: number; accountId: number }[] = [];
    const conflicts: ImportConflict[] = [];
    let created = 0;
    let linked = 0;
    const origin = `world ${worldName}`;
    store.tx(() => {
      for (const p of todo) {
        const existing = store.getAccountByLowerName(p.username.toLowerCase());
        if (!existing) {
          const staffRole: StaffRole | null = isStaffRole(p.staffRole) ? p.staffRole : null;
          const id = store.insertAccount({
            username: p.username,
            passwordHash: p.passwordHash,
            chieftain: p.chieftain !== null && isChieftainId(p.chieftain) ? p.chieftain : DEFAULT_CHIEFTAIN,
            createdAt: p.createdAt,
            bannedAt: p.bannedAt,
            banReason: p.banReason,
            staffRole,
          });
          store.audit({ at: o.now, actorId: null, actorIp: 'cli', action: 'import_create', targetAccount: id, detail: `${origin} player ${p.id}` });
          used.add(id);
          pending.push({ playerId: p.id, accountId: id });
          created += 1;
        } else if (existing.passwordHash === p.passwordHash && !used.has(existing.id)) {
          // The same person: a re-run after a crash, or an account made from another world with this very hash.
          store.audit({ at: o.now, actorId: null, actorIp: 'cli', action: 'import_link', targetAccount: existing.id, detail: `${origin} player ${p.id}` });
          used.add(existing.id);
          pending.push({ playerId: p.id, accountId: existing.id });
          linked += 1;
        } else {
          conflicts.push({ playerId: p.id, username: p.username });
        }
      }
    });

    // (c)+(e) world writes, one transaction: the column, the unique index, the links
    let addedColumn = false;
    world.exec('BEGIN IMMEDIATE');
    try {
      if (!columnsOf(world, 'players').has('account_id')) {
        world.exec('ALTER TABLE players ADD COLUMN account_id INTEGER');
        addedColumn = true;
      }
      world.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_account ON players(account_id)');
      const link = world.prepare('UPDATE players SET account_id = ? WHERE id = ? AND account_id IS NULL');
      for (const { playerId, accountId } of pending) link.run(accountId, playerId);
      const playersAfter = countPlayers(world);
      if (playersAfter !== playersBefore) throw new ImportError(`Player count changed during the import (${playersBefore} -> ${playersAfter}); rolled back.`);
      world.exec('COMMIT');
      return { created, linked, alreadyLinked, conflicts, playersBefore, playersAfter, addedColumn, backups: { lobby: lobbyBackup, world: worldBackup } };
    } catch (err) {
      try {
        world.exec('ROLLBACK');
      } catch {
        // already gone; the original error matters more
      }
      throw err;
    }
  } finally {
    lobby?.close();
    world.close();
  }
}

/** Human-readable lines for the CLI. */
export function formatReport(r: ImportReport): string[] {
  const lines = [
    `Backups written first: world ${r.backups.world}`,
    `                       lobby ${r.backups.lobby}`,
    r.addedColumn ? 'Added players.account_id (and its unique index) to the world database.' : 'players.account_id already existed in the world database.',
    `Players in the world database: ${r.playersBefore} before, ${r.playersAfter} after.`,
    `Lobby accounts created: ${r.created}`,
    `Linked to an existing lobby account: ${r.linked}`,
    `Already linked (skipped): ${r.alreadyLinked}`,
    `Name conflicts: ${r.conflicts.length}`,
  ];
  for (const c of r.conflicts) {
    lines.push(`  CONFLICT player #${c.playerId} "${c.username}": a lobby account with this name has a different password. Not touched; sort this out by hand (rename one of them).`);
  }
  if (r.conflicts.length > 0) lines.push('Done with conflicts: those players have no lobby account yet (exit code 2).');
  return lines;
}
