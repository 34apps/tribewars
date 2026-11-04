// SQLite (node:sqlite) connection and schema of the lobby. Same pragmas as apps/server/src/db.ts.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Bump when the schema changes in any way (and add the migration to applySchema). */
export const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT    NOT NULL,
  username_lower TEXT    NOT NULL UNIQUE,
  password_hash  TEXT    NOT NULL,
  chieftain      TEXT    NOT NULL DEFAULT 'old-orm',
  created_at     INTEGER NOT NULL,
  last_login     INTEGER,
  banned_at      INTEGER,
  ban_reason     TEXT,
  -- Staff: set only by the lobby CLI (admin.ts). Worlds copy it onto the player at every entry.
  staff_role     TEXT CHECK (staff_role IN ('support', 'moderator', 'admin'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Failed sign-ins per submitted username (lower case), whether or not such an account exists, so the answer never
-- reveals which names exist. Additive table (v2); no personal data beyond the name an attacker typed.
CREATE TABLE IF NOT EXISTS login_failures (
  name         TEXT    PRIMARY KEY,
  fails        INTEGER NOT NULL,
  last_fail    INTEGER NOT NULL,
  locked_until INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_failures_last ON login_failures(last_fail);

-- Every IP an account registered or signed in from (multi-account guard). Raw IPs: needed to review and ban;
-- rows go with the account (cascade).
CREATE TABLE IF NOT EXISTS account_ips (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ip         TEXT    NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  PRIMARY KEY (account_id, ip)
);
CREATE INDEX IF NOT EXISTS idx_account_ips_ip ON account_ips(ip);

-- The world list. Managed only by the lobby CLI. path is the public URL path of the world's page ("/w/w1/").
CREATE TABLE IF NOT EXISTS worlds (
  id         TEXT    PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 32),
  name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  status     TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'full', 'closed')),
  path       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  at             INTEGER NOT NULL,
  actor_id       INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  actor_ip       TEXT,
  action         TEXT    NOT NULL,
  target_account INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  detail         TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_account, id);
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_log(actor_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, id);
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE OF id, at, actor_ip, action, detail ON audit_log
BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END;
`;

/** Open (creating the folder and schema if needed) the lobby database. */
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
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}
