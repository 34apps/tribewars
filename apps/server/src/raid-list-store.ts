// SQL for the raid_lists and raid_list_rows tables (a paid extra; docs/GAME_DESIGN.md "Raid lists"): prepared statements, bound parameters only.
// Every statement is keyed on the owner's player id, so another player's list or row can never be read or changed.

import { UNIT_IDS, convertSiegeUnits, type Resources, type Units } from '@clanfire/engine';
import { SqlBase, type Raw } from './sql.ts';

export interface RaidListRow {
  id: number;
  playerId: number;
  name: string;
  createdAt: number;
}

export interface RaidRow {
  id: number;
  listId: number;
  playerId: number;
  villageId: number;
  fromVillageId: number;
  units: Partial<Units>;
  createdAt: number;
}

/** The caller's newest battle report on a village (the "last" line of a list row). */
export interface LastRaid {
  at: number;
  won: boolean;
  loot: number;
}

/** How many of the caller's newest attack reports are looked at for the "last" lines. Bounded on purpose. */
export const RAID_LAST_LOOKUP_REPORTS = 200;

/** Stored JSON back to a unit map; anything unexpected (hand-edited database) is dropped rather than trusted. */
function parseUnits(text: string): Partial<Units> {
  const out: Partial<Units> = {};
  try {
    const raw = convertSiegeUnits(JSON.parse(text) as Record<string, unknown>);
    for (const u of UNIT_IDS) {
      const n = raw[u];
      if (typeof n === 'number' && Number.isInteger(n) && n > 0) out[u] = n;
    }
  } catch {
    // empty map
  }
  return out;
}

const toList = (r: Raw): RaidListRow => ({ id: r.id as number, playerId: r.player_id as number, name: r.name as string, createdAt: r.created_at as number });

const toRow = (r: Raw): RaidRow => ({
  id: r.id as number,
  listId: r.list_id as number,
  playerId: r.player_id as number,
  villageId: r.village_id as number,
  fromVillageId: r.from_village_id as number,
  units: parseUnits(r.units_json as string),
  createdAt: r.created_at as number,
});

const ROW_COLS = 'id, list_id, player_id, village_id, from_village_id, units_json, created_at';

export class RaidListStore extends SqlBase {
  lists(playerId: number): RaidListRow[] {
    return this.all('SELECT id, player_id, name, created_at FROM raid_lists WHERE player_id = ? ORDER BY id', playerId).map(toList);
  }

  listCount(playerId: number): number {
    return Number(this.get('SELECT COUNT(*) AS n FROM raid_lists WHERE player_id = ?', playerId)?.n ?? 0);
  }

  list(playerId: number, id: number): RaidListRow | null {
    const r = this.get('SELECT id, player_id, name, created_at FROM raid_lists WHERE id = ? AND player_id = ?', id, playerId);
    return r ? toList(r) : null;
  }

  insertList(playerId: number, name: string, now: number): number {
    return this.run('INSERT INTO raid_lists (player_id, name, created_at) VALUES (?, ?, ?)', playerId, name, now).id;
  }

  /** True when a list of this player was renamed. */
  renameList(playerId: number, id: number, name: string): boolean {
    return this.run('UPDATE raid_lists SET name = ? WHERE id = ? AND player_id = ?', name, id, playerId).changes > 0;
  }

  /** True when a list of this player was removed (its rows go with it). */
  deleteList(playerId: number, id: number): boolean {
    return this.run('DELETE FROM raid_lists WHERE id = ? AND player_id = ?', id, playerId).changes > 0;
  }

  /** Rows of every list of the player, in list order (insertion order). */
  rowsOf(playerId: number): RaidRow[] {
    return this.all(`SELECT ${ROW_COLS} FROM raid_list_rows WHERE player_id = ? ORDER BY list_id, id`, playerId).map(toRow);
  }

  rowsOfList(playerId: number, listId: number): RaidRow[] {
    return this.all(`SELECT ${ROW_COLS} FROM raid_list_rows WHERE list_id = ? AND player_id = ? ORDER BY id`, listId, playerId).map(toRow);
  }

  rowCount(playerId: number, listId: number): number {
    return Number(this.get('SELECT COUNT(*) AS n FROM raid_list_rows WHERE list_id = ? AND player_id = ?', listId, playerId)?.n ?? 0);
  }

  row(playerId: number, listId: number, rowId: number): RaidRow | null {
    const r = this.get(`SELECT ${ROW_COLS} FROM raid_list_rows WHERE id = ? AND list_id = ? AND player_id = ?`, rowId, listId, playerId);
    return r ? toRow(r) : null;
  }

  hasVillage(playerId: number, listId: number, villageId: number): boolean {
    return this.get('SELECT 1 AS x FROM raid_list_rows WHERE list_id = ? AND player_id = ? AND village_id = ?', listId, playerId, villageId) !== undefined;
  }

  insertRow(playerId: number, listId: number, villageId: number, fromVillageId: number, units: Partial<Units>, now: number): number {
    return this.run(
      'INSERT INTO raid_list_rows (list_id, player_id, village_id, from_village_id, units_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      listId,
      playerId,
      villageId,
      fromVillageId,
      JSON.stringify(units),
      now,
    ).id;
  }

  /** True when a row of this player was changed. */
  updateRow(playerId: number, listId: number, rowId: number, fromVillageId: number, units: Partial<Units>): boolean {
    return (
      this.run('UPDATE raid_list_rows SET from_village_id = ?, units_json = ? WHERE id = ? AND list_id = ? AND player_id = ?', fromVillageId, JSON.stringify(units), rowId, listId, playerId)
        .changes > 0
    );
  }

  /** True when a row of this player was removed. */
  deleteRow(playerId: number, listId: number, rowId: number): boolean {
    return this.run('DELETE FROM raid_list_rows WHERE id = ? AND list_id = ? AND player_id = ?', rowId, listId, playerId).changes > 0;
  }

  /**
   * The caller's own newest battle report (side 'attack', not called off) on each village, from their newest RAID_LAST_LOOKUP_REPORTS attack
   * reports. Reads only fields of the caller's own rows, so nobody sees another player's reports.
   */
  lastRaids(playerId: number): Map<number, LastRaid> {
    const out = new Map<number, LastRaid>();
    const rows = this.all(
      `SELECT created_at, won, json_extract(battle_json, '$.type') AS type, json_extract(battle_json, '$.outcome') AS outcome,
              json_extract(battle_json, '$.defender.villageId') AS village_id, json_extract(battle_json, '$.loot') AS loot
       FROM reports WHERE player_id = ? AND side = 'attack' ORDER BY created_at DESC, id DESC LIMIT ?`,
      playerId,
      RAID_LAST_LOOKUP_REPORTS,
    );
    for (const r of rows) {
      if ((r.type !== null && r.type !== undefined && r.type !== 'battle') || r.outcome === 'called_off') continue;
      const villageId = r.village_id;
      if (typeof villageId !== 'number' || out.has(villageId)) continue; // newest first: the first one wins
      out.set(villageId, { at: r.created_at as number, won: r.won === 1, loot: lootTotal(r.loot) });
    }
    return out;
  }
}

function lootTotal(json: unknown): number {
  if (typeof json !== 'string') return 0;
  try {
    const raw = JSON.parse(json) as Partial<Resources>;
    return Object.values(raw).reduce<number>((a, n) => a + (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0), 0);
  } catch {
    return 0;
  }
}
