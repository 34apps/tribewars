// Browser stand-in for node:sqlite's DatabaseSync / StatementSync, backed by sql.js (the pure-JS asm build, so no
// WebAssembly is needed). It implements the subset the server's Store / SqlBase / openDatabase use:
//   db.exec(sql), db.prepare(sql) -> { run, get, all } with positional or named (also bare-name) parameters,
//   run() -> { changes, lastInsertRowid }, db.close().
// The real server code runs on top of this unchanged.

import type { SqlJsDatabase, SqlJsStatement, SqlJsStatic } from 'sql.js/dist/sql-asm-memory-growth.js';

type Row = Record<string, unknown>;

let sqlJs: SqlJsStatic | null = null;
let initialData: Uint8Array | null = null;
let current: DatabaseSync | null = null;

/** Called once at boot, before the server's openDatabase(): the loaded sql.js and (optionally) a saved database. */
export function configureSqlite(sql: SqlJsStatic, saved: Uint8Array | null): void {
  sqlJs = sql;
  initialData = saved;
}

/** The database most recently opened (the preview opens exactly one). */
export function openDatabaseInstance(): DatabaseSync | null {
  return current;
}

function isNamed(p: unknown): p is Record<string, unknown> {
  return typeof p === 'object' && p !== null && !(p instanceof Uint8Array) && !Array.isArray(p);
}

function cleanValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  return v;
}

/** node:sqlite accepts bare names ({ id: 1 } for $id / :id / @id); sql.js wants the prefix, so offer all three. */
function bindable(params: unknown[]): unknown[] | Record<string, unknown> {
  if (params.length === 1 && isNamed(params[0])) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params[0])) {
      const value = cleanValue(v);
      if (/^[:$@]/.test(k)) out[k] = value;
      else for (const prefix of [':', '$', '@']) out[prefix + k] = value;
    }
    return out;
  }
  if (params.length === 1 && Array.isArray(params[0])) return (params[0] as unknown[]).map(cleanValue);
  return params.map(cleanValue);
}

export class StatementSync {
  private stmt: SqlJsStatement | null = null;
  private epoch = -1;

  constructor(
    private readonly owner: DatabaseSync,
    private readonly sql: string,
  ) {
    this.native(); // surface SQL errors at prepare time, like node:sqlite
  }

  /** The sql.js statement; prepared again if the database was re-opened by an export. */
  private native(): SqlJsStatement {
    if (this.stmt === null || this.epoch !== this.owner.epoch) {
      this.stmt = this.owner.raw.prepare(this.sql);
      this.epoch = this.owner.epoch;
    }
    return this.stmt;
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const st = this.native();
    try {
      st.bind(bindable(params));
      st.step();
    } finally {
      st.reset();
    }
    const changes = this.owner.raw.getRowsModified();
    const lastInsertRowid = /^\s*(INSERT|REPLACE)/i.test(this.sql) ? this.owner.lastInsertRowid() : 0;
    return { changes, lastInsertRowid };
  }

  get(...params: unknown[]): Row | undefined {
    const st = this.native();
    try {
      st.bind(bindable(params));
      return st.step() ? st.getAsObject() : undefined;
    } finally {
      st.reset();
    }
  }

  all(...params: unknown[]): Row[] {
    const st = this.native();
    const rows: Row[] = [];
    try {
      st.bind(bindable(params));
      while (st.step()) rows.push(st.getAsObject());
    } finally {
      st.reset();
    }
    return rows;
  }
}

export class DatabaseSync {
  raw: SqlJsDatabase;
  /** Bumped whenever sql.js re-opens the database (export), which invalidates every prepared statement. */
  epoch = 0;
  private open = true;
  private inTx = false;
  private foreignKeys = false;
  private rowIdStmt: StatementSync | null = null;

  constructor(_path?: string) {
    if (sqlJs === null) throw new Error('sql.js is not loaded yet: call configureSqlite() first.');
    this.raw = new sqlJs.Database(initialData);
    initialData = null;
    current = this;
  }

  exec(sql: string): void {
    const head = sql.trimStart();
    // Tuning pragmas are meaningless for an in-memory sql.js database (and WAL could hide data from export()).
    if (/^PRAGMA\s+(journal_mode|synchronous|busy_timeout)\b/i.test(head)) return;
    const fk = /^PRAGMA\s+foreign_keys\s*=\s*(ON|1|TRUE)\b/i.exec(head);
    if (fk) this.foreignKeys = true;
    const tx = /^(BEGIN|COMMIT|END|ROLLBACK)\b/i.exec(head);
    this.raw.run(sql);
    if (tx) this.inTx = /^BEGIN/i.test(tx[1] ?? '');
  }

  prepare(sql: string): StatementSync {
    return new StatementSync(this, sql);
  }

  lastInsertRowid(): number {
    this.rowIdStmt ??= new StatementSync(this, 'SELECT last_insert_rowid() AS id');
    return Number(this.rowIdStmt.get()?.id ?? 0);
  }

  /** Serialise the database, or null while a transaction is open (sql.js closes and re-opens it to export). */
  exportBytes(): Uint8Array | null {
    if (!this.open || this.inTx) return null;
    const bytes = this.raw.export();
    this.epoch++;
    this.rowIdStmt = null;
    // Export re-opens the connection with default pragmas.
    if (this.foreignKeys) this.raw.run('PRAGMA foreign_keys = ON');
    return bytes;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.raw.close();
  }
}
