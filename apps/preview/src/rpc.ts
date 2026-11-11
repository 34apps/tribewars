// Messages between the page and the game worker (worker.ts), and the page's side of the calls. Pure: no DOM, no
// Worker, so it is testable in Node.
//
// Clock rule: each side has its own game clock (clock.ts); they stay equal by exchanging snapshots, and syncing only
// moves a clock forward. The page changes the rate (speed chip) and sends its snapshot; the worker skips, restores and
// resets and sends its snapshot on every change. Every reply carries the worker's clock, and the page syncs to it
// BEFORE the call resolves, so a response produced after a skip never meets a page clock that is behind it.

import type { ApiResult } from './backend.ts';
import type { ClockSnapshot } from './clock.ts';
import type { SlowStep, WorldInfo } from './host.ts';
import type { Save } from './persist.ts';
import type { ShowcaseStage, StageTops } from './showcase.ts';

/** What the page can ask the worker to do, with its arguments and result. */
export interface Ops {
  api: { args: { method: string; path: string; body: string | undefined }; result: ApiResult };
  skip: { args: { ms: number }; result: void };
  showcase: { args: { stage: ShowcaseStage; tops: StageTops }; result: void };
  flush: { args: Record<string, never>; result: void };
  stop: { args: Record<string, never>; result: void };
  grant: { args: { name: string }; result: void };
  /** Console debugging: run `(ctx, clock) => ...` (function source) in the worker; the result must be cloneable. */
  run: { args: { src: string }; result: unknown };
}
export type Op = keyof Ops;

export type PageToWorker =
  | { kind: 'init'; save: Save | null; hidden: boolean }
  | { kind: 'call'; id: number; op: Op; args: unknown }
  | { kind: 'clock'; snap: ClockSnapshot }
  | { kind: 'hidden'; hidden: boolean };

export type WorkerToPage =
  /** The worker script runs (sent before the slow start-up, so the page can tell a blocked worker from a slow one). */
  | { kind: 'alive' }
  | { kind: 'ready'; info: WorldInfo; discardedSave: boolean; clock: ClockSnapshot }
  | { kind: 'failed'; error: string }
  | { kind: 'reply'; id: number; ok: true; value: unknown; clock: ClockSnapshot }
  | { kind: 'reply'; id: number; ok: false; error: string; clock: ClockSnapshot }
  | { kind: 'clock'; snap: ClockSnapshot }
  | { kind: 'storage'; ok: boolean }
  /** IndexedDB refused the save inside the worker: the page stores it (its localStorage fallback). */
  | { kind: 'save-fallback'; save: Save }
  | { kind: 'slow'; step: SlowStep };

export interface RpcClient {
  call<K extends Op>(op: K, args: Ops[K]['args']): Promise<Ops[K]['result']>;
  /** Feed a worker message in; returns true when it was a reply to a call. */
  handle(msg: WorkerToPage): boolean;
  /** Reject every open call (the worker is gone). */
  failAll(reason: string): void;
  pending(): number;
}

export function createRpcClient(post: (msg: PageToWorker) => void, syncClock: (snap: ClockSnapshot) => void): RpcClient {
  let nextId = 1;
  const open = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  return {
    call(op, args) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        open.set(id, { resolve: resolve as (v: unknown) => void, reject });
        try {
          post({ kind: 'call', id, op, args });
        } catch (err) {
          open.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
    handle(msg) {
      if (msg.kind !== 'reply') return false;
      const waiter = open.get(msg.id);
      if (!waiter) return true;
      open.delete(msg.id);
      syncClock(msg.clock); // first: the caller may read game time as soon as it resumes
      if (msg.ok) waiter.resolve(msg.value);
      else waiter.reject(new Error(msg.error));
      return true;
    },
    failAll(reason) {
      for (const w of open.values()) w.reject(new Error(reason));
      open.clear();
    },
    pending: () => open.size,
  };
}

/** The bytes of a save, ready to hand over without a copy (a view of a larger buffer is copied first). */
export function transferableSave(save: Save): { save: Save; transfer: ArrayBuffer[] } {
  const db = save.db;
  if (!db) return { save, transfer: [] };
  const whole = db.byteOffset === 0 && db.byteLength === db.buffer.byteLength && db.buffer instanceof ArrayBuffer;
  const bytes = whole ? db : db.slice();
  return { save: { ...save, db: bytes }, transfer: [bytes.buffer as ArrayBuffer] };
}
