// Shared prepared-statement plumbing for the stores. SQL is only ever written with bound parameters.

import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { LiveEmit } from './live-events.ts';

export type Raw = Record<string, unknown>;
export type Param = string | number | null;

export abstract class SqlBase {
  private readonly cache = new Map<string, StatementSync>();
  /** Live-update hints (see live-events.ts). The Store wires this to its commit-aware queue; the default drops them. */
  emit: LiveEmit = () => {};

  constructor(readonly db: DatabaseSync) {}

  protected q(sql: string): StatementSync {
    let st = this.cache.get(sql);
    if (!st) {
      st = this.db.prepare(sql);
      this.cache.set(sql, st);
    }
    return st;
  }

  protected get(sql: string, ...params: Param[]): Raw | undefined {
    return this.q(sql).get(...params) as Raw | undefined;
  }

  protected all(sql: string, ...params: Param[]): Raw[] {
    return this.q(sql).all(...params) as Raw[];
  }

  protected run(sql: string, ...params: Param[]): { changes: number; id: number } {
    const r = this.q(sql).run(...params);
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  }
}
