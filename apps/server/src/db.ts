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
