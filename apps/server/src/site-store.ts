// SQL for map sites (Fire Shrines): who holds each one and the troops standing there. Rules live in the engine (sites.ts)
// and in site-service.ts. Site positions are not stored: they come from the world seed.

import { normalizeUnits, type Units, type VillageRanks } from '@clanfire/engine';
import { SqlBase, type Raw } from './sql.ts';
import { addUnits } from './units.ts';

export interface SiteRow {
  id: number;
  /** null = neutral (the militia defends it). */
  holderTribeId: number | null;
  /** No attack may arrive before this time (ms); 0 = never calm. */
  calmUntil: number;
  /** Site Wall: this level as of `wallAt` (null = level 0 since the world began); the engine's siteWallLevel gives the level now. */
  wallLevel: number;
  wallAt: number | null;
  /** Keepers: this share (0..1) as of `keepersSince`; the engine's keepersFraction gives the share now. */
  keepersBase: number;
  keepersSince: number;
}

const SITE_COLS = 'id, holder_tribe_id, calm_until, wall_level, wall_at, keepers_base, keepers_since';
const NEW_SITE: Omit<SiteRow, 'id'> = { holderTribeId: null, calmUntil: 0, wallLevel: 0, wallAt: null, keepersBase: 1, keepersSince: 0 };

function toSite(r: Raw): SiteRow {
  return {
    id: r.id as number,
    holderTribeId: (r.holder_tribe_id as number | null) ?? null,
    calmUntil: r.calm_until as number,
    wallLevel: (r.wall_level as number | null) ?? 0,
    wallAt: (r.wall_at as number | null) ?? null,
    keepersBase: (r.keepers_base as number | null) ?? 1,
    keepersSince: (r.keepers_since as number | null) ?? 0,
  };
}

/** A contingent of one home village standing at a site. The units also stay in the owner's home village `away` count. */
export interface GarrisonRow {
  id: number;
  siteId: number;
  ownerPlayerId: number;
  homeVillageId: number;
  units: Units;
  arrivedAt: number;
  ranks: VillageRanks | null;
}

function parseRanks(raw: unknown): VillageRanks | null {
  if (typeof raw !== 'string') return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as VillageRanks) : null;
  } catch {
    return null;
  }
}

function toGarrison(r: Raw): GarrisonRow {
  return {
    id: r.id as number,
    siteId: r.site_id as number,
    ownerPlayerId: r.owner_player_id as number,
    homeVillageId: r.home_village_id as number,
    units: normalizeUnits(JSON.parse(r.units_json as string) as Partial<Units>),
    arrivedAt: r.arrived_at as number,
    ranks: parseRanks(r.ranks_json),
  };
}

export class SiteStore extends SqlBase {
  /** A site that has never been held reads as neutral with no calm time (no row yet). */
  getSite(id: number): SiteRow {
    const r = this.get(`SELECT ${SITE_COLS} FROM sites WHERE id = ?`, id);
    return r ? toSite(r) : { id, ...NEW_SITE };
  }

  allSites(): SiteRow[] {
    return this.all(`SELECT ${SITE_COLS} FROM sites ORDER BY id`).map(toSite);
  }

  /** Ids of every site that has a holder or troops standing (the only ones that can need tidying up). */
  activeSiteIds(): number[] {
    return this.all('SELECT id FROM sites WHERE holder_tribe_id IS NOT NULL UNION SELECT DISTINCT site_id AS id FROM site_garrison ORDER BY id').map((r) => r.id as number);
  }

  setHolder(id: number, tribeId: number | null): void {
    this.siteUpkeepTouch();
    this.run('INSERT INTO sites (id, holder_tribe_id, calm_until) VALUES (?, ?, 0) ON CONFLICT(id) DO UPDATE SET holder_tribe_id = excluded.holder_tribe_id', id, tribeId);
  }

  /** Store the Wall: `level` as of `at`. Called after a hit (the Wall then rises again from the new level). */
  setWall(id: number, level: number, at: number): void {
    this.run('INSERT INTO sites (id, wall_level, wall_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET wall_level = excluded.wall_level, wall_at = excluded.wall_at', id, level, at);
  }

  /** Store the keepers' share `base` as of `since` (0 when the holding tribe's last troops leave; the survivors' share after a fight). */
  setKeepers(id: number, base: number, since: number): void {
    this.run('INSERT INTO sites (id, keepers_base, keepers_since) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET keepers_base = excluded.keepers_base, keepers_since = excluded.keepers_since', id, base, since);
  }

  setCalmUntil(id: number, calmUntil: number): void {
    this.siteUpkeepTouch();
    this.run('INSERT INTO sites (id, holder_tribe_id, calm_until) VALUES (?, NULL, ?) ON CONFLICT(id) DO UPDATE SET calm_until = excluded.calm_until', id, calmUntil);
  }

  /** Ids of the sites a tribe holds. */
  heldBy(tribeId: number): number[] {
    return this.all('SELECT id FROM sites WHERE holder_tribe_id = ? ORDER BY id', tribeId).map((r) => r.id as number);
  }

  // ---- garrison ------------------------------------------------------------------------------------------

  garrisonAt(siteId: number): GarrisonRow[] {
    return this.all('SELECT * FROM site_garrison WHERE site_id = ? ORDER BY id', siteId).map(toGarrison);
  }

  garrisonOfPlayer(playerId: number): GarrisonRow[] {
    return this.all('SELECT * FROM site_garrison WHERE owner_player_id = ? ORDER BY site_id, id', playerId).map(toGarrison);
  }

  /** Every contingent at any site, for the list endpoint (at most 9 sites, each bounded by its population cap). */
  allGarrison(): GarrisonRow[] {
    return this.all('SELECT * FROM site_garrison ORDER BY site_id, id').map(toGarrison);
  }

  getGarrison(siteId: number, homeVillageId: number): GarrisonRow | null {
    const r = this.get('SELECT * FROM site_garrison WHERE site_id = ? AND home_village_id = ?', siteId, homeVillageId);
    return r ? toGarrison(r) : null;
  }

  /** Station `units` for a (site, home village) pair: merges into the pair's existing contingent, keeping its arrival time. */
  addGarrison(siteId: number, ownerPlayerId: number, homeVillageId: number, units: Units, arrivedAt: number, ranks: VillageRanks | null): void {
    this.siteUpkeepTouch();
    const old = this.getGarrison(siteId, homeVillageId);
    if (old) {
      this.run('UPDATE site_garrison SET units_json = ?, ranks_json = ? WHERE id = ?', JSON.stringify(addUnits(old.units, units)), ranks ? JSON.stringify(ranks) : null, old.id);
      return;
    }
    this.run(
      'INSERT INTO site_garrison (site_id, owner_player_id, home_village_id, units_json, arrived_at, ranks_json) VALUES (?, ?, ?, ?, ?, ?)',
      siteId,
      ownerPlayerId,
      homeVillageId,
      JSON.stringify(units),
      arrivedAt,
      ranks ? JSON.stringify(ranks) : null,
    );
  }

  setGarrisonUnits(id: number, units: Units): void {
    this.siteUpkeepTouch();
    this.run('UPDATE site_garrison SET units_json = ? WHERE id = ?', JSON.stringify(units), id);
  }

  deleteGarrison(id: number): void {
    this.siteUpkeepTouch();
    this.run('DELETE FROM site_garrison WHERE id = ?', id);
  }
}
