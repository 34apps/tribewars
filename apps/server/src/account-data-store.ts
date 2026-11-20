// SQL for account deletion and the data export (docs/PRIVACY.md; rules in account-data-service.ts).
// Deletion never removes the players row: it becomes a tombstone so mail, forum posts, chat and reports that name the id keep working.

import type { ExportIpDto, WorldExportDto } from '@clanfire/engine';
import { DEFAULT_CHIEFTAIN } from '@clanfire/engine';
import { SqlBase, type Param } from './sql.ts';

type ExportBody = Omit<WorldExportDto, 'format' | 'worldId' | 'exportedAt' | 'player' | 'villages'>;

/** Parse stored JSON for the export; a damaged value is shown as text rather than failing the whole download. */
function parsed(text: unknown): unknown {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class AccountDataStore extends SqlBase {
  /**
   * Delete everything personal of a player that no other player's view needs. Rows others can see (tribe chat, forum posts and threads,
   * mail the player SENT, message reports, support tickets, the audit log) stay. `tombName` is the name the rest shows for them.
   */
  erasePrivate(playerId: number, tombName: string): void {
    const id = Math.trunc(playerId);
    const same: string[] = [
      'sessions',
      'notes',
      'troop_groups',
      'raid_list_rows',
      'raid_lists',
      'notifications',
      'first_steps',
      'first_steps_card',
      'advisor_log',
      'forum_reads',
      'tribe_applications',
      'player_ips',
      'player_devices',
      'player_activity',
      'player_stats',
      'fighter_totals',
      'strike_chain',
      'chieftain_claims',
      'reports',
    ];
    for (const t of same) this.run(`DELETE FROM ${t} WHERE player_id = ?`, id);
    this.run('DELETE FROM tribe_invites WHERE player_id = ? OR invited_by = ?', id, id);
    this.run('DELETE FROM pair_events WHERE a_player = ? OR b_player = ?', id, id);
    this.run('DELETE FROM renown_pairs WHERE earner_id = ? OR opponent = ?', id, `p:${id}`);
    this.run('DELETE FROM tribe_store_sends WHERE player_id = ?', id);
    this.run('UPDATE tribe_store_ledger SET player_name = ? WHERE player_id = ?', tombName, id);
    // Mail: the player's inbox goes (the sender keeps their sent copy); what they sent stays in the recipients' boxes.
    this.run('UPDATE mail SET deleted_by_recipient = 1 WHERE to_player = ?', id);
    this.run('UPDATE mail SET deleted_by_sender = 1 WHERE from_player = ?', id);
    this.run('DELETE FROM mail WHERE deleted_by_sender = 1 AND deleted_by_recipient = 1');
  }

  /**
   * Replace the old username by the tombstone name where OTHER players read it: player-name fields (`ownerName`, `claimBy`) in the report bodies
   * they hold, and tribe event lines (whole word). Village names are never touched, even when equal. Frozen `world_end` results stay as they are
   * (docs/PRIVACY.md s.2). Rows are narrowed with LIKE first; the JSON is then parsed and rewritten.
   */
  scrubName(oldName: string, tombName: string): void {
    if (!oldName) return;
    const like = (s: string): string => `%${s.replace(/[\\%_]/g, '\\$&')}%`;
    const quoted = JSON.stringify(oldName); // the name as it sits inside the stored JSON
    const fields = new Set(['ownerName', 'claimBy']);
    const walk = (v: unknown): boolean => {
      let changed = false;
      if (Array.isArray(v)) {
        for (const x of v) changed = walk(x) || changed;
      } else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        for (const k of Object.keys(o)) {
          if (fields.has(k) && o[k] === oldName) {
            o[k] = tombName;
            changed = true;
          } else changed = walk(o[k]) || changed;
        }
      }
      return changed;
    };
    for (const r of this.all("SELECT id, battle_json FROM reports WHERE battle_json LIKE ? ESCAPE '\\'", like(quoted))) {
      let body: unknown;
      try {
        body = JSON.parse(r.battle_json as string);
      } catch {
        continue;
      }
      if (walk(body)) this.run('UPDATE reports SET battle_json = ? WHERE id = ?', JSON.stringify(body), r.id as number);
    }
    const word = new RegExp(`(?<![A-Za-z0-9_])${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'g');
    for (const e of this.all("SELECT id, text FROM tribe_events WHERE text LIKE ? ESCAPE '\\'", like(oldName))) {
      const text = (e.text as string).replace(word, () => tombName);
      if (text !== e.text) this.run('UPDATE tribe_events SET text = ? WHERE id = ?', text, e.id as number);
    }
  }

  /** The row keeps its id and becomes "Deleted player <id>": no way to sign in, no lobby link, no ban, no role, nothing paid. */
  tombstone(playerId: number, name: string, now: number): void {
    this.run(
      `UPDATE players SET username = ?, username_lower = ?, password_hash = '', account_id = NULL, deleted_at = ?, chieftain = ?, badges_json = NULL,
         household_shared = 0, banned_at = NULL, ban_reason = NULL, muted_until = NULL, mute_reason = NULL, staff_role = NULL, premium = 0,
         abandoned_notice = 0, protected_until = 0, last_active = NULL, renown_total = 0, renown_spent = 0, renown_reserved = 0, chest_gold = 0, chest_reserved = 0
       WHERE id = ?`,
      name,
      name.toLowerCase(),
      now,
      DEFAULT_CHIEFTAIN,
      Math.trunc(playerId),
    );
    this.run('DELETE FROM abandoned_villages WHERE player_id = ?', Math.trunc(playerId)); // a tombstone never gets a return summary
  }

  // ---- export ----------------------------------------------------------------------------------------

  /** Everything the world export lists about one player apart from the profile and villages (those come from the main store). */
  exportBody(playerId: number): ExportBody {
    const id = Math.trunc(playerId);
    const notes = this.all('SELECT kind, target_id, text, tags, updated_at FROM notes WHERE player_id = ? ORDER BY id', id).map((r) => ({
      kind: r.kind,
      targetId: r.target_id,
      text: r.text,
      tags: parsed(r.tags),
      updatedAt: r.updated_at,
    }));
    const troopGroups = this.all('SELECT name, units, created_at FROM troop_groups WHERE player_id = ? ORDER BY id', id).map((r) => ({
      name: r.name,
      units: parsed(r.units),
      createdAt: r.created_at,
    }));
    const raidLists = this.all('SELECT id, name, created_at FROM raid_lists WHERE player_id = ? ORDER BY id', id).map((l) => ({
      name: l.name,
      createdAt: l.created_at,
      rows: this.all('SELECT village_id, from_village_id, units_json, created_at FROM raid_list_rows WHERE list_id = ? AND player_id = ? ORDER BY id', l.id as number, id).map((r) => ({
        villageId: r.village_id,
        fromVillageId: r.from_village_id,
        units: parsed(r.units_json),
        createdAt: r.created_at,
      })),
    }));
    const mail = this.all(
      `SELECT m.id, m.created_at, f.username AS from_name, t.username AS to_name, m.subject, m.body
         FROM mail m JOIN players f ON f.id = m.from_player JOIN players t ON t.id = m.to_player
        WHERE (m.from_player = ? AND m.deleted_by_sender = 0) OR (m.to_player = ? AND m.deleted_by_recipient = 0)
        ORDER BY m.id`,
      id,
      id,
    ).map((r) => ({ id: r.id as number, at: r.created_at as number, from: r.from_name as string, to: r.to_name as string, subject: r.subject as string, body: r.body as string }));
    const forumPosts = this.all(
      'SELECT p.created_at, t.title, p.body FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id WHERE p.author_id = ? ORDER BY p.id',
      id,
    ).map((r) => ({ at: r.created_at as number, thread: r.title as string, body: r.body as string }));
    const tribeChat = this.all('SELECT created_at, text FROM tribe_messages WHERE player_id = ? ORDER BY id', id).map((r) => ({ at: r.created_at as number, body: r.text as string }));
    const reports = this.all(
      "SELECT created_at, COALESCE(json_extract(battle_json, '$.type'), 'battle') AS kind, title FROM reports WHERE player_id = ? ORDER BY id",
      id,
    ).map((r) => ({ at: r.created_at as number, kind: String(r.kind), title: r.title as string }));
    const ips: ExportIpDto[] = this.all('SELECT ip, first_seen, last_seen FROM player_ips WHERE player_id = ? ORDER BY last_seen DESC', id).map((r) => ({
      ip: r.ip as string,
      firstSeen: r.first_seen as number,
      lastSeen: r.last_seen as number,
    }));
    const devices = this.all('SELECT substr(device_hash, 1, 8) AS label, first_seen, last_seen FROM player_devices WHERE player_id = ? ORDER BY last_seen DESC', id).map((r) => ({
      label: r.label as string,
      firstSeen: r.first_seen as number,
      lastSeen: r.last_seen as number,
    }));
    const supportTickets = this.all('SELECT created_at, subject FROM tickets WHERE player_id = ? ORDER BY id', id as Param).map((r) => ({ at: r.created_at as number, subject: r.subject as string }));
    return { notes, troopGroups, raidLists, mail, forumPosts, tribeChat, reports, ips, devices, supportTickets };
  }
}
