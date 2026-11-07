// SQL for the domination win condition and the world end. Rules live in the engine (domination.ts) and the rest in
// domination-service.ts. The world_end table has one row that is written once and never changed (triggers in db.ts).

import { parseBadgeSummary, type BadgePlayerInput, type BadgeSummaryDto, type FinalPlayerDto, type FinalTribeDto, type WorldBadgeDto, type WorldEndBadge, type WorldEndKind } from '@clanfire/engine';
import { SqlBase, type Param } from './sql.ts';

export interface WorldEndRow {
  endedAt: number;
  kind: WorldEndKind;
  winnerTribeId: number | null;
  winnerName: string | null;
  winnerTag: string | null;
  reason: string;
  finalTribes: FinalTribeDto[];
  finalPlayers: FinalPlayerDto[];
}

/** Players who count as "active": played since `since`, not banned, not a test (sandbox) account. */
function activeFilter(sandbox: readonly string[]): string {
  const skip = sandbox.length > 0 ? ` AND p.username_lower NOT IN (${sandbox.map(() => '?').join(', ')})` : '';
  return `COALESCE(p.last_active, p.created_at) >= ? AND p.banned_at IS NULL${skip}`;
}

export class DominationStore extends SqlBase {
  /** The end never goes away, so once seen it is kept and later calls do not touch the database. */
  private cached: WorldEndRow | null = null;
  /** This process wrote the end itself (and so already told the players); false when it only found a row written by another process. */
  endedHere = false;

  getWorldEnd(): WorldEndRow | null {
    if (this.cached) return this.cached;
    const r = this.get('SELECT * FROM world_end WHERE id = 1');
    if (!r) return null;
    const final = JSON.parse(r.final_json as string) as { tribes?: FinalTribeDto[]; players?: FinalPlayerDto[] };
    this.cached = {
      endedAt: r.ended_at as number,
      kind: r.kind as WorldEndKind,
      winnerTribeId: (r.winner_tribe_id as number | null) ?? null,
      winnerName: (r.winner_name as string | null) ?? null,
      winnerTag: (r.winner_tag as string | null) ?? null,
      reason: r.reason as string,
      finalTribes: final.tribes ?? [],
      finalPlayers: final.players ?? [],
    };
    return this.cached;
  }

  /** Write the end once. False when the world had already ended (nothing is changed then). */
  insertWorldEnd(row: WorldEndRow): boolean {
    const done = this.run(
      'INSERT OR IGNORE INTO world_end (id, ended_at, kind, winner_tribe_id, winner_name, winner_tag, reason, final_json) VALUES (1, ?, ?, ?, ?, ?, ?, ?)',
      row.endedAt,
      row.kind,
      row.winnerTribeId,
      row.winnerName,
      row.winnerTag,
      row.reason,
      JSON.stringify({ tribes: row.finalTribes, players: row.finalPlayers }),
    );
    if (done.changes > 0) this.endedHere = true;
    return done.changes > 0;
  }

  /** Ids of the active players (see activeFilter). */
  activePlayerIds(since: number, sandbox: readonly string[]): number[] {
    return this.all(`SELECT p.id FROM players p WHERE ${activeFilter(sandbox)}`, since, ...sandbox).map((r) => r.id as number);
  }

  /** (ip, player) pairs of the active players: accounts that share an IP are one person for the count. */
  activePlayerIps(since: number, sandbox: readonly string[]): { ip: string; playerId: number }[] {
    const params: Param[] = [since, ...sandbox];
    return this.all(`SELECT i.ip AS ip, i.player_id AS player_id FROM player_ips i JOIN players p ON p.id = i.player_id WHERE ${activeFilter(sandbox)}`, ...params).map((r) => ({
      ip: r.ip as string,
      playerId: r.player_id as number,
    }));
  }

  /** Points of every village that a player owns (abandoned villages are not counted). */
  totalPlayerVillagePoints(): number {
    return Number(this.get('SELECT COALESCE(SUM(points), 0) AS n FROM villages WHERE owner_id IS NOT NULL')?.n ?? 0);
  }

  // ---- badges (docs/GAME_DESIGN.md 18.1) ----

  /** Every player as the badge rules need them (sandbox = test accounts, by lowercase username). */
  badgePlayers(sandbox: ReadonlySet<string>): BadgePlayerInput[] {
    return this.all(
      `SELECT p.id, p.username_lower, p.created_at, p.last_active, p.banned_at, tm.tribe_id, tm.joined_at,
              (SELECT COUNT(*) FROM villages v WHERE v.owner_id = p.id) AS villages
         FROM players p LEFT JOIN tribe_members tm ON tm.player_id = p.id`,
    ).map((r) => ({
      playerId: r.id as number,
      createdAt: r.created_at as number,
      lastActive: (r.last_active as number | null) ?? null,
      banned: r.banned_at !== null,
      test: sandbox.has(r.username_lower as string),
      villages: Number(r.villages),
      tribeId: (r.tribe_id as number | null) ?? null,
      tribeJoinedAt: (r.joined_at as number | null) ?? null,
    }));
  }

  insertBadges(list: readonly WorldEndBadge[]): void {
    for (const b of list) this.run('INSERT OR IGNORE INTO world_end_badges (player_id, badge, place) VALUES (?, ?, ?)', b.playerId, b.badge, b.place);
  }

  /** Badges of one player from this world's end (empty before the end and for old worlds). */
  worldBadgesOf(playerId: number): WorldBadgeDto[] {
    return this.all('SELECT badge, place FROM world_end_badges WHERE player_id = ? ORDER BY rowid', playerId).map((r) => ({ badge: r.badge as WorldBadgeDto['badge'], place: (r.place as number | null) ?? null }));
  }

  /** How many of each kind this world gave out. */
  badgeCounts(): Partial<Record<WorldBadgeDto['badge'], number>> {
    const out: Partial<Record<WorldBadgeDto['badge'], number>> = {};
    for (const r of this.all('SELECT badge, COUNT(*) AS n FROM world_end_badges GROUP BY badge')) out[r.badge as WorldBadgeDto['badge']] = Number(r.n);
    return out;
  }

  /** Badges of the given players, grouped by player id (players without any are left out). */
  badgesOfPlayers(ids: readonly number[]): Record<number, WorldBadgeDto[]> {
    const want = new Set(ids);
    const out: Record<number, WorldBadgeDto[]> = {};
    for (const r of this.all('SELECT player_id, badge, place FROM world_end_badges ORDER BY player_id, rowid')) {
      const id = r.player_id as number;
      if (!want.has(id)) continue;
      (out[id] ??= []).push({ badge: r.badge as WorldBadgeDto['badge'], place: (r.place as number | null) ?? null });
    }
    return out;
  }

  /** The account badge summary the lobby pass brought (stored as JSON). Defensive: anything unreadable is []. */
  accountBadges(playerId: number): BadgeSummaryDto[] {
    const raw = this.get('SELECT badges_json FROM players WHERE id = ?', playerId)?.badges_json;
    if (typeof raw !== 'string' || raw === '') return [];
    try {
      return parseBadgeSummary(JSON.parse(raw)) ?? [];
    } catch {
      return [];
    }
  }

  setAccountBadges(playerId: number, list: readonly BadgeSummaryDto[]): void {
    this.run('UPDATE players SET badges_json = ? WHERE id = ?', JSON.stringify(list), playerId);
  }
}
