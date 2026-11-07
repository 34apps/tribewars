// `world-finish`: copy a finished world's badges to lobby accounts and write its Hall of Fame row (plan step 9).
// The world database is opened READ-ONLY and every value read from it is checked before it is written. One lobby
// transaction; running it twice changes nothing ("already recorded").

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  BADGE_TOP_PLAYERS,
  HALL_OF_FAME_TOP_PLAYERS,
  HALL_OF_FAME_TOP_TRIBES,
  isBadgeKind,
  type BadgeKind,
  type HallOfFameEntryDto,
  type WorldEndKind,
} from '@clanfire/engine';
import { freeTarget, stamp, vacuumCopy } from './snapshot.ts';
import type { HallOfFameRow, Store } from './store.ts';

export class FinishError extends Error {}

export interface FinishOptions {
  store: Store;
  worldId: string;
  worldDbPath: string;
  /** Where the pre-finish copy of the lobby database goes (created if needed). */
  backupDir: string;
  now: number;
}

export interface FinishReport {
  alreadyRecorded: boolean;
  badgesAdded: number;
  /** Badge rows whose player has no lobby account (skipped). */
  skippedNoAccount: number;
  /** Badge rows whose account id is not in the lobby (skipped). */
  skippedUnknownAccount: number;
  /** Badge rows that failed validation (skipped). */
  skippedInvalid: number;
  /** The world database predates world_end_badges: no badges, Hall of Fame row only. */
  noBadgeTable: boolean;
  backup: string | null;
}

const SQLITE_MAGIC = 'SQLite format 3\u0000';

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const cleanText = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return t.length === 0 ? null : t.slice(0, max);
};

interface Top {
  tribes: { rank: number; name: string; tag: string; points: number }[];
  players: { rank: number; name: string; points: number; tribeTag: string | null }[];
}

/** The best tribes / players of final_json, each field checked; malformed rows are dropped. */
export function parseTop(finalJson: string): Top {
  let raw: unknown;
  try {
    raw = JSON.parse(finalJson);
  } catch {
    throw new FinishError('world_end.final_json is not valid JSON.');
  }
  const obj = (raw && typeof raw === 'object' ? raw : {}) as { tribes?: unknown; players?: unknown };
  const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)) : []);
  const tribes: Top['tribes'] = [];
  for (const t of rows(obj.tribes)) {
    const name = cleanText(t.name, 40);
    const tag = cleanText(t.tag, 8);
    if (!isInt(t.rank) || t.rank < 1 || !name || !tag || !isInt(t.points)) continue;
    tribes.push({ rank: t.rank, name, tag, points: t.points });
  }
  const players: Top['players'] = [];
  for (const p of rows(obj.players)) {
    const name = cleanText(p.name, 40);
    if (!isInt(p.rank) || p.rank < 1 || !name || !isInt(p.points)) continue;
    players.push({ rank: p.rank, name, points: p.points, tribeTag: cleanText(p.tribeTag, 8) });
  }
  tribes.sort((a, b) => a.rank - b.rank);
  players.sort((a, b) => a.rank - b.rank);
  return { tribes: tribes.slice(0, HALL_OF_FAME_TOP_TRIBES), players: players.slice(0, HALL_OF_FAME_TOP_PLAYERS) };
}

/** Hall of Fame rows as the API sends them (a stored row that no longer parses is left out). */
export function hallOfFameDtos(rows: HallOfFameRow[]): HallOfFameEntryDto[] {
  const out: HallOfFameEntryDto[] = [];
  for (const r of rows) {
    let top: Top;
    try {
      top = parseTop(r.topJson);
    } catch {
      continue;
    }
    out.push({
      worldId: r.worldId,
      worldName: r.worldName,
      endedAt: r.endedAt,
      kind: r.kind,
      winner: r.winnerName && r.winnerTag ? { name: r.winnerName, tag: r.winnerTag } : null,
      topTribes: top.tribes,
      topPlayers: top.players,
    });
  }
  return out;
}

export function finishWorld(o: FinishOptions): FinishReport {
  const { store } = o;
  const world = store.getWorld(o.worldId);
  if (!world) throw new FinishError(`No such world: ${o.worldId}`);
  const path = resolve(o.worldDbPath);
  if (!existsSync(path) || !statSync(path).isFile()) throw new FinishError(`World database not found: ${path}`);
  const wdb = new DatabaseSync(path, { readOnly: true });
  try {
    wdb.exec('PRAGMA busy_timeout = 10000');
    const tables = new Set((wdb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
    if (!tables.has('world_end')) throw new FinishError('world has not ended');
    const end = wdb.prepare('SELECT ended_at, kind, winner_name, winner_tag, final_json FROM world_end WHERE id = 1').get() as Record<string, unknown> | undefined;
    if (!end) throw new FinishError('world has not ended');
    const endedAt = end.ended_at;
    const kind = end.kind;
    if (!isInt(endedAt) || endedAt <= 0) throw new FinishError('world_end.ended_at is not valid.');
    if (kind !== 'domination' && kind !== 'manual') throw new FinishError('world_end.kind is not valid.');
    if (typeof end.final_json !== 'string') throw new FinishError('world_end.final_json is missing.');
    const top = parseTop(end.final_json);
    const hall: HallOfFameRow = {
      worldId: world.id,
      worldName: world.name,
      endedAt,
      kind: kind as WorldEndKind,
      winnerName: cleanText(end.winner_name, 40),
      winnerTag: cleanText(end.winner_tag, 8),
      topJson: JSON.stringify(top),
    };

    const report: FinishReport = { alreadyRecorded: false, badgesAdded: 0, skippedNoAccount: 0, skippedUnknownAccount: 0, skippedInvalid: 0, noBadgeTable: !tables.has('world_end_badges'), backup: null };
    if (store.hasHallOfFame(world.id)) {
      report.alreadyRecorded = true;
      return report;
    }

    const rows: { accountId: number; badge: BadgeKind; place: number | null }[] = [];
    if (!report.noBadgeTable) {
      const cols = new Set((wdb.prepare('PRAGMA table_info(players)').all() as { name: string }[]).map((c) => c.name));
      if (!cols.has('account_id')) throw new FinishError('The world database has no players.account_id (run lobby:import first).');
      const raw = wdb
        .prepare('SELECT b.player_id AS player_id, b.badge AS badge, b.place AS place, p.account_id AS account_id FROM world_end_badges b LEFT JOIN players p ON p.id = b.player_id ORDER BY b.player_id, b.badge')
        .all() as Record<string, unknown>[];
      for (const r of raw) {
        const { badge, place, account_id: accountId } = r;
        if (!isBadgeKind(badge) || (badge === 'top10' ? !isInt(place) || place < 1 || place > BADGE_TOP_PLAYERS : place !== null)) {
          report.skippedInvalid += 1;
          continue;
        }
        if (accountId === null || accountId === undefined) {
          report.skippedNoAccount += 1;
          continue;
        }
        if (!isInt(accountId) || accountId < 1) {
          report.skippedInvalid += 1;
          continue;
        }
        rows.push({ accountId, badge, place: badge === 'top10' ? (place as number) : null });
      }
    }

    // Back up the lobby database first (VACUUM INTO cannot run inside a transaction).
    mkdirSync(resolve(o.backupDir), { recursive: true });
    report.backup = freeTarget(resolve(o.backupDir), `pre-finish-${stamp(new Date(o.now))}-${world.id}`);
    vacuumCopy(store.db, report.backup);

    store.tx(() => {
      if (!store.insertHallOfFame(hall)) {
        report.alreadyRecorded = true;
        return;
      }
      for (const r of rows) {
        if (!store.accountExists(r.accountId)) {
          report.skippedUnknownAccount += 1;
          continue;
        }
        if (store.insertAccountBadge(r.accountId, world.id, r.badge, r.place, endedAt)) report.badgesAdded += 1;
      }
      store.setWorldStatus(world.id, 'finished');
      store.audit({ at: o.now, actorId: null, actorIp: 'cli', action: 'world_finish', targetAccount: null, detail: `${world.id} badges=${report.badgesAdded} noAccount=${report.skippedNoAccount}` });
    });
    return report;
  } finally {
    wdb.close();
  }
}

export function formatFinishReport(worldId: string, r: FinishReport): string[] {
  if (r.alreadyRecorded) return [`World ${worldId} is already recorded in the Hall of Fame; nothing changed.`];
  const lines = [`World ${worldId} recorded: Hall of Fame row written, status set to finished, ${r.badgesAdded} badge(s) given.`];
  if (r.skippedNoAccount > 0) lines.push(`Skipped ${r.skippedNoAccount} badge(s) of players without a lobby account.`);
  if (r.skippedUnknownAccount > 0) lines.push(`Skipped ${r.skippedUnknownAccount} badge(s) whose account is not in the lobby.`);
  if (r.skippedInvalid > 0) lines.push(`Skipped ${r.skippedInvalid} badge row(s) that failed validation.`);
  if (r.noBadgeTable) lines.push('This world database has no world_end_badges table (it ended before badges existed): no badges given.');
  if (r.backup) lines.push(`Lobby backup: ${r.backup}`);
  return lines;
}
