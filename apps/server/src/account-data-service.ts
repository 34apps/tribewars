// Account deletion and data export for one world (docs/PRIVACY.md). The tombstone rules: the players row stays under the name
// "Deleted player <id>" so mail, forum posts, chat and reports that name the id keep working; everything private goes.

import { DELETED_PLAYER_NAME, ENTRY_PASS_CLOCK_SKEW_MS, GameError, type WorldExportDto } from '@clanfire/engine';
import type { GameService } from './game.ts';
import { verifyLobbyCommand } from './lobby-command.ts';
import type { EntryKey } from './entry-pass.ts';
import type { PlayerRow, Store } from './store.ts';
import type { TribeService } from './tribe-service.ts';

export interface DeleteContext {
  /** Who asked: the player themselves, the lobby (account deleted there) or the operator's CLI. */
  via: 'self' | 'lobby' | 'cli';
  actorId: number | null;
  actorIp: string | null;
}

export const tombstoneName = (playerId: number): string => `${DELETED_PLAYER_NAME} ${playerId}`;

export class AccountDataService {
  constructor(
    private readonly store: Store,
    private readonly game: GameService,
    private readonly tribes: TribeService,
    private readonly worldId: string,
    private readonly now: () => number,
  ) {}

  /**
   * Delete the player's account in this world, in one transaction: villages abandoned now (as after the inactivity rule), tribe left (leader hands
   * over, last member disbands), private rows erased, the row turned into a tombstone. Deleting a tombstone again does nothing (false).
   * Own troops standing as support elsewhere, at sites, and every movement of the player are removed together with the villages they belong to
   * (the same consequence an abandoned owner has); other players' troops standing in the player's villages walk home.
   */
  deletePlayer(playerId: number, now: number, ctx: DeleteContext): boolean {
    return this.store.tx(() => {
      const player = this.store.getPlayer(playerId);
      if (!player || player.deletedAt !== null) return false;
      const tomb = tombstoneName(playerId);
      this.game.processDue(now); // arrivals due by now first, so every battle sees the world it expects
      this.tribes.leaveForDeletion(playerId, tomb, now);
      this.game.abandonAllVillagesOf(playerId, now);
      this.store.accountData.erasePrivate(playerId, tomb);
      this.store.accountData.tombstone(playerId, tomb, now);
      this.store.accountData.scrubName(player.username, tomb);
      this.store.markSiteUpkeepDirty();
      this.store.audit({ at: now, actorId: ctx.actorId, actorIp: ctx.actorIp, action: 'account_deleted', targetPlayer: playerId, detail: ctx.via });
      this.store.emit({ kind: 'player-banned', playerId }); // closes the player's live sockets
      return true;
    });
  }

  /** The player's own data in this world. Never the password hash, session tokens, or anyone else's private data. */
  exportFor(player: PlayerRow, now: number): WorldExportDto {
    const body = this.store.accountData.exportBody(player.id);
    const tribe = this.store.tribes.playerTribe(player.id);
    return {
      format: 'clanflame-world-export-v1',
      worldId: this.worldId,
      exportedAt: now,
      player: {
        id: player.id,
        username: player.username,
        chieftain: player.chieftain,
        createdAt: player.createdAt,
        lastActive: player.lastActive,
        tribe: tribe ? { name: tribe.name, tag: tribe.tag } : null,
      },
      villages: this.store.villagesOfPlayer(player.id).map((v) => ({ id: v.id, name: v.name, x: v.x, y: v.y })),
      ...body,
    };
  }

  /** Export of a never-played account: the sections are empty and `player` is null. */
  private emptyExport(now: number): WorldExportDto {
    return {
      format: 'clanflame-world-export-v1',
      worldId: this.worldId,
      exportedAt: now,
      player: null,
      villages: [],
      notes: [],
      troopGroups: [],
      raidLists: [],
      mail: [],
      forumPosts: [],
      tribeChat: [],
      reports: [],
      ips: [],
      devices: [],
      supportTickets: [],
    };
  }

  /**
   * A signed lobby command: verify it, burn its nonce and act, all in one transaction (a failed action gives the nonce back).
   * `account_delete` -> { done: true } (an unknown or already deleted account counts as done); `account_export` -> the world export.
   */
  runLobbyCommand(command: string, keys: readonly EntryKey[], typ: 'account_delete', ip: string | null): { done: true };
  runLobbyCommand(command: string, keys: readonly EntryKey[], typ: 'account_export', ip: string | null): WorldExportDto;
  runLobbyCommand(command: string, keys: readonly EntryKey[], typ: 'account_delete' | 'account_export', ip: string | null): { done: true } | WorldExportDto {
    const now = this.now();
    const claims = verifyLobbyCommand(command, keys, now, this.worldId, typ);
    return this.store.tx(() => {
      this.store.deleteExpiredEntryNonces(now);
      if (!this.store.useEntryNonce(claims.nonce, claims.exp + ENTRY_PASS_CLOCK_SKEW_MS)) throw new GameError('unauthorized', 'This command was already used.');
      const player = this.store.getPlayerByAccountId(claims.aid);
      if (typ === 'account_export') return player && player.deletedAt === null ? this.exportFor(player, now) : this.emptyExport(now);
      if (player) this.deletePlayer(player.id, now, { via: 'lobby', actorId: null, actorIp: ip });
      return { done: true as const };
    });
  }
}
