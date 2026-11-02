// Minimal types for the part of sql.js (pure-JS asm build) the preview uses.
declare module 'sql.js/dist/sql-asm-memory-growth.js' {
  export interface SqlJsStatement {
    bind(values?: unknown[] | Record<string, unknown>): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    reset(): boolean;
    free(): boolean;
  }
  export interface SqlJsDatabase {
    run(sql: string): SqlJsDatabase;
    prepare(sql: string): SqlJsStatement;
    getRowsModified(): number;
    export(): Uint8Array;
    close(): void;
  }
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | null) => SqlJsDatabase;
  }
  const initSqlJs: (config?: Record<string, unknown>) => Promise<SqlJsStatic>;
  export default initSqlJs;
}
