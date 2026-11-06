// SQL for the troop_groups table (saved send-form groups): prepared statements with bound parameters only.
// Every statement is keyed on the owner's player id, so another player's row can never be read or changed.

import { UNIT_IDS, type Units } from '@clanfire/engine';
import { SqlBase, type Raw } from './sql.ts';

export interface TroopGroupRow {
  id: number;
  playerId: number;
  name: string;
  units: Partial<Units>;
  createdAt: number;
}

/** Stored JSON back to a unit map; anything unexpected (hand-edited database) is dropped rather than trusted. */
function parseUnits(text: string): Partial<Units> {
  const out: Partial<Units> = {};
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    for (const u of UNIT_IDS) {
      const n = raw[u];
      if (typeof n === 'number' && Number.isInteger(n) && n > 0) out[u] = n;
    }
  } catch {
    // empty map
  }
  return out;
}

const toRow = (r: Raw): TroopGroupRow => ({
  id: r.id as number,
  playerId: r.player_id as number,
  name: r.name as string,
  units: parseUnits(r.units as string),
  createdAt: r.created_at as number,
});

export class TroopGroupStore extends SqlBase {
  list(playerId: number): TroopGroupRow[] {
    return this.all('SELECT id, player_id, name, units, created_at FROM troop_groups WHERE player_id = ? ORDER BY id', playerId).map(toRow);
  }

  count(playerId: number): number {
    return Number(this.get('SELECT COUNT(*) AS n FROM troop_groups WHERE player_id = ?', playerId)?.n ?? 0);
  }

  get1(playerId: number, id: number): TroopGroupRow | null {
    const r = this.get('SELECT id, player_id, name, units, created_at FROM troop_groups WHERE id = ? AND player_id = ?', id, playerId);
    return r ? toRow(r) : null;
  }

  insert(playerId: number, name: string, units: Partial<Units>, now: number): number {
    return this.run('INSERT INTO troop_groups (player_id, name, units, created_at) VALUES (?, ?, ?, ?)', playerId, name, JSON.stringify(units), now).id;
  }

  /** True when a row of this player was changed. */
  update(playerId: number, id: number, name: string, units: Partial<Units>): boolean {
    return this.run('UPDATE troop_groups SET name = ?, units = ? WHERE id = ? AND player_id = ?', name, JSON.stringify(units), id, playerId).changes > 0;
  }

  /** True when a row of this player was removed. */
  delete(playerId: number, id: number): boolean {
    return this.run('DELETE FROM troop_groups WHERE id = ? AND player_id = ?', id, playerId).changes > 0;
  }
}
