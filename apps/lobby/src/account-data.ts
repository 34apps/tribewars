// Account data rights (docs/legal/privacy.md s.8, 9, 11): deletion, export, closure after 24 months without activity.
// One deletion path serves the player's own request, the inactivity sweep and the operator's `delete-account`.

import { DEFAULT_CHIEFTAIN, DELETED_PLAYER_NAME, GameError, INACTIVE_CLOSE_MS, INACTIVE_WARN_BEFORE_MS, type AccountDeletionInfoDto, type AccountExportDto, type WorldExportDto } from '@clanfire/engine';
import type { AccountDataHooks } from './account-hooks.ts';
import type { AccountRow, Store } from './store.ts';
import type { CommandLog, DeletionDispatcher, WorldCommandClient } from './world-commands.ts';

/** Stored instead of a hash: parseable by nothing, so verifyPassword always says no. */
export const NO_PASSWORD_HASH = '!';
/** Tombstone user name. A hyphen is never valid in a username (USERNAME_PATTERN), so no one can register it. */
export const tombstoneName = (id: number): string => `deleted-${id}`;
/** Accounts handled per sweep run (the next run continues). */
export const SWEEP_BATCH = 200;

export type DeletionCause = { kind: 'self'; ip: string | null } | { kind: 'inactive' } | { kind: 'operator' };

export interface SweepReport {
  /** Accounts that got (or, in a dry run, would get) the warning, and whether a message was delivered. */
  warned: { id: number; username: string; delivered: boolean }[];
  closed: { id: number; username: string }[];
}

interface ActivityRow {
  id: number;
  username: string;
  last: number;
  warnedAt: number | null;
}

export class AccountDataService {
  constructor(
    private readonly store: Store,
    private readonly hooks: AccountDataHooks,
    private readonly now: () => number,
    /** Needed for the export only; the CLI passes null. */
    private readonly commands: WorldCommandClient | null = null,
    private readonly log: CommandLog = { info: () => {}, warn: () => {} },
  ) {}

  private get db() {
    return this.store.db;
  }

  /** Worlds the account entered that are still in the lobby's list. */
  private enteredWorlds(accountId: number): { id: string; name: string; firstEntered: number; lastEntered: number }[] {
    return (
      this.db
        .prepare('SELECT w.id AS id, w.name AS name, aw.first_entered AS f, aw.last_entered AS l FROM account_worlds aw JOIN worlds w ON w.id = aw.world_id WHERE aw.account_id = ? ORDER BY aw.last_entered DESC, w.id')
        .all(accountId) as { id: string; name: string; f: number; l: number }[]
    ).map((r) => ({ id: r.id, name: r.name, firstEntered: r.f, lastEntered: r.l }));
  }

  deletionInfo(account: AccountRow): AccountDeletionInfoDto {
    const h = this.hooks.deletionInfo(this.db, account.id);
    return { worlds: this.enteredWorlds(account.id).map((w) => ({ id: w.id, name: w.name })), flames: h.flames };
  }

  // ---- deletion --------------------------------------------------------------------------------

  /**
   * Delete an account: queue the deletion in every entered world, remove everything personal, keep a tombstone row. One transaction.
   * A banned account keeps its name and ban fields (ban records are kept, privacy s.8) but loses password and sessions like any other.
   */
  deleteAccount(accountId: number, cause: DeletionCause): void {
    this.store.tx(() => {
      const t = this.now();
      const account = this.store.getAccount(accountId);
      if (!account || account.deletedAt !== null) throw new GameError('not_found', 'No such account.');
      const db = this.db;
      for (const w of this.enteredWorlds(account.id)) {
        db.prepare('INSERT OR IGNORE INTO account_deletions (account_id, world_id, created_at) VALUES (?, ?, ?)').run(account.id, w.id, t);
      }
      const banned = account.bannedAt !== null;
      const name = banned ? account.username : tombstoneName(account.id);
      db.prepare('UPDATE accounts SET username = ?, username_lower = ?, password_hash = ?, chieftain = ?, staff_role = NULL, last_login = NULL, closure_warned_at = NULL, deleted_at = ? WHERE id = ?').run(
        name,
        name.toLowerCase(),
        NO_PASSWORD_HASH,
        DEFAULT_CHIEFTAIN,
        t,
        account.id,
      );
      db.prepare('DELETE FROM sessions WHERE account_id = ?').run(account.id);
      db.prepare('DELETE FROM account_ips WHERE account_id = ?').run(account.id);
      db.prepare('DELETE FROM account_badges WHERE account_id = ?').run(account.id);
      db.prepare('DELETE FROM account_worlds WHERE account_id = ?').run(account.id);
      db.prepare('DELETE FROM login_failures WHERE name = ?').run(account.usernameLower);
      this.anonymiseHallOfFame(account.username);
      this.hooks.onAccountDeleted(db, account.id, t);
      this.store.audit({
        at: t,
        actorId: cause.kind === 'self' ? account.id : null,
        actorIp: cause.kind === 'self' ? cause.ip : cause.kind === 'operator' ? 'cli' : null,
        action: cause.kind === 'inactive' ? 'account_closed_inactive' : 'account_deleted',
        targetAccount: account.id,
        detail: cause.kind === 'operator' ? 'by operator' : '',
      });
    });
  }

  /** Hall of Fame is public: the deleted player's name (exact match) becomes "Deleted player" in winners and top lists. */
  private anonymiseHallOfFame(username: string): void {
    const rows = this.db.prepare('SELECT world_id, winner_name, top_json FROM hall_of_fame WHERE winner_name = ? OR instr(top_json, ?) > 0').all(username, username) as { world_id: string; winner_name: string | null; top_json: string }[];
    for (const r of rows) {
      const winner = r.winner_name === username ? DELETED_PLAYER_NAME : r.winner_name;
      let top = r.top_json;
      try {
        const obj = JSON.parse(r.top_json) as { players?: unknown };
        if (obj && Array.isArray(obj.players)) {
          let changed = false;
          for (const p of obj.players as { name?: unknown }[]) {
            if (p && p.name === username) {
              p.name = DELETED_PLAYER_NAME;
              changed = true;
            }
          }
          if (changed) top = JSON.stringify(obj);
        }
      } catch {
        // A row that is not JSON cannot list the name as a player; leave it.
      }
      this.db.prepare('UPDATE hall_of_fame SET winner_name = ?, top_json = ? WHERE world_id = ?').run(winner, top, r.world_id);
    }
  }

  // ---- inactivity ------------------------------------------------------------------------------

  private activityRows(where: string, params: (number | string)[], limit: number): ActivityRow[] {
    // Last activity = latest of sign-up, last sign-in, last world entry (sessions are at most 60 days, so a session never outlives a sign-in by enough to matter).
    const rows = this.db
      .prepare(
        `SELECT id, username, last, warned FROM (
           SELECT a.id AS id, a.username AS username, a.closure_warned_at AS warned,
                  MAX(a.created_at, COALESCE(a.last_login, 0), COALESCE((SELECT MAX(last_entered) FROM account_worlds WHERE account_id = a.id), 0)) AS last
             FROM accounts a WHERE a.deleted_at IS NULL AND a.staff_role IS NULL
         ) WHERE ${where} ORDER BY last, id LIMIT ?`,
      )
      .all(...params, limit) as { id: number; username: string; last: number; warned: number | null }[];
    return rows.map((r) => ({ id: r.id, username: r.username, last: r.last, warnedAt: r.warned }));
  }

  /**
   * (a) 23 months without activity and not yet warned: record the warning (and try to deliver it). (b) 24 months without activity and
   * the warning at least 30 days old: delete the account. Never staff, never deleted ones. Bounded per run. `dryRun` changes nothing.
   */
  runInactiveSweep(now: number, opts: { dryRun?: boolean; limit?: number } = {}): SweepReport {
    const limit = opts.limit ?? SWEEP_BATCH;
    const report: SweepReport = { warned: [], closed: [] };
    const closing = this.activityRows('last < ? AND warned IS NOT NULL AND warned <= ?', [now - INACTIVE_CLOSE_MS, now - INACTIVE_WARN_BEFORE_MS], limit);
    for (const a of closing) {
      if (!opts.dryRun) this.deleteAccount(a.id, { kind: 'inactive' });
      report.closed.push({ id: a.id, username: a.username });
    }
    const warning = this.activityRows('last < ? AND warned IS NULL', [now - (INACTIVE_CLOSE_MS - INACTIVE_WARN_BEFORE_MS)], limit);
    for (const a of warning) {
      let delivered = false;
      if (!opts.dryRun) {
        const closeAt = Math.max(a.last + INACTIVE_CLOSE_MS, now + INACTIVE_WARN_BEFORE_MS);
        this.db.prepare('UPDATE accounts SET closure_warned_at = ? WHERE id = ?').run(now, a.id);
        try {
          delivered = this.hooks.notifyInactiveWarning(this.db, a.id, closeAt);
        } catch (err) {
          this.log.warn(`inactivity warning for account ${a.id} failed: ${err instanceof Error ? err.message : 'error'}`);
        }
        this.store.audit({ at: now, actorId: null, actorIp: null, action: 'inactive_warned', targetAccount: a.id, detail: `delivered=${delivered ? 'yes' : 'no'}` });
      }
      report.warned.push({ id: a.id, username: a.username, delivered });
    }
    return report;
  }

  // ---- export ----------------------------------------------------------------------------------

  async exportAccount(account: AccountRow): Promise<AccountExportDto> {
    const db = this.db;
    const entered = this.enteredWorlds(account.id);
    const allIds = (db.prepare('SELECT world_id FROM account_worlds WHERE account_id = ? ORDER BY world_id').all(account.id) as { world_id: string }[]).map((r) => r.world_id);
    const worldData: WorldExportDto[] = [];
    const worldsUnavailable: string[] = allIds.filter((id) => !entered.some((w) => w.id === id)); // left the lobby list: unreachable
    const results = await Promise.all(
      entered.map(async (w) => {
        const res = this.commands ? await this.commands.send(w.id, 'account_export', account.id) : ({ ok: false, error: 'no commands' } as const);
        const body = res.ok ? (res.body as Partial<WorldExportDto> | null) : null;
        return body && typeof body === 'object' && body.format === 'clanflame-world-export-v1' && body.worldId === w.id ? { w, data: body as WorldExportDto } : { w, data: null };
      }),
    );
    for (const r of results) {
      if (r.data) worldData.push(r.data);
      else worldsUnavailable.push(r.w.id);
    }
    const t = this.now();
    const ips = (db.prepare('SELECT ip, first_seen, last_seen FROM account_ips WHERE account_id = ? ORDER BY first_seen, ip').all(account.id) as { ip: string; first_seen: number; last_seen: number }[]).map((r) => ({ ip: r.ip, firstSeen: r.first_seen, lastSeen: r.last_seen }));
    const audit = (db.prepare('SELECT at, action, actor_ip FROM audit_log WHERE target_account = ? ORDER BY id LIMIT 2000').all(account.id) as { at: number; action: string; actor_ip: string | null }[]).map((r) => ({ at: r.at, action: r.action, ip: r.actor_ip }));
    const dto: AccountExportDto = {
      format: 'clanflame-account-export-v1',
      exportedAt: t,
      account: {
        id: account.id,
        username: account.username,
        chieftain: account.chieftain,
        createdAt: account.createdAt,
        lastLogin: account.lastLogin,
        staffRole: account.staffRole,
        banned: account.bannedAt !== null ? { at: account.bannedAt, reason: account.banReason } : null,
      },
      worlds: entered,
      badges: this.store.accountBadges(account.id),
      ips,
      audit,
      extra: this.hooks.exportSections(db, account.id),
      worldData: worldData.sort((a, b) => (a.worldId < b.worldId ? -1 : 1)),
      worldsUnavailable: worldsUnavailable.sort(),
    };
    this.store.audit({ at: t, actorId: account.id, actorIp: null, action: 'account_export', targetAccount: account.id, detail: worldsUnavailable.length > 0 ? `unavailable=${worldsUnavailable.join(',')}`.slice(0, 200) : '' });
    return dto;
  }
}

/** Background jobs of the lobby process: send queued deletions every minute, run the inactivity sweep and drop old finished queue rows at most once an hour. Returns stop(). */
export function startMaintenance(opts: { service: AccountDataService; dispatcher: DeletionDispatcher; now: () => number; log: CommandLog; tickMs?: number }): () => void {
  let lastSweep = 0;
  let busy = false;
  const tick = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const t = opts.now();
      if (t - lastSweep >= 3_600_000) {
        lastSweep = t;
        const r = opts.service.runInactiveSweep(t);
        if (r.warned.length > 0 || r.closed.length > 0) opts.log.info(`inactive sweep: ${r.warned.length} warned, ${r.closed.length} closed`);
        opts.dispatcher.pruneDone();
      }
      if (opts.dispatcher.hasPending()) await opts.dispatcher.runPending();
    } catch (err) {
      opts.log.warn(`account maintenance failed: ${err instanceof Error ? err.message : 'error'}`);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), opts.tickMs ?? 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
