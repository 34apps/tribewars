// SQL for the tribe project tables (docs/GAME_DESIGN.md 18.5): the Tribe Store, the running project, the ledger and the
// funding-shipment bookkeeping. Prepared statements with bound parameters only; the rules live in tribe-projects-service.ts.

import { RESOURCE_IDS, emptyResources, type Resources, type TribeProjectId } from '@clanfire/engine';
import { SqlBase, type Raw } from './sql.ts';

export interface TribeStoreRow {
  tribeId: number;
  resources: Resources;
  villageId: number | null;
  villageSetAt: number;
  levels: Record<TribeProjectId, number>;
}

export interface ProjectRunRow {
  tribeId: number;
  project: TribeProjectId;
  level: number;
  startedAt: number;
  endsAt: number;
  cost: Resources;
}

export interface LedgerRow {
  id: number;
  playerId: number;
  name: string;
  resources: Resources;
  at: number;
}

export interface LedgerTotalRow {
  playerId: number;
  name: string;
  total: number;
  last24h: number;
}

/** Fixed column names (never built from input). */
const LEVEL_COLUMN: Record<TribeProjectId, string> = { roads: 'roads', watchtower: 'watchtower', wards: 'wards' };
const LEVEL_SQL: Record<TribeProjectId, string> = {
  roads: 'UPDATE tribe_stores SET roads = ? WHERE tribe_id = ?',
  watchtower: 'UPDATE tribe_stores SET watchtower = ? WHERE tribe_id = ?',
  wards: 'UPDATE tribe_stores SET wards = ? WHERE tribe_id = ?',
};

const MS_PER_DAY = 86_400_000;

function toStore(r: Raw): TribeStoreRow {
  return {
    tribeId: r.tribe_id as number,
    resources: { wood: r.wood as number, food: r.food as number, iron: r.iron as number, gold: r.gold as number },
    villageId: (r.village_id as number | null) ?? null,
    villageSetAt: r.village_set_at as number,
    levels: { roads: r[LEVEL_COLUMN.roads] as number, watchtower: r[LEVEL_COLUMN.watchtower] as number, wards: r[LEVEL_COLUMN.wards] as number },
  };
}

function toRun(r: Raw): ProjectRunRow {
  return {
    tribeId: r.tribe_id as number,
    project: r.project as TribeProjectId,
    level: r.level as number,
    startedAt: r.started_at as number,
    endsAt: r.ends_at as number,
    cost: { ...emptyResources(), ...(JSON.parse(r.cost_json as string) as Partial<Resources>) },
  };
}

export class ProjectStore extends SqlBase {
  /** The tribe's row, made on first use. */
  ensure(tribeId: number): TribeStoreRow {
    this.run('INSERT OR IGNORE INTO tribe_stores (tribe_id) VALUES (?)', tribeId);
    return toStore(this.get('SELECT * FROM tribe_stores WHERE tribe_id = ?', tribeId) as Raw);
  }

  /** Without creating the row (reads by other tribes' code paths, e.g. roads). */
  peek(tribeId: number): TribeStoreRow | null {
    const r = this.get('SELECT * FROM tribe_stores WHERE tribe_id = ?', tribeId);
    return r ? toStore(r) : null;
  }

  /** The store village of the tribe whose store sits in this village, if any (map marker, raid pool). */
  storeAtVillage(villageId: number): TribeStoreRow | null {
    const r = this.get('SELECT * FROM tribe_stores WHERE village_id = ?', villageId);
    return r ? toStore(r) : null;
  }

  /** Village id -> tribe id for every store village (the map marker; validity is rechecked by the caller). */
  storeVillageTribes(): Map<number, number> {
    return new Map(this.all('SELECT village_id, tribe_id FROM tribe_stores WHERE village_id IS NOT NULL').map((r) => [r.village_id as number, r.tribe_id as number]));
  }

  /** Replace the contents. The CHECKs make a negative value an error; callers clamp first. */
  setResources(tribeId: number, res: Resources): void {
    this.run('UPDATE tribe_stores SET wood = ?, food = ?, iron = ?, gold = ? WHERE tribe_id = ?', res.wood, res.food, res.iron, res.gold, tribeId);
  }

  setVillage(tribeId: number, villageId: number | null, at: number): void {
    this.run('UPDATE tribe_stores SET village_id = ?, village_set_at = ? WHERE tribe_id = ?', villageId, at, tribeId);
  }

  clearVillage(tribeId: number): void {
    this.run('UPDATE tribe_stores SET village_id = NULL WHERE tribe_id = ?', tribeId);
  }

  setLevel(tribeId: number, project: TribeProjectId, level: number): void {
    this.run(LEVEL_SQL[project], level, tribeId);
  }

  getRun(tribeId: number): ProjectRunRow | null {
    const r = this.get('SELECT * FROM tribe_project_runs WHERE tribe_id = ?', tribeId);
    return r ? toRun(r) : null;
  }

  /** The primary key allows one run per tribe: a second insert throws (the service checks first). */
  insertRun(run: ProjectRunRow): void {
    this.run(
      'INSERT INTO tribe_project_runs (tribe_id, project, level, started_at, ends_at, cost_json) VALUES (?, ?, ?, ?, ?, ?)',
      run.tribeId,
      run.project,
      run.level,
      run.startedAt,
      run.endsAt,
      JSON.stringify(run.cost),
    );
  }

  deleteRun(tribeId: number): void {
    this.run('DELETE FROM tribe_project_runs WHERE tribe_id = ?', tribeId);
  }

  // ---- ledger ----------------------------------------------------------------------------------

  insertLedger(tribeId: number, playerId: number, name: string, res: Resources, at: number): void {
    this.run(
      'INSERT INTO tribe_store_ledger (tribe_id, player_id, player_name, wood, food, iron, gold, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      tribeId,
      playerId,
      name,
      res.wood,
      res.food,
      res.iron,
      res.gold,
      at,
    );
  }

  ledger(tribeId: number, limit: number): LedgerRow[] {
    return this.all(
      `SELECT l.id, l.player_id, COALESCE(p.username, l.player_name) AS name, l.wood, l.food, l.iron, l.gold, l.at
       FROM tribe_store_ledger l LEFT JOIN players p ON p.id = l.player_id
       WHERE l.tribe_id = ? ORDER BY l.at DESC, l.id DESC LIMIT ?`,
      tribeId,
      limit,
    ).map((r) => ({
      id: r.id as number,
      playerId: r.player_id as number,
      name: r.name as string,
      resources: { wood: r.wood as number, food: r.food as number, iron: r.iron as number, gold: r.gold as number },
      at: r.at as number,
    }));
  }

  /** Per giver: everything ever given, and the last 24 h up to `now`. Biggest first. */
  totals(tribeId: number, now: number): LedgerTotalRow[] {
    return this.all(
      `SELECT l.player_id, COALESCE(p.username, MAX(l.player_name)) AS name,
              SUM(${RESOURCE_IDS.map((r) => `l.${r}`).join(' + ')}) AS total,
              COALESCE(SUM(CASE WHEN l.at > ? THEN ${RESOURCE_IDS.map((r) => `l.${r}`).join(' + ')} ELSE 0 END), 0) AS last24h
       FROM tribe_store_ledger l LEFT JOIN players p ON p.id = l.player_id
       WHERE l.tribe_id = ? GROUP BY l.player_id ORDER BY total DESC, l.player_id ASC`,
      now - MS_PER_DAY,
      tribeId,
    ).map((r) => ({ playerId: r.player_id as number, name: r.name as string, total: r.total as number, last24h: r.last24h as number }));
  }

  // ---- funding shipments ---------------------------------------------------------------------

  insertSend(movementId: number, tribeId: number, playerId: number, sentAt: number, total: number): void {
    // Rows older than a day no longer count towards the cap.
    this.run('DELETE FROM tribe_store_sends WHERE sent_at <= ?', sentAt - MS_PER_DAY);
    this.run('INSERT INTO tribe_store_sends (movement_id, tribe_id, player_id, sent_at, total) VALUES (?, ?, ?, ?, ?)', movementId, tribeId, playerId, sentAt, total);
  }

  deleteSend(movementId: number): void {
    this.run('DELETE FROM tribe_store_sends WHERE movement_id = ?', movementId);
  }

  /** What the player sent to a store in the last 24 h (on the road or arrived; cancelled and turned-back ones are gone). */
  sentSince(playerId: number, now: number): number {
    const r = this.get('SELECT COALESCE(SUM(total), 0) AS n FROM tribe_store_sends WHERE player_id = ? AND sent_at > ?', playerId, now - MS_PER_DAY);
    return Number(r?.n ?? 0);
  }

  /** Cargo of funding shipments still on the road for this tribe (sent by its current members). */
  onTheRoad(tribeId: number): Resources {
    const sum = emptyResources();
    const rows = this.all(
      `SELECT m.loot_json FROM movements m
       JOIN villages o ON o.id = m.origin_village_id
       JOIN tribe_members tm ON tm.player_id = o.owner_id
       WHERE m.kind = 'shipment' AND m.to_tribe_store = 1 AND tm.tribe_id = ?`,
      tribeId,
    );
    for (const r of rows) {
      if (!r.loot_json) continue;
      const c = JSON.parse(r.loot_json as string) as Partial<Resources>;
      for (const id of RESOURCE_IDS) sum[id] += c[id] ?? 0;
    }
    return sum;
  }
}
