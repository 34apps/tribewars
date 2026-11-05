// Map sites (Fire Shrines): sending, arrival, holding and the Renown bonus (docs/GAME_DESIGN.md 18.4b "Step 5"). The rules and numbers
// are in the engine (sites.ts, config.ts); this file keeps who holds what and applies the rules in arrival order. Troops go to a site
// like any other mission (attack / support to the site's tile; the movement row carries the tile, like a found mission), and stand
// there in `site_garrison`, still counted in their home village's `away` like support in a village.
// Everything here runs inside the caller's transaction (GameService.send / resolveMovement / processDue).

import {
  GameError,
  POP_PER_UNIT,
  UNIT_IDS,
  applyAttackerLosses,
  battleSeed,
  emptyResources,
  emptyUnits,
  isShrineAwake,
  normalizeUnits,
  occupierPopulation,
  resolveSiteBattle,
  settleVillage,
  shrineWakeMs,
  siteBonus,
  siteCalmMs,
  siteMaxPopulation,
  siteMilitia,
  siteMilitiaPopulation,
  totalUnits,
  travelTimeMs,
  tribeRenownBonus,
  villagePoints,
  type BattleReportData,
  type Mission,
  type SiteDef,
  type SiteDto,
  type SitesResponse,
  type Units,
  type VillageRefDto,
  type WorldSettings,
} from '@clanfire/engine';
import { worldCreatedAt } from './domination-service.ts';
import { sitesFor } from './site-layout.ts';
import type { GarrisonRow } from './site-store.ts';
import type { MovementRow, MovementView, PlayerRow, Store, VillageRecord } from './store.ts';
import { isWithin, subtractUnits, sumUnits } from './units.ts';

/** Display name of a site: "Great Fire" or "Fire Shrine 1".."8". */
export function siteName(site: SiteDef): string {
  return site.kind === 'great_fire' ? 'Great Fire' : `Fire Shrine ${site.id - 1}`;
}

const coords = (v: { x: number; y: number }): string => `(${v.x}|${v.y})`;

/** Population of a set of units (the same measure the hold clock and the site cap use). */
const population = (units: Partial<Units>): number => occupierPopulation(units);

/** The most of `units` that fits into `room` population (unit kinds in their fixed order), and what is left over. */
function fitUnits(units: Units, room: number): { fit: Units; rest: Units } {
  const fit = emptyUnits();
  let left = Math.max(0, room);
  for (const u of UNIT_IDS) {
    const n = Math.min(units[u], Math.floor(left / POP_PER_UNIT[u]));
    fit[u] = n;
    left -= n * POP_PER_UNIT[u];
  }
  return { fit, rest: subtractUnits(units, fit) };
}

const minutesLeft = (until: number, t: number): number => Math.max(1, Math.ceil((until - t) / 60_000));

export class SiteService {
  private readonly defs: readonly SiteDef[];
  private created: number | null = null;

  constructor(
    private readonly store: Store,
    private readonly settings: WorldSettings,
    private readonly now: () => number,
  ) {
    this.defs = sitesFor(settings);
    store.siteNameAt = (x, y) => {
      const s = this.at(x, y);
      return s ? siteName(s) : null;
    };
    store.renownBonusOf = (playerId) => this.renownBonusOf(playerId, this.now());
  }

  // ---- the map ---------------------------------------------------------------------------------------------

  at(x: number, y: number): SiteDef | null {
    return this.defs.find((s) => s.x === x && s.y === y) ?? null;
  }

  byId(id: number): SiteDef | null {
    return this.defs.find((s) => s.id === id) ?? null;
  }

  private createdAt(): number {
    this.created ??= worldCreatedAt(this.store, this.now());
    return this.created;
  }

  private awake(t: number): boolean {
    return isShrineAwake(this.createdAt(), t, this.settings);
  }

  private ref(site: SiteDef, holderTag: string | null = null): VillageRefDto {
    return { villageId: 0, name: siteName(site), x: site.x, y: site.y, ownerName: holderTag };
  }

  private tagOf(tribeId: number | null): string | null {
    return tribeId === null ? null : (this.store.tribes.getTribe(tribeId)?.tag ?? null);
  }

  // ---- relations of tribes ---------------------------------------------------------------------------------

  /** May `playerId` station troops at a site held by `holder` (own tribe or an ally)? */
  private supportAllowed(playerId: number, holder: number, t: number): boolean {
    const m = this.store.tribes.membership(playerId);
    if (!m) return false;
    if (m.tribeId === holder) return true;
    return this.store.tribes.relationBetween(m.tribeId, holder, t)?.kind === 'ally';
  }

  /** Tribe-mates, allies and NAP partners of the holder cannot attack its site (the same protection as for villages). */
  private attackForbidden(tribeId: number, holder: number, t: number): boolean {
    if (tribeId === holder) return true;
    const kind = this.store.tribes.relationBetween(tribeId, holder, t)?.kind;
    return kind === 'ally' || kind === 'nap';
  }

  // ---- sending (checks only; the movement itself is created by GameService.send) -------------------------------

  /** Throws a GameError when `player` may not send `mission` with `army` from `home` to `site` now. */
  checkSend(player: PlayerRow, site: SiteDef, mission: Mission, army: Units, t: number): void {
    const name = siteName(site);
    if (mission !== 'attack' && mission !== 'support') throw new GameError('invalid_target', `${name} can only be attacked or supported.`);
    if (army.chieftain > 0) throw new GameError('invalid_target', 'Chieftains cannot go to a site: send fighters.');
    const mine = this.store.tribes.membership(player.id);
    if (!mine) throw new GameError('invalid_target', 'Only members of a tribe can attack or support a site. Join or found a tribe first.');
    this.reconcileSite(site.id, t);
    const row = this.store.sites.getSite(site.id);
    const holder = row.holderTribeId;
    if (mission === 'attack') {
      if (row.calmUntil > t) {
        throw new GameError('target_protected', `${name} is calm after a capture: it cannot be attacked for another ${minutesLeft(row.calmUntil, t)} min.`);
      }
      if (holder !== null) {
        if (this.attackForbidden(mine.tribeId, holder, t)) throw new GameError('invalid_target', `Your tribe, an ally or a pact partner holds ${name}: you can't attack it.`);
        this.refuseHousehold(player.id, this.store.sites.garrisonAt(site.id));
      }
      return;
    }
    if (holder === null) throw new GameError('invalid_target', `Nobody holds ${name}: attack it to take it.`);
    if (!this.supportAllowed(player.id, holder, t)) throw new GameError('invalid_target', 'You can only send support to a site held by your own tribe or an ally.');
    const room = siteMaxPopulation(site.kind) - this.garrisonPopulation(site.id);
    if (population(army) > room) {
      throw new GameError('invalid_target', `${name} takes at most ${siteMaxPopulation(site.kind)} population; ${Math.max(0, room)} still fits.`);
    }
  }

  private refuseHousehold(senderId: number, garrison: readonly GarrisonRow[]): void {
    if (garrison.some((c) => c.ownerPlayerId !== senderId && this.store.shareAnIp(senderId, c.ownerPlayerId))) {
      throw new GameError('invalid_target', 'You share a connection with a player whose troops stand there, so you cannot attack it.');
    }
  }

  private garrisonPopulation(siteId: number): number {
    return this.store.sites.garrisonAt(siteId).reduce((n, c) => n + population(c.units), 0);
  }

  // ---- keeping the holder true -------------------------------------------------------------------------------

  /**
   * Make the stored state of every site that has a holder or troops true to the rules, as of `t`: troops of players who left the
   * tribe, were banned, lost their village or whose tribe is no longer allied go home; with no troop of the holding tribe left the
   * site is neutral again and the allies' troops go home. Called after every batch of arrivals (every request and the 1 s tick);
   * cheap when no site is held.
   */
  reconcileAll(t: number): void {
    const ids = this.store.sites.activeSiteIds();
    if (ids.length === 0) return;
    this.store.tx(() => {
      for (const id of ids) this.reconcileSite(id, t);
    });
  }

  reconcileSite(siteId: number, t: number): void {
    const site = this.byId(siteId);
    if (!site) return;
    const ss = this.store.sites;
    const row = ss.getSite(siteId);
    const holder = row.holderTribeId;
    const garrison = ss.garrisonAt(siteId);
    if (garrison.length === 0) {
      if (holder !== null) ss.setHolder(siteId, null);
      return;
    }
    const keep: GarrisonRow[] = [];
    let members = 0;
    for (const c of garrison) {
      const home = this.store.getVillage(c.homeVillageId);
      const owner = this.store.getPlayer(c.ownerPlayerId);
      // The village changed hands or the player is gone: the troops are disbanded (as stationed support is).
      if (!home || home.ownerId !== c.ownerPlayerId || !owner) {
        ss.deleteGarrison(c.id);
        continue;
      }
      const tribeId = this.store.tribes.membership(c.ownerPlayerId)?.tribeId ?? null;
      const isMember = holder !== null && tribeId === holder;
      const isAlly = holder !== null && tribeId !== null && !isMember && this.store.tribes.relationBetween(tribeId, holder, t)?.kind === 'ally';
      if (owner.bannedAt === null && (isMember || isAlly)) {
        keep.push(c);
        if (isMember) members++;
      } else {
        this.sendHome(c, home, site, t);
      }
    }
    if (members === 0) {
      for (const c of keep) {
        const home = this.store.getVillage(c.homeVillageId);
        if (home) this.sendHome(c, home, site, t);
        else ss.deleteGarrison(c.id);
      }
      if (holder !== null) ss.setHolder(siteId, null);
    }
  }

  /** The contingent leaves the site and walks home from the site's tile. */
  private sendHome(c: GarrisonRow, home: VillageRecord, site: SiteDef, t: number): number | null {
    this.store.sites.deleteGarrison(c.id);
    if (totalUnits(c.units) === 0) return null;
    return this.returnFromTile(home, site, c.units, t).arriveAt;
  }

  private returnFromTile(home: VillageRecord, tile: { x: number; y: number }, units: Units, t: number, travelMs?: number): { id: number; arriveAt: number } {
    const arriveAt = t + (travelMs ?? travelTimeMs(tile, { x: home.x, y: home.y }, units, this.settings));
    const id = this.store.insertMovement({
      kind: 'return',
      originVillageId: home.id,
      targetVillageId: home.id,
      units,
      loot: emptyResources(),
      departAt: t,
      arriveAt,
      targetX: tile.x,
      targetY: tile.y,
    });
    return { id, arriveAt };
  }

  // ---- arrivals --------------------------------------------------------------------------------------------

  /** Earliest of two optional arrival times. */
  private soonest(a: number | null, b: number | null): number | null {
    return a === null ? b : b === null ? a : Math.min(a, b);
  }

  /**
   * An attack reaches a site. Calm time, a changed relation, a shared connection or a finished world turn it back (the sender is told).
   * Otherwise it fights the militia of a neutral site, or the troops standing at a held one, by the usual battle rules (no walls, no loot,
   * no siege damage). A win kills every defender and the survivors stay as the garrison (up to the site's cap): their tribe holds the
   * site and it is calm for SITE_CALM_HOURS. Returns the earliest arrival of any return it started.
   */
  resolveAttack(m: MovementRow): number | null {
    const s = this.settings;
    const origin = this.store.getVillage(m.originVillageId);
    const site = m.targetX != null && m.targetY != null ? this.at(m.targetX, m.targetY) : null;
    if (!origin || origin.ownerId === null || !site) {
      this.store.deleteMovement(m.id);
      return null;
    }
    const at = m.arriveAt;
    const ownerId = origin.ownerId;
    const ss = this.store.sites;
    if (this.store.isWorldEnded()) return this.callOff(m, origin, site, 'the world has ended');
    this.reconcileSite(site.id, at);
    const row = ss.getSite(site.id);
    const mine = this.store.tribes.membership(ownerId);
    if (!mine) return this.callOff(m, origin, site, 'you are no longer in a tribe');
    if (row.calmUntil > at) return this.callOff(m, origin, site, 'it is calm after a capture');
    const holder = row.holderTribeId;
    if (holder !== null && this.attackForbidden(mine.tribeId, holder, at)) return this.callOff(m, origin, site, 'its holder is now your tribe, an ally or a pact partner');
    const garrison = holder !== null ? ss.garrisonAt(site.id) : [];
    if (garrison.some((c) => c.ownerPlayerId !== ownerId && this.store.shareAnIp(ownerId, c.ownerPlayerId))) {
      return this.callOff(m, origin, site, 'you share a connection with a player whose troops stand there');
    }

    const militia = holder === null ? siteMilitia(site.kind, this.awake(at)) : emptyUnits();
    const originState = settleVillage(origin.state, at, s);
    const result = resolveSiteBattle({
      attackerUnits: m.units,
      militia,
      support: garrison.map((c) => c.units),
      attackerRanks: m.ranks ?? undefined,
      supportRanks: garrison.map((c) => c.ranks ?? undefined),
      seed: battleSeed(this.store.battleSalt(), m.id, at),
    });
    const survivors = result.attackerSurvivors;
    const survived = totalUnits(survivors) > 0;

    const newOrigin = applyAttackerLosses(originState, result.attackerLosses);
    this.store.saveVillage(origin.id, newOrigin, villagePoints(newOrigin));
    // The defenders: a won attack kills everybody standing there; a lost one costs them what the battle says.
    const garrisonLosses = garrison.map((c, i) => (result.attackerWon ? c.units : normalizeUnits(result.supportLosses[i])));
    this.applyGarrisonLosses(garrison, garrisonLosses, at);

    // A win with survivors: they stay and their tribe takes the site; up to the cap, the rest walk home.
    const captured = result.attackerWon && survived;
    let back: number | null = null;
    if (captured) {
      const { fit, rest } = fitUnits(survivors, siteMaxPopulation(site.kind));
      ss.setHolder(site.id, mine.tribeId);
      ss.setCalmUntil(site.id, at + siteCalmMs(s));
      ss.addGarrison(site.id, ownerId, origin.id, fit, at, m.ranks ?? null);
      if (totalUnits(rest) > 0) back = this.returnFromTile(origin, site, rest, at).arriveAt;
    } else {
      if (survived) back = this.returnFromTile(origin, site, survivors, at).arriveAt;
      if (result.attackerWon) ss.setHolder(site.id, null); // everything fell and nobody is left to hold it
    }
    this.reconcileSite(site.id, at); // a lost attack may have wiped out the holder's own troops

    this.reportBattle(m, origin, site, row.holderTribeId, garrison, garrisonLosses, result, survived, captured, at);
    this.store.deleteMovement(m.id);
    return back;
  }

  /** Take the dead off each contingent and off their owners' home villages `away` count (settled first). */
  private applyGarrisonLosses(garrison: readonly GarrisonRow[], losses: readonly Units[], t: number): void {
    garrison.forEach((c, i) => {
      const loss = losses[i];
      if (!loss || totalUnits(loss) === 0) return;
      const left = subtractUnits(c.units, loss);
      if (totalUnits(left) === 0) this.store.sites.deleteGarrison(c.id);
      else this.store.sites.setGarrisonUnits(c.id, left);
      const home = this.store.getVillage(c.homeVillageId);
      if (!home) return;
      const next = applyAttackerLosses(settleVillage(home.state, t, this.settings), loss);
      this.store.saveVillage(home.id, next, villagePoints(next));
    });
  }

  private reportBattle(
    m: MovementRow,
    origin: VillageRecord,
    site: SiteDef,
    holderTribeId: number | null,
    garrison: readonly GarrisonRow[],
    garrisonLosses: readonly Units[],
    result: ReturnType<typeof resolveSiteBattle>,
    survived: boolean,
    captured: boolean,
    at: number,
  ): void {
    const siteRef = this.ref(site, this.tagOf(holderTribeId));
    const full: BattleReportData = {
      outcome: 'battle',
      attacker: { villageId: origin.id, name: origin.name, x: origin.x, y: origin.y, ownerName: origin.ownerName },
      defender: siteRef,
      attackerWon: result.attackerWon,
      luck: result.luck,
      attackPower: result.attackPower,
      defensePower: result.defensePower,
      attackerUnits: m.units,
      attackerLosses: result.attackerLosses,
      defenderUnits: result.defenderUnits,
      defenderLosses: result.defenderLosses,
      supportUnits: garrison.length > 0 ? sumUnits(garrison.map((c) => c.units)) : null,
      supportLosses: garrison.length > 0 ? sumUnits([...garrisonLosses]) : null,
      wallLevel: null,
      loot: emptyResources(),
    };
    // An army wiped out sees nothing of the defence.
    const seen: BattleReportData = survived ? full : { ...full, defenderUnits: null, defenderLosses: null, supportUnits: null, supportLosses: null };
    const name = siteName(site);
    this.store.insertReport({
      playerId: origin.ownerId as number,
      side: 'attack',
      won: result.attackerWon,
      title: captured ? `Your tribe took ${name} ${coords(site)}` : `Attack on ${name} ${coords(site)}`,
      createdAt: at,
      type: 'battle',
      battle: seen,
    });
    // Everyone who had troops standing there gets the full picture (one report per owner).
    for (const ownerId of new Set(garrison.map((c) => c.ownerPlayerId))) {
      this.store.insertReport({
        playerId: ownerId,
        side: 'support',
        won: !result.attackerWon,
        title: `Your troops at ${name} ${coords(site)} were attacked`,
        createdAt: at,
        type: 'battle',
        battle: full,
      });
    }
  }

  /** The attack does not happen: the troops turn round at the site and walk home, and the sender is told why. */
  private callOff(m: MovementRow, origin: VillageRecord, site: SiteDef, why: string): number | null {
    const at = m.arriveAt;
    const name = siteName(site);
    this.store.insertReport({
      playerId: origin.ownerId as number,
      side: 'attack',
      won: false,
      title: `Attack on ${name} ${coords(site)} called off: ${why}`,
      createdAt: at,
      type: 'battle',
      battle: {
        outcome: 'called_off',
        attacker: { villageId: origin.id, name: origin.name, x: origin.x, y: origin.y, ownerName: origin.ownerName },
        defender: this.ref(site),
        attackerWon: false,
        luck: 0,
        attackPower: 0,
        defensePower: 0,
        attackerUnits: m.units,
        attackerLosses: emptyUnits(),
        defenderUnits: null,
        defenderLosses: null,
        supportUnits: null,
        supportLosses: null,
        wallLevel: null,
        loot: emptyResources(),
      },
    });
    const back = this.returnFromTile(origin, site, m.units, at).arriveAt;
    this.store.deleteMovement(m.id);
    return back;
  }

  /**
   * Support reaches a site. Only while the site is still held by the sender's tribe or an ally; what does not fit under the cap
   * walks home. Anything else turns the whole army back and tells the sender.
   */
  resolveSupport(m: MovementRow): number | null {
    const origin = this.store.getVillage(m.originVillageId);
    const site = m.targetX != null && m.targetY != null ? this.at(m.targetX, m.targetY) : null;
    if (!origin || origin.ownerId === null || !site) {
      this.store.deleteMovement(m.id);
      return null;
    }
    const at = m.arriveAt;
    const ownerId = origin.ownerId;
    let refusal: string | null = null;
    let fit = emptyUnits();
    let rest = m.units;
    if (this.store.isWorldEnded()) {
      refusal = 'the world has ended';
    } else {
      this.reconcileSite(site.id, at);
      const holder = this.store.sites.getSite(site.id).holderTribeId;
      if (holder === null) refusal = 'nobody holds the site any more';
      else if (!this.supportAllowed(ownerId, holder, at)) refusal = 'your tribe is not the holder or an ally of the holder';
      else {
        ({ fit, rest } = fitUnits(m.units, siteMaxPopulation(site.kind) - this.garrisonPopulation(site.id)));
        if (totalUnits(fit) === 0) refusal = 'the site is full';
      }
    }
    const name = siteName(site);
    if (refusal !== null) {
      this.store.insertReport({
        playerId: ownerId,
        side: 'support',
        won: false,
        title: `Support for ${name} ${coords(site)} turned back: ${refusal}`,
        createdAt: at,
        type: 'support',
        support: { reason: 'relation_changed', home: { villageId: origin.id, name: origin.name, x: origin.x, y: origin.y, ownerName: origin.ownerName }, host: this.ref(site), units: m.units },
      });
      const back = this.returnFromTile(origin, site, m.units, at).arriveAt;
      this.store.deleteMovement(m.id);
      return back;
    }
    this.store.sites.addGarrison(site.id, ownerId, origin.id, fit, at, m.ranks ?? null);
    this.store.addStats(ownerId, { supportSent: 1 });
    this.store.deleteMovement(m.id);
    return totalUnits(rest) > 0 ? this.returnFromTile(origin, site, rest, at).arriveAt : null;
  }

  // ---- recall ----------------------------------------------------------------------------------------------

  /** The owner brings troops of one of their villages home from a site (all of them when `units` is omitted). Returns the new return movement. */
  recall(player: PlayerRow, siteId: number, villageId: number, units: Partial<Units> | undefined, t: number): MovementView {
    const site = this.byId(siteId);
    if (!site) throw new GameError('not_found', 'Site not found.');
    const home = this.store.getVillage(villageId);
    if (!home || home.ownerId !== player.id) throw new GameError('not_found', 'Those troops are not stationed there.');
    const row = this.store.sites.getGarrison(siteId, villageId);
    if (!row || row.ownerPlayerId !== player.id) throw new GameError('not_found', 'Those troops are not stationed there.');
    const want = units === undefined ? row.units : normalizeUnits(units);
    if (totalUnits(want) === 0) throw new GameError('no_troops', 'Select at least one unit.');
    if (!isWithin(want, row.units)) throw new GameError('not_enough_troops', 'You do not have that many troops stationed there.');
    const left = subtractUnits(row.units, want);
    if (totalUnits(left) === 0) this.store.sites.deleteGarrison(row.id);
    else this.store.sites.setGarrisonUnits(row.id, left);
    const id = this.returnFromTile(home, site, want, t).id;
    // The last troop of the holding tribe leaving makes the site neutral and sends the allies home.
    this.reconcileSite(siteId, t);
    const view = this.store.getMovementView(id);
    if (!view) throw new Error('movement vanished after insert');
    return view;
  }

  // ---- reads -----------------------------------------------------------------------------------------------

  /** Renown bonus (0.1 = +10%) the player's tribe earns from the sites it holds at `t`; 0 without a tribe or a held site. */
  renownBonusOf(playerId: number, t: number): number {
    const m = this.store.tribes.membership(playerId);
    if (!m) return 0;
    const held = this.store.sites.heldBy(m.tribeId);
    if (held.length === 0) return 0;
    const awake = this.awake(t);
    const kinds = held.flatMap((id) => {
      const d = this.byId(id);
      return d ? [{ kind: d.kind, awake }] : [];
    });
    return tribeRenownBonus(kinds);
  }

  /** GET /api/sites: every site with its holder, garrison size, calm time and bonus. Reads only. */
  list(player: PlayerRow, t: number): SitesResponse {
    const awake = this.awake(t);
    const rows = new Map(this.store.sites.allSites().map((r) => [r.id, r]));
    const garrison = this.store.sites.allGarrison();
    const sites: SiteDto[] = this.defs.map((d) => {
      const row = rows.get(d.id) ?? { id: d.id, holderTribeId: null, calmUntil: 0 };
      const tribe = row.holderTribeId !== null ? this.store.tribes.getTribe(row.holderTribeId) : null;
      const here = garrison.filter((c) => c.siteId === d.id);
      const mineHere = here.filter((c) => c.ownerPlayerId === player.id);
      const held = tribe !== null;
      return {
        id: d.id,
        kind: d.kind,
        x: d.x,
        y: d.y,
        awake,
        holder: tribe ? { tribeId: tribe.id, name: tribe.name, tag: tribe.tag } : null,
        garrison: held ? here.reduce((n, c) => n + population(c.units), 0) : siteMilitiaPopulation(d.kind, awake),
        maxPopulation: siteMaxPopulation(d.kind),
        calmUntil: row.calmUntil > t ? row.calmUntil : null,
        bonus: held ? siteBonus(d.kind, awake) : 0,
        mine: mineHere.reduce((n, c) => n + population(c.units), 0),
        ...(mineHere.length > 0
          ? {
              myContingents: mineHere.map((c) => ({
                villageId: c.homeVillageId,
                villageName: this.store.getVillage(c.homeVillageId)?.name ?? '?',
                units: c.units,
                arrivedAt: c.arrivedAt,
              })),
            }
          : {}),
      };
    });
    return { sites, wakesAt: this.createdAt() + shrineWakeMs(this.settings), myBonus: this.renownBonusOf(player.id, t) };
  }
}
