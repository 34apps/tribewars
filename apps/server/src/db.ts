// SQLite (node:sqlite) connection and schema.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_CHIEFTAIN, STAT_KEYS, type StatKey } from '@clanfire/engine';

/** SQL column of a stat counter: camelCase key to snake_case. Only ever fed constants from STAT_KEYS. */
export const statColumn = (k: StatKey): string => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

// ---- Tables with a CHECK that grew after release -----------------------------------------------------------
// SQLite cannot alter a CHECK, so `rebuildOutdatedTables` copies older databases into the new shape (see applySchema).

/** kind: attack / scout / support / shipment go out; return comes home. For every kind `origin_village_id` is the army's home. */
const movementsTable = (name: string): string => `CREATE TABLE IF NOT EXISTS ${name} (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  kind              TEXT    NOT NULL CHECK (kind IN ('attack', 'scout', 'support', 'return', 'shipment')),
  origin_village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  target_village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  units_json        TEXT    NOT NULL,
  loot_json         TEXT,
  depart_at         INTEGER NOT NULL,
  arrive_at         INTEGER NOT NULL,
  ranks_json        TEXT
);`;

/** battle_json holds the report body of any type; its `type` key (absent = battle) tells which. */
const reportsTable = (name: string): string => `CREATE TABLE IF NOT EXISTS ${name} (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  side        TEXT    NOT NULL CHECK (side IN ('attack', 'defense', 'support', 'shipment')),
  won         INTEGER NOT NULL,
  title       TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  read        INTEGER NOT NULL DEFAULT 0,
  battle_json TEXT    NOT NULL
);`;

const REBUILDS = [
  {
    table: 'movements',
    marker: "'shipment'",
    create: movementsTable,
    columns: 'id, kind, origin_village_id, target_village_id, units_json, loot_json, depart_at, arrive_at',
  },
  {
    table: 'reports',
    marker: "'shipment')",
    create: reportsTable,
    columns: 'id, player_id, side, won, title, created_at, read, battle_json',
  },
] as const;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT    NOT NULL,
  username_lower  TEXT    NOT NULL UNIQUE,
  password_hash   TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  protected_until INTEGER NOT NULL DEFAULT 0,
  chieftain       TEXT    NOT NULL DEFAULT 'old-orm',
  premium         INTEGER NOT NULL DEFAULT 0,
  household_shared INTEGER NOT NULL DEFAULT 0,
  banned_at       INTEGER,
  ban_reason      TEXT,
  -- Last authenticated API request (written at most every few minutes). Drives the caretaker bot.
  last_active     INTEGER,
  -- Villages lost to abandonment (idle too long) that the player has not yet been told about; 0 = nothing to show.
  abandoned_notice INTEGER NOT NULL DEFAULT 0
);

-- Every IP an account registered or signed in from (multi-account detection). Raw IPs: needed to review and ban;
-- rows go with the account (cascade).
CREATE TABLE IF NOT EXISTS player_ips (
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  ip         TEXT    NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  PRIMARY KEY (player_id, ip)
);
CREATE INDEX IF NOT EXISTS idx_player_ips_ip ON player_ips(ip);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_player  ON sessions(player_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS villages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id   INTEGER REFERENCES players(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  x          INTEGER NOT NULL,
  y          INTEGER NOT NULL,
  points     INTEGER NOT NULL DEFAULT 0,
  state_json TEXT    NOT NULL,
  -- Earliest time the caretaker bot may act on this village again (0 = any time). Only used while the owner is idle.
  bot_next_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE (x, y)
);
CREATE INDEX IF NOT EXISTS idx_villages_owner ON villages(owner_id);

${movementsTable('movements')}
CREATE INDEX IF NOT EXISTS idx_movements_arrive ON movements(arrive_at, id);
CREATE INDEX IF NOT EXISTS idx_movements_origin ON movements(origin_village_id);
CREATE INDEX IF NOT EXISTS idx_movements_target ON movements(target_village_id);

${reportsTable('reports')}
CREATE INDEX IF NOT EXISTS idx_reports_player ON reports(player_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_unread ON reports(player_id) WHERE read = 0;

-- ---- Support troops (docs/GAME_DESIGN.md section 12). One contingent per (home, host) pair; new arrivals merge.
-- The units stay in the owner's home village "away" count while stationed.
CREATE TABLE IF NOT EXISTS stationed (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  home_village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  host_village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  units_json      TEXT    NOT NULL,
  arrived_at      INTEGER NOT NULL,
  ranks_json      TEXT,
  UNIQUE (home_village_id, host_village_id)
);
CREATE INDEX IF NOT EXISTS idx_stationed_host ON stationed(host_village_id);
CREATE INDEX IF NOT EXISTS idx_stationed_home ON stationed(home_village_id);

-- ---- Tribes (docs/GAME_DESIGN.md section 11). All CREATE IF NOT EXISTS: older databases upgrade in place.
-- Deleting a tribe cascades to everything that hangs off it (members, invites, applications, proposals,
-- relations, events, chat).

CREATE TABLE IF NOT EXISTS tribes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  name_lower  TEXT    NOT NULL UNIQUE,
  tag         TEXT    NOT NULL UNIQUE,
  description TEXT    NOT NULL DEFAULT '',
  recruitment TEXT    NOT NULL CHECK (recruitment IN ('open', 'application', 'invite')),
  created_at  INTEGER NOT NULL
);

-- player_id is the primary key: a player is in at most one tribe.
CREATE TABLE IF NOT EXISTS tribe_members (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  tribe_id  INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  role      TEXT    NOT NULL CHECK (role IN ('leader', 'officer', 'member')),
  joined_at INTEGER NOT NULL,
  -- Individual rights the leader granted on top of the role: a JSON array of TRIBE_GRANTABLE names.
  grants    TEXT    NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_tribe_members_tribe ON tribe_members(tribe_id);
-- At most one leader per tribe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tribe_members_leader ON tribe_members(tribe_id) WHERE role = 'leader';

CREATE TABLE IF NOT EXISTS tribe_invites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tribe_id   INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  invited_by INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (tribe_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_tribe_invites_player  ON tribe_invites(player_id);
CREATE INDEX IF NOT EXISTS idx_tribe_invites_expires ON tribe_invites(expires_at);

CREATE TABLE IF NOT EXISTS tribe_applications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tribe_id   INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  message    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (tribe_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_tribe_applications_player ON tribe_applications(player_id);

-- Pending ally / NAP proposals. One per unordered pair of tribes.
CREATE TABLE IF NOT EXISTS tribe_proposals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT    NOT NULL CHECK (kind IN ('ally', 'nap')),
  from_tribe_id INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  to_tribe_id   INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  CHECK (from_tribe_id <> to_tribe_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tribe_proposals_pair
  ON tribe_proposals (MIN(from_tribe_id, to_tribe_id), MAX(from_tribe_id, to_tribe_id));
CREATE INDEX IF NOT EXISTS idx_tribe_proposals_from ON tribe_proposals(from_tribe_id);
CREATE INDEX IF NOT EXISTS idx_tribe_proposals_to   ON tribe_proposals(to_tribe_id);

-- One row per unordered pair (tribe_a < tribe_b). declared_by is the declaring tribe for 'enemy' only.
-- ends_at is set while a cancelled ally/NAP serves its notice; at that time the row stops counting
-- and is deleted lazily.
CREATE TABLE IF NOT EXISTS tribe_relations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tribe_a     INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  tribe_b     INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('ally', 'nap', 'enemy')),
  declared_by INTEGER REFERENCES tribes(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  ends_at     INTEGER,
  CHECK (tribe_a < tribe_b),
  UNIQUE (tribe_a, tribe_b)
);
CREATE INDEX IF NOT EXISTS idx_tribe_relations_b    ON tribe_relations(tribe_b);
CREATE INDEX IF NOT EXISTS idx_tribe_relations_ends ON tribe_relations(ends_at) WHERE ends_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS tribe_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tribe_id   INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  text       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tribe_events_tribe ON tribe_events(tribe_id, id);

CREATE TABLE IF NOT EXISTS tribe_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tribe_id   INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  text       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tribe_messages_tribe ON tribe_messages(tribe_id, id);

-- ---- Tribe forum (section 11). Everything cascades with the tribe; authors' posts stay when they leave the tribe.
CREATE TABLE IF NOT EXISTS forum_boards (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tribe_id   INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  visibility TEXT    NOT NULL CHECK (visibility IN ('members', 'leadership')),
  post_rule  TEXT    NOT NULL DEFAULT 'members' CHECK (post_rule IN ('members', 'leadership')),
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forum_boards_tribe ON forum_boards(tribe_id, position);

CREATE TABLE IF NOT EXISTS forum_threads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id     INTEGER NOT NULL REFERENCES forum_boards(id) ON DELETE CASCADE,
  tribe_id     INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  author_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  title        TEXT    NOT NULL,
  pinned       INTEGER NOT NULL DEFAULT 0,
  locked       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  last_post_at INTEGER NOT NULL,
  post_count   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_forum_threads_board ON forum_threads(board_id, pinned, last_post_at);

CREATE TABLE IF NOT EXISTS forum_posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id  INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  edited_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_forum_posts_thread ON forum_posts(thread_id, id);

-- Per-member read marker: a thread is unread when its last post is newer than this (or than the join time).
CREATE TABLE IF NOT EXISTS forum_reads (
  player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  thread_id    INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  last_read_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, thread_id)
);

-- ---- Mail: player-to-player messages (plain text). Each side hides its own copy; the row goes when both did.
CREATE TABLE IF NOT EXISTS mail (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  from_player          INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  to_player            INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  subject              TEXT    NOT NULL,
  body                 TEXT    NOT NULL,
  created_at           INTEGER NOT NULL,
  read_at              INTEGER,
  deleted_by_sender    INTEGER NOT NULL DEFAULT 0,
  deleted_by_recipient INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mail_to     ON mail(to_player, created_at);
CREATE INDEX IF NOT EXISTS idx_mail_from   ON mail(from_player, created_at);
CREATE INDEX IF NOT EXISTS idx_mail_unread ON mail(to_player) WHERE read_at IS NULL AND deleted_by_recipient = 0;

-- ---- Advisor (Mags, AI tips): one row per question sent to the model. Doubles as the rolling-hour rate limit
-- (rows with ok = 1) and the token-usage log. Never stores the question or the answer.
CREATE TABLE IF NOT EXISTS advisor_log (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id          INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  asked_at           INTEGER NOT NULL,
  model              TEXT    NOT NULL,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  ok                 INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_advisor_log_player ON advisor_log(player_id, asked_at);

-- ---- Player statistics (docs/GAME_DESIGN.md section 16): lifetime counters, one INTEGER column per STAT_KEYS entry.
CREATE TABLE IF NOT EXISTS player_stats (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
${STAT_KEYS.map((k) => `  ${statColumn(k)} INTEGER NOT NULL DEFAULT 0`).join(',\n')}
);
`;

/**
 * Bring an older database up to the current shape: rebuild tables whose CHECK constraint grew, then create
 * whatever is missing. Safe to run on every start.
 */
export function applySchema(db: DatabaseSync): void {
  rebuildOutdatedTables(db);
  db.exec(SCHEMA);
  addMissingColumns(db);
}

/** Columns added after release: SQLite has no ADD COLUMN IF NOT EXISTS, so check the table first. */
function addMissingColumns(db: DatabaseSync): void {
  const cols = db.prepare('PRAGMA table_info(players)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'chieftain')) {
    db.exec(`ALTER TABLE players ADD COLUMN chieftain TEXT NOT NULL DEFAULT '${DEFAULT_CHIEFTAIN}'`);
  }
  if (!cols.some((c) => c.name === 'premium')) {
    db.exec('ALTER TABLE players ADD COLUMN premium INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'household_shared')) db.exec('ALTER TABLE players ADD COLUMN household_shared INTEGER NOT NULL DEFAULT 0');
  if (!cols.some((c) => c.name === 'banned_at')) db.exec('ALTER TABLE players ADD COLUMN banned_at INTEGER');
  if (!cols.some((c) => c.name === 'ban_reason')) db.exec('ALTER TABLE players ADD COLUMN ban_reason TEXT');
  // Existing players count as "just active" at upgrade time, so nobody is treated as idle the moment this ships.
  if (!cols.some((c) => c.name === 'last_active')) {
    db.exec('ALTER TABLE players ADD COLUMN last_active INTEGER');
    db.prepare('UPDATE players SET last_active = ?').run(Date.now());
  }
  if (!cols.some((c) => c.name === 'abandoned_notice')) db.exec('ALTER TABLE players ADD COLUMN abandoned_notice INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS idx_players_last_active ON players(last_active)');
  const villageCols = db.prepare('PRAGMA table_info(villages)').all() as Array<{ name: string }>;
  if (!villageCols.some((c) => c.name === 'bot_next_at')) db.exec('ALTER TABLE villages ADD COLUMN bot_next_at INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS idx_villages_bot ON villages(bot_next_at) WHERE owner_id IS NOT NULL');
  const members = db.prepare('PRAGMA table_info(tribe_members)').all() as Array<{ name: string }>;
  if (!members.some((c) => c.name === 'grants')) db.exec("ALTER TABLE tribe_members ADD COLUMN grants TEXT NOT NULL DEFAULT '[]'");
  // Home-village unit ranks stamped when troops leave (section 15). Null = no ranks (older rows).
  for (const table of ['movements', 'stationed']) {
    const t = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!t.some((c) => c.name === 'ranks_json')) db.exec(`ALTER TABLE ${table} ADD COLUMN ranks_json TEXT`);
  }
}

/**
 * Databases created before scouts, support and support reports have `CHECK`s that refuse the new values.
 * SQLite cannot change a CHECK, so copy the rows into a table with the new definition (ids kept) and swap.
 */
function rebuildOutdatedTables(db: DatabaseSync): void {
  for (const { table, marker, create, columns } of REBUILDS) {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string } | undefined;
    if (!row || row.sql.includes(marker)) continue;
    const seq = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table) as { seq: number } | undefined;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(create(`${table}_new`));
      db.exec(`INSERT INTO ${table}_new (${columns}) SELECT ${columns} FROM ${table}`);
      db.exec(`DROP TABLE ${table}`); // its indexes go with it; SCHEMA re-creates them
      db.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`);
      if (seq) {
        // Keep ids from being reused after the swap (the copy only knows the highest surviving id).
        const done = db.prepare('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?').run(seq.seq, table);
        if (Number(done.changes) === 0) db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(table, seq.seq);
      }
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // The transaction may already be gone; the original error matters more.
      }
      throw err;
    }
  }
}

/** Open (creating the folder and schema if needed) the game database. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') {
    path = resolve(path);
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  applySchema(db);
  return db;
}
