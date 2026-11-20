// Lobby -> world commands (contract: end of packages/engine/src/api.ts). The lobby never called a world before; now it does,
// for account deletion and export only. Commands are signed like entry passes (same key, other domain, single use, 2 minutes).
//
// WORLD_API_URL is a template with `{id}`, e.g. `http://game-{id}:3000/w/{id}/api`; the command goes to `<that>/lobby/account/<verb>`.
// Unset: commands are queued (deletion) or reported as unavailable (export), with a log line. The world id always comes from the
// lobby's own worlds table (checked against WORLD_ID_PATTERN at world-add), never from a request, so a client cannot steer the URL.

import type { KeyObject } from 'node:crypto';
import type { Store } from './store.ts';
import { signLobbyCommand } from './pass.ts';
import type { LobbyCommandType } from '@clanfire/engine';

export const WORLD_COMMAND_TIMEOUT_MS = 5_000;
/** Retry delay after the Nth failure: 1 minute, doubling, at most 6 hours. */
export const RETRY_BASE_MS = 60_000;
/** Finished queue rows are kept this long, then removed by the hourly pass. */
export const DONE_KEEP_MS = 30 * 24 * 3600_000;
export const RETRY_MAX_MS = 6 * 3600_000;
/** Most commands sent in one pass of the dispatcher. */
export const DISPATCH_BATCH = 50;

export interface CommandLog {
  info(msg: string): void;
  warn(msg: string): void;
}
const silent: CommandLog = { info: () => {}, warn: () => {} };

export type CommandResult = { ok: true; body: unknown } | { ok: false; error: string };

export function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS);
}

/** Template with `{id}` -> base URL of one world's API; null when unset. */
export function worldApiBase(template: string | null, worldId: string): string | null {
  return template ? template.split('{id}').join(worldId).replace(/\/+$/, '') : null;
}

export class WorldCommandClient {
  constructor(
    private readonly signingKey: KeyObject,
    private readonly worldApiUrl: string | null,
    private readonly now: () => number,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly log: CommandLog = silent,
  ) {}

  private warnedUnset = false;

  get configured(): boolean {
    return this.worldApiUrl !== null;
  }

  /** Sign and POST one command. Never throws; a refusal, a timeout and a network error are all `{ ok: false }`. */
  async send(worldId: string, typ: LobbyCommandType, accountId: number): Promise<CommandResult> {
    const base = worldApiBase(this.worldApiUrl, worldId);
    if (!base) {
      if (!this.warnedUnset) {
        this.warnedUnset = true;
        this.log.warn('WORLD_API_URL is not set: commands to worlds (account deletion, export) are queued or reported unavailable until it is.');
      }
      return { ok: false, error: 'WORLD_API_URL is not set' };
    }
    const verb = typ === 'account_delete' ? 'delete' : 'export';
    const { command } = signLobbyCommand(typ, accountId, worldId, this.signingKey, this.now());
    try {
      const res = await this.fetchImpl(`${base}/lobby/account/${verb}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command }),
        redirect: 'error',
        signal: AbortSignal.timeout(WORLD_COMMAND_TIMEOUT_MS),
      });
      if (res.status !== 200) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true, body: await res.json() };
    } catch (err) {
      return { ok: false, error: (err instanceof Error ? `${err.name}: ${err.message}` : 'error').slice(0, 200) };
    }
  }
}

/** Sends the queued `account_delete` commands until every world answers done (forever, with backoff). */
export class DeletionDispatcher {
  private inflight: Promise<number> | null = null;

  constructor(
    private readonly store: Store,
    private readonly client: WorldCommandClient,
    private readonly now: () => number,
    private readonly log: CommandLog = silent,
  ) {}

  hasPending(): boolean {
    return this.store.db.prepare('SELECT 1 FROM account_deletions WHERE done_at IS NULL LIMIT 1').get() !== undefined;
  }

  /** Forget deletions that were confirmed more than `DONE_KEEP_MS` ago (the queue is not a log; the audit log keeps the record). Returns how many rows went. */
  pruneDone(): number {
    const cutoff = this.now() - DONE_KEEP_MS;
    return Number(this.store.db.prepare('DELETE FROM account_deletions WHERE done_at IS NOT NULL AND done_at < ?').run(cutoff).changes);
  }

  /** One pass over the rows that are due. Concurrent calls share one pass. Returns how many worlds answered done. */
  runPending(): Promise<number> {
    this.inflight ??= this.pass().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async pass(): Promise<number> {
    const db = this.store.db;
    // A world that left the lobby's list has nobody to tell.
    db.exec('DELETE FROM account_deletions WHERE done_at IS NULL AND world_id NOT IN (SELECT id FROM worlds)');
    if (!this.client.configured) {
      if (this.hasPending()) await this.client.send('-', 'account_delete', 0); // only to log the "unset" line once
      return 0;
    }
    const due = db
      .prepare('SELECT account_id, world_id, attempts FROM account_deletions WHERE done_at IS NULL AND next_try_at <= ? ORDER BY next_try_at, account_id LIMIT ?')
      .all(this.now(), DISPATCH_BATCH) as { account_id: number; world_id: string; attempts: number }[];
    let done = 0;
    await Promise.all(
      due.map(async (row) => {
        const res = await this.client.send(row.world_id, 'account_delete', row.account_id);
        const t = this.now();
        const answered = res.ok && typeof res.body === 'object' && res.body !== null && (res.body as { done?: unknown }).done === true;
        if (answered) {
          db.prepare('UPDATE account_deletions SET done_at = ?, last_error = NULL WHERE account_id = ? AND world_id = ?').run(t, row.account_id, row.world_id);
          done += 1;
          return;
        }
        const attempts = row.attempts + 1;
        const error = res.ok ? 'unexpected answer' : res.error;
        db.prepare('UPDATE account_deletions SET attempts = ?, last_error = ?, next_try_at = ? WHERE account_id = ? AND world_id = ?').run(attempts, error, t + retryDelayMs(attempts), row.account_id, row.world_id);
        this.log.warn(`account deletion in world ${row.world_id} not done (attempt ${attempts}): ${error}`);
      }),
    );
    return done;
  }
}
