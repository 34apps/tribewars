// SQL for the notifications table (docs/GAME_DESIGN.md 18.10): prepared statements with bound parameters only.
// One row per incoming attack / support / shipment, for the target's owner. Rows never hold units.

import type { NotificationKind } from '@clanfire/engine';
import { SqlBase, type Raw } from './sql.ts';

export interface NotificationRow {
  id: number;
  playerId: number;
  kind: NotificationKind;
  movementId: number;
  originVillageId: number;
  targetVillageId: number;
  departAt: number;
  arriveAt: number;
  createdAt: number;
  read: boolean;
  origin: VillageStubRow;
  target: VillageStubRow;
}

export interface VillageStubRow {
  villageId: number;
  name: string;
  x: number;
  y: number;
  ownerName: string | null;
}

const SELECT = `SELECT n.id, n.player_id, n.kind, n.movement_id, n.origin_village_id, n.target_village_id, n.depart_at, n.arrive_at,
       n.created_at, n.read,
       o.name AS o_name, o.x AS o_x, o.y AS o_y, op.username AS o_owner,
       t.name AS t_name, t.x AS t_x, t.y AS t_y, tp.username AS t_owner
  FROM notifications n
  JOIN villages o ON o.id = n.origin_village_id
  JOIN villages t ON t.id = n.target_village_id
  LEFT JOIN players op ON op.id = o.owner_id
  LEFT JOIN players tp ON tp.id = t.owner_id`;

const toRow = (r: Raw): NotificationRow => ({
  id: r.id as number,
  playerId: r.player_id as number,
  kind: r.kind as NotificationKind,
  movementId: r.movement_id as number,
  originVillageId: r.origin_village_id as number,
  targetVillageId: r.target_village_id as number,
  departAt: r.depart_at as number,
  arriveAt: r.arrive_at as number,
  createdAt: r.created_at as number,
  read: (r.read as number) === 1,
  origin: { villageId: r.origin_village_id as number, name: r.o_name as string, x: r.o_x as number, y: r.o_y as number, ownerName: (r.o_owner as string | null) ?? null },
  target: { villageId: r.target_village_id as number, name: r.t_name as string, x: r.t_x as number, y: r.t_y as number, ownerName: (r.t_owner as string | null) ?? null },
});

export class NotificationStore extends SqlBase {
  /** Add a row for `playerId`, then prune: at most `keep` rows per player and nothing older than `maxAgeMs`. Tells the player's sockets. */
  insert(
    playerId: number,
    kind: NotificationKind,
    movementId: number,
    originVillageId: number,
    targetVillageId: number,
    departAt: number,
    arriveAt: number,
    now: number,
    keep: number,
    maxAgeMs: number,
  ): number {
    const id = this.run(
      'INSERT INTO notifications (player_id, kind, movement_id, origin_village_id, target_village_id, depart_at, arrive_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      playerId,
      kind,
      movementId,
      originVillageId,
      targetVillageId,
      departAt,
      arriveAt,
      now,
    ).id;
    this.prune(playerId, now, keep, maxAgeMs);
    this.emit({ kind: 'player', playerId, topics: ['notifications'] });
    return id;
  }

  /** Newest first, at most `limit`. Villages that no longer exist drop out of the join. */
  list(playerId: number, limit: number): NotificationRow[] {
    return this.all(`${SELECT} WHERE n.player_id = ? ORDER BY n.id DESC LIMIT ?`, playerId, limit).map(toRow);
  }

  unreadCount(playerId: number): number {
    const r = this.get('SELECT COUNT(*) AS n FROM notifications WHERE player_id = ? AND read = 0', playerId);
    return r ? Number(r.n) : 0;
  }

  /** Mark this player's own rows read (`ids`, or every row when null). Rows of other players are never touched. */
  markRead(playerId: number, ids: readonly number[] | null): void {
    if (ids === null) {
      this.run('UPDATE notifications SET read = 1 WHERE player_id = ? AND read = 0', playerId);
      return;
    }
    for (const id of ids) this.run('UPDATE notifications SET read = 1 WHERE player_id = ? AND id = ? AND read = 0', playerId, id);
  }

  /** A cancelled movement takes its notification back. Tells the owner's sockets when a row went. */
  deleteForMovement(movementId: number): void {
    const rows = this.all('SELECT DISTINCT player_id FROM notifications WHERE movement_id = ?', movementId);
    if (rows.length === 0) return;
    this.run('DELETE FROM notifications WHERE movement_id = ?', movementId);
    for (const r of rows) this.emit({ kind: 'player', playerId: r.player_id as number, topics: ['notifications'] });
  }

  private prune(playerId: number, now: number, keep: number, maxAgeMs: number): void {
    this.run('DELETE FROM notifications WHERE player_id = ? AND created_at < ?', playerId, now - maxAgeMs);
    this.run(
      'DELETE FROM notifications WHERE player_id = ? AND id NOT IN (SELECT id FROM notifications WHERE player_id = ? ORDER BY id DESC LIMIT ?)',
      playerId,
      playerId,
      keep,
    );
  }
}
