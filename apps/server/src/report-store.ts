// SQL for player reports of messages (message_reports). Rules live in report-service.ts.

import type { MessageReportCategory, MessageReportKind, MessageReportStatus } from '@clanfire/engine';
import { SqlBase, type Raw } from './sql.ts';

export interface ReportEntryRow {
  id: number;
  reporterId: number;
  reporterName: string;
  reportedPlayerId: number;
  reportedName: string;
  kind: MessageReportKind;
  refId: number | null;
  snapshot: string;
  category: MessageReportCategory;
  note: string;
  status: MessageReportStatus;
  handledBy: number | null;
  handledAt: number | null;
  resolutionNote: string;
  createdAt: number;
}

export interface NewReportEntry {
  reporterId: number;
  reportedPlayerId: number;
  kind: MessageReportKind;
  refId: number | null;
  snapshot: string;
  category: MessageReportCategory;
  note: string;
  createdAt: number;
}

const SELECT = `SELECT r.*, rp.username AS reporter_name, dp.username AS reported_name
  FROM message_reports r JOIN players rp ON rp.id = r.reporter_id JOIN players dp ON dp.id = r.reported_player_id`;

const toRow = (r: Raw): ReportEntryRow => ({
  id: r.id as number,
  reporterId: r.reporter_id as number,
  reporterName: r.reporter_name as string,
  reportedPlayerId: r.reported_player_id as number,
  reportedName: r.reported_name as string,
  kind: r.kind as MessageReportKind,
  refId: (r.ref_id as number | null) ?? null,
  snapshot: r.snapshot as string,
  category: r.category as MessageReportCategory,
  note: r.note as string,
  status: r.status as MessageReportStatus,
  handledBy: (r.handled_by as number | null) ?? null,
  handledAt: (r.handled_at as number | null) ?? null,
  resolutionNote: r.resolution_note as string,
  createdAt: r.created_at as number,
});

export class ReportStore extends SqlBase {
  byId(id: number): ReportEntryRow | null {
    const r = this.get(`${SELECT} WHERE r.id = ?`, id);
    return r ? toRow(r) : null;
  }

  insert(n: NewReportEntry): number {
    return this.run(
      `INSERT INTO message_reports (reporter_id, reported_player_id, kind, ref_id, snapshot, category, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      n.reporterId,
      n.reportedPlayerId,
      n.kind,
      n.refId,
      n.snapshot,
      n.category,
      n.note,
      n.createdAt,
    ).id;
  }

  /** An open report by this reporter about the same message (or, for kind `player`, the same player). */
  openDuplicate(reporterId: number, kind: MessageReportKind, refId: number | null, reportedPlayerId: number): boolean {
    const r =
      refId === null
        ? this.get(
            "SELECT 1 AS x FROM message_reports WHERE reporter_id = ? AND kind = ? AND ref_id IS NULL AND reported_player_id = ? AND status = 'open'",
            reporterId,
            kind,
            reportedPlayerId,
          )
        : this.get("SELECT 1 AS x FROM message_reports WHERE reporter_id = ? AND kind = ? AND ref_id = ? AND status = 'open'", reporterId, kind, refId);
    return r !== undefined;
  }

  countSince(reporterId: number, since: number): number {
    return Number(this.get('SELECT COUNT(*) AS n FROM message_reports WHERE reporter_id = ? AND created_at > ?', reporterId, since)?.n ?? 0);
  }

  /** Newest first, keyset-paged by id. */
  page(f: { status?: MessageReportStatus; category?: MessageReportCategory; before?: number }, limit: number): ReportEntryRow[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (f.status !== undefined) {
      where.push('r.status = ?');
      params.push(f.status);
    }
    if (f.category !== undefined) {
      where.push('r.category = ?');
      params.push(f.category);
    }
    if (f.before !== undefined) {
      where.push('r.id < ?');
      params.push(f.before);
    }
    const sql = `${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY r.id DESC LIMIT ?`;
    return this.all(sql, ...params, limit).map(toRow);
  }

  /** Only while still open; false if someone else handled it first. */
  resolve(id: number, status: 'actioned' | 'dismissed', by: number, at: number, note: string): boolean {
    return this.run("UPDATE message_reports SET status = ?, handled_by = ?, handled_at = ?, resolution_note = ? WHERE id = ? AND status = 'open'", status, by, at, note, id).changes === 1;
  }
}
