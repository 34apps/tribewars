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
    const r = this.get('SELECT id, holder_tribe_id, calm_until FROM sites WHERE id = ?', id);
    return r ? { id, holderTribeId: (r.holder_tribe_id as number | null) ?? null, calmUntil: r.calm_until as number } : { id, holderTribeId: null, calmUntil: 0 };
  }

  allSites(): SiteRow[] {
    return this.all('SELECT id, holder_tribe_id, calm_until FROM sites ORDER BY id').map((r) => ({
      id: r.id as number,
      holderTribeId: (r.holder_tribe_id as number | null) ?? null,
      calmUntil: r.calm_until as number,
    }));
  }

  /** Ids of every site that has a holder or troops standing (the only ones that can need tidying up). */
  activeSiteIds(): number[] {
    return this.all('SELECT id FROM sites WHERE holder_tribe_id IS NOT NULL UNION SELECT DISTINCT site_id AS id FROM site_garrison ORDER BY id').map((r) => r.id as number);
  }

  setHolder(id: number, tribeId: number | null): void {
    this.run('INSERT INTO sites (id, holder_tribe_id, calm_until) VALUES (?, ?, 0) ON CONFLICT(id) DO UPDATE SET holder_tribe_id = excluded.holder_tribe_id', id, tribeId);
  }

  setCalmUntil(id: number, calmUntil: number): void {
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
    this.run('UPDATE site_garrison SET units_json = ? WHERE id = ?', JSON.stringify(units), id);
  }

  deleteGarrison(id: number): void {
    this.run('DELETE FROM site_garrison WHERE id = ?', id);
  }
}
