// Raid lists, a paid extra (docs/GAME_DESIGN.md "Raid lists"; contract in packages/engine/src/api.ts). Convenience only: a row is an ordinary
// attack on an abandoned village, sent through GameService.send with every check a manual send has (troops at home, protection, march cap),
// plus the per-account `send` rate limit charged once per row. Nothing here decides a time, a price or a battle.

import {
  GameError,
  RAID_LIST_MAX_LISTS,
  RAID_LIST_MAX_ROWS,
  RAID_LIST_SEND_CAP,
  checkRaidListName,
  checkRaidRowUnits,
  distance,
  hasRaidListsExtra,
  normalizeUnits,
  travelTimeMs,
  worldRules,
  type Coords,
  type RaidListDto,
  type RaidListResponse,
  type RaidListSendResponse,
  type RaidListsResponse,
  type RaidRowRequest,
  type RaidRowUpdateRequest,
  type RaidSendResult,
  type RaidSkipReason,
  type WorldSettings,
} from '@clanfire/engine';
import type { GameService } from './game.ts';
import type { RaidListRow, RaidRow } from './raid-list-store.ts';
import type { PlayerRow, Store } from './store.ts';

const notFound = (): GameError => new GameError('not_found', 'That raid list does not exist.');
const rowNotFound = (): GameError => new GameError('not_found', 'That raid list row does not exist.');

/** Which skip reason a refusal of the normal send maps to. */
function reasonOf(err: GameError): RaidSkipReason {
  switch (err.code) {
    case 'not_enough_troops':
    case 'no_troops':
      return 'not_enough_troops';
    case 'target_protected':
      return 'target_protected';
    case 'invalid_target':
      return 'invalid_target';
    case 'march_limit':
      return 'march_limit';
    case 'forbidden':
    case 'not_found':
      return 'village_gone';
    default:
      return 'other';
  }
}

export class RaidListService {
  constructor(
    private readonly store: Store,
    private readonly settings: WorldSettings,
    private readonly game: GameService,
  ) {}

  private enabled(): boolean {
    return worldRules(this.settings).features.raidLists;
  }

  /** Both the world switch and the player's extra; otherwise 403 saying which one is missing. */
  private requireAccess(player: PlayerRow): void {
    if (!this.enabled()) throw new GameError('forbidden', 'Raid lists are not switched on in this world.');
    if (!hasRaidListsExtra(this.game.premiumBits(player))) throw new GameError('forbidden', 'Raid lists are a paid extra, and this account does not have it.');
  }

  private ownList(player: PlayerRow, id: number): RaidListRow {
    const list = this.store.raidLists.list(player.id, id);
    if (!list) throw notFound();
    return list;
  }

  // ---- reads ---------------------------------------------------------------------------------

  /** Always answers; the lists themselves only when the world switch is on and the player has the extra. */
  snapshot(player: PlayerRow): RaidListsResponse {
    const enabled = this.enabled();
    const entitled = hasRaidListsExtra(this.game.premiumBits(player));
    const limits = { lists: RAID_LIST_MAX_LISTS, rows: RAID_LIST_MAX_ROWS, sendCap: RAID_LIST_SEND_CAP };
    if (!enabled || !entitled) return { enabled, entitled, limits, lists: [] };
    const lists = this.store.raidLists.lists(player.id);
    const rows = this.store.raidLists.rowsOf(player.id);
    const ctx = this.dtoContext(player, rows.length > 0);
    return { enabled, entitled, limits, lists: lists.map((l) => this.listDto(l, rows.filter((r) => r.listId === l.id), ctx)) };
  }

  private dtoContext(player: PlayerRow, hasRows: boolean) {
    return {
      last: hasRows ? this.store.raidLists.lastRaids(player.id) : new Map(),
      waymarks: hasRows ? this.game.sites.waymarksForPlayer(player.id) : [],
    };
  }

  private listDto(list: RaidListRow, rows: RaidRow[], ctx: ReturnType<RaidListService['dtoContext']>): RaidListDto {
    return {
      id: list.id,
      name: list.name,
      rows: rows.flatMap((row) => {
        const target = this.store.getVillage(row.villageId);
        if (!target) return [];
        const from: Coords | null = this.store.getVillage(row.fromVillageId);
        const units = normalizeUnits(row.units);
        const ms = from ? travelTimeMs(from, target, units, this.settings, ctx.waymarks) : Infinity;
        return [
          {
            id: row.id,
            villageId: target.id,
            x: target.x,
            y: target.y,
            name: target.name,
            abandoned: target.ownerId === null,
            fromVillageId: row.fromVillageId,
            units: row.units,
            distance: from ? Math.round(distance(from, target) * 10) / 10 : 0,
            travelSeconds: Number.isFinite(ms) ? Math.ceil(ms / 1000) : 0,
            last: ctx.last.get(target.id) ?? null,
          },
        ];
      }),
    };
  }

  private listResponse(player: PlayerRow, listId: number): RaidListResponse {
    const list = this.ownList(player, listId);
    const rows = this.store.raidLists.rowsOfList(player.id, listId);
    return { list: this.listDto(list, rows, this.dtoContext(player, rows.length > 0)) };
  }

  // ---- lists ---------------------------------------------------------------------------------

  createList(player: PlayerRow, name: unknown, t: number): RaidListResponse {
    this.requireAccess(player);
    const n = checkRaidListName(name);
    if (!n.ok) throw new GameError('invalid_input', n.message);
    return this.store.tx(() => {
      if (this.store.raidLists.listCount(player.id) >= RAID_LIST_MAX_LISTS) {
        throw new GameError('raid_list_limit', `You can keep at most ${RAID_LIST_MAX_LISTS} raid lists. Delete one first.`);
      }
      const id = this.store.raidLists.insertList(player.id, n.name, t);
      return this.listResponse(player, id);
    });
  }

  renameList(player: PlayerRow, listId: number, name: unknown): RaidListResponse {
    this.requireAccess(player);
    const n = checkRaidListName(name);
    if (!n.ok) throw new GameError('invalid_input', n.message);
    return this.store.tx(() => {
      if (!this.store.raidLists.renameList(player.id, listId, n.name)) throw notFound();
      return this.listResponse(player, listId);
    });
  }

  deleteList(player: PlayerRow, listId: number): void {
    this.requireAccess(player);
    if (!this.store.tx(() => this.store.raidLists.deleteList(player.id, listId))) throw notFound();
  }

  // ---- rows ----------------------------------------------------------------------------------

  /** The sending village must be the caller's own (same answers as the normal send route). */
  private ownFrom(player: PlayerRow, villageId: number): void {
    const v = this.store.getVillage(villageId);
    if (!v) throw new GameError('not_found', 'Village not found.');
    if (v.ownerId !== player.id) throw new GameError('forbidden', 'That is not your village.');
  }

  addRow(player: PlayerRow, listId: number, body: RaidRowRequest, t: number): RaidListResponse {
    this.requireAccess(player);
    const u = checkRaidRowUnits(body.units);
    if (!u.ok) throw new GameError('invalid_input', u.message);
    return this.store.tx(() => {
      this.ownList(player, listId);
      this.ownFrom(player, body.fromVillageId);
      const target = this.store.getVillageAt(body.x, body.y);
      if (!target) throw new GameError('invalid_target', 'There is no village at those coordinates.');
      if (target.ownerId !== null) throw new GameError('invalid_target', 'Only abandoned villages can go on a raid list.');
      if (this.store.raidLists.hasVillage(player.id, listId, target.id)) throw new GameError('invalid_input', 'That village is already in this list.');
      if (this.store.raidLists.rowCount(player.id, listId) >= RAID_LIST_MAX_ROWS) {
        throw new GameError('raid_list_limit', `A raid list holds at most ${RAID_LIST_MAX_ROWS} villages.`);
      }
      this.store.raidLists.insertRow(player.id, listId, target.id, body.fromVillageId, u.units, t);
      return this.listResponse(player, listId);
    });
  }

  updateRow(player: PlayerRow, listId: number, rowId: number, body: RaidRowUpdateRequest): RaidListResponse {
    this.requireAccess(player);
    if (body.fromVillageId === undefined && body.units === undefined) throw new GameError('invalid_input', 'Nothing to change.');
    let units: RaidRow['units'] | undefined;
    if (body.units !== undefined) {
      const u = checkRaidRowUnits(body.units);
      if (!u.ok) throw new GameError('invalid_input', u.message);
      units = u.units;
    }
    return this.store.tx(() => {
      this.ownList(player, listId);
      const row = this.store.raidLists.row(player.id, listId, rowId);
      if (!row) throw rowNotFound();
      if (body.fromVillageId !== undefined) this.ownFrom(player, body.fromVillageId);
      this.store.raidLists.updateRow(player.id, listId, rowId, body.fromVillageId ?? row.fromVillageId, units ?? row.units);
      return this.listResponse(player, listId);
    });
  }

  deleteRow(player: PlayerRow, listId: number, rowId: number): RaidListResponse {
    this.requireAccess(player);
    return this.store.tx(() => {
      this.ownList(player, listId);
      if (!this.store.raidLists.deleteRow(player.id, listId, rowId)) throw rowNotFound();
      return this.listResponse(player, listId);
    });
  }

  // ---- send ----------------------------------------------------------------------------------

  /**
   * "Send all": every chosen row (list order) is one ordinary attack through GameService.send, in its own transaction, at the server clock.
   * At most RAID_LIST_SEND_CAP rows are tried per press. Each tried row is charged to the account's `send` rate limit (`charge`, one hit per
   * row), so a press can never do more than the same number of manual sends; when the limit runs out the rest are skipped as rate_limited.
   * A row whose target is no longer abandoned is never sent, so a list cannot be used to attack a player.
   */
  send(player: PlayerRow, listId: number, rowIds: readonly number[] | undefined, t: number, charge: () => boolean): RaidListSendResponse {
    this.requireAccess(player);
    const list = this.ownList(player, listId);
    const all = this.store.raidLists.rowsOfList(player.id, list.id);
    let chosen = all;
    if (rowIds !== undefined) {
      const ids = new Set(rowIds);
      const known = new Set(all.map((r) => r.id));
      for (const id of ids) if (!known.has(id)) throw rowNotFound(); // a row of another list or player looks like a missing one
      chosen = all.filter((r) => ids.has(r.id));
    }

    const results: RaidSendResult[] = [];
    const skip = (rowId: number, reason: RaidSkipReason, message: string): void => {
      results.push({ rowId, ok: false, reason, message });
    };
    let tried = 0;
    let limited = false;
    for (const row of chosen) {
      if (tried >= RAID_LIST_SEND_CAP) {
        skip(row.id, 'press_cap', `One press sends at most ${RAID_LIST_SEND_CAP} villages. Press again for the rest.`);
        continue;
      }
      if (limited) {
        skip(row.id, 'rate_limited', 'Too many sends this minute. Wait a moment and press again.');
        continue;
      }
      const target = this.store.getVillage(row.villageId);
      if (!target) {
        skip(row.id, 'invalid_target', 'That village is gone.');
        continue;
      }
      if (target.ownerId !== null) {
        skip(row.id, 'not_abandoned', 'That village belongs to a player now. Remove it from the list.');
        continue;
      }
      if (!charge()) {
        limited = true;
        skip(row.id, 'rate_limited', 'Too many sends this minute. Wait a moment and press again.');
        continue;
      }
      tried++;
      try {
        // Check and send in one transaction: the target cannot change hands between the two.
        const sent = this.store.tx(() => {
          const now = this.store.getVillage(row.villageId);
          if (!now || now.ownerId !== null) return null;
          return this.game.send(player, row.fromVillageId, now.x, now.y, row.units, 'attack', t);
        });
        if (!sent) skip(row.id, 'not_abandoned', 'That village belongs to a player now. Remove it from the list.');
        else results.push({ rowId: row.id, ok: true, movementId: sent.movement.id, arriveAt: sent.movement.arriveAt });
      } catch (err) {
        if (!(err instanceof GameError)) throw err;
        skip(row.id, reasonOf(err), err.message);
      }
    }
    const sentCount = results.filter((r) => r.ok).length;
    return { results, sent: sentCount, skipped: results.length - sentCount };
  }
}
