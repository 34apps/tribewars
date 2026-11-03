// SQL for staff tooling on players: the audit log (append-only), staff roles, mutes, lookup. Rules live in staff-service.ts.

import { AUDIT_DETAIL_MAX, isStaffRole, type StaffPlayerSummaryDto, type StaffRole } from '@clanfire/engine';
import { SqlBase, type Raw } from './sql.ts';

export interface NewAudit {
  at: number;
  /** The staff member, or null for the server CLI. */
  actorId: number | null;
  actorIp?: string | null;
  action: string;
  targetPlayer?: number | null;
  detail?: string;
}

export interface AuditRow {
  id: number;
  at: number;
  actorId: number | null;
  actorName: string | null;
  actorIp: string | null;
  action: string;
  targetPlayerId: number | null;
  targetName: string | null;
  detail: string;
}

export interface AuditFilter {
  /** Entries where this player is the actor or the target. */
  player?: number;
  action?: string;
  before?: number;
}

export interface PlayerLookupRow {
  id: number;
  username: string;
  createdAt: number;
  lastActive: number;
  staffRole: StaffRole | null;
  bannedAt: number | null;
  banReason: string | null;
  mutedUntil: number | null;
  muteReason: string | null;
}

const AUDIT_SQL = `SELECT a.id, a.at, a.actor_id, a.actor_ip, a.action, a.target_player, a.detail, ap.username AS actor_name, tp.username AS target_name
  FROM audit_log a LEFT JOIN players ap ON ap.id = a.actor_id LEFT JOIN players tp ON tp.id = a.target_player`;

const toAudit = (r: Raw): AuditRow => ({
  id: r.id as number,
  at: r.at as number,
  actorId: (r.actor_id as number | null) ?? null,
  actorName: (r.actor_name as string | null) ?? null,
  actorIp: (r.actor_ip as string | null) ?? null,
  action: r.action as string,
  targetPlayerId: (r.target_player as number | null) ?? null,
  targetName: (r.target_name as string | null) ?? null,
  detail: r.detail as string,
});

const toLookup = (r: Raw): PlayerLookupRow => ({
  id: r.id as number,
  username: r.username as string,
  createdAt: r.created_at as number,
  lastActive: (r.last_active as number | null) ?? (r.created_at as number),
  staffRole: isStaffRole(r.staff_role) ? r.staff_role : null,
  bannedAt: (r.banned_at as number | null) ?? null,
  banReason: (r.ban_reason as string | null) ?? null,
  mutedUntil: (r.muted_until as number | null) ?? null,
  muteReason: (r.mute_reason as string | null) ?? null,
});

export const toPlayerSummary = (p: PlayerLookupRow, now: number): StaffPlayerSummaryDto => ({
  id: p.id,
  username: p.username,
  createdAt: p.createdAt,
  lastActive: p.lastActive,
  staffRole: p.staffRole,
  bannedAt: p.bannedAt,
  mutedUntil: p.mutedUntil !== null && p.mutedUntil > now ? p.mutedUntil : null,
});

const LOOKUP_SQL = 'SELECT id, username, created_at, last_active, staff_role, banned_at, ban_reason, muted_until, mute_reason FROM players';

/** Escape LIKE wildcards so a search for "a_b" or "%" matches literally. */
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class StaffStore extends SqlBase {
  // ---- audit ---------------------------------------------------------------------------------------

  audit(e: NewAudit): void {
    const detail = [...(e.detail ?? '')].slice(0, AUDIT_DETAIL_MAX).join('');
    this.run(
      'INSERT INTO audit_log (at, actor_id, actor_ip, action, target_player, detail) VALUES (?, ?, ?, ?, ?, ?)',
      e.at,
      e.actorId,
      e.actorIp ?? null,
      e.action,
      e.targetPlayer ?? null,
      detail,
    );
  }

  /** Newest first, keyset-paged by id. */
  auditPage(f: AuditFilter, limit: number): AuditRow[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (f.player !== undefined) {
      where.push('(a.actor_id = ? OR a.target_player = ?)');
      params.push(f.player, f.player);
    }
    if (f.action !== undefined) {
      where.push('a.action = ?');
      params.push(f.action);
    }
    if (f.before !== undefined) {
      where.push('a.id < ?');
      params.push(f.before);
    }
    const sql = `${AUDIT_SQL}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY a.id DESC LIMIT ?`;
    return this.all(sql, ...params, limit).map(toAudit);
  }

  /** Entries about one player as the target (profile view). */
  auditAbout(playerId: number, limit: number): AuditRow[] {
    return this.all(`${AUDIT_SQL} WHERE a.target_player = ? ORDER BY a.id DESC LIMIT ?`, playerId, limit).map(toAudit);
  }

  // ---- roles and mutes -----------------------------------------------------------------------------

  setStaffRole(playerId: number, role: StaffRole | null): void {
    this.run('UPDATE players SET staff_role = ? WHERE id = ?', role, playerId);
  }

  setMute(playerId: number, until: number, reason: string): void {
    this.run('UPDATE players SET muted_until = ?, mute_reason = ? WHERE id = ?', until, reason, playerId);
  }

  clearMute(playerId: number): void {
    this.run('UPDATE players SET muted_until = NULL, mute_reason = NULL WHERE id = ?', playerId);
  }

  /** Every staff member (for assignment checks). */
  isStaffId(playerId: number): boolean {
    return this.get('SELECT 1 AS x FROM players WHERE id = ? AND staff_role IS NOT NULL', playerId) !== undefined;
  }

  // ---- lookup --------------------------------------------------------------------------------------

  lookup(id: number): PlayerLookupRow | null {
    const r = this.get(`${LOOKUP_SQL} WHERE id = ?`, id);
    return r ? toLookup(r) : null;
  }

  /** Name search (case-insensitive prefix first, then contains), at most `limit`. */
  search(query: string, limit: number): PlayerLookupRow[] {
    const q = likeEscape(query.toLowerCase());
    return this.all(
      `${LOOKUP_SQL} WHERE username_lower LIKE ? ESCAPE '\\'
       ORDER BY (username_lower LIKE ? ESCAPE '\\') DESC, username_lower LIMIT ?`,
      `%${q}%`,
      `${q}%`,
      limit,
    ).map(toLookup);
  }

  ipsOf(playerId: number): Array<{ ip: string; firstSeen: number; lastSeen: number }> {
    return this.all('SELECT ip, first_seen, last_seen FROM player_ips WHERE player_id = ? ORDER BY last_seen DESC', playerId).map((r) => ({
      ip: r.ip as string,
      firstSeen: r.first_seen as number,
      lastSeen: r.last_seen as number,
    }));
  }

  ticketCountOf(playerId: number): number {
    return Number(this.get('SELECT COUNT(*) AS n FROM tickets WHERE player_id = ?', playerId)?.n ?? 0);
  }

  openReportsAgainst(playerId: number): number {
    return Number(this.get("SELECT COUNT(*) AS n FROM message_reports WHERE reported_player_id = ? AND status = 'open'", playerId)?.n ?? 0);
  }
}
