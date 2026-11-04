// SQLite (node:sqlite) connection and schema.

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_CHIEFTAIN, STAT_KEYS, type StatKey } from '@clanfire/engine';
import { DEFAULT_TEMPLATES } from './template-defaults.ts';

/** SQL column of a stat counter: camelCase key to snake_case. Only ever fed constants from STAT_KEYS. */
export const statColumn = (k: StatKey): string => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

// ---- Tables with a CHECK that grew after release -----------------------------------------------------------
// SQLite cannot alter a CHECK, so `rebuildOutdatedTables` copies older databases into the new shape (see applySchema).

/**
 * kind: attack / scout / support / shipment / found / occupy go out; return comes home. For every kind `origin_village_id` is the
 * army's home. A `found` movement (and the return of a failed one) walks to a free tile, not to a village: `target_x`/`target_y`
 * hold the tile and `target_village_id` is the army's own home as a placeholder.
 */
const movementsTable = (name: string): string => `CREATE TABLE IF NOT EXISTS ${name} (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  kind              TEXT    NOT NULL CHECK (kind IN ('attack', 'scout', 'support', 'return', 'shipment', 'found', 'occupy')),
  origin_village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  target_village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  units_json        TEXT    NOT NULL,
  loot_json         TEXT,
  depart_at         INTEGER NOT NULL,
  arrive_at         INTEGER NOT NULL,
  ranks_json        TEXT,
  return_secs       INTEGER,
  target_x          INTEGER,
  target_y          INTEGER
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
    marker: "'occupy'",
    create: movementsTable,
    // Only the columns the old table has are copied (older ones lack ranks_json, return_secs, target_x, target_y).
    columns: 'id, kind, origin_village_id, target_village_id, units_json, loot_json, depart_at, arrive_at, ranks_json, return_secs, target_x, target_y',
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
  -- Unused since the premium queue effect was removed (docs/GAME_DESIGN.md section 18.2); SQLite keeps the column.
  premium         INTEGER NOT NULL DEFAULT 0,
  household_shared INTEGER NOT NULL DEFAULT 0,
  banned_at       INTEGER,
  ban_reason      TEXT,
  -- Last authenticated API request (written at most every few minutes). Drives the caretaker bot.
  last_active     INTEGER,
  -- Villages lost to abandonment (idle too long) that the player has not yet been told about; 0 = nothing to show.
  abandoned_notice INTEGER NOT NULL DEFAULT 0,
  -- Staff: set only by the server CLI (admin.ts). Re-read from here on every staff request.
  staff_role      TEXT CHECK (staff_role IN ('support', 'moderator', 'admin')),
  -- Mute: cannot write mail, chat or forum text until this time (ms).
  muted_until     INTEGER,
  mute_reason     TEXT,
  -- Lobby account this player belongs to (docs/MULTI_WORLD.md); null for players of a world without a lobby.
  -- The unique index idx_players_account is created in addMissingColumns (the column may not exist yet on old databases).
  account_id      INTEGER,
  -- Renown (docs/GAME_DESIGN.md section 18.2): everything earned (never goes down) and everything spent on villages. REAL: fractions are kept.
  renown_total    REAL    NOT NULL DEFAULT 0,
  renown_spent    REAL    NOT NULL DEFAULT 0,
  -- The part of renown_spent that is reserved by Chieftains (queued, at home, away): it comes back (partly) if they die, and is
  -- released when they are used up founding or taking a village. Always <= renown_spent.
  renown_reserved REAL    NOT NULL DEFAULT 0
);

-- Entry passes already used (single use). A row is kept until the pass could no longer be accepted (exp + clock skew).
CREATE TABLE IF NOT EXISTS used_pass_nonces (
  nonce      TEXT    PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_used_pass_nonces_expires ON used_pass_nonces(expires_at);

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
  -- While the hearth is out: the time the hold clock (or the fail timer) next needs attention (engine holdDueAt); NULL = lit.
  hold_due_at INTEGER,
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

-- ---- Won raids on abandoned villages: the loot of repeat raids by the same player shrinks (docs/GAME_DESIGN.md section 5).
-- Old rows are pruned when new ones are written.
CREATE TABLE IF NOT EXISTS npc_raids (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_npc_raids_pair ON npc_raids(player_id, village_id, at);

-- ---- Combat Renown (section 18.2): what one earner has already counted against one opponent in the open 24 h window.
-- opponent is 'p:<playerId>' or 'v:<abandonedVillageId>'. value is raw Renown (engine rawRenown), window_start in ms.
CREATE TABLE IF NOT EXISTS renown_pairs (
  earner_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  opponent     TEXT    NOT NULL,
  window_start INTEGER NOT NULL,
  value        REAL    NOT NULL,
  PRIMARY KEY (earner_id, opponent)
);

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

-- ---- Staff tooling: audit log (append-only), player reports of messages, support tickets, formal templates.
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            INTEGER NOT NULL,
  actor_id      INTEGER REFERENCES players(id) ON DELETE SET NULL,
  actor_ip      TEXT,
  action        TEXT    NOT NULL,
  target_player INTEGER REFERENCES players(id) ON DELETE SET NULL,
  detail        TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_player, id);
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_log(actor_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, id);
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE OF id, at, actor_ip, action, detail ON audit_log
BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END;

-- kind 'player' has no ref_id and no snapshot; the others keep a copy of the text so evidence survives deletion.
CREATE TABLE IF NOT EXISTS message_reports (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id        INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  reported_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind               TEXT    NOT NULL CHECK (kind IN ('mail', 'forum_post', 'chat', 'player')),
  ref_id             INTEGER,
  snapshot           TEXT    NOT NULL DEFAULT '',
  category           TEXT    NOT NULL CHECK (category IN ('spam', 'abuse', 'threats', 'cheating', 'other')),
  note               TEXT    NOT NULL DEFAULT '',
  status             TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  handled_by         INTEGER REFERENCES players(id) ON DELETE SET NULL,
  handled_at         INTEGER,
  resolution_note    TEXT    NOT NULL DEFAULT '',
  created_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msgreports_status   ON message_reports(status, id);
CREATE INDEX IF NOT EXISTS idx_msgreports_reporter ON message_reports(reporter_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msgreports_reported ON message_reports(reported_player_id, status);

CREATE TABLE IF NOT EXISTS tickets (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id             INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  category              TEXT    NOT NULL CHECK (category IN ('account', 'bug', 'payment', 'report_player', 'gameplay', 'feedback', 'other', 'moderation')),
  subject               TEXT    NOT NULL,
  status                TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'solved', 'closed')),
  priority              TEXT    NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  assigned_to           INTEGER REFERENCES players(id) ON DELETE SET NULL,
  opened_by_staff       INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  last_player_read_at   INTEGER,
  last_staff_message_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tickets_player ON tickets(player_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_tickets_queue  ON tickets(status, updated_at);

CREATE TABLE IF NOT EXISTS message_templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT    NOT NULL UNIQUE,
  title      TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('ticket', 'moderation')),
  body       TEXT    NOT NULL,
  updated_by INTEGER REFERENCES players(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id   INTEGER REFERENCES players(id) ON DELETE SET NULL,
  is_staff    INTEGER NOT NULL DEFAULT 0,
  internal    INTEGER NOT NULL DEFAULT 0,
  body        TEXT    NOT NULL,
  template_id INTEGER REFERENCES message_templates(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id, id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_author ON ticket_messages(author_id, created_at);

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
  seedTemplates(db);
}

/**
 * Schema version, stored in `PRAGMA user_version`. BUMP IT whenever the schema changes in any way (new table, column,
 * index, rebuilt CHECK, data fix-up in applySchema), then update SCHEMA_FINGERPRINT (the test in restart.test.ts tells
 * you the new value). A deploy that finds an older version on disk first writes a backup (see openDatabase).
 */
export const SCHEMA_VERSION = 5;
/** Hash of everything applySchema derives the schema from; guards against changing it without bumping SCHEMA_VERSION. */
export const SCHEMA_FINGERPRINT = '9818fd1735929cae';

/** The text the fingerprint is computed over (schema SQL, rebuild definitions, migration code). Used by tests only. */
export function schemaFingerprintInput(): string {
  const rebuilds = REBUILDS.map((r) => `${r.table}|${r.marker}|${r.columns}|${r.create(r.table)}`).join('\n');
  return [SCHEMA, rebuilds, rebuildOutdatedTables.toString(), addMissingColumns.toString(), seedTemplates.toString()].join('\n----\n');
}

const MIGRATION_BACKUP = /^pre-migrate-v\d+-v\d+-\d{8}-\d{6}\.sqlite$/;
const MIGRATION_BACKUPS_KEPT = 5;

function utcStamp(d: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

const userVersion = (db: DatabaseSync): number => Number((db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined)?.user_version ?? 0);

/** Consistent copy of the open database (VACUUM INTO) next to it in backups/, before a migration touches anything. */
function backupBeforeMigration(db: DatabaseSync, dbPath: string, from: number): string {
  const dir = resolve(dirname(dbPath), 'backups');
  mkdirSync(dir, { recursive: true });
  const target = resolve(dir, `pre-migrate-v${from}-v${SCHEMA_VERSION}-${utcStamp(new Date())}.sqlite`);
  if (existsSync(target)) rmSync(target, { force: true });
  try {
    db.prepare('VACUUM INTO ?').run(target);
  } catch (err) {
    rmSync(target, { force: true });
    throw new Error(`pre-migration backup failed, refusing to migrate: ${String(err)}`);
  }
  const old = readdirSync(dir).filter((f) => MIGRATION_BACKUP.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - MIGRATION_BACKUPS_KEPT))) rmSync(resolve(dir, f), { force: true });
  return target;
}

/** First start only (a meta flag remembers it, so templates an admin deleted do not come back). */
function seedTemplates(db: DatabaseSync): void {
  const done = db.prepare("SELECT 1 AS x FROM meta WHERE key = 'templates_seeded'").get();
  if (done) return;
  const insert = db.prepare('INSERT OR IGNORE INTO message_templates (key, title, kind, body, updated_by, updated_at) VALUES (?, ?, ?, ?, NULL, ?)');
  const t = Date.now();
  for (const d of DEFAULT_TEMPLATES) insert.run(d.key, d.title, d.kind, d.body, t);
  db.prepare("INSERT INTO meta (key, value) VALUES ('templates_seeded', '1')").run();
}

/** Columns added after release: SQLite has no ADD COLUMN IF NOT EXISTS, so check the table first. */
function addMissingColumns(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE'); // all or nothing: a half-applied migration must not be possible
  try {
    addMissingColumnsInner(db);
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // already gone; the original error matters more
    }
    throw err;
  }
}

function addMissingColumnsInner(db: DatabaseSync): void {
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
  if (!cols.some((c) => c.name === 'staff_role')) {
    db.exec("ALTER TABLE players ADD COLUMN staff_role TEXT CHECK (staff_role IN ('support', 'moderator', 'admin'))");
  }
  if (!cols.some((c) => c.name === 'muted_until')) db.exec('ALTER TABLE players ADD COLUMN muted_until INTEGER');
  if (!cols.some((c) => c.name === 'mute_reason')) db.exec('ALTER TABLE players ADD COLUMN mute_reason TEXT');
  if (!cols.some((c) => c.name === 'account_id')) db.exec('ALTER TABLE players ADD COLUMN account_id INTEGER');
  if (!cols.some((c) => c.name === 'renown_total')) db.exec('ALTER TABLE players ADD COLUMN renown_total REAL NOT NULL DEFAULT 0');
  if (!cols.some((c) => c.name === 'renown_spent')) db.exec('ALTER TABLE players ADD COLUMN renown_spent REAL NOT NULL DEFAULT 0');
  if (!cols.some((c) => c.name === 'renown_reserved')) db.exec('ALTER TABLE players ADD COLUMN renown_reserved REAL NOT NULL DEFAULT 0');
  // Name and column are fixed: the lobby import command (links existing players to lobby accounts) uses exactly these. NULL may repeat.
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_account ON players(account_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_players_last_active ON players(last_active)');
  const villageCols = db.prepare('PRAGMA table_info(villages)').all() as Array<{ name: string }>;
  if (!villageCols.some((c) => c.name === 'bot_next_at')) db.exec('ALTER TABLE villages ADD COLUMN bot_next_at INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS idx_villages_bot ON villages(bot_next_at) WHERE owner_id IS NOT NULL');
  if (!villageCols.some((c) => c.name === 'hold_due_at')) db.exec('ALTER TABLE villages ADD COLUMN hold_due_at INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS idx_villages_hold ON villages(hold_due_at) WHERE hold_due_at IS NOT NULL');
  const members = db.prepare('PRAGMA table_info(tribe_members)').all() as Array<{ name: string }>;
  if (!members.some((c) => c.name === 'grants')) db.exec("ALTER TABLE tribe_members ADD COLUMN grants TEXT NOT NULL DEFAULT '[]'");
  // Home-village unit ranks stamped when troops leave (section 15). Null = no ranks (older rows).
  // Test mode only: fixed travel seconds for the way home, chosen when sending.
  const moveCols = db.prepare('PRAGMA table_info(movements)').all() as Array<{ name: string }>;
  if (!moveCols.some((c) => c.name === 'return_secs')) db.exec('ALTER TABLE movements ADD COLUMN return_secs INTEGER');
  for (const table of ['movements', 'stationed']) {
    const t = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!t.some((c) => c.name === 'ranks_json')) db.exec(`ALTER TABLE ${table} ADD COLUMN ranks_json TEXT`);
  }
  // Found missions walk to a free tile (see movementsTable).
  for (const col of ['target_x', 'target_y']) {
    if (!moveCols.some((c) => c.name === col)) db.exec(`ALTER TABLE movements ADD COLUMN ${col} INTEGER`);
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
    // Copy only what the old table has (columns added later start empty).
    const have = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
    const copied = columns.split(', ').filter((c) => have.has(c)).join(', ');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(create(`${table}_new`));
      db.exec(`INSERT INTO ${table}_new (${copied}) SELECT ${copied} FROM ${table}`);
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
  const inMemory = path === ':memory:';
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  const found = userVersion(db);
  if (found > SCHEMA_VERSION) {
    console.warn(`[db] database schema v${found} is newer than this code (v${SCHEMA_VERSION}): older code on a newer database; continuing (schema changes are additive).`);
  }
  if (found < SCHEMA_VERSION) {
    const hasTables = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' LIMIT 1").get() !== undefined;
    // Never in memory (tests, browser preview): there is nothing durable to protect and no file system to write to.
    if (hasTables && !inMemory) {
      const file = backupBeforeMigration(db, path, found);
      console.info(`[db] schema v${found} -> v${SCHEMA_VERSION}: backup written to ${file}`);
    }
  }
  applySchema(db);
  if (found < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}
