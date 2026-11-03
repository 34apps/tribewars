// Player reports of user-written messages (mail, forum posts, tribe chat) and of players. The server decides who is
// being reported from the message itself and only accepts messages the reporter could actually see. A copy of the text
// is kept as evidence. Staff handle reports in routes/staff.ts; reporters stay hidden from the reported player.

import {
  GameError,
  REPORTS_PER_DAY,
  REPORTS_PER_HOUR,
  REPORT_NOTE_MAX,
  REPORT_RESOLUTION_MAX,
  REPORT_SNAPSHOT_MAX,
  MESSAGE_REPORT_CATEGORIES,
  STAFF_PAGE_SIZE,
  type CreateMessageReportRequest,
  type MessageReportCategory,
  type MessageReportReceipt,
  type MessageReportStatus,
  type ResolveReportRequest,
  type StaffReportDto,
  type StaffReportListResponse,
} from '@clanfire/engine';
import type { ReportEntryRow } from './report-store.ts';
import type { StaffActing } from './support-service.ts';
import type { ForumService } from './forum-service.ts';
import type { PlayerRow, Store } from './store.ts';
import { cleanText, len } from './tribe-service.ts';

const HOUR = 3_600_000;
const DAY = 86_400_000;

const notFound = (): GameError => new GameError('not_found', 'That message does not exist.');
const clip = (s: string, max: number): string => [...s].slice(0, max).join('');

const dto = (r: ReportEntryRow): StaffReportDto => ({
  id: r.id,
  kind: r.kind,
  refId: r.refId,
  reporterId: r.reporterId,
  reporterName: r.reporterName,
  reportedPlayerId: r.reportedPlayerId,
  reportedName: r.reportedName,
  snapshot: r.snapshot,
  category: r.category,
  note: r.note,
  status: r.status,
  handledBy: r.handledBy,
  handledAt: r.handledAt,
  resolutionNote: r.resolutionNote,
  createdAt: r.createdAt,
});

export class ReportService {
  constructor(
    private readonly store: Store,
    private readonly forum: ForumService,
  ) {}

  private get rs() {
    return this.store.msgReports;
  }

  create(reporter: PlayerRow, req: CreateMessageReportRequest, t: number): MessageReportReceipt {
    if (!(MESSAGE_REPORT_CATEGORIES as readonly string[]).includes(req.category)) throw new GameError('invalid_input', 'Unknown report category.');
    const note = req.note === undefined ? '' : cleanText(req.note, 'The note');
    if (len(note) > REPORT_NOTE_MAX) throw new GameError('invalid_input', `The note can have at most ${REPORT_NOTE_MAX} characters.`);
    if (req.kind === 'player' && note === '') throw new GameError('invalid_input', 'Tell us what the player did.');

    return this.store.tx(() => {
      const found = this.locate(reporter, req);
      if (found.reportedId === reporter.id) throw new GameError('invalid_input', "You can't report yourself.");
      if (this.rs.openDuplicate(reporter.id, req.kind, found.refId, found.reportedId)) {
        throw new GameError('invalid_input', 'You have already reported this. Our team will look at it.');
      }
      if (this.rs.countSince(reporter.id, t - HOUR) >= REPORTS_PER_HOUR || this.rs.countSince(reporter.id, t - DAY) >= REPORTS_PER_DAY) {
        throw new GameError('rate_limited', 'You have sent many reports. Please try again later.');
      }
      const id = this.rs.insert({
        reporterId: reporter.id,
        reportedPlayerId: found.reportedId,
        kind: req.kind,
        refId: found.refId,
        snapshot: clip(found.snapshot, REPORT_SNAPSHOT_MAX),
        category: req.category as MessageReportCategory,
        note,
        createdAt: t,
      });
      return { id, status: 'open' };
    });
  }

  /** What is being reported: the author and a copy of the text, only for messages the reporter can see. */
  private locate(reporter: PlayerRow, req: CreateMessageReportRequest): { reportedId: number; refId: number | null; snapshot: string } {
    if (req.kind === 'player') {
      const name = cleanText(req.username ?? '', 'The username').normalize('NFC');
      const p = name === '' ? null : this.store.getPlayerByLowerName(name.toLowerCase());
      if (!p) throw new GameError('not_found', 'There is no such player.');
      return { reportedId: p.id, refId: null, snapshot: '' };
    }
    if (req.refId === undefined) throw new GameError('invalid_input', 'Say which message you are reporting.');
    if (req.kind === 'mail') {
      const m = this.store.mail.byId(req.refId);
      if (!m || m.toId !== reporter.id || m.deletedByRecipient) throw notFound(); // only mail the reporter received
      return { reportedId: m.fromId, refId: m.id, snapshot: `Subject: ${m.subject}\n\n${m.body}` };
    }
    if (req.kind === 'forum_post') {
      const { post, title } = this.forum.postVisibleTo(reporter, req.refId);
      return { reportedId: post.authorId, refId: post.id, snapshot: `Thread: ${title}\n\n${post.body}` };
    }
    const mem = this.store.tribes.membership(reporter.id);
    const msg = mem ? this.store.tribes.messageInTribe(mem.tribeId, req.refId) : null;
    if (!msg) throw notFound();
    return { reportedId: msg.playerId, refId: msg.id, snapshot: msg.text };
  }

  // ---- staff -------------------------------------------------------------------------------------

  list(f: { status?: MessageReportStatus; category?: MessageReportCategory; before?: number }): StaffReportListResponse {
    const rows = this.rs.page(f, STAFF_PAGE_SIZE + 1);
    const shown = rows.slice(0, STAFF_PAGE_SIZE);
    return { reports: shown.map(dto), nextBefore: rows.length > STAFF_PAGE_SIZE ? shown[shown.length - 1]!.id : null };
  }

  get(id: number): StaffReportDto {
    return dto(this.row(id));
  }

  resolve(a: StaffActing, id: number, req: ResolveReportRequest): StaffReportDto {
    const note = req.resolutionNote === undefined ? '' : cleanText(req.resolutionNote, 'The note');
    if (len(note) > REPORT_RESOLUTION_MAX) throw new GameError('invalid_input', `The note can have at most ${REPORT_RESOLUTION_MAX} characters.`);
    return this.store.tx(() => {
      const r = this.row(id);
      if (!this.rs.resolve(id, req.status, a.staff.id, a.t, note)) throw new GameError('requirements_not_met', 'This report has already been handled.');
      this.store.audit({ at: a.t, actorId: a.staff.id, actorIp: a.ip, action: 'report_resolve', targetPlayer: r.reportedPlayerId, detail: `report #${id}: ${req.status}${note ? `: ${note}` : ''}` });
      return dto(this.row(id));
    });
  }

  private row(id: number): ReportEntryRow {
    const r = this.rs.byId(id);
    if (!r) throw new GameError('not_found', 'That report does not exist.');
    return r;
  }
}
