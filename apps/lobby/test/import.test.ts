import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createPlayerVillage, villagePoints, type EnterWorldResponse, type LobbyMeResponse } from '@clanfire/engine';
// Server code is imported in tests only, to build a realistic world database.
import { hashPassword as worldHashPassword } from '../../server/src/auth.ts';
import { openDatabase as openWorldDatabase } from '../../server/src/db.ts';
import { Store as WorldStore } from '../../server/src/store.ts';
import { buildApp } from '../src/app.ts';
import { openDatabase as openLobbyDatabase } from '../src/db.ts';
import { ImportError, formatReport, importWorld, type ImportOptions } from '../src/import-world.ts';
import { Store } from '../src/store.ts';
import { Client, KEY, PUBLIC_KEY, errorOf, ok } from './helpers.ts';
import { verifyPass } from '../src/pass.ts';

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const LOBBY_DIR = resolve(import.meta.dirname, '..');

interface Fixture {
  dir: string;
  worldPath: string;
  lobbyPath: string;
  opts: ImportOptions;
}

interface WorldPlayerSpec {
  name: string;
  password: string;
  chieftain?: string;
  banned?: string;
  staff?: 'support' | 'moderator' | 'admin';
  createdAt?: number;
}

const PLAYERS: WorldPlayerSpec[] = [
  { name: 'Alice', password: 'alice password 1', createdAt: 1_000 },
  { name: 'Bob_Banned', password: 'bob password 22', chieftain: 'ysra', banned: 'cheating', createdAt: 2_000 },
  { name: 'Carol', password: 'carol password 3', staff: 'moderator', createdAt: 3_000 },
];

async function makeWorld(path: string, players: WorldPlayerSpec[]): Promise<void> {
  mkdirSync(join(path, '..'), { recursive: true });
  const db = openWorldDatabase(path);
  const store = new WorldStore(db);
  let x = 0;
  for (const p of players) {
    const t = p.createdAt ?? NOW;
    const id = store.insertPlayer(p.name, await worldHashPassword(p.password), t, 0, p.chieftain);
    const state = createPlayerVillage(t);
    store.insertVillage(id, `${p.name}'s village`, x++, 0, villagePoints(state), state);
    if (p.banned) store.banPlayer(id, p.banned, t + 1);
    if (p.staff) store.staff.setStaffRole(id, p.staff);
  }
  db.close();
}

async function fixture(players: WorldPlayerSpec[] = PLAYERS): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-import-'));
  const worldPath = join(dir, 'world', 'clanfire.sqlite');
  const lobbyPath = join(dir, 'lobby', 'lobby.sqlite');
  await makeWorld(worldPath, players);
  return {
    dir,
    worldPath,
    lobbyPath,
    opts: { lobbyDbPath: lobbyPath, worldDbPath: worldPath, backupDirLobby: join(dir, 'lobby-backups'), backupDirWorld: join(dir, 'world', 'backups'), now: NOW },
  };
}

async function withFixture(players: WorldPlayerSpec[] | undefined, fn: (f: Fixture) => Promise<void> | void): Promise<void> {
  const f = await fixture(players);
  try {
    await fn(f);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
}

function query<T>(path: string, sql: string): T[] {
  const db = new DatabaseSync(path);
  try {
    return db.prepare(sql).all() as T[];
  } finally {
    db.close();
  }
}

const worldPlayers = (f: Fixture) => query<{ id: number; username: string; password_hash: string; account_id: number | null }>(f.worldPath, 'SELECT id, username, password_hash, account_id FROM players ORDER BY id');
const lobbyAccounts = (f: Fixture) => query<Record<string, unknown>>(f.lobbyPath, 'SELECT * FROM accounts ORDER BY id');
const count = (path: string, table: string): number => Number(query<{ n: number }>(path, `SELECT COUNT(*) AS n FROM ${table}`)[0]?.n);

/** Make the world database look like one from before lobby accounts existed. */
function dropAccountColumn(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec('DROP INDEX IF EXISTS idx_players_account');
    const cols = (db.prepare('PRAGMA table_info(players)').all() as { name: string }[]).map((c) => c.name);
    if (cols.includes('account_id')) db.exec('ALTER TABLE players DROP COLUMN account_id');
  } finally {
    db.close();
  }
}

test('import: every world player becomes a lobby account with the same name, hash and attributes', async () => {
  await withFixture(undefined, async (f) => {
    dropAccountColumn(f.worldPath);
    const before = query<{ id: number; username: string; password_hash: string }>(f.worldPath, 'SELECT id, username, password_hash FROM players ORDER BY id').map((p) => [p.id, p.username, p.password_hash]);
    const villagesBefore = count(f.worldPath, 'villages');

    const r = importWorld(f.opts);
    assert.deepEqual({ created: r.created, linked: r.linked, alreadyLinked: r.alreadyLinked, conflicts: r.conflicts.length, before: r.playersBefore, after: r.playersAfter, added: r.addedColumn }, { created: 3, linked: 0, alreadyLinked: 0, conflicts: 0, before: 3, after: 3, added: true });

    // World: column and unique index added, links written, nothing else changed.
    const after = worldPlayers(f);
    assert.deepEqual(after.map((p) => [p.id, p.username, p.password_hash]), before, 'names and password hashes untouched');
    assert.equal(count(f.worldPath, 'villages'), villagesBefore);
    assert.equal(count(f.worldPath, 'players'), 3);
    const ids = after.map((p) => p.account_id);
    assert.ok(ids.every((id) => typeof id === 'number'));
    assert.equal(new Set(ids).size, 3, 'account ids are unique');
    const index = query<{ name: string; sql: string }>(f.worldPath, "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_players_account'");
    assert.match(index[0]?.sql ?? '', /UNIQUE INDEX idx_players_account ON players\(account_id\)/);

    // Lobby: same names (original case), same hashes, attributes copied.
    const accounts = lobbyAccounts(f);
    assert.equal(accounts.length, 3);
    for (const [i, spec] of PLAYERS.entries()) {
      const a = accounts[i];
      const p = after[i];
      assert.ok(a && p);
      assert.equal(a.id, p.account_id);
      assert.equal(a.username, spec.name);
      assert.equal(a.username_lower, spec.name.toLowerCase());
      assert.equal(a.password_hash, p.password_hash);
      assert.equal(a.created_at, spec.createdAt);
      assert.equal(a.chieftain, spec.chieftain ?? 'old-orm');
      assert.equal(a.banned_at, spec.banned ? (spec.createdAt ?? 0) + 1 : null);
      assert.equal(a.ban_reason, spec.banned ?? null);
      assert.equal(a.staff_role, spec.staff ?? null);
    }
    const audit = query<{ action: string; actor_ip: string; actor_id: number | null }>(f.lobbyPath, 'SELECT action, actor_ip, actor_id FROM audit_log');
    assert.equal(audit.length, 3);
    assert.ok(audit.every((a) => a.action === 'import_create' && a.actor_ip === 'cli' && a.actor_id === null));
  });
});

test('import: running it twice changes nothing', async () => {
  await withFixture(undefined, async (f) => {
    importWorld(f.opts);
    const worldA = worldPlayers(f);
    const lobbyA = lobbyAccounts(f);
    const auditA = count(f.lobbyPath, 'audit_log');

    const again = importWorld({ ...f.opts, now: NOW + 5_000 });
    assert.deepEqual({ created: again.created, linked: again.linked, alreadyLinked: again.alreadyLinked, conflicts: again.conflicts.length, added: again.addedColumn }, { created: 0, linked: 0, alreadyLinked: 3, conflicts: 0, added: false });
    assert.deepEqual(worldPlayers(f), worldA);
    assert.deepEqual(lobbyAccounts(f), lobbyA);
    assert.equal(count(f.lobbyPath, 'audit_log'), auditA);
    assert.ok(formatReport(again).some((l) => /Already linked \(skipped\): 3/.test(l)));
  });
});

test('import: the world password still logs in at the lobby, bans and staff carry over', async () => {
  await withFixture(undefined, async (f) => {
    importWorld(f.opts);
    const app = await buildApp({ dbPath: f.lobbyPath, signingKey: KEY.privateKey, now: () => NOW, secureCookies: false });
    try {
      app.ctx.store.insertWorld({ id: 'w1', name: 'World 1', status: 'open', path: '/w/w1/', createdAt: 0 });
      const alice = new Client(app);
      const res = await alice.post('/lobby/api/auth/login', { username: 'alice', password: PLAYERS[0]?.password });
      ok(res);
      assert.equal(res.json<LobbyMeResponse>().account?.username, 'Alice');
      errorOf(await new Client(app).post('/lobby/api/auth/login', { username: 'alice', password: 'wrong password' }), 401, 'unauthorized');

      // The banned player is refused (after the right password).
      errorOf(await new Client(app).post('/lobby/api/auth/login', { username: 'Bob_Banned', password: PLAYERS[1]?.password }), 403, 'forbidden');

      // The moderator keeps the role; the pass carries it and the account id the world has stored.
      const carol = new Client(app);
      ok(await carol.post('/lobby/api/auth/login', { username: 'Carol', password: PLAYERS[2]?.password }));
      const entered = await carol.post('/lobby/api/worlds/w1/enter', {});
      ok(entered);
      const claims = verifyPass(entered.json<EnterWorldResponse>().pass, [PUBLIC_KEY], NOW);
      assert.equal(claims.role, 'moderator');
      assert.equal(claims.name, 'Carol');
      assert.equal(claims.aid, worldPlayers(f)[2]?.account_id);

      // Changing the lobby password is not possible here, but the old world hash format is what verifies: same scrypt format.
      assert.match(lobbyAccounts(f)[0]?.password_hash as string, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    } finally {
      await app.close();
    }
  });
});

test('import: both databases are backed up first, and the backups are the state before the import', async () => {
  await withFixture(undefined, async (f) => {
    dropAccountColumn(f.worldPath);
    // The lobby already has an unrelated account, so its backup is not empty.
    const lobby = openLobbyDatabase(f.lobbyPath);
    new Store(lobby).insertAccount({ username: 'Existing', passwordHash: await worldHashPassword('existing password'), chieftain: 'old-orm', createdAt: 5 });
    lobby.close();

    const r = importWorld(f.opts);
    assert.ok(existsSync(r.backups.world) && existsSync(r.backups.lobby));
    assert.match(r.backups.world, /world[\\/]backups[\\/]pre-import-20261104-120000-clanfire\.sqlite$/);
    assert.match(r.backups.lobby, /lobby-backups[\\/]pre-import-20261104-120000-lobby\.sqlite$/);

    // World backup: readable, same players, and still no account_id column (the state before).
    const wb = query<{ name: string }>(r.backups.world, 'PRAGMA table_info(players)').map((c) => c.name);
    assert.ok(!wb.includes('account_id'));
    assert.equal(count(r.backups.world, 'players'), 3);
    assert.equal(count(r.backups.world, 'villages'), 3);
    assert.equal(query<{ quick_check: string }>(r.backups.world, 'PRAGMA quick_check')[0]?.quick_check, 'ok');
    // Lobby backup: only the account that existed before.
    assert.deepEqual(query<{ username: string }>(r.backups.lobby, 'SELECT username FROM accounts').map((a) => a.username), ['Existing']);
    assert.equal(query<{ quick_check: string }>(r.backups.lobby, 'PRAGMA quick_check')[0]?.quick_check, 'ok');
    assert.equal(count(f.lobbyPath, 'accounts'), 4);

    // A second run in the same second gets its own backup names instead of overwriting.
    const again = importWorld(f.opts);
    assert.notEqual(again.backups.world, r.backups.world);
    assert.notEqual(again.backups.lobby, r.backups.lobby);
    assert.equal(readdirSync(join(f.dir, 'world', 'backups')).filter((n) => n.startsWith('pre-import-')).length, 2);
  });
});

test('import: a new, empty lobby database is backed up too', async () => {
  await withFixture(undefined, (f) => {
    assert.ok(!existsSync(f.lobbyPath));
    const r = importWorld(f.opts);
    assert.equal(count(r.backups.lobby, 'accounts'), 0);
    assert.equal(count(f.lobbyPath, 'accounts'), 3);
  });
});

test('import: a world database without account_id gets the column and a unique index', async () => {
  await withFixture(undefined, (f) => {
    dropAccountColumn(f.worldPath);
    assert.ok(!query<{ name: string }>(f.worldPath, 'PRAGMA table_info(players)').some((c) => c.name === 'account_id'));
    const r = importWorld(f.opts);
    assert.equal(r.addedColumn, true);
    assert.ok(query<{ name: string }>(f.worldPath, 'PRAGMA table_info(players)').some((c) => c.name === 'account_id'));
    // The unique index is real: two players cannot share an account.
    const db = new DatabaseSync(f.worldPath);
    try {
      assert.throws(() => db.exec('UPDATE players SET account_id = 1 WHERE id IN (1, 2)'), /UNIQUE/);
    } finally {
      db.close();
    }
  });
});

test('import: a name conflict is reported and left untouched; the rest goes through', async () => {
  const players: WorldPlayerSpec[] = [...PLAYERS, { name: 'Dave', password: 'dave password 44' }];
  await withFixture(players, async (f) => {
    // Another person called alice already has a lobby account with another password.
    const lobby = openLobbyDatabase(f.lobbyPath);
    const otherHash = await worldHashPassword('someone else entirely');
    new Store(lobby).insertAccount({ username: 'ALICE', passwordHash: otherHash, chieftain: 'ysra', createdAt: 7 });
    lobby.close();
    const lobbyBefore = lobbyAccounts(f)[0];

    const r = importWorld(f.opts);
    assert.deepEqual(r.conflicts, [{ playerId: 1, username: 'Alice' }]);
    assert.deepEqual({ created: r.created, linked: r.linked }, { created: 3, linked: 0 });
    assert.equal(r.playersBefore, 4);
    assert.equal(r.playersAfter, 4);

    // The conflicting world player and the existing lobby account are both untouched.
    const wp = worldPlayers(f);
    assert.equal(wp[0]?.username, 'Alice');
    assert.equal(wp[0]?.account_id, null);
    assert.ok(wp.slice(1).every((p) => typeof p.account_id === 'number'));
    assert.deepEqual(lobbyAccounts(f)[0], lobbyBefore);
    assert.equal(count(f.lobbyPath, 'accounts'), 4);

    const report = formatReport(r).join('\n');
    assert.match(report, /CONFLICT player #1 "Alice"/);
    assert.match(report, /Name conflicts: 1/);

    // Running again changes nothing and reports the same conflict.
    const again = importWorld({ ...f.opts, now: NOW + 1000 });
    assert.deepEqual(again.conflicts, r.conflicts);
    assert.deepEqual({ created: again.created, alreadyLinked: again.alreadyLinked }, { created: 0, alreadyLinked: 3 });
    assert.equal(count(f.lobbyPath, 'accounts'), 4);
  });
});

test('import: a re-run after a crash (lobby written, world not) links by name and hash', async () => {
  await withFixture(undefined, (f) => {
    importWorld(f.opts);
    const linked = worldPlayers(f).map((p) => p.account_id);
    // Undo the world side only, as if the process died between the two transactions.
    const db = new DatabaseSync(f.worldPath);
    db.exec('UPDATE players SET account_id = NULL');
    db.close();

    const r = importWorld({ ...f.opts, now: NOW + 1000 });
    assert.deepEqual({ created: r.created, linked: r.linked, alreadyLinked: r.alreadyLinked, conflicts: r.conflicts.length }, { created: 0, linked: 3, alreadyLinked: 0, conflicts: 0 });
    assert.deepEqual(worldPlayers(f).map((p) => p.account_id), linked, 'the same accounts as before');
    assert.equal(count(f.lobbyPath, 'accounts'), 3);
  });
});

test('import: a second world with the same person (same hash) links instead of duplicating', async () => {
  await withFixture(undefined, async (f) => {
    importWorld(f.opts);
    const other = join(f.dir, 'world2', 'clanfire.sqlite');
    // Same hash as world 1's Alice (the same account, imported from a copy of the world), plus a stranger.
    await makeWorld(other, [{ name: 'Erin', password: 'erin password 5' }]);
    const w1Hash = worldPlayers(f)[0]?.password_hash as string;
    const db = new DatabaseSync(other);
    db.prepare("UPDATE players SET username = 'alice', username_lower = 'alice', password_hash = ?").run(w1Hash);
    db.close();
    const r = importWorld({ ...f.opts, worldDbPath: other, backupDirWorld: join(f.dir, 'world2', 'backups') });
    assert.deepEqual({ created: r.created, linked: r.linked, conflicts: r.conflicts.length }, { created: 0, linked: 1, conflicts: 0 });
    assert.equal(count(f.lobbyPath, 'accounts'), 3);
    assert.equal(query<{ account_id: number }>(other, 'SELECT account_id FROM players')[0]?.account_id, worldPlayers(f)[0]?.account_id);
  });
});

test('import: refuses a missing file, a non-SQLite file, a foreign database and identical paths, without any backup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-import-bad-'));
  try {
    const opts = (worldDbPath: string, lobbyDbPath = join(dir, 'lobby.sqlite')): ImportOptions => ({ lobbyDbPath, worldDbPath, backupDirLobby: join(dir, 'lb'), backupDirWorld: join(dir, 'wb'), now: NOW });
    assert.throws(() => importWorld(opts(join(dir, 'missing.sqlite'))), (e: Error) => e instanceof ImportError && /not found/.test(e.message));
    assert.throws(() => importWorld(opts(dir)), ImportError); // a directory

    const text = join(dir, 'text.sqlite');
    writeFileSync(text, 'this is certainly not a database, just some text that is long enough');
    assert.throws(() => importWorld(opts(text)), (e: Error) => e instanceof ImportError && /not a SQLite database/.test(e.message));

    const foreign = join(dir, 'foreign.sqlite');
    const f = new DatabaseSync(foreign);
    f.exec('CREATE TABLE other (x INTEGER); INSERT INTO other VALUES (1)');
    f.close();
    assert.throws(() => importWorld(opts(foreign)), (e: Error) => e instanceof ImportError && /not a Clanfire world database/.test(e.message));
    assert.throws(() => importWorld(opts(foreign, foreign)), (e: Error) => e instanceof ImportError && /same file/.test(e.message));

    assert.ok(!existsSync(join(dir, 'lb')) && !existsSync(join(dir, 'wb')), 'no backup folders were created');
    assert.ok(!existsSync(join(dir, 'lobby.sqlite')), 'the lobby database was not created');
    assert.equal(count(foreign, 'other'), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('import: an invalid chieftain or staff role in an old database falls back safely', async () => {
  await withFixture([{ name: 'Frank', password: 'frank password 6' }], (f) => {
    const db = new DatabaseSync(f.worldPath);
    db.exec("PRAGMA foreign_keys = OFF; UPDATE players SET chieftain = 'not-a-chieftain'");
    db.close();
    const r = importWorld(f.opts);
    assert.equal(r.created, 1);
    assert.equal(lobbyAccounts(f)[0]?.chieftain, 'old-orm');
    assert.equal(lobbyAccounts(f)[0]?.staff_role, null);
  });
});

test('import CLI: exit 0 on success, 2 with conflicts, 1 on errors; report on stdout', async () => {
  await withFixture([...PLAYERS], async (f) => {
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ['--import', 'tsx', 'src/import.ts', ...args], {
        cwd: LOBBY_DIR,
        encoding: 'utf8',
        env: { ...process.env, DATABASE_PATH: f.lobbyPath, BACKUP_DIR: join(f.dir, 'lobby-backups'), NODE_ENV: 'test', LOBBY_SIGNING_KEY: '' },
      });

    const bad = run(join(f.dir, 'nope.sqlite'));
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /not found/);
    assert.equal(run().status, 1);
    assert.equal(run(f.worldPath, '--surprise').status, 1);

    // A conflicting name first.
    const lobby = openLobbyDatabase(f.lobbyPath);
    new Store(lobby).insertAccount({ username: 'alice', passwordHash: await worldHashPassword('different one'), chieftain: 'old-orm', createdAt: 1 });
    lobby.close();
    const conflict = run(f.worldPath, '--world-name-ignored');
    assert.equal(conflict.status, 2, conflict.stderr);
    assert.match(conflict.stdout, /CONFLICT player #1 "Alice"/);
    assert.match(conflict.stdout, /Lobby accounts created: 2/);
    assert.ok(readdirSync(join(f.dir, 'world', 'backups')).some((n) => /^pre-import-\d{8}-\d{6}-clanfire\.sqlite$/.test(n)));
    assert.ok(readdirSync(join(f.dir, 'lobby-backups')).some((n) => /^pre-import-\d{8}-\d{6}-lobby\.sqlite$/.test(n)));
  });

  // Without conflicts the exit code is 0.
  await withFixture([...PLAYERS], (f) => {
    const ok0 = spawnSync(process.execPath, ['--import', 'tsx', 'src/import.ts', f.worldPath], {
      cwd: LOBBY_DIR,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_PATH: f.lobbyPath, BACKUP_DIR: join(f.dir, 'lobby-backups'), NODE_ENV: 'test' },
    });
    assert.equal(ok0.status, 0, ok0.stderr);
    assert.match(ok0.stdout, /Lobby accounts created: 3/);
    assert.match(ok0.stdout, /Players in the world database: 3 before, 3 after\./);
  });
});
