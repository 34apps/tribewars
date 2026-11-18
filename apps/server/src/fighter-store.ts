// SQL for the fighter_totals table and the fighter rankings (docs/GAME_DESIGN.md, "Fighter rankings"): prepared statements, bound parameters only.

import { SqlBase } from './sql.ts';

export interface FighterTotals {
  attack: number;
  defence: number;
}

export interface FighterPlayerRow extends FighterTotals {
  id: number;
  username: string;
  tribeId: number | null;
  tribeTag: string | null;
  villages: number;
  mainX: number;
  mainY: number;
}

export interface FighterTribeRow extends FighterTotals {
  id: number;
  name: string;
  tag: string;
  members: number;
}

export class FighterStore extends SqlBase {
  /** Add destroyed value to a player's totals. Call inside the transaction of the battle. Zero or negative amounts are skipped. */
  add(playerId: number | null, attack: number, defence: number): void {
    if (playerId === null || !(attack > 0 || defence > 0)) return;
    this.run(
      `INSERT INTO fighter_totals (player_id, attack, defence) VALUES (?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET attack = attack + excluded.attack, defence = defence + excluded.defence`,
      playerId,
      Math.max(0, attack),
      Math.max(0, defence),
    );
  }

  totalsOf(playerId: number): FighterTotals {
    const r = this.get('SELECT attack, defence FROM fighter_totals WHERE player_id = ?', playerId);
    return { attack: (r?.attack as number | undefined) ?? 0, defence: (r?.defence as number | undefined) ?? 0 };
  }

  /** Every player with at least one village (the same set as the other player rankings), name order; the caller sorts by the chosen kind. */
  players(): FighterPlayerRow[] {
    return this.all(
      `SELECT p.id, p.username, tm.tribe_id, tr.tag AS tribe_tag, COUNT(v.id) AS villages,
              (SELECT x FROM villages m WHERE m.owner_id = p.id ORDER BY m.points DESC, m.id ASC LIMIT 1) AS main_x,
              (SELECT y FROM villages m WHERE m.owner_id = p.id ORDER BY m.points DESC, m.id ASC LIMIT 1) AS main_y,
              COALESCE(f.attack, 0) AS attack, COALESCE(f.defence, 0) AS defence
       FROM players p
       JOIN villages v ON v.owner_id = p.id
       LEFT JOIN tribe_members tm ON tm.player_id = p.id
       LEFT JOIN tribes tr ON tr.id = tm.tribe_id
       LEFT JOIN fighter_totals f ON f.player_id = p.id
       GROUP BY p.id
       ORDER BY p.username_lower ASC, p.id ASC`,
    ).map((r) => ({
      id: r.id as number,
      username: r.username as string,
      tribeId: (r.tribe_id as number | null) ?? null,
      tribeTag: (r.tribe_tag as string | null) ?? null,
      villages: r.villages as number,
      mainX: r.main_x as number,
      mainY: r.main_y as number,
      attack: r.attack as number,
      defence: r.defence as number,
    }));
  }

  /** Every tribe with the sum of its CURRENT members' totals (a member who leaves takes their fighting along, like points). Older tribe first. */
  tribes(): FighterTribeRow[] {
    return this.all(
      `SELECT t.id, t.name, t.tag, COUNT(m.player_id) AS members,
              COALESCE(SUM(f.attack), 0) AS attack, COALESCE(SUM(f.defence), 0) AS defence
       FROM tribes t
       LEFT JOIN tribe_members m ON m.tribe_id = t.id
       LEFT JOIN fighter_totals f ON f.player_id = m.player_id
       GROUP BY t.id
       ORDER BY t.created_at ASC, t.id ASC`,
    ).map((r) => ({
      id: r.id as number,
      name: r.name as string,
      tag: r.tag as string,
      members: r.members as number,
      attack: r.attack as number,
      defence: r.defence as number,
    }));
  }
}
