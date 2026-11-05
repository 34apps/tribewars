// SQL for the domination win condition and the world end. Rules live in the engine (domination.ts) and the rest in
// domination-service.ts. The world_end table has one row that is written once and never changed (triggers in db.ts).

import type { FinalPlayerDto, FinalTribeDto, WorldEndKind } from '@clanfire/engine';
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
}
