// SQLite (node:sqlite) connection and schema of the lobby. Same pragmas as apps/server/src/db.ts.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Append-only, except that `actor_ip` may be set to NULL (privacy, v6): the purge in Store.purgeConnectionData does it after 30 days. */
const AUDIT_UPDATE_GUARD_SQL = `CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE OF id, at, actor_ip, action, detail ON audit_log
WHEN NOT (NEW.id IS OLD.id AND NEW.at IS OLD.at AND NEW.action IS OLD.action AND NEW.detail IS OLD.detail AND NEW.actor_ip IS NULL)
BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END;`;

/** Bump when the schema changes in any way (and add the migration to applySchema). */
export const SCHEMA_VERSION = 7; // 7: Flames shop: ledger, purchases, consents, stripe_events, login_history, world_premium, account_items; accounts.pay_banned_at/disputes; worlds.shop_premium (2026-11-20)
// 6: audit_log trigger replaced: the only allowed update is blanking actor_ip (purged after 30 days, entries stay) (2026-11-18)

/**
 * The world list. Managed only by the lobby CLI. path is the public URL path of the world's page ("/w/w1/").
 * Status 'finished' (v3) = the world ended by a win: read-only, still enterable to see the results.
 * v1/v2 databases have a CHECK without 'finished': migrateWorldsTable() rebuilds the table in place.
 */
function worldsTableSql(table: string): string {
  return `CREATE TABLE IF NOT EXISTS ${table} (
  id         TEXT    PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 32),
  name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  status     TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'full', 'closed', 'finished')),
  path       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- v7: this world sells Premium for Flames (operator CLI world-shop).
  shop_premium INTEGER NOT NULL DEFAULT 0
);`;
}

/** v3: widen the status CHECK of an older worlds table (SQLite cannot alter a CHECK): copy into a new table, swap. */
function migrateWorldsTable(db: DatabaseSync): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'worlds'").get() as { sql?: string } | undefined;
  if (!row?.sql || row.sql.includes("'finished'")) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DROP TABLE IF EXISTS worlds_new');
    db.exec(worldsTableSql('worlds_new'));
    db.exec('INSERT INTO worlds_new (id, name, status, path, created_at, sort_order) SELECT id, name, status, path, created_at, sort_order FROM worlds');
    db.exec('DROP TABLE worlds');
    db.exec('ALTER TABLE worlds_new RENAME TO worlds');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

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
  staff_role     TEXT CHECK (staff_role IN ('support', 'moderator', 'admin')),
  -- v7: may not buy Flames any more (second bank dispute); disputes = bank disputes opened against this account's purchases.
  pay_banned_at  INTEGER,
  disputes       INTEGER NOT NULL DEFAULT 0,
  -- v7: self-declared before the first purchase; set once (support can change it with the CLI). NULL = not asked yet.
  age_group      TEXT CHECK (age_group IN ('adult', 'minor'))
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

${worldsTableSql('worlds')}

-- v4: badges from finished worlds (docs/GAME_DESIGN.md 18.1 "Badges") and the Hall of Fame. Both are written only by the
-- operator CLI (world-finish, badge-grant, badge-revoke). Additive tables: older databases get them on the next start.
-- place: only for 'top10' (1-10). top_json: {tribes: [...], players: [...]} as frozen by the world at its end.
CREATE TABLE IF NOT EXISTS account_badges (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  world_id   TEXT    NOT NULL,
  badge      TEXT    NOT NULL CHECK (badge IN ('champion', 'second_tribe', 'third_tribe', 'top10', 'veteran')),
  place      INTEGER CHECK (place IS NULL OR (place BETWEEN 1 AND 10 AND badge = 'top10')),
  ended_at   INTEGER NOT NULL,
  PRIMARY KEY (account_id, world_id, badge)
);
CREATE INDEX IF NOT EXISTS idx_account_badges_world ON account_badges(world_id);

CREATE TABLE IF NOT EXISTS hall_of_fame (
  world_id    TEXT    PRIMARY KEY,
  world_name  TEXT    NOT NULL,
  ended_at    INTEGER NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('domination', 'manual')),
  winner_name TEXT,
  winner_tag  TEXT,
  top_json    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hall_of_fame_ended ON hall_of_fame(ended_at);

-- v5: which worlds an account has entered (homepage "Your worlds"). Written only by POST /api/worlds/:id/enter after it
-- succeeded; own data only. Additive table: older databases get it on the next start. Rows go with the account (cascade).
CREATE TABLE IF NOT EXISTS account_worlds (
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  world_id      TEXT    NOT NULL,
  first_entered INTEGER NOT NULL,
  last_entered  INTEGER NOT NULL,
  PRIMARY KEY (account_id, world_id)
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
${AUDIT_UPDATE_GUARD_SQL}

-- v7: Flames shop (docs/PAYMENTS_PLAN.md). Additive: older databases get these tables and columns on the next start.
-- The ledger is append-only (triggers below); the balance is always SUM(delta). No foreign key on account_id: accounting
-- records must survive whatever happens to the account row.
CREATE TABLE IF NOT EXISTS consents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL,
  purchase_id   INTEGER,
  at            INTEGER NOT NULL,
  ip            TEXT    NOT NULL,
  terms_version TEXT    NOT NULL,
  kind          TEXT    NOT NULL CHECK (kind IN ('withdrawal_waiver', 'parent_consent')),
  text          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consents_account ON consents(account_id);

CREATE TABLE IF NOT EXISTS purchases (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id            INTEGER NOT NULL,
  -- kind 'settle' = the player paying open dispute fees: no pack, no Flames.
  kind                  TEXT    NOT NULL DEFAULT 'flames' CHECK (kind IN ('flames', 'settle')),
  pack_id               TEXT    NOT NULL,
  flames                INTEGER NOT NULL CHECK (flames >= 0),
  price_cents           INTEGER NOT NULL CHECK (price_cents > 0),
  currency              TEXT    NOT NULL,
  status                TEXT    NOT NULL CHECK (status IN ('pending', 'paid', 'refunded', 'disputed', 'dispute_lost', 'dispute_won', 'expired')),
  checkout_session_id   TEXT    UNIQUE,
  payment_intent_id     TEXT    UNIQUE,
  charge_id             TEXT,
  dispute_id            TEXT,
  country               TEXT,
  ip                    TEXT    NOT NULL,
  user_agent            TEXT    NOT NULL,
  consent_id            INTEGER REFERENCES consents(id),
  email                 TEXT,
  card_brand            TEXT,
  card_last4            TEXT,
  card_country          TEXT,
  disputed_at           INTEGER,
  created_at            INTEGER NOT NULL,
  paid_at               INTEGER,
  refunded_flames       INTEGER NOT NULL DEFAULT 0,
  refunded_cents        INTEGER NOT NULL DEFAULT 0,
  refunded_at           INTEGER,
  receipt_sent          INTEGER NOT NULL DEFAULT 0,
  evidence_json         TEXT,
  evidence_submitted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_purchases_account ON purchases(account_id, id);
CREATE INDEX IF NOT EXISTS idx_purchases_charge ON purchases(charge_id);
CREATE INDEX IF NOT EXISTS idx_purchases_dispute ON purchases(dispute_id);
CREATE INDEX IF NOT EXISTS idx_purchases_paid ON purchases(paid_at);

-- Dispute fees the player owes (provider fee + handling fee). Open = paid_at and cancelled_at both NULL.
CREATE TABLE IF NOT EXISTS account_fees (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id         INTEGER NOT NULL,
  purchase_id        INTEGER NOT NULL,
  dispute_id         TEXT    NOT NULL,
  kind               TEXT    NOT NULL CHECK (kind IN ('provider_fee', 'handling_fee')),
  cents              INTEGER NOT NULL CHECK (cents > 0),
  created_at         INTEGER NOT NULL,
  paid_at            INTEGER,
  cancelled_at       INTEGER,
  settle_purchase_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fees_account ON account_fees(account_id, id);
CREATE INDEX IF NOT EXISTS idx_fees_dispute ON account_fees(dispute_id);

CREATE TABLE IF NOT EXISTS flames_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL,
  at          INTEGER NOT NULL,
  delta       INTEGER NOT NULL CHECK (delta <> 0),
  reason      TEXT    NOT NULL CHECK (reason IN ('purchase', 'spend', 'refund', 'refund_failed', 'dispute', 'dispute_won', 'support')),
  purchase_id INTEGER,
  world_id    TEXT,
  item_id     TEXT,
  request_id  TEXT,
  detail      TEXT,
  UNIQUE (account_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON flames_ledger(account_id, id);
CREATE INDEX IF NOT EXISTS idx_ledger_purchase ON flames_ledger(purchase_id);
CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON flames_ledger
BEGIN SELECT RAISE(ABORT, 'the Flames ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON flames_ledger
BEGIN SELECT RAISE(ABORT, 'the Flames ledger is append-only'); END;

-- One row per processed Stripe event, written in the same transaction as the event's effects.
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id    TEXT    PRIMARY KEY,
  type        TEXT    NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_type ON stripe_events(type, received_at);

-- Register, sign-in and world-entry history (evidence for disputes). Raw IP and browser string: purged after 2 years.
CREATE TABLE IF NOT EXISTS login_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  at         INTEGER NOT NULL,
  ip         TEXT    NOT NULL,
  user_agent TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('register', 'login', 'enter')),
  world_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_login_history_account ON login_history(account_id, id);
CREATE INDEX IF NOT EXISTS idx_login_history_at ON login_history(at);

CREATE TABLE IF NOT EXISTS world_premium (
  account_id INTEGER NOT NULL,
  world_id   TEXT    NOT NULL,
  until      INTEGER NOT NULL,
  PRIMARY KEY (account_id, world_id)
);

CREATE TABLE IF NOT EXISTS account_items (
  account_id INTEGER NOT NULL,
  item_id    TEXT    NOT NULL,
  at         INTEGER NOT NULL,
  PRIMARY KEY (account_id, item_id)
);
`;

/** v7: add a column to a table that predates it (SQLite has no ADD COLUMN IF NOT EXISTS). */
function addColumnIfMissing(db: DatabaseSync, table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

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
  migrateWorldsTable(db); // before SCHEMA: an old worlds table is replaced, a missing one is created by SCHEMA
  const before = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  db.exec(SCHEMA);
  // v7: columns on tables that already existed (a new database has them from the CREATE TABLE above).
  addColumnIfMissing(db, 'accounts', 'pay_banned_at', 'INTEGER');
  addColumnIfMissing(db, 'accounts', 'disputes', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'accounts', 'age_group', "TEXT CHECK (age_group IN ('adult', 'minor'))");
  addColumnIfMissing(db, 'worlds', 'shop_premium', 'INTEGER NOT NULL DEFAULT 0');
  // v5: fill "Your worlds" for players who entered worlds before it existed, from the append-only audit log.
  if (before > 0 && before < 5) {
    db.exec(`INSERT OR IGNORE INTO account_worlds (account_id, world_id, first_entered, last_entered)
      SELECT target_account, detail, MIN(at), MAX(at) FROM audit_log
      WHERE action = 'enter' AND target_account IS NOT NULL AND target_account IN (SELECT id FROM accounts)
      GROUP BY target_account, detail`);
  }
  // v6: the old trigger forbade every update; replace it (idempotent: dropping and recreating gives the same guard).
  if (before > 0 && before < 6) {
    db.exec('DROP TRIGGER IF EXISTS audit_no_update');
    db.exec(AUDIT_UPDATE_GUARD_SQL);
  }
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}
