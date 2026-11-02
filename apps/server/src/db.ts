// SQLite (node:sqlite) connection and schema.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
  protected_until INTEGER NOT NULL DEFAULT 0
);

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
  UNIQUE (x, y)
);
CREATE INDEX IF NOT EXISTS idx_villages_owner ON villages(owner_id);

CREATE TABLE IF NOT EXISTS movements (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  kind              TEXT    NOT NULL CHECK (kind IN ('attack', 'return')),
  origin_village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  target_village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  units_json        TEXT    NOT NULL,
  loot_json         TEXT,
  depart_at         INTEGER NOT NULL,
  arrive_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_movements_arrive ON movements(arrive_at, id);
CREATE INDEX IF NOT EXISTS idx_movements_origin ON movements(origin_village_id);
CREATE INDEX IF NOT EXISTS idx_movements_target ON movements(target_village_id);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  side        TEXT    NOT NULL CHECK (side IN ('attack', 'defense')),
  won         INTEGER NOT NULL,
  title       TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  read        INTEGER NOT NULL DEFAULT 0,
  battle_json TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_player ON reports(player_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_unread ON reports(player_id) WHERE read = 0;

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
  joined_at INTEGER NOT NULL
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
`;

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
  db.exec(SCHEMA);
  return db;
}
