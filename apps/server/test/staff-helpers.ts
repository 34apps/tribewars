// Shared setup for the staff-tooling tests: staff accounts (roles are set in the database, as the CLI does) and audit reads.

import type { StaffRole } from '@clanfire/engine';
import { newPlayer, type App, type P } from './tribe-helpers.ts';

/** A new player with a staff role. Roles can only be granted through the CLI / database, never over HTTP. */
export async function newStaff(app: App, name: string, role: StaffRole): Promise<P> {
  const p = await newPlayer(app, name);
  app.ctx.store.staff.setStaffRole(p.id, role);
  return p;
}

export interface AuditRowLite {
  action: string;
  actor_id: number | null;
  actor_ip: string | null;
  target_player: number | null;
  detail: string;
}

/** Audit rows straight from the database (oldest first), optionally one action. */
export function auditRows(app: App, action?: string): AuditRowLite[] {
  const db = app.ctx.store.db;
  const sql = `SELECT action, actor_id, actor_ip, target_player, detail FROM audit_log${action ? ' WHERE action = ?' : ''} ORDER BY id`;
  return (action ? db.prepare(sql).all(action) : db.prepare(sql).all()) as unknown as AuditRowLite[];
}
